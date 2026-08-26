"""Small desktop editor for video-driven VOZUAL sign authoring."""

from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import quote

import cv2
import numpy as np
from PIL import Image, ImageTk

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.authoring_pipeline import generate_preview
    from src.linguistic_catalog import (
        editor_metadata,
        preview_renderable_plan,
        unpublish_entry,
        upsert_editor_entry,
        write_published_motion_manifest,
    )
    from src.sign_catalog import (
        CATEGORIES,
        CATEGORY_ALL,
        USEFUL_PHRASE_PRESETS,
        SignCatalogEntry,
        UsefulPhrasePreset,
        example_phrase_for_gloss,
        missing_glosses_for_phrase,
        suggested_signs,
    )
    from src.sign_recipe import SignRecipe
    from src.video_reference_recorder import record_video
    from src.video_sign_import import (
        build_recipe,
        import_video,
        write_landmark_skeleton_preview,
    )
else:
    from .authoring_pipeline import generate_preview
    from .linguistic_catalog import (
        editor_metadata,
        preview_renderable_plan,
        unpublish_entry,
        upsert_editor_entry,
        write_published_motion_manifest,
    )
    from .sign_catalog import (
        CATEGORIES,
        CATEGORY_ALL,
        USEFUL_PHRASE_PRESETS,
        SignCatalogEntry,
        UsefulPhrasePreset,
        example_phrase_for_gloss,
        missing_glosses_for_phrase,
        suggested_signs,
    )
    from .sign_recipe import SignRecipe
    from .video_reference_recorder import record_video
    from .video_sign_import import (
        build_recipe,
        import_video,
        write_landmark_skeleton_preview,
    )

REPO_ROOT = Path(__file__).resolve().parents[2]


class _MobilePreviewRequestHandler(SimpleHTTPRequestHandler):
    """Serve the local mobile runtime without writing browser requests to stdout."""

    def log_message(self, _format: str, *_args: object) -> None:
        return


class SignAuthoringEditor:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("VOZUAL — Editor de señas")
        root.geometry("760x820")
        root.configure(bg="#07111f")
        self.video_path = tk.StringVar()
        self.gloss = tk.StringVar(value="GRACIAS")
        self.speech_aliases = tk.StringVar(value="")
        self.speech_aliases_input: tk.Text | None = None
        self._updating_speech_aliases_input = False
        self.speech_aliases_overridden = False
        self.linguistic_categories = tk.StringVar(value="sin_clasificar")
        self.lexical_class = tk.StringVar(value="noun")
        self.lsc_verb_type = tk.StringVar(value="none")
        self.linguistic_review_status = tk.StringVar(value="draft")
        self.show_linguistic_details = tk.BooleanVar(value=False)
        self.linguistic_summary = tk.StringVar()
        self.linguistic_example = tk.StringVar(value="")
        self.linguistic_plan_preview = tk.StringVar(
            value="Escribe una frase para comprobar qué señas publicadas puede renderizar la app."
        )
        self.loaded_review_gloss: str | None = None
        self.suggestion_category = tk.StringVar(value=CATEGORY_ALL)
        self.suggestion_label = tk.StringVar(value="Leyendo señas pendientes…")
        self.current_suggestion: SignCatalogEntry | None = None
        self.duration_seconds = tk.DoubleVar(value=1.2)
        self.anchor = tk.StringVar(value="chin")
        self.contact_palm = tk.StringVar(value="camera")
        self.release_palm = tk.StringVar(value="up")
        self.forward = tk.DoubleVar(value=0.45)
        self.return_to_rest = tk.BooleanVar(value=True)
        self.entry_height_cm = tk.DoubleVar(value=0.0)
        self.entry_lateral_cm = tk.DoubleVar(value=0.0)
        self.entry_depth_cm = tk.DoubleVar(value=0.0)
        self.exit_height_cm = tk.DoubleVar(value=0.0)
        self.exit_lateral_cm = tk.DoubleVar(value=0.0)
        self.exit_depth_cm = tk.DoubleVar(value=0.0)
        self.motion_keyframes: list[dict[str, object]] = []
        self.motion_kind = tk.StringVar(value="point")
        self.motion_time_seconds = tk.DoubleVar(value=0.5)
        self.timeline_seconds = tk.DoubleVar(value=0.0)
        self.timeline_label = tk.StringVar(value="MOMENTO ACTUAL: 0.000 s")
        self.motion_height_cm = tk.DoubleVar(value=0.0)
        self.motion_lateral_cm = tk.DoubleVar(value=0.0)
        self.motion_depth_cm = tk.DoubleVar(value=0.0)
        # Facial values are normalized morph amounts (0 = neutral, 1 = full).
        # They live on the same timeline as the wrist adjustments.
        self.face_jaw_open = tk.DoubleVar(value=0.0)
        self.face_eye_wide = tk.DoubleVar(value=0.0)
        self.face_brow_raise = tk.DoubleVar(value=0.0)
        self.status = tk.StringVar(
            value="Escribe el nombre, indica la duración y pulsa GRABAR SEÑA."
        )
        self.step_status = tk.StringVar(
            value="PASO ACTUAL: graba o selecciona un video."
        )
        self.recipe_path: Path | None = None
        self.landmark_path: Path | None = None
        self.tracking_preview_path: Path | None = None
        self.skeleton_preview_path: Path | None = None
        self.avatar_preview_path: Path | None = None
        self.mobile_preview_button: tk.Button | None = None
        self.mobile_preview_server: ThreadingHTTPServer | None = None
        self.mobile_preview_url: str | None = None
        self.mobile_preview_gloss: str | None = None
        self.mobile_preview_root: Path | None = None
        self.mobile_preview_signatures: dict[
            str, tuple[tuple[str, int, int], ...]
        ] = {}
        self.created_sign_paths: dict[str, tuple[Path, Path]] = {}
        self.created_sign_labels: dict[str, str] = {}
        self.created_sign_list: tk.Listbox | None = None
        self.library_filter = tk.StringVar(value="pending")
        self.library_filter_button: tk.Button | None = None
        self.publish_pending_button: tk.Button | None = None
        self.mobile_library_status = tk.StringVar(value="APP MÓVIL: leyendo biblioteca…")
        self.library_selection_status = tk.StringVar(
            value="Selecciona una seña para editarla o publicarla."
        )
        self.reference_frames: list[list[list[float]]] = []
        self.reference_fps = 30
        self.reference_active_hand = "right"
        self.reference_hand_label = tk.StringVar(value="CAPTURA ORIGINAL: aún no cargada")
        self.tracking_capture: cv2.VideoCapture | None = None
        self.timeline_preview_label: tk.Label | None = None
        self.timeline_preview_image: ImageTk.PhotoImage | None = None
        self.brand_wordmark_image: ImageTk.PhotoImage | None = None
        self.brand_symbol_image: ImageTk.PhotoImage | None = None
        self.stage_cards: list[tuple[tk.Frame, tk.Label, tk.Label]] = []
        self.live_state_path: Path | None = None
        for variable in (
            self.motion_height_cm,
            self.motion_lateral_cm,
            self.motion_depth_cm,
            self.face_jaw_open,
            self.face_eye_wide,
            self.face_brow_raise,
            self.timeline_seconds,
        ):
            variable.trace_add("write", lambda *_args: self._write_live_avatar_state())
        self._build()
        self.root.protocol("WM_DELETE_WINDOW", self._close_editor)
        self.speech_aliases.trace_add("write", self._refresh_speech_aliases_input)
        self._set_default_speech_aliases(self.gloss.get())
        self._update_linguistic_summary()
        self._restore_latest_recording()
        self._refresh_created_signs()

    def _build(self) -> None:
        background = "#07111f"
        card = "#111e2e"
        card_soft = "#172638"
        text = "#f5f8fc"
        muted = "#9fb0c4"
        accent = "#20d6ce"
        warning = "#ffc857"
        danger = "#ff5b76"

        self.root.geometry("1120x720")
        self.root.minsize(980, 650)
        self.root.configure(bg=background)
        style = ttk.Style()
        style.configure(
            "VOZUAL.Horizontal.TProgressbar",
            troughcolor=card_soft,
            background=accent,
            bordercolor=card_soft,
            lightcolor=accent,
            darkcolor=accent,
        )

        frame = tk.Frame(self.root, bg=background, padx=28, pady=22)
        frame.pack(fill="both", expand=True)
        frame.grid_columnconfigure(0, weight=3, uniform="workspace")
        frame.grid_columnconfigure(1, weight=2, uniform="workspace")
        frame.grid_rowconfigure(1, weight=1)

        header = tk.Frame(frame, bg=background)
        header.grid(row=0, column=0, columnspan=2, sticky="ew")
        brand = tk.Frame(header, bg=background)
        brand.pack(side="left")
        brand_visual = tk.Frame(brand, bg=background)
        brand_visual.pack(anchor="w")
        symbol_path = REPO_ROOT / "mobile" / "assets" / "images" / "vozual" / "vozual-macos-icon.png"
        try:
            symbol = Image.open(symbol_path).convert("RGBA")
            symbol.thumbnail((54, 54), Image.Resampling.LANCZOS)
            self.brand_symbol_image = ImageTk.PhotoImage(symbol)
            tk.Label(
                brand_visual,
                image=self.brand_symbol_image,
                bg=background,
                bd=0,
            ).pack(side="left", padx=(0, 9))
        except (OSError, tk.TclError):
            pass
        tk.Label(
            brand_visual,
            text="VOZUAL",
            fg=text,
            bg=background,
            font=("Arial", 26, "bold"),
        ).pack(side="left")
        tk.Label(
            brand,
            text="VIDEO  →  SEÑA DEL AVATAR LSC",
            fg=accent,
            bg=background,
            font=("Arial", 10, "bold"),
        ).pack(anchor="w")
        tk.Label(
            header,
            text="●  PROCESAMIENTO LOCAL",
            fg=accent,
            bg=card,
            padx=14,
            pady=8,
            font=("Arial", 9, "bold"),
        ).pack(side="right", anchor="n")

        # Stage state is still used to keep status messages synchronized, but
        # the three-card tutorial was removed: the two visible work areas make
        # the workflow clearer without a second, competing navigation system.
        self.stage_summary = tk.StringVar(value="GRABA UNA TOMA")
        self.stage_progress = tk.IntVar(value=1)
        self.stage_cards = []

        capture_card = tk.Frame(frame, bg=card, padx=18, pady=16)
        capture_card.grid(row=1, column=0, sticky="nsew", padx=(0, 7), pady=(14, 0))
        tk.Label(
            capture_card,
            text="CREAR O EDITAR UNA SEÑA",
            fg=text,
            bg=card,
            font=("Arial", 16, "bold"),
        ).pack(anchor="w")
        tk.Label(
            capture_card,
            text=(
                "Para una seña nueva: escribe el nombre, graba una toma y crea la animación.\n"
                "Para una seña existente: cárgala desde la biblioteca de la derecha; "
                "no necesitas grabar otra vez."
            ),
            fg=muted,
            bg=card,
            font=("Arial", 10),
        ).pack(anchor="w", pady=(3, 10))

        # Keep the next action permanently above the fold. The previous layout
        # placed the action that creates the animation below optional metadata,
        # making the primary workflow appear to end at recording.
        workflow_card = tk.Frame(capture_card, bg=card_soft, padx=12, pady=10)
        workflow_card.pack(fill="x", pady=(0, 12))
        tk.Label(
            workflow_card,
            text="SIGUIENTE PASO",
            fg=accent,
            bg=card_soft,
            font=("Arial", 8, "bold"),
        ).grid(row=0, column=0, columnspan=2, sticky="w")
        tk.Label(
            workflow_card,
            text="Graba o elige una toma. Cuando esté lista, crea la animación aquí.",
            fg=muted,
            bg=card_soft,
            font=("Arial", 8),
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 7))
        workflow_card.grid_columnconfigure(0, weight=1)
        workflow_card.grid_columnconfigure(1, weight=1)
        camera_button = tk.Button(
            workflow_card,
            text="ABRIR CÁMARA Y GRABAR",
            command=self._record_video,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 10, "bold"),
            cursor="pointinghand",
        )
        camera_button.grid(row=2, column=0, sticky="ew", padx=(0, 4), ipady=6)
        self.automatic_button = tk.Button(
            workflow_card,
            text="CREAR ANIMACIÓN",
            command=self._create_automatically,
            bg=accent,
            fg=background,
            activebackground="#58e8e1",
            activeforeground=background,
            relief="flat",
            font=("Arial", 10, "bold"),
            cursor="pointinghand",
            state="disabled",
        )
        self.automatic_button.grid(row=2, column=1, sticky="ew", padx=(4, 0), ipady=6)
        video_row = tk.Frame(workflow_card, bg="#0d1928", padx=8, pady=5)
        video_row.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        tk.Label(video_row, text="TOMA", fg=accent, bg="#0d1928", font=("Arial", 8, "bold")).pack(side="left", padx=(0, 7))
        tk.Entry(
            video_row,
            textvariable=self.video_path,
            bg="#0d1928",
            fg=muted,
            readonlybackground="#0d1928",
            relief="flat",
            state="readonly",
            font=("Arial", 8),
        ).pack(side="left", fill="x", expand=True)
        tk.Button(
            video_row,
            text="ELEGIR VIDEO",
            command=self._choose_video,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        ).pack(side="right", padx=(8, 0), ipady=3)
        tk.Button(
            video_row,
            text="VER TOMA",
            command=self._open_source_video,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        ).pack(side="right", padx=(8, 0), ipady=3)

        fields = tk.Frame(capture_card, bg=card)
        fields.pack(fill="x")
        name_field = tk.Frame(fields, bg=card)
        name_field.grid(row=0, column=0, sticky="ew")
        fields.grid_columnconfigure(0, weight=1)
        tk.Label(name_field, text="NOMBRE DE LA SEÑA", fg=muted, bg=card, font=("Arial", 9, "bold")).pack(anchor="w", pady=(0, 5))
        tk.Entry(
            name_field,
            textvariable=self.gloss,
            bg=card_soft,
            fg=text,
            insertbackground=text,
            relief="flat",
            font=("Arial", 14, "bold"),
        ).pack(fill="x", ipady=5)

        aliases_field = tk.Frame(fields, bg=card)
        aliases_field.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        tk.Label(
            aliases_field,
            text="OTRAS FORMAS DE VOZ (SEPARADAS POR COMAS)",
            fg=muted,
            bg=card,
            font=("Arial", 8, "bold"),
        ).pack(anchor="w", pady=(0, 5))
        aliases_input_frame = tk.Frame(aliases_field, bg=card_soft)
        aliases_input_frame.pack(fill="x")
        aliases_scrollbar = tk.Scrollbar(aliases_input_frame)
        aliases_scrollbar.pack(side="right", fill="y")
        self.speech_aliases_input = tk.Text(
            aliases_input_frame,
            bg=card_soft,
            fg=text,
            insertbackground=text,
            relief="flat",
            font=("Arial", 10),
            height=4,
            wrap="word",
            padx=8,
            pady=7,
            yscrollcommand=aliases_scrollbar.set,
            undo=True,
        )
        self.speech_aliases_input.pack(side="left", fill="x", expand=True)
        aliases_scrollbar.configure(command=self.speech_aliases_input.yview)
        self.speech_aliases_input.bind(
            "<<Modified>>", self._on_speech_aliases_input_modified
        )
        tk.Label(
            aliases_field,
            text=(
                "El nombre de la seña ya se reconoce automáticamente. "
                "Aquí aparecen conjugaciones o equivalentes seguros que usan la misma animación."
            ),
            fg=muted,
            bg=card,
            font=("Arial", 8),
            wraplength=560,
            justify="left",
        ).pack(anchor="w", pady=(4, 0))
        self.update_voice_forms_button = tk.Button(
            aliases_field,
            text="GUARDAR PALABRAS Y ACTUALIZAR APP MÓVIL",
            command=self._update_loaded_sign_voice_forms,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
            padx=10,
            pady=5,
        )
        self.update_voice_forms_button.pack(anchor="e", pady=(6, 0))

        linguistic_field = tk.Frame(fields, bg=card)
        linguistic_field.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        tk.Label(
            linguistic_field,
            text="CLASIFICACIÓN LINGÜÍSTICA",
            fg=accent,
            bg=card,
            font=("Arial", 8, "bold"),
        ).grid(row=0, column=0, sticky="w")
        linguistic_field.grid_columnconfigure(0, weight=1)
        self.linguistic_details_button = tk.Button(
            linguistic_field,
            text="EDITAR DETALLES",
            command=self._toggle_linguistic_details,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        )
        self.linguistic_details_button.grid(row=0, column=1, sticky="e")
        tk.Label(
            linguistic_field,
            textvariable=self.linguistic_summary,
            fg=muted,
            bg=card,
            font=("Arial", 8),
            wraplength=560,
            justify="left",
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(3, 0))
        self.linguistic_details = tk.Frame(linguistic_field, bg=card)
        self.linguistic_details.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(7, 0))
        for column in range(4):
            self.linguistic_details.grid_columnconfigure(column, weight=1)
        tk.Label(self.linguistic_details, text="CATEGORÍA", fg=muted, bg=card, font=("Arial", 8, "bold")).grid(row=0, column=0, sticky="w")
        tk.Label(self.linguistic_details, text="CLASE", fg=muted, bg=card, font=("Arial", 8, "bold")).grid(row=0, column=1, sticky="w", padx=(6, 0))
        tk.Label(self.linguistic_details, text="VERBO LSC", fg=muted, bg=card, font=("Arial", 8, "bold")).grid(row=0, column=2, sticky="w", padx=(6, 0))
        tk.Label(self.linguistic_details, text="REVISIÓN", fg=muted, bg=card, font=("Arial", 8, "bold")).grid(row=0, column=3, sticky="w", padx=(6, 0))
        tk.Entry(
            self.linguistic_details,
            textvariable=self.linguistic_categories,
            bg=card_soft,
            fg=text,
            insertbackground=text,
            relief="flat",
            font=("Arial", 9),
        ).grid(row=1, column=0, sticky="ew", pady=(3, 0))
        ttk.Combobox(
            self.linguistic_details,
            textvariable=self.lexical_class,
            values=("noun", "verb", "adjective", "pronoun", "question", "negation", "fixed_expression"),
            state="readonly",
            font=("Arial", 9),
        ).grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=(3, 0))
        ttk.Combobox(
            self.linguistic_details,
            textvariable=self.lsc_verb_type,
            values=("none", "plain", "directional_review_required", "spatial_review_required"),
            state="readonly",
            font=("Arial", 9),
        ).grid(row=1, column=2, sticky="ew", padx=(6, 0), pady=(3, 0))
        ttk.Combobox(
            self.linguistic_details,
            textvariable=self.linguistic_review_status,
            values=("draft", "reviewed", "approved", "legacy_approved", "blocked"),
            state="readonly",
            font=("Arial", 9),
        ).grid(row=1, column=3, sticky="ew", padx=(6, 0), pady=(3, 0))
        tk.Label(
            self.linguistic_details,
            text="Los verbos direccionales y espaciales requieren revisión señante.",
            fg=muted,
            bg=card,
            font=("Arial", 8),
            wraplength=560,
            justify="left",
        ).grid(row=2, column=0, columnspan=4, sticky="w", pady=(4, 0))
        tk.Entry(
            self.linguistic_details,
            textvariable=self.linguistic_example,
            bg=card_soft,
            fg=text,
            insertbackground=text,
            relief="flat",
            font=("Arial", 9),
        ).grid(row=3, column=0, columnspan=3, sticky="ew", pady=(7, 0))
        tk.Button(
            self.linguistic_details,
            text="PROBAR FRASE",
            command=self._preview_linguistic_plan,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        ).grid(row=3, column=3, sticky="ew", padx=(6, 0), pady=(7, 0))
        tk.Label(
            self.linguistic_details,
            textvariable=self.linguistic_plan_preview,
            fg=accent,
            bg=card,
            font=("Arial", 8, "bold"),
            wraplength=560,
            justify="left",
        ).grid(row=4, column=0, columnspan=4, sticky="w", pady=(4, 0))
        self.linguistic_details.grid_remove()

        suggestion_card = tk.Frame(capture_card, bg=card_soft, padx=12, pady=8)
        suggestion_card.pack(fill="x", pady=(10, 0))
        tk.Label(
            suggestion_card,
            text="RUTA GUIADA DE VOCABULARIO",
            fg=accent,
            bg=card_soft,
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=0, sticky="w")
        tk.Button(
            suggestion_card,
            text="VER PALABRAS Y FRASES",
            command=self._open_vocabulary_planner,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
            cursor="pointinghand",
        ).grid(row=0, column=1, sticky="e")
        tk.Label(
            suggestion_card,
            text=(
                "Pulsa la recomendación: VOZUAL la prepara y sortea otra palabra "
                "pendiente."
            ),
            fg=muted,
            bg=card_soft,
            font=("Arial", 8),
            wraplength=560,
            justify="left",
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(3, 8))
        tk.Label(suggestion_card, text="CATEGORÍA", fg=muted, bg=card_soft, font=("Arial", 8, "bold")).grid(row=2, column=0, sticky="w")
        category_box = ttk.Combobox(
            suggestion_card,
            textvariable=self.suggestion_category,
            values=CATEGORIES,
            state="readonly",
            font=("Arial", 10, "bold"),
        )
        category_box.grid(row=3, column=0, sticky="ew", padx=(0, 6), pady=(3, 0))
        category_box.bind("<<ComboboxSelected>>", self._on_suggestion_category_changed)
        tk.Button(
            suggestion_card,
            textvariable=self.suggestion_label,
            command=self._use_current_suggestion,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 10, "bold"),
            cursor="pointinghand",
            wraplength=290,
            justify="left",
        ).grid(row=3, column=1, sticky="ew", padx=(6, 0), pady=(3, 0), ipady=6)
        suggestion_card.grid_columnconfigure(0, weight=1)
        suggestion_card.grid_columnconfigure(1, weight=1)
        duration_box = tk.Frame(fields, bg=card)
        duration_box.grid(row=3, column=0, sticky="ew", pady=(9, 0))
        tk.Label(
            duration_box,
            text="DURACIÓN DE LA SEÑA (SEG)",
            fg=muted,
            bg=card,
            font=("Arial", 9, "bold"),
        ).pack(anchor="w", pady=(0, 5))
        tk.Spinbox(
            duration_box,
            textvariable=self.duration_seconds,
            from_=0.5,
            to=5.0,
            increment=0.1,
            bg=card_soft,
            fg=text,
            buttonbackground=card_soft,
            relief="flat",
            font=("Arial", 11, "bold"),
            width=7,
        ).pack(side="left", ipady=2)
        tk.Label(
            duration_box,
            text="Se usa para grabar y reproducir.",
            fg=muted,
            bg=card,
            font=("Arial", 8),
        ).pack(side="left", padx=(10, 0))

        review_card = tk.Frame(frame, bg=card, padx=18, pady=16)
        review_card.grid(row=1, column=1, sticky="nsew", padx=(7, 0), pady=(14, 0))
        tk.Label(
            review_card,
            text="REVISAR Y PUBLICAR",
            fg=text,
            bg=card,
            font=("Arial", 16, "bold"),
        ).pack(anchor="w")
        tk.Label(
            review_card,
            text="Aquí verás qué está haciendo VOZUAL y cuál es el siguiente paso.",
            fg=muted,
            bg=card,
            font=("Arial", 9),
            wraplength=390,
            justify="left",
        ).pack(anchor="w", pady=(3, 10))

        status_card = tk.Frame(review_card, bg=card_soft, padx=12, pady=10)
        status_card.pack(fill="x")
        tk.Label(status_card, text="PASO ACTUAL", fg=accent, bg=card_soft, font=("Arial", 9, "bold")).pack(anchor="w")
        tk.Label(
            status_card,
            textvariable=self.step_status,
            wraplength=380,
            justify="left",
            fg=text,
            bg=card_soft,
            font=("Arial", 12, "bold"),
        ).pack(anchor="w", pady=(4, 2))
        tk.Label(
            status_card,
            textvariable=self.status,
            wraplength=380,
            justify="left",
            fg=muted,
            bg=card_soft,
            font=("Arial", 9),
        ).pack(anchor="w")

        created_card = tk.Frame(review_card, bg=card_soft, padx=12, pady=10)
        created_card.pack(fill="x", pady=(10, 0))
        tk.Label(
            created_card,
            text="BIBLIOTECA DE SEÑAS",
            fg=accent,
            bg=card_soft,
            font=("Arial", 9, "bold"),
        ).pack(anchor="w")
        tk.Label(
            created_card,
            text="Aquí solo aparece la cola de publicación. Busca una seña existente cuando necesites editarla.",
            fg=muted,
            bg=card_soft,
            font=("Arial", 8),
            wraplength=380,
            justify="left",
        ).pack(anchor="w", pady=(2, 6))
        tk.Label(
            created_card,
            textvariable=self.mobile_library_status,
            fg=accent,
            bg=card_soft,
            font=("Arial", 8, "bold"),
        ).pack(anchor="w", pady=(0, 6))
        tk.Label(
            created_card,
            textvariable=self.library_selection_status,
            fg="#d7e1ed",
            bg=card_soft,
            font=("Arial", 8),
            wraplength=380,
            justify="left",
        ).pack(anchor="w", pady=(0, 6))
        list_frame = tk.Frame(created_card, bg=card_soft)
        list_frame.pack(fill="x")
        self.created_sign_list = tk.Listbox(
            list_frame,
            height=2,
            exportselection=False,
            bg="#0d1928",
            fg=text,
            selectbackground=accent,
            selectforeground=background,
            relief="flat",
            highlightthickness=0,
            font=("Arial", 10, "bold"),
        )
        self.created_sign_list.pack(side="left", fill="x", expand=True)
        scrollbar = tk.Scrollbar(list_frame, command=self.created_sign_list.yview)
        scrollbar.pack(side="right", fill="y")
        self.created_sign_list.configure(yscrollcommand=scrollbar.set)
        self.created_sign_list.bind("<<ListboxSelect>>", self._on_created_sign_selection)
        self.created_sign_list.bind("<Double-Button-1>", lambda _event: self._load_created_sign())
        action_row = tk.Frame(created_card, bg=card_soft)
        action_row.pack(fill="x", pady=(8, 0))
        action_row.grid_columnconfigure(0, weight=1)
        action_row.grid_columnconfigure(1, weight=1)
        tk.Button(
            action_row,
            text="CARGAR Y EDITAR",
            command=self._load_created_sign,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 9, "bold"),
            cursor="pointinghand",
        ).grid(row=0, column=0, sticky="ew", padx=(0, 4), ipady=4)
        self.publish_pending_button = tk.Button(
            action_row,
            text="PUBLICAR PENDIENTES EN APP MÓVIL",
            command=self._publish_all_signs,
            bg=accent,
            fg=background,
            activebackground="#63e5df",
            activeforeground=background,
            relief="flat",
            font=("Arial", 9, "bold"),
            cursor="pointinghand",
        )
        self.publish_pending_button.grid(row=0, column=1, sticky="ew", padx=(4, 0), ipady=4)
        self.library_filter_button = tk.Button(
            created_card,
            text="BUSCAR UNA SEÑA PUBLICADA",
            command=self._open_library_search,
            bg="#172638",
            fg="#172638",
            activebackground="#26384e",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        )
        self.library_filter_button.pack(fill="x", pady=(4, 0), ipady=2)
        tk.Button(
            created_card,
            text="↻  RECARGAR BIBLIOTECA",
            command=self._refresh_created_signs,
            bg="#172638",
            fg="#172638",
            activebackground="#26384e",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        ).pack(fill="x", pady=(4, 0), ipady=2)

        self.analysis_progress = ttk.Progressbar(
            status_card,
            mode="indeterminate",
            style="VOZUAL.Horizontal.TProgressbar",
        )

        result = tk.Frame(review_card, bg=card)
        result.pack(fill="both", expand=True, pady=(10, 0))
        tk.Label(result, text="REVISAR LA SEÑAL CARGADA", fg=muted, bg=card, font=("Arial", 9, "bold")).pack(anchor="w", pady=(0, 3))
        tk.Label(
            result,
            text="Analiza o carga una seña para activar sus vistas. Los botones te indicarán qué falta.",
            fg="#6f8298",
            bg=card,
            font=("Arial", 8),
        ).pack(anchor="w", pady=(0, 8))
        self.tracking_button = tk.Button(
            result,
            text="VER PUNTOS DETECTADOS  ·  ANALIZA UNA SEÑA PRIMERO",
            command=self._open_tracking_preview,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 9, "bold"),
        )
        self.tracking_button.pack(fill="x", ipady=5, pady=(0, 5))
        self.skeleton_button = tk.Button(
            result,
            text="VER ESQUELETO CAPTURADO  ·  CARGA UNA SEÑA PRIMERO",
            command=self._open_skeleton_preview,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 9, "bold"),
        )
        self.skeleton_button.pack(fill="x", ipady=5, pady=(0, 5))
        self.mobile_preview_button = tk.Button(
            result,
            text="SIMULAR APP MÓVIL  ·  CARGA UNA SEÑA PRIMERO",
            command=self._preview_in_mobile_runtime,
            bg=accent,
            fg=background,
            activebackground="#63e5df",
            activeforeground=background,
            disabledforeground="#62738a",
            font=("Arial", 9, "bold"),
            relief="flat",
            state="disabled",
            cursor="pointinghand",
        )
        self.mobile_preview_button.pack(fill="x", ipady=6, pady=(0, 5))
        self.preview_button = tk.Button(
            result,
            text="VISTA 3D CON BLENDER (OPCIONAL)  ·  GENERA O CARGA UNA SEÑA",
            command=self._generate_preview,
            bg=danger,
            fg="#172638",
            activebackground="#ff7890",
            activeforeground=text,
            font=("Arial", 9, "bold"),
            relief="flat",
        )
        self.preview_button.pack(fill="x", ipady=5, pady=(0, 5))
        tk.Button(
            result,
            text="EDITAR PARÁMETROS POR SEGUNDO  ⚙",
            command=self._open_advanced_dialog,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 9, "bold"),
            cursor="pointinghand",
        ).pack(fill="x", ipady=5)
        tk.Label(
            result,
            text=(
                "SIMULAR APP MÓVIL usa el mismo motor de Android. Blender es una "
                "vista distinta y no sirve para aprobar la publicación."
            ),
            fg="#6f8298",
            bg=card,
            wraplength=380,
            justify="left",
            font=("Arial", 8),
        ).pack(side="bottom", anchor="w")

        self._build_advanced_dialog(background, card, card_soft, text, muted, warning)
        self._configure_readable_buttons()

    def _configure_readable_buttons(self) -> None:
        """Keep button labels legible when macOS replaces Tk button backgrounds."""

        readable = "#172638"
        disabled = "#62738a"

        def apply(widget: tk.Misc) -> None:
            for child in widget.winfo_children():
                if isinstance(child, tk.Button):
                    child.configure(
                        fg=readable,
                        activeforeground=readable,
                        disabledforeground=disabled,
                    )
                apply(child)

        apply(self.root)

    def _build_advanced_dialog(
        self,
        background: str,
        card: str,
        card_soft: str,
        text: str,
        muted: str,
        warning: str,
    ) -> None:
        accent = "#20d6ce"
        self.advanced_window = tk.Toplevel(self.root)
        self.advanced_window.title("VOZUAL — Parámetros por segundo")
        self.advanced_window.geometry("1240x820")
        self.advanced_window.minsize(1080, 720)
        self.advanced_window.configure(bg=card)
        self.advanced_window.withdraw()
        self.advanced_window.protocol("WM_DELETE_WINDOW", self.advanced_window.withdraw)

        self.advanced_panel = tk.Frame(self.advanced_window, bg=card, padx=24, pady=22)
        self.advanced_panel.pack(fill="both", expand=True)
        tk.Label(
            self.advanced_panel,
            text="EDITAR PARÁMETROS POR SEGUNDO",
            fg=text,
            bg=card,
            font=("Arial", 18, "bold"),
        ).pack(anchor="w")
        tk.Label(
            self.advanced_panel,
            text=(
                "Modifica entrada, salida o cualquier segundo después de revisar "
                "la animación. No necesitas analizar nuevamente el video."
            ),
            fg=muted,
            bg=card,
            font=("Arial", 9),
        ).pack(anchor="w", pady=(3, 12))

        workspace = tk.Frame(self.advanced_panel, bg=card)
        workspace.pack(fill="both", expand=True)
        workspace.grid_columnconfigure(0, weight=3)
        workspace.grid_columnconfigure(1, weight=2)
        workspace.grid_rowconfigure(0, weight=1)
        visual_panel = tk.Frame(workspace, bg="#0d1928", padx=16, pady=14)
        visual_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        inspector = tk.Frame(workspace, bg=card_soft, padx=16, pady=14)
        inspector.grid(row=0, column=1, sticky="nsew")
        tk.Label(visual_panel, text="VISTA DEL MOVIMIENTO", fg=accent, bg="#0d1928", font=("Arial", 11, "bold")).pack(anchor="w")
        tk.Label(visual_panel, text="La silueta turquesa representa el ajuste antes de regenerar el avatar.", fg=muted, bg="#0d1928", font=("Arial", 8)).pack(anchor="w", pady=(2, 8))

        controls = tk.Frame(inspector, bg=card_soft)
        controls.pack(fill="x", pady=(4, 0))
        self._combo(controls, "Contacto corporal", self.anchor, ("none", "chin", "mouth", "forehead", "cheek", "chest"), 0)
        self._combo(controls, "Palma al tocar", self.contact_palm, ("camera", "up", "down", "in", "out"), 1)
        self._combo(controls, "Palma al terminar", self.release_palm, ("camera", "up", "down", "in", "out"), 2)

        tk.Label(inspector, text="Distancia hacia adelante", fg=muted, bg=card_soft, font=("Arial", 9, "bold")).pack(anchor="w", pady=(14, 0))
        tk.Scale(inspector, variable=self.forward, from_=0.0, to=1.0, resolution=0.05, orient="horizontal", bg=card_soft, fg=text, highlightthickness=0, troughcolor="#26374b").pack(fill="x")
        tk.Checkbutton(inspector, text="Regresar la mano a reposo", variable=self.return_to_rest, bg=card_soft, fg=text, selectcolor=card, activebackground=card_soft, activeforeground=text).pack(anchor="w", pady=6)

        timeline = tk.Frame(visual_panel, bg="#0d1928")
        timeline.pack(fill="x", pady=(4, 2))
        tk.Label(
            timeline,
            textvariable=self.timeline_label,
            fg=accent,
            bg="#0d1928",
            font=("Arial", 10, "bold"),
        ).pack(anchor="w")
        tk.Label(
            timeline,
            textvariable=self.reference_hand_label,
            fg=muted,
            bg="#0d1928",
            font=("Arial", 8),
            wraplength=760,
            justify="left",
        ).pack(anchor="w", pady=(3, 0))
        self.timeline_preview_label = tk.Label(
            timeline,
            text="La vista del fotograma aparecerá al cargar una seña.",
            fg=muted,
            bg="#0d1928",
            anchor="center",
        )
        self.timeline_preview_label.pack(anchor="w", fill="x", pady=(6, 0))
        self.timeline_scale = tk.Scale(
            timeline,
            variable=self.timeline_seconds,
            from_=0.0,
            to=5.0,
            resolution=0.01,
            orient="horizontal",
            showvalue=False,
            command=self._timeline_changed,
            bg="#0d1928",
            fg=text,
            highlightthickness=0,
            troughcolor="#26374b",
            activebackground=accent,
        )
        self.timeline_scale.pack(fill="x")
        tk.Label(
            timeline,
            text="Mueve el control para consultar la posición exacta; usa AGREGAR PUNTO para fijar un ajuste en ese instante.",
            fg=muted,
            bg="#0d1928",
            font=("Arial", 8),
            wraplength=760,
            justify="left",
        ).pack(anchor="w")

        adjustments = tk.Frame(inspector, bg=card, padx=12, pady=10)
        adjustments.pack(fill="both", expand=True, pady=(10, 6))
        tk.Label(
            adjustments,
            text="PARÁMETROS DE LA MANO EN LA LÍNEA DE TIEMPO",
            fg=text,
            bg=card_soft,
            font=("Arial", 11, "bold"),
        ).grid(row=0, column=0, columnspan=3, sticky="w")
        tk.Label(
            adjustments,
            text=(
                "Selecciona entrada, salida o cualquier segundo. Los valores son "
                "centímetros respecto al movimiento automático."
            ),
            fg=muted,
            bg=card_soft,
            font=("Arial", 8),
            wraplength=720,
            justify="left",
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(2, 8))
        columns = ("kind", "time", "height", "lateral", "depth")
        self.motion_tree = ttk.Treeview(
            adjustments,
            columns=columns,
            show="headings",
            height=4,
            selectmode="browse",
        )
        for name, title, width in (
            ("kind", "MOMENTO", 90),
            ("time", "SEGUNDO", 80),
            ("height", "ALTURA", 80),
            ("lateral", "LATERAL", 80),
            ("depth", "PROFUNDIDAD", 95),
        ):
            self.motion_tree.heading(name, text=title)
            self.motion_tree.column(name, width=width, anchor="center")
        self.motion_tree.grid(row=2, column=0, columnspan=5, sticky="ew")
        self.motion_tree.bind("<<TreeviewSelect>>", self._select_motion_keyframe)

        editor = tk.Frame(adjustments, bg=card_soft)
        editor.grid(row=3, column=0, columnspan=5, sticky="ew", pady=(10, 0))
        for column, (label, variable, lower, upper, increment) in enumerate(
            (
                ("Momento", self.motion_kind, None, None, None),
                ("Segundo", self.motion_time_seconds, 0.0, 5.0, 0.05),
                ("Altura cm", self.motion_height_cm, -30.0, 30.0, 1.0),
                ("Lateral cm", self.motion_lateral_cm, -30.0, 30.0, 1.0),
                ("Profundidad cm", self.motion_depth_cm, -30.0, 30.0, 1.0),
            )
        ):
            box = tk.Frame(editor, bg=card_soft)
            box.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 5, 0))
            editor.grid_columnconfigure(column, weight=1)
            tk.Label(box, text=label, fg=muted, bg=card_soft, font=("Arial", 8)).pack(anchor="w")
            if column == 0:
                ttk.Combobox(
                    box,
                    textvariable=variable,
                    values=("entry", "point", "exit"),
                    state="readonly",
                    width=9,
                ).pack(fill="x", pady=(3, 0))
            else:
                tk.Spinbox(
                    box,
                    textvariable=variable,
                    from_=lower,
                    to=upper,
                    increment=increment,
                    bg=card,
                    fg=text,
                    buttonbackground=card,
                    relief="flat",
                    width=8,
                ).pack(fill="x", pady=(3, 0), ipady=3)
        face_controls = tk.LabelFrame(
            adjustments,
            text="EXPRESIÓN FACIAL EN ESTE MOMENTO",
            fg=text,
            bg=card_soft,
            padx=8,
            pady=6,
            font=("Arial", 9, "bold"),
        )
        face_controls.grid(row=4, column=0, columnspan=5, sticky="ew", pady=(10, 0))
        for column, (label, variable, explanation) in enumerate(
            (
                ("Apertura de boca", self.face_jaw_open, "0 neutral · 1 abierta"),
                ("Ojos abiertos", self.face_eye_wide, "0 normal · 1 más abiertos"),
                ("Cejas arriba", self.face_brow_raise, "0 neutral · 1 elevadas"),
            )
        ):
            box = tk.Frame(face_controls, bg=card_soft)
            box.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 8, 0))
            face_controls.grid_columnconfigure(column, weight=1)
            tk.Label(box, text=label, fg=muted, bg=card_soft, font=("Arial", 8, "bold")).pack(anchor="w")
            tk.Scale(
                box, variable=variable, from_=0.0, to=1.0, resolution=0.05,
                orient="horizontal", showvalue=True, bg=card_soft, fg=text,
                highlightthickness=0, troughcolor="#26374b", activebackground=accent,
            ).pack(fill="x")
            tk.Label(box, text=explanation, fg=muted, bg=card_soft, font=("Arial", 7)).pack(anchor="w")
        actions = tk.Frame(adjustments, bg=card_soft)
        actions.grid(row=5, column=0, columnspan=5, sticky="ew", pady=(10, 0))
        for text_value, command in (
            ("AGREGAR PUNTO", self._add_motion_keyframe),
            ("ACTUALIZAR SELECCIONADO", self._update_motion_keyframe),
            ("ELIMINAR SELECCIONADO", self._delete_motion_keyframe),
        ):
            tk.Button(
                actions,
                text=text_value,
                command=command,
                bg="#26384e",
                fg="#172638",
                relief="flat",
                font=("Arial", 8, "bold"),
            ).pack(side="left", expand=True, fill="x", padx=(0, 5), ipady=5)
        tk.Button(
            adjustments,
            text="RESTABLECER TODOS LOS PUNTOS A CERO",
            command=self._reset_motion_adjustments,
            bg="#26384e",
            fg="#172638",
            relief="flat",
            font=("Arial", 9, "bold"),
        ).grid(row=6, column=0, columnspan=5, sticky="ew", pady=(10, 0), ipady=5)

        self.analyze_button = tk.Button(
            self.advanced_panel,
            text="ANALIZAR VIDEO",
            command=self._analyze,
            bg="#26384e",
            fg="#172638",
            relief="flat",
            font=("Arial", 11, "bold"),
        )
        self.analyze_button.pack(fill="x", ipady=10, pady=(8, 4))
        tk.Label(
            self.advanced_panel,
            text=(
                "PASO FINAL: agrega o actualiza un punto y luego pulsa "
                "GUARDAR Y REGENERAR AHORA. La captura original no cambia; "
                "el resultado se abre al terminar."
            ),
            bg=card,
            fg=muted,
            justify="left",
            anchor="w",
            wraplength=960,
            font=("Arial", 9),
        ).pack(fill="x", pady=(4, 2), ipady=6)
        self.save_button = tk.Button(
            self.advanced_panel,
            text="GUARDAR SIN GENERAR (BLOQUEADO)",
            command=self._save_recipe,
            bg=warning,
            fg=background,
            disabledforeground="#647386",
            font=("Arial", 11, "bold"),
            relief="flat",
            state="disabled",
        )
        self.save_button.pack(fill="x", ipady=10, pady=8)
        self.apply_adjustments_button = tk.Button(
            self.advanced_panel,
            text="GUARDAR Y REGENERAR AHORA",
            command=self._generate_preview,
            bg="#20d6ce",
            fg=background,
            disabledforeground="#647386",
            font=("Arial", 11, "bold"),
            relief="flat",
            state="disabled",
        )
        self.apply_adjustments_button.pack(fill="x", ipady=10, pady=(0, 8))
        tk.Button(
            self.advanced_panel,
            text="ABRIR VISTA 3D DEL AVATAR",
            command=self._open_live_avatar_editor,
            bg="#26384e",
            fg="#172638",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(fill="x", ipady=8, pady=(0, 8))
        tk.Button(
            self.advanced_panel,
            text="CERRAR AJUSTES",
            command=self.advanced_window.withdraw,
            bg=card_soft,
            fg="#172638",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(fill="x", ipady=8, pady=(8, 0))

    def _open_advanced_dialog(self) -> None:
        duration = max(0.05, float(self.duration_seconds.get()))
        self.timeline_scale.configure(to=duration)
        self.timeline_seconds.set(min(float(self.timeline_seconds.get()), duration))
        self._timeline_changed(str(self.timeline_seconds.get()))
        self.advanced_window.deiconify()
        self.advanced_window.transient(self.root)
        self.advanced_window.lift()
        self.advanced_window.focus_force()

    def _open_live_avatar_editor(self) -> None:
        source_avatar = self._source_avatar()
        if source_avatar is None:
            messagebox.showerror("Falta avatar", "No se encontró el archivo GLB del avatar.", parent=self.advanced_window)
            return
        viewer = REPO_ROOT / "ml/src/avatar_live_editor.py"
        state_directory = self.recipe_path.parent if self.recipe_path else REPO_ROOT / "tmp/creator_references"
        self.live_state_path = state_directory / "live_avatar_state.json"
        self._write_live_avatar_state()
        subprocess.Popen([sys.executable, str(viewer), str(source_avatar), str(self.live_state_path)])

    def _write_live_avatar_state(self) -> None:
        if self.live_state_path is None:
            return
        self.live_state_path.parent.mkdir(parents=True, exist_ok=True)
        self.live_state_path.write_text(json.dumps({
            "time_seconds": float(self.timeline_seconds.get()),
            "height_cm": float(self.motion_height_cm.get()),
            "lateral_cm": float(self.motion_lateral_cm.get()),
            "depth_cm": float(self.motion_depth_cm.get()),
            "jaw_open": float(self.face_jaw_open.get()),
            "eye_wide": float(self.face_eye_wide.get()),
            "brow_raise": float(self.face_brow_raise.get()),
            "active_hand": self.reference_active_hand,
        }), encoding="utf-8")

    def _timeline_changed(self, value: str) -> None:
        """Show the interpolated offsets at the selected millisecond."""
        try:
            current = max(0.0, float(value))
        except (TypeError, ValueError):
            return
        self.timeline_label.set(f"MOMENTO ACTUAL: {current:.3f} s")
        self._update_timeline_preview(current)
        if self.reference_frames:
            frame_index = min(
                len(self.reference_frames) - 1,
                max(0, round(current * max(1, self.reference_fps))),
            )
            frame = self.reference_frames[frame_index]
            # Pose wrist indices are 15/16; show both so the editor makes
            # handedness and the captured baseline explicit.
            left = frame[15] if len(frame) > 15 else [0.0, 0.0, 0.0]
            right = frame[16] if len(frame) > 16 else [0.0, 0.0, 0.0]
            self.reference_hand_label.set(
                f"CAPTURA ORIGINAL · cuadro {frame_index + 1}/{len(self.reference_frames)} · "
                f"muñeca izquierda X {left[0]:+.3f}  Y {left[1]:+.3f}  Z {left[2]:+.3f} · "
                f"derecha X {right[0]:+.3f}  Y {right[1]:+.3f}  Z {right[2]:+.3f}"
            )
        if not self.motion_keyframes:
            return
        points = sorted(self.motion_keyframes, key=lambda point: float(point["time_seconds"]))
        if current <= float(points[0]["time_seconds"]):
            point = points[0]
        elif current >= float(points[-1]["time_seconds"]):
            point = points[-1]
        else:
            before, after = points[0], points[-1]
            for left, right in zip(points, points[1:]):
                if float(left["time_seconds"]) <= current <= float(right["time_seconds"]):
                    before, after = left, right
                    break
            left_time = float(before["time_seconds"])
            right_time = float(after["time_seconds"])
            fraction = 0.0 if right_time == left_time else (current - left_time) / (right_time - left_time)
            point = {
                "kind": "point",
                "time_seconds": current,
                **{
                    name: float(before.get(name, 0.0)) + (float(after.get(name, 0.0)) - float(before.get(name, 0.0))) * fraction
                    for name in (
                        "height_cm", "lateral_cm", "depth_cm",
                        "jaw_open", "eye_wide", "brow_raise",
                    )
                },
            }
        self.motion_kind.set(str(point["kind"]))
        self.motion_time_seconds.set(round(current, 3))
        self.motion_height_cm.set(float(point["height_cm"]))
        self.motion_lateral_cm.set(float(point["lateral_cm"]))
        self.motion_depth_cm.set(float(point["depth_cm"]))
        self.face_jaw_open.set(float(point.get("jaw_open", 0.0)))
        self.face_eye_wide.set(float(point.get("eye_wide", 0.0)))
        self.face_brow_raise.set(float(point.get("brow_raise", 0.0)))

    def _update_timeline_preview(self, current: float) -> None:
        if self.timeline_preview_label is None or self.tracking_capture is None:
            return
        fps = self.tracking_capture.get(cv2.CAP_PROP_FPS) or float(self.reference_fps or 30)
        frame_count = int(self.tracking_capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        # The tracking movie preserves the whole recording while the recipe can
        # compress it into (for example) one second. Map the editor clock back
        # to the original movie clock before showing its diagnostic frame.
        recipe_duration = max(0.01, float(self.duration_seconds.get()))
        source_duration = frame_count / fps if frame_count and fps else recipe_duration
        source_time = min(source_duration, max(0.0, current / recipe_duration * source_duration))
        frame_index = max(0, min(frame_count - 1, round(source_time * fps))) if frame_count else 0
        self.tracking_capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = self.tracking_capture.read()
        if not ok:
            return
        has_hand_adjustment = any(
            abs(float(variable.get())) > 0.001
            for variable in (self.motion_height_cm, self.motion_lateral_cm, self.motion_depth_cm)
        )
        # At zero, the diagnostic already shows the exact detected hand. A
        # second overlay would look like a false duplicate hand.
        if self.reference_frames and has_hand_adjustment:
            recipe_frame = min(
                len(self.reference_frames) - 1,
                max(0, round(current * max(1, self.reference_fps))),
            )
            frame_data = self.reference_frames[recipe_frame]
            self._draw_adjusted_hand(frame, frame_data)
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(frame)
        image.thumbnail((720, 300), Image.Resampling.LANCZOS)
        self.timeline_preview_image = ImageTk.PhotoImage(image)
        self.timeline_preview_label.configure(image=self.timeline_preview_image, text="")

    def _draw_adjusted_hand(self, frame: np.ndarray, landmarks: list[list[float]]) -> None:
        """Show a ghosted, manually corrected hand over the captured frame."""
        height, width = frame.shape[:2]
        hand_start = 33 if self.reference_active_hand == "left" else 54
        hand = landmarks[hand_start : hand_start + 21]
        if len(hand) < 21:
            return
        try:
            lateral = float(self.motion_lateral_cm.get())
            vertical = float(self.motion_height_cm.get())
            depth = float(self.motion_depth_cm.get())
        except (tk.TclError, ValueError):
            return
        pixels_per_cm = min(width, height) / 180.0
        dx = lateral * pixels_per_cm
        dy = -vertical * pixels_per_cm
        scale = max(0.65, min(1.45, 1.0 - depth * 0.025))
        wrist_x, wrist_y = hand[0][0] * width, hand[0][1] * height
        points = []
        for point in hand:
            x, y = point[0] * width, point[1] * height
            points.append((int(round((x - wrist_x) * scale + wrist_x + dx)), int(round((y - wrist_y) * scale + wrist_y + dy))))
        connections = ((0, 1), (0, 5), (0, 9), (0, 13), (0, 17), (1, 2), (2, 3), (3, 4), (5, 6), (6, 7), (7, 8), (9, 10), (10, 11), (11, 12), (13, 14), (14, 15), (15, 16), (17, 18), (18, 19), (19, 20))
        for first, second in connections:
            cv2.line(frame, points[first], points[second], (40, 255, 220), 2, cv2.LINE_AA)
        for point in points:
            cv2.circle(frame, point, 4, (40, 255, 220), -1, cv2.LINE_AA)
        cv2.putText(frame, f"AJUSTE PREVIO X:{lateral:+.1f} Y:{vertical:+.1f} Z:{depth:+.1f} cm", (12, height - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 255, 220), 2, cv2.LINE_AA)

    def _reset_motion_adjustments(self) -> None:
        for variable in (
            self.entry_height_cm,
            self.entry_lateral_cm,
            self.entry_depth_cm,
            self.exit_height_cm,
            self.exit_lateral_cm,
            self.exit_depth_cm,
        ):
            variable.set(0.0)
        for variable in (
            self.motion_height_cm,
            self.motion_lateral_cm,
            self.motion_depth_cm,
            self.face_jaw_open,
            self.face_eye_wide,
            self.face_brow_raise,
        ):
            variable.set(0.0)
        duration = max(0.05, float(self.duration_seconds.get()))
        self.motion_keyframes = [
            self._motion_point("entry", 0.0),
            self._motion_point("exit", duration),
        ]
        self._refresh_motion_tree()
        self.status.set("Ajustes de entrada y salida restablecidos a cero.")

    def _motion_point(self, kind: str, time_seconds: float) -> dict[str, object]:
        return {
            "kind": kind,
            "time_seconds": round(float(time_seconds), 3),
            "height_cm": float(self.motion_height_cm.get()),
            "lateral_cm": float(self.motion_lateral_cm.get()),
            "depth_cm": float(self.motion_depth_cm.get()),
            "jaw_open": float(self.face_jaw_open.get()),
            "eye_wide": float(self.face_eye_wide.get()),
            "brow_raise": float(self.face_brow_raise.get()),
        }

    def _refresh_motion_tree(self) -> None:
        for item in self.motion_tree.get_children():
            self.motion_tree.delete(item)
        labels = {"entry": "ENTRADA", "point": "PUNTO", "exit": "SALIDA"}
        self.motion_keyframes.sort(key=lambda point: float(point["time_seconds"]))
        for index, point in enumerate(self.motion_keyframes):
            self.motion_tree.insert(
                "",
                "end",
                iid=str(index),
                values=(
                    labels[str(point["kind"])],
                    f"{float(point['time_seconds']):.2f} s",
                    f"{float(point['height_cm']):+.1f} cm",
                    f"{float(point['lateral_cm']):+.1f} cm",
                    f"{float(point['depth_cm']):+.1f} cm",
                ),
            )

    def _selected_motion_index(self) -> int | None:
        selection = self.motion_tree.selection()
        return int(selection[0]) if selection else None

    def _select_motion_keyframe(self, _event: object = None) -> None:
        index = self._selected_motion_index()
        if index is None:
            return
        point = self.motion_keyframes[index]
        self.motion_kind.set(str(point["kind"]))
        self.motion_time_seconds.set(float(point["time_seconds"]))
        self.motion_height_cm.set(float(point["height_cm"]))
        self.motion_lateral_cm.set(float(point["lateral_cm"]))
        self.motion_depth_cm.set(float(point["depth_cm"]))
        self.face_jaw_open.set(float(point.get("jaw_open", 0.0)))
        self.face_eye_wide.set(float(point.get("eye_wide", 0.0)))
        self.face_brow_raise.set(float(point.get("brow_raise", 0.0)))

    def _edited_motion_point(self) -> dict[str, object] | None:
        try:
            time_seconds = float(self.motion_time_seconds.get())
            duration = max(0.05, float(self.duration_seconds.get()))
            if not 0.0 <= time_seconds <= duration:
                raise ValueError
            point = self._motion_point(self.motion_kind.get(), time_seconds)
            if any(
                abs(float(point[name])) > 30.0
                for name in ("height_cm", "lateral_cm", "depth_cm")
            ) or any(not 0.0 <= float(point[name]) <= 1.0 for name in ("jaw_open", "eye_wide", "brow_raise")):
                raise ValueError
            return point
        except (tk.TclError, ValueError):
            messagebox.showerror(
                "Parámetro inválido",
                "El segundo debe estar dentro de la animación y cada ajuste entre -30 y 30 cm.",
                parent=self.advanced_window,
            )
            return None

    def _add_motion_keyframe(self) -> None:
        point = self._edited_motion_point()
        if point is None:
            return
        time_seconds = float(point["time_seconds"])
        if any(abs(float(existing["time_seconds"]) - time_seconds) < 0.001 for existing in self.motion_keyframes):
            messagebox.showerror(
                "Segundo duplicado",
                "Ya existe un parámetro en ese segundo. Selecciónalo y actualízalo.",
                parent=self.advanced_window,
            )
            return
        self.motion_keyframes.append(point)
        self._refresh_motion_tree()

    def _update_motion_keyframe(self) -> None:
        index = self._selected_motion_index()
        point = self._edited_motion_point()
        if index is None or point is None:
            return
        time_seconds = float(point["time_seconds"])
        if any(
            other_index != index
            and abs(float(existing["time_seconds"]) - time_seconds) < 0.001
            for other_index, existing in enumerate(self.motion_keyframes)
        ):
            messagebox.showerror(
                "Segundo duplicado",
                "Ya existe otro parámetro en ese segundo.",
                parent=self.advanced_window,
            )
            return
        self.motion_keyframes[index] = point
        self._refresh_motion_tree()

    def _delete_motion_keyframe(self) -> None:
        index = self._selected_motion_index()
        if index is None:
            return
        del self.motion_keyframes[index]
        self._refresh_motion_tree()

    def _set_stage(self, stage: int) -> None:
        stage = max(1, min(stage, 3))
        titles = {
            1: "GRABA UNA TOMA",
            2: "CREA LA ANIMACIÓN",
            3: "REVISA Y PUBLICA",
        }
        self.stage_progress.set(stage)
        self.stage_summary.set(titles[stage])
        for index, (card, title, subtitle) in enumerate(self.stage_cards, start=1):
            active = index == stage
            card.configure(
                bg="#153f50" if active else "#172638",
                highlightbackground="#20d6ce" if active else "#2a415b",
            )
            title.configure(
                bg="#153f50" if active else "#172638",
                fg="#20d6ce" if active else "#f5f8fc",
            )
            subtitle.configure(
                bg="#153f50" if active else "#172638",
                fg="#d7e1ed" if active else "#9fb0c4",
            )

    def _label(self, parent: tk.Widget, text: str) -> None:
        tk.Label(parent, text=text, fg="#b8c7d9", bg="#07111f", font=("Arial", 10, "bold")).pack(anchor="w", pady=(12, 5))

    def _combo(self, parent: tk.Widget, label: str, variable: tk.StringVar, values: tuple[str, ...], column: int) -> None:
        background = str(parent.cget("bg"))
        box = tk.Frame(parent, bg=background)
        box.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 7, 0))
        parent.grid_columnconfigure(column, weight=1)
        tk.Label(box, text=label, fg="#b8c7d9", bg=background).pack(anchor="w")
        ttk.Combobox(box, textvariable=variable, values=values, state="readonly").pack(fill="x", pady=(4, 0))

    def _refresh_created_signs(self) -> None:
        """Refresh the local library of analyzed signs shown in the editor."""
        if self.created_sign_list is None:
            return
        library = REPO_ROOT / "tmp/creator_references/video_imports"
        self._migrate_legacy_captures(library)
        self.created_sign_paths = {}
        self.created_sign_labels = {}
        self.created_sign_list.delete(0, tk.END)
        published_glosses = self._published_mobile_glosses()
        created: list[tuple[str, Path, Path]] = []
        if library.is_dir():
            for directory in sorted((path for path in library.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
                recipes = sorted(directory.glob("*.recipe.json"), key=lambda path: path.stat().st_mtime, reverse=True)
                if not recipes:
                    continue
                recipe_path = recipes[0]
                data = json.loads(recipe_path.read_text(encoding="utf-8"))
                landmark_path = Path(str(data.get("landmark_source", "")))
                if not landmark_path.is_file():
                    candidates = sorted(directory.glob("*_video_reference.json"))
                    landmark_path = candidates[0] if candidates else Path()
                if not landmark_path.is_file():
                    continue
                gloss = str(data.get("gloss", directory.name)).strip().upper()
                created.append((gloss, recipe_path, landmark_path))
        for gloss, recipe_path, landmark_path in sorted(created, key=lambda entry: entry[0]):
            self.created_sign_paths[gloss] = (recipe_path, landmark_path)
            if self.library_filter.get() == "pending" and gloss in published_glosses:
                continue
            state = "PUBLICADA" if gloss in published_glosses else "PENDIENTE"
            label = f"{state}  ·  {gloss}"
            self.created_sign_labels[label] = gloss
            self.created_sign_list.insert(tk.END, label)
        pending_count = len(self.created_sign_paths) - len(
            set(self.created_sign_paths) & published_glosses
        )
        if self.library_filter_button is not None:
            self.library_filter_button.configure(
                text=f"BUSCAR ENTRE {len(self.created_sign_paths)} SEÑAS"
            )
        if self.publish_pending_button is not None:
            self.publish_pending_button.configure(
                text=(
                    f"PUBLICAR {pending_count} PENDIENTES EN APP MÓVIL"
                    if pending_count else "APP MÓVIL AL DÍA ✓"
                )
            )
        self.mobile_library_status.set(
            self._mobile_library_summary(
                published_glosses, set(self.created_sign_paths)
            )
        )
        if self.created_sign_list.size() > 0:
            self.created_sign_list.selection_set(0)
            self._on_created_sign_selection()
        else:
            self.library_selection_status.set(
                "No hay señas pendientes. Usa BUSCAR ENTRE SEÑAS para abrir una publicada."
                if self.created_sign_paths
                else "No hay señas guardadas todavía."
            )
        self._refresh_sign_suggestions()

    def _toggle_library_filter(self) -> None:
        """Keep the publishing queue focused while retaining access to history."""
        self.library_filter.set(
            "all" if self.library_filter.get() == "pending" else "pending"
        )
        self._refresh_created_signs()

    def _open_library_search(self) -> None:
        """Search the library without rendering an unbounded list in the editor."""
        if not self.created_sign_paths:
            messagebox.showinfo(
                "Biblioteca de señas",
                "Aún no hay señas guardadas para buscar.",
                parent=self.root,
            )
            return

        dialog = tk.Toplevel(self.root)
        dialog.title("Buscar seña")
        dialog.geometry("1220x720")
        dialog.minsize(980, 620)
        dialog.configure(bg="#111e2e")
        dialog.transient(self.root)
        dialog.grab_set()
        panel = tk.Frame(dialog, bg="#111e2e", padx=20, pady=18)
        panel.pack(fill="both", expand=True)
        tk.Label(
            panel,
            text="BUSCAR EN LA BIBLIOTECA",
            fg="#f5f8fc",
            bg="#111e2e",
            font=("Arial", 15, "bold"),
        ).pack(anchor="w")
        tk.Label(
            panel,
            text=(
                "Escribe el nombre de una seña. La cola principal seguirá mostrando "
                "solo las pendientes de publicación."
            ),
            fg="#9fb0c4",
            bg="#111e2e",
            font=("Arial", 9),
            wraplength=500,
            justify="left",
        ).pack(anchor="w", pady=(4, 12))
        query = tk.StringVar()
        tk.Entry(
            panel,
            textvariable=query,
            bg="#172638",
            fg="#f5f8fc",
            insertbackground="#f5f8fc",
            relief="flat",
            font=("Arial", 12),
        ).pack(fill="x", ipady=7)
        result_status = tk.StringVar(value="Escribe para buscar entre las señas disponibles.")
        tk.Label(
            panel,
            textvariable=result_status,
            fg="#20d6ce",
            bg="#111e2e",
            font=("Arial", 8, "bold"),
        ).pack(anchor="w", pady=(8, 5))
        library_workspace = tk.Frame(panel, bg="#111e2e")
        library_workspace.pack(fill="both", expand=True)
        list_frame = tk.Frame(library_workspace, bg="#111e2e")
        list_frame.pack(side="left", fill="both", expand=True)
        results = ttk.Treeview(
            list_frame,
            columns=("gloss", "category", "aliases", "state"),
            show="headings",
            selectmode="browse",
        )
        results.heading("gloss", text="SEÑA")
        results.heading("category", text="CATEGORÍA")
        results.heading("aliases", text="PALABRAS DE VOZ")
        results.heading("state", text="ESTADO")
        results.column("gloss", width=120, anchor="w")
        results.column("category", width=145, anchor="w")
        results.column("aliases", width=250, anchor="w")
        results.column("state", width=90, anchor="center")
        results.pack(side="left", fill="both", expand=True)
        scrollbar = tk.Scrollbar(list_frame, command=results.yview)
        scrollbar.pack(side="right", fill="y")
        results.configure(yscrollcommand=scrollbar.set)

        preview_card = tk.Frame(
            library_workspace,
            bg="#172638",
            padx=10,
            pady=10,
            width=350,
        )
        preview_card.pack(side="right", fill="y", padx=(10, 0))
        preview_card.pack_propagate(False)
        tk.Label(
            preview_card,
            text="TOMA ORIGINAL",
            fg="#20d6ce",
            bg="#172638",
            font=("Arial", 9, "bold"),
        ).pack(anchor="w")
        preview_status = tk.StringVar(
            value="Selecciona una seña para reproducir su toma aquí."
        )
        tk.Label(
            preview_card,
            textvariable=preview_status,
            fg="#9fb0c4",
            bg="#172638",
            font=("Arial", 8),
            wraplength=320,
            justify="left",
        ).pack(anchor="w", pady=(3, 8))
        preview_label = tk.Label(
            preview_card,
            text="SIN TOMA SELECCIONADA",
            fg="#9fb0c4",
            bg="#0d1928",
            font=("Arial", 10, "bold"),
        )
        preview_label.pack(fill="both", expand=True)
        preview_pause_button = tk.Button(
            preview_card,
            text="⏸  PAUSAR",
            command=lambda: toggle_inline_preview(),
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 9, "bold"),
            state="disabled",
        )
        preview_pause_button.pack(fill="x", pady=(8, 0), ipady=4)

        inline_capture: cv2.VideoCapture | None = None
        inline_after_id: str | None = None
        inline_photo: ImageTk.PhotoImage | None = None
        inline_paused = False
        inline_delay_ms = 33

        def stop_inline_preview(*, clear: bool = False) -> None:
            nonlocal inline_after_id, inline_capture, inline_photo, inline_paused
            if inline_after_id is not None:
                try:
                    dialog.after_cancel(inline_after_id)
                except tk.TclError:
                    pass
                inline_after_id = None
            if inline_capture is not None:
                inline_capture.release()
                inline_capture = None
            inline_paused = False
            preview_pause_button.configure(
                text="⏸  PAUSAR", bg="#20d6ce", fg="#07111f", state="disabled"
            )
            if clear:
                inline_photo = None
                preview_label.configure(image="", text="SIN TOMA SELECCIONADA")
                preview_status.set("Selecciona una seña para reproducir su toma aquí.")

        def show_next_inline_frame() -> None:
            nonlocal inline_after_id, inline_photo
            inline_after_id = None
            if inline_paused or inline_capture is None or not dialog.winfo_exists():
                return
            ok, frame = inline_capture.read()
            if not ok:
                inline_capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = inline_capture.read()
            if not ok:
                preview_status.set("La toma no contiene fotogramas reproducibles.")
                preview_pause_button.configure(state="disabled")
                return
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            image.thumbnail((325, 360), Image.Resampling.LANCZOS)
            inline_photo = ImageTk.PhotoImage(image)
            preview_label.configure(image=inline_photo, text="")
            inline_after_id = dialog.after(inline_delay_ms, show_next_inline_frame)

        def show_selected_recording() -> None:
            nonlocal inline_capture, inline_delay_ms, inline_paused
            selected = results.selection()
            if not selected:
                stop_inline_preview(clear=True)
                return
            gloss = selected[0]
            recording = self._recording_for_gloss(gloss)
            stop_inline_preview()
            preview_label.configure(image="", text="TOMA NO DISPONIBLE")
            if recording is None:
                preview_status.set(
                    f"{gloss} no conserva una toma original en la biblioteca local."
                )
                return
            capture = cv2.VideoCapture(str(recording))
            if not capture.isOpened():
                capture.release()
                preview_status.set(f"No se pudo reproducir {recording.name}.")
                return
            inline_capture = capture
            fps = capture.get(cv2.CAP_PROP_FPS)
            inline_delay_ms = max(20, int(1000 / fps)) if fps and fps > 1 else 33
            inline_paused = False
            preview_status.set(f"REPRODUCIENDO: {gloss} · {recording.name}")
            preview_pause_button.configure(state="normal")
            show_next_inline_frame()

        def toggle_inline_preview() -> None:
            nonlocal inline_paused
            if inline_capture is None:
                return
            inline_paused = not inline_paused
            if inline_paused:
                preview_pause_button.configure(
                    text="▶  REANUDAR", bg="#26384e", fg="#f5f8fc"
                )
                return
            preview_pause_button.configure(
                text="⏸  PAUSAR", bg="#20d6ce", fg="#07111f"
            )
            show_next_inline_frame()

        def close_search() -> None:
            stop_inline_preview()
            if dialog.winfo_exists():
                dialog.destroy()

        dialog.protocol("WM_DELETE_WINDOW", close_search)
        matched_glosses: list[str] = []
        aliases_by_gloss: dict[str, list[str]] = {}
        represented_forms = tk.StringVar(
            value="Selecciona una seña para ver todas las palabras de voz que representa."
        )

        def refresh_results(*_args: object) -> None:
            nonlocal aliases_by_gloss, matched_glosses
            stop_inline_preview(clear=True)
            needle = query.get().strip().casefold()
            results.delete(*results.get_children())
            if not needle:
                matched_glosses = []
                result_status.set("Escribe al menos una letra para buscar.")
                return
            aliases_by_gloss = {
                gloss: self._speech_aliases_for_recipe(gloss, paths[0])
                for gloss, paths in self.created_sign_paths.items()
            }
            matched_glosses = [
                gloss
                for gloss in sorted(self.created_sign_paths)
                if needle in gloss.casefold()
                or any(needle in alias.casefold() for alias in aliases_by_gloss[gloss])
            ][:50]
            for gloss in matched_glosses:
                state = "PUBLICADA" if gloss in self._published_mobile_glosses() else "PENDIENTE"
                categories = editor_metadata(gloss)["categories"]
                category = ", ".join(str(item).replace("_", " ") for item in categories)
                aliases = aliases_by_gloss[gloss]
                preview = ", ".join(aliases[:4]) + ("…" if len(aliases) > 4 else "")
                results.insert("", tk.END, iid=gloss, values=(gloss, category, preview, state))
            result_status.set(
                f"{len(matched_glosses)} resultado(s). Refina la búsqueda si hay demasiados."
                if matched_glosses else "No encontramos una seña con ese nombre."
            )

        def show_represented_forms(_event: tk.Event[tk.Misc] | None = None) -> None:
            selected = results.selection()
            if not selected:
                return
            gloss = selected[0]
            aliases = aliases_by_gloss.get(gloss, [])
            aliases_editor_input.delete("1.0", tk.END)
            aliases_editor_input.insert("1.0", ", ".join(aliases))
            represented_forms.set(
                f"FORMA BASE AUTOMÁTICA: {gloss.lower()} · "
                + (
                    "VARIANTES EDITABLES: " + ", ".join(aliases)
                    if aliases
                    else "SIN VARIANTES ADICIONALES"
                )
            )
            show_selected_recording()

        def select_in_main_queue(gloss: str) -> bool:
            """Select one searched sign through the established editor pathway."""
            self.library_filter.set("all")
            self._refresh_created_signs()
            label = next(
                (item for item, value in self.created_sign_labels.items() if value == gloss),
                None,
            )
            if label is not None and self.created_sign_list is not None:
                index = self.created_sign_list.get(0, tk.END).index(label)
                self.created_sign_list.selection_clear(0, tk.END)
                self.created_sign_list.selection_set(index)
                return True
            return False

        def restore_compact_queue() -> None:
            self.library_filter.set("pending")
            self._refresh_created_signs()

        def load_selected(_event: tk.Event[tk.Misc] | None = None) -> None:
            selected = results.selection()
            if not selected:
                return
            if select_in_main_queue(selected[0]):
                self._load_created_sign()
            restore_compact_queue()
            close_search()

        def delete_selected() -> None:
            selected = results.selection()
            if not selected:
                messagebox.showinfo(
                    "Eliminar seña",
                    "Selecciona una seña de la tabla primero.",
                    parent=dialog,
                )
                return
            dialog.grab_release()
            if select_in_main_queue(selected[0]):
                self._delete_selected_sign()
            restore_compact_queue()
            if dialog.winfo_exists():
                dialog.grab_set()
                refresh_results()

        def save_edited_aliases() -> None:
            selected = results.selection()
            if not selected:
                messagebox.showinfo(
                    "Editar palabras de voz",
                    "Selecciona una seña de la tabla primero.",
                    parent=dialog,
                )
                return
            gloss = selected[0]
            aliases = self._parse_edited_speech_aliases(
                gloss,
                aliases_editor_input.get("1.0", "end-1c"),
            )
            recipe_path = self.created_sign_paths[gloss][0]
            try:
                original_text = recipe_path.read_text(encoding="utf-8")
                data = json.loads(original_text)
                data["speech_aliases"] = aliases
                data["speech_aliases_overridden"] = True
                recipe_path.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                if gloss in self._published_mobile_glosses():
                    self._register_published_linguistic_entry(gloss, recipe_path)
            except (OSError, ValueError, json.JSONDecodeError) as error:
                if "original_text" in locals():
                    recipe_path.write_text(original_text, encoding="utf-8")
                messagebox.showerror(
                    "No se pudieron guardar las palabras",
                    str(error),
                    parent=dialog,
                )
                return

            aliases_by_gloss[gloss] = aliases
            current_values = list(results.item(gloss, "values"))
            preview = ", ".join(aliases[:4]) + ("…" if len(aliases) > 4 else "")
            current_values[2] = preview or "solo forma base"
            results.item(gloss, values=current_values)
            represented_forms.set(
                f"GUARDADO · FORMA BASE: {gloss.lower()} · "
                + (
                    "VARIANTES: " + ", ".join(aliases)
                    if aliases
                    else "sin variantes adicionales"
                )
            )
            if self.loaded_review_gloss == gloss:
                self.speech_aliases_overridden = True
                self.speech_aliases.set(", ".join(aliases))
            result_status.set(
                "Palabras guardadas en VOZUAL. "
                + (
                    "La app móvil las usará en la próxima compilación."
                    if gloss in self._published_mobile_glosses()
                    else "Se aplicarán cuando publiques esta seña."
                )
            )

        query.trace_add("write", refresh_results)
        results.bind("<<TreeviewSelect>>", show_represented_forms)
        results.bind("<Double-Button-1>", load_selected)
        aliases_editor = tk.Frame(panel, bg="#172638", padx=10, pady=9)
        aliases_editor.pack(fill="x", pady=(9, 0))
        aliases_editor.grid_columnconfigure(0, weight=1)
        tk.Label(
            aliases_editor,
            text="EDITAR PALABRAS DE VOZ",
            fg="#20d6ce",
            bg="#172638",
            font=("Arial", 8, "bold"),
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            aliases_editor,
            text=(
                "Sepáralas con comas. Puedes agregar o borrar variantes; "
                "el nombre base de la seña siempre se conserva."
            ),
            fg="#9fb0c4",
            bg="#172638",
            font=("Arial", 8),
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 6))
        aliases_editor_input = tk.Text(
            aliases_editor,
            height=2,
            wrap="word",
            bg="#0d1928",
            fg="#f5f8fc",
            insertbackground="#f5f8fc",
            relief="flat",
            font=("Arial", 10),
            padx=8,
            pady=7,
        )
        aliases_editor_input.grid(row=2, column=0, sticky="ew", padx=(0, 8))
        tk.Button(
            aliases_editor,
            text="GUARDAR PALABRAS",
            command=save_edited_aliases,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 9, "bold"),
        ).grid(row=2, column=1, sticky="nsew", ipady=4)
        tk.Label(
            panel,
            textvariable=represented_forms,
            fg="#20d6ce",
            bg="#111e2e",
            font=("Arial", 8, "bold"),
            wraplength=800,
            justify="left",
        ).pack(anchor="w", pady=(8, 0))
        action_row = tk.Frame(panel, bg="#111e2e")
        action_row.pack(fill="x", pady=(10, 0))
        action_row.grid_columnconfigure(0, weight=1)
        action_row.grid_columnconfigure(1, weight=1)
        tk.Button(
            action_row,
            text="ABRIR SEÑA",
            command=load_selected,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=0, sticky="ew", padx=(0, 4), ipady=5)
        tk.Button(
            action_row,
            text="ELIMINAR",
            command=delete_selected,
            bg="#ff5b76",
            fg="#172638",
            activebackground="#ff7c91",
            activeforeground="#172638",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=1, sticky="ew", padx=(4, 0), ipady=5)

    def _open_vocabulary_planner(self) -> None:
        """List useful pending concepts and phrase-driven recording goals."""
        dialog = tk.Toplevel(self.root)
        dialog.title("VOZUAL — Palabras y frases")
        dialog.geometry("980x640")
        dialog.minsize(820, 520)
        dialog.configure(bg="#111e2e")
        dialog.transient(self.root)
        dialog.grab_set()

        panel = tk.Frame(dialog, bg="#111e2e", padx=20, pady=18)
        panel.pack(fill="both", expand=True)
        tk.Label(
            panel,
            text="PLAN DE PALABRAS Y FRASES",
            fg="#f5f8fc",
            bg="#111e2e",
            font=("Arial", 15, "bold"),
        ).pack(anchor="w")
        tk.Label(
            panel,
            text=(
                "Las conjugaciones y equivalentes de voz reutilizan una sola seña. "
                "Las frases sirven para priorizar conceptos; no fijan la gramática LSC."
            ),
            fg="#9fb0c4",
            bg="#111e2e",
            font=("Arial", 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", pady=(4, 12))

        existing = set(self.created_sign_paths) | self._published_mobile_glosses()
        pending_entries = suggested_signs(existing)
        pending_by_gloss = {entry.gloss: entry for entry in pending_entries}
        notebook = ttk.Notebook(panel)
        notebook.pack(fill="both", expand=True)

        words_tab = tk.Frame(notebook, bg="#111e2e", padx=10, pady=10)
        phrases_tab = tk.Frame(notebook, bg="#111e2e", padx=10, pady=10)
        notebook.add(words_tab, text=f"PALABRAS PENDIENTES ({len(pending_entries)})")
        notebook.add(phrases_tab, text=f"FRASES ÚTILES ({len(USEFUL_PHRASE_PRESETS)})")

        word_columns = ("gloss", "category", "voice_forms", "example")
        word_tree = ttk.Treeview(
            words_tab,
            columns=word_columns,
            show="headings",
            selectmode="browse",
        )
        word_tree.heading("gloss", text="SEÑA POR GRABAR")
        word_tree.heading("category", text="CATEGORÍA")
        word_tree.heading("voice_forms", text="CONJUGACIONES / EQUIVALENTES")
        word_tree.heading("example", text="FRASE DE USO")
        word_tree.column("gloss", width=145, anchor="w")
        word_tree.column("category", width=180, anchor="w")
        word_tree.column("voice_forms", width=300, anchor="w")
        word_tree.column("example", width=260, anchor="w")
        word_rows: dict[str, SignCatalogEntry] = {}
        for entry in pending_entries:
            forms = self._aliases_for_gloss(entry.gloss)
            voice_forms = ", ".join(forms[:6]) or "solo forma base"
            if len(forms) > 6:
                voice_forms += "…"
            row = word_tree.insert(
                "",
                tk.END,
                values=(
                    entry.gloss,
                    entry.category,
                    voice_forms,
                    example_phrase_for_gloss(entry.gloss) or "—",
                ),
            )
            word_rows[row] = entry
        word_scrollbar = ttk.Scrollbar(
            words_tab, orient="vertical", command=word_tree.yview
        )
        word_tree.configure(yscrollcommand=word_scrollbar.set)
        word_tree.pack(side="left", fill="both", expand=True)
        word_scrollbar.pack(side="right", fill="y")

        def prepare_selected_word() -> None:
            selected = word_tree.selection()
            if not selected:
                messagebox.showinfo(
                    "Palabras pendientes",
                    "Selecciona una palabra de la tabla.",
                    parent=dialog,
                )
                return
            self.current_suggestion = word_rows[selected[0]]
            self.suggestion_category.set(self.current_suggestion.category)
            self._use_current_suggestion()
            dialog.destroy()

        word_tree.bind("<Double-Button-1>", lambda _event: prepare_selected_word())
        word_button = tk.Button(
            panel,
            text="PREPARAR SEÑA SELECCIONADA",
            command=prepare_selected_word,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 10, "bold"),
        )
        word_button.pack(fill="x", pady=(10, 0), ipady=6)

        phrase_columns = ("category", "phrase", "missing")
        phrase_tree = ttk.Treeview(
            phrases_tab,
            columns=phrase_columns,
            show="headings",
            selectmode="browse",
        )
        phrase_tree.heading("category", text="SITUACIÓN")
        phrase_tree.heading("phrase", text="FRASE EN ESPAÑOL")
        phrase_tree.heading("missing", text="SEÑAS QUE FALTA GRABAR")
        phrase_tree.column("category", width=130, anchor="w")
        phrase_tree.column("phrase", width=390, anchor="w")
        phrase_tree.column("missing", width=340, anchor="w")
        phrase_rows: dict[str, UsefulPhrasePreset] = {}
        for phrase in USEFUL_PHRASE_PRESETS:
            missing = missing_glosses_for_phrase(phrase, existing)
            row = phrase_tree.insert(
                "",
                tk.END,
                values=(
                    phrase.category,
                    phrase.spoken_text,
                    ", ".join(missing) if missing else "COMPLETA ✓",
                ),
            )
            phrase_rows[row] = phrase
        phrase_scrollbar = ttk.Scrollbar(
            phrases_tab, orient="vertical", command=phrase_tree.yview
        )
        phrase_tree.configure(yscrollcommand=phrase_scrollbar.set)
        phrase_tree.pack(side="left", fill="both", expand=True)
        phrase_scrollbar.pack(side="right", fill="y")

        def prepare_selected_phrase() -> None:
            selected = phrase_tree.selection()
            if not selected:
                messagebox.showinfo(
                    "Frases útiles",
                    "Selecciona una frase de la tabla.",
                    parent=dialog,
                )
                return
            phrase = phrase_rows[selected[0]]
            self.linguistic_example.set(phrase.spoken_text)
            self._preview_linguistic_plan()
            missing = missing_glosses_for_phrase(phrase, existing)
            if not missing:
                messagebox.showinfo(
                    "Frase completa",
                    "Todos sus conceptos ya están grabados. Puedes probarla en la ficha lingüística.",
                    parent=dialog,
                )
                return
            next_entry = pending_by_gloss.get(missing[0])
            if next_entry is None:
                messagebox.showwarning(
                    "Revisión necesaria",
                    f"{missing[0]} todavía no tiene una ficha de grabación curada.",
                    parent=dialog,
                )
                return
            self.current_suggestion = next_entry
            self.suggestion_category.set(next_entry.category)
            self._use_current_suggestion()
            self.status.set(
                f'Frase "{phrase.spoken_text}": prepara {next_entry.gloss}. '
                f"Después faltarán {max(0, len(missing) - 1)} conceptos."
            )
            dialog.destroy()

        phrase_tree.bind(
            "<Double-Button-1>", lambda _event: prepare_selected_phrase()
        )
        phrase_button = tk.Button(
            panel,
            text="PREPARAR SIGUIENTE SEÑA DE LA FRASE",
            command=prepare_selected_phrase,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 10, "bold"),
        )

        def show_active_tab(_event: tk.Event[tk.Misc] | None = None) -> None:
            if notebook.index(notebook.select()) == 0:
                phrase_button.pack_forget()
                word_button.pack(fill="x", pady=(10, 0), ipady=6)
            else:
                word_button.pack_forget()
                phrase_button.pack(fill="x", pady=(10, 0), ipady=6)

        notebook.bind("<<NotebookTabChanged>>", show_active_tab)

    def _on_suggestion_category_changed(
        self, _event: tk.Event[tk.Misc] | None = None
    ) -> None:
        self._refresh_sign_suggestions()

    def _refresh_sign_suggestions(self, exclude_gloss: str | None = None) -> None:
        """Show a random uncreated gloss, avoiding the one just prepared."""

        existing = set(self.created_sign_paths) | self._published_mobile_glosses()
        suggestions = suggested_signs(existing, self.suggestion_category.get())
        alternatives = tuple(
            suggestion
            for suggestion in suggestions
            if suggestion.gloss != exclude_gloss
        )
        pool = alternatives if exclude_gloss is not None else suggestions
        self.current_suggestion = random.choice(pool) if pool else None
        if self.current_suggestion is None:
            category = self.suggestion_category.get()
            if suggestions and exclude_gloss is not None:
                self.suggestion_label.set(
                    f"✓ {exclude_gloss} YA ESTÁ PREPARADA\n"
                    f"{category}: no hay otra palabra pendiente"
                )
            else:
                self.suggestion_label.set(f"✓ {category}: no quedan señas pendientes")
            return
        forms = self._aliases_for_gloss(self.current_suggestion.gloss)
        coverage = (
            "RECONOCERÁ: " + ", ".join(forms[:4]) + ("…" if len(forms) > 4 else "")
            if forms
            else "SIN VARIANTES REGISTRADAS: completa la ficha lingüística antes de publicar."
        )
        example = example_phrase_for_gloss(self.current_suggestion.gloss)
        phrase_context = f"\nFRASE: {example}" if example else ""
        self.suggestion_label.set(
            "HACER AHORA: "
            f"{self.current_suggestion.gloss} · "
            f"{self.current_suggestion.recommended_duration_seconds:.1f} s\n"
            f"{self.current_suggestion.category}\n{coverage}{phrase_context}"
        )

    def _use_current_suggestion(self) -> None:
        """Set the creation form to the recommended gloss after checking duplicates."""

        if self.current_suggestion is None:
            messagebox.showinfo(
                "Ruta de vocabulario",
                "No hay más señas pendientes en esta categoría.",
                parent=self.root,
            )
            return
        selected = self.current_suggestion
        self.gloss.set(selected.gloss)
        self._set_default_speech_aliases(selected.gloss)
        self.duration_seconds.set(selected.recommended_duration_seconds)
        self.video_path.set("")
        self._reset_workflow_after_video()
        self.step_status.set(
            f"SEÑA PREPARADA: {selected.gloss}. Pulsa ABRIR CÁMARA Y GRABAR."
        )
        self.status.set(
            f"Preparada: {selected.gloss} "
            f"({selected.recommended_duration_seconds:.1f} s, "
            f"{selected.category}). La recomendación ya cambió a otra palabra."
        )
        self._refresh_sign_suggestions(exclude_gloss=selected.gloss)

    @staticmethod
    def _mobile_library_summary(
        published_glosses: set[str], created_glosses: set[str]
    ) -> str:
        """Summarize publication state without filling the UI with gloss names."""
        pending_count = len(created_glosses - published_glosses)
        return (
            f"APP MÓVIL: {len(published_glosses)} PUBLICADAS · "
            f"{pending_count} PENDIENTES"
        )

    @staticmethod
    def _aliases_for_gloss(
        gloss: str,
        aliases: object = None,
        *,
        include_defaults: bool = True,
    ) -> list[str]:
        """Return normalized, unique spoken forms for one canonical sign."""
        default_value = editor_metadata(gloss)["speech_aliases"]
        defaults = (
            [alias for alias in default_value if isinstance(alias, str)]
            if isinstance(default_value, list)
            else []
        )
        # Old recipes may have been recorded before the shared catalog gained
        # full conjugations. Keep an author's custom words and append the safe
        # catalog inventory when that sign is reopened.
        if isinstance(aliases, list):
            raw_aliases = [*aliases, *defaults] if include_defaults else aliases
        else:
            raw_aliases = defaults if include_defaults else []
        unique: dict[str, str] = {}
        for alias in raw_aliases:
            if not isinstance(alias, str):
                continue
            normalized = alias.strip().lower()
            if normalized:
                unique.setdefault(normalized, alias.strip())
        # The canonical gloss is always a mobile speech candidate, so showing
        # it again in the aliases field is redundant and makes a fresh verb
        # look as if it has no conjugations. Keep this field for additional
        # spoken forms only.
        canonical = gloss.strip().casefold()
        return [value for key, value in unique.items() if key != canonical]

    @classmethod
    def _parse_edited_speech_aliases(cls, gloss: str, text: str) -> list[str]:
        """Parse an exact user-managed alias list from comma or line separators."""
        aliases = [
            alias.strip()
            for line in text.splitlines()
            for alias in line.split(",")
            if alias.strip()
        ]
        return cls._aliases_for_gloss(
            gloss,
            aliases,
            include_defaults=False,
        )

    def _set_default_speech_aliases(self, gloss: str) -> None:
        metadata = editor_metadata(gloss)
        self.speech_aliases_overridden = False
        self.speech_aliases.set(", ".join(self._aliases_for_gloss(gloss)))
        self.linguistic_categories.set(", ".join(metadata["categories"]))
        self.lexical_class.set(str(metadata["lexical_class"]))
        self.lsc_verb_type.set(str(metadata["verb_type"]))
        self.linguistic_review_status.set(str(metadata["review_status"]))
        self._update_linguistic_summary()

    def _on_speech_aliases_input_modified(self, _event: tk.Event[tk.Text]) -> None:
        """Mirror the multiline editor back to the recipe variable."""
        if self.speech_aliases_input is None or not self.speech_aliases_input.edit_modified():
            return
        self.speech_aliases_input.edit_modified(False)
        if self._updating_speech_aliases_input:
            return
        self.speech_aliases_overridden = True
        self.speech_aliases.set(self.speech_aliases_input.get("1.0", "end-1c"))

    def _refresh_speech_aliases_input(self, *_args: object) -> None:
        """Show every saved voice form without resetting the user's cursor."""
        if self.speech_aliases_input is None:
            return
        expected = self.speech_aliases.get()
        actual = self.speech_aliases_input.get("1.0", "end-1c")
        if actual == expected:
            return
        self._updating_speech_aliases_input = True
        try:
            self.speech_aliases_input.delete("1.0", "end")
            self.speech_aliases_input.insert("1.0", expected)
            self.speech_aliases_input.edit_modified(False)
        finally:
            self._updating_speech_aliases_input = False

    def _update_linguistic_summary(self) -> None:
        """Describe the required linguistic decision in plain language."""
        gloss = self.gloss.get().strip().upper()
        if gloss == "YO":
            self.linguistic_summary.set(
                "Para YO no necesitas configurar nada: es un pronombre de primera persona."
            )
            return
        category = self.linguistic_categories.get().replace("_", " ")
        lexical_class = self.lexical_class.get()
        if lexical_class == "verb":
            self.linguistic_summary.set(
                f"Verbo · {category}. Añade las formas de voz que deben usar esta misma seña."
            )
            return
        self.linguistic_summary.set(
            f"{lexical_class.replace('_', ' ').capitalize()} · {category}. Edita detalles solo si necesitas corregir esta clasificación."
        )

    def _toggle_linguistic_details(self) -> None:
        """Reveal specialist metadata only when the author needs it."""
        showing = not self.show_linguistic_details.get()
        self.show_linguistic_details.set(showing)
        if showing:
            self.linguistic_details.grid()
            self.linguistic_details_button.configure(text="OCULTAR DETALLES")
        else:
            self.linguistic_details.grid_remove()
            self.linguistic_details_button.configure(text="EDITAR DETALLES")
        self._update_linguistic_summary()

    def _current_linguistic_categories(self) -> list[str]:
        return [
            category.strip()
            for category in self.linguistic_categories.get().split(",")
            if category.strip()
        ] or ["sin_clasificar"]

    def _preview_linguistic_plan(self) -> None:
        """Show the same renderable LSC plan used by the mobile catalog."""
        renderable, pending = preview_renderable_plan(self.linguistic_example.get())
        if not renderable and not pending:
            self.linguistic_plan_preview.set(
                "No hay señas publicadas para esa frase todavía."
            )
            return
        message = "APP RENDERIZA: " + (" · ".join(renderable) or "ninguna seña")
        if pending:
            message += "  |  FALTA APROBAR/ANIMAR: " + ", ".join(pending)
        self.linguistic_plan_preview.set(message)

    def _current_speech_aliases(self) -> list[str]:
        return self._aliases_for_gloss(
            self.gloss.get(),
            self.speech_aliases.get().split(","),
            include_defaults=not self.speech_aliases_overridden,
        )

    @staticmethod
    def _published_mobile_glosses() -> set[str]:
        """Read the explicit mobile publication list without inspecting scratch files."""
        manifest = REPO_ROOT / "mobile/assets/motions/published_signs.json"
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            glosses = data.get("publishedGlosses", [])
            return {str(gloss).strip().upper() for gloss in glosses if str(gloss).strip()}
        except (OSError, json.JSONDecodeError, TypeError):
            return set()

    def _selected_created_gloss(
        self, silent: bool = False
    ) -> tuple[str, Path, Path] | None:
        if self.created_sign_list is None:
            return None
        selected = self.created_sign_list.curselection()
        if not selected:
            if silent:
                return None
            messagebox.showinfo("Palabras creadas", "Selecciona una palabra guardada.", parent=self.root)
            return None
        label = str(self.created_sign_list.get(selected[0]))
        gloss = self.created_sign_labels.get(label, label)
        paths = self.created_sign_paths.get(gloss)
        if paths is None:
            return None
        return gloss, paths[0], paths[1]

    def _load_gloss_from_library(self, gloss: str) -> None:
        """Select and load an existing sign by gloss from the local library."""
        if self.created_sign_list is None:
            return
        for index in range(self.created_sign_list.size()):
            label = str(self.created_sign_list.get(index))
            if self.created_sign_labels.get(label) != gloss:
                continue
            self.created_sign_list.selection_clear(0, tk.END)
            self.created_sign_list.selection_set(index)
            self.created_sign_list.activate(index)
            self._on_created_sign_selection()
            self._load_created_sign()
            return

    def _can_create_new_gloss(self, gloss: str) -> bool:
        """Prevent a recording or analysis from silently overwriting a saved sign."""
        normalized = gloss.strip().upper()
        if not normalized:
            return False
        self._refresh_created_signs()
        if normalized not in self.created_sign_paths:
            return True
        published = normalized in self._published_mobile_glosses()
        availability = (
            "ya está publicada para la app móvil"
            if published
            else "ya existe en la biblioteca de VOZUAL"
        )
        load_existing = messagebox.askyesno(
            "Seña existente",
            f"{normalized} {availability}.\n\n"
            "Para proteger tu trabajo, VOZUAL no grabará ni analizará encima de esa seña.\n\n"
            "¿Quieres cargarla ahora para revisarla o editarla?\n\n"
            "Para crear una seña nueva, escribe otro nombre.",
            parent=self.root,
        )
        if load_existing:
            self._load_gloss_from_library(normalized)
        else:
            self.status.set(
                f"{normalized} ya existe. Escribe otro nombre para crear una seña nueva."
            )
        return False

    def _on_created_sign_selection(self, _event: tk.Event[tk.Misc] | None = None) -> None:
        """Explain the selected library item before the user chooses an action."""
        selected = self._selected_created_gloss(silent=True)
        if selected is None:
            return
        gloss, _recipe_path, _landmark_path = selected
        state = (
            "ya está publicada: el celular la incluirá en la próxima instalación."
            if gloss in self._published_mobile_glosses()
            else "solo existe en VOZUAL: ya puedes publicarla en la app móvil."
        )
        self.library_selection_status.set(
            f"Seleccionada: {gloss}. CARGAR Y EDITAR abre sus vistas y parámetros; {state}"
        )

    @staticmethod
    def _export_mobile_motion(
        gloss: str, recipe_path: Path, landmark_path: Path
    ) -> None:
        """Export one captured motion into the format consumed by the mobile app."""
        output = REPO_ROOT / "mobile/assets/motions" / f"{gloss.lower()}.motion.json"
        SignAuthoringEditor._export_mobile_motion_file(
            gloss,
            recipe_path,
            landmark_path,
            output,
        )

    @staticmethod
    def _export_mobile_motion_file(
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
        output: Path,
    ) -> None:
        """Export a motion to an explicit target for publication or simulation."""
        recipe_data = json.loads(recipe_path.read_text(encoding="utf-8"))
        fps = max(1, int(recipe_data.get("output_fps", 30)))
        exporter = REPO_ROOT / "mobile/tools/export_skeleton_motion.py"
        subprocess.run(
            [
                sys.executable,
                str(exporter),
                str(landmark_path),
                str(output),
                "--fps",
                str(fps),
                "--recipe",
                str(recipe_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )

    @staticmethod
    def _mobile_preview_signature(
        recipe_path: Path,
        landmark_path: Path,
        extra_inputs: tuple[Path, ...] | None = None,
    ) -> tuple[tuple[str, int, int], ...]:
        """Identify the exact capture and mobile runtime reviewed by the author."""

        mobile_root = REPO_ROOT / "mobile"
        inputs = [recipe_path, landmark_path]
        if extra_inputs is None:
            inputs.extend(
                [
                    mobile_root / "tools/avatar-runtime.ts",
                    mobile_root / "tools/avatar/preview.html",
                    mobile_root / "tools/compact-sign-motion.js",
                    mobile_root / "tools/export_skeleton_motion.py",
                    mobile_root / "assets/models/vozual_woman_avatar_hands_v4.glb",
                    mobile_root / "assets/motions/avatar_profile_overrides.json",
                    mobile_root / "assets/motions/published_signs.json",
                    mobile_root / "package-lock.json",
                    *sorted((mobile_root / "assets/motions").glob("*.motion.json")),
                    *sorted((mobile_root / "src/services").glob("*.ts")),
                ]
            )
        else:
            inputs.extend(extra_inputs)
        signature: list[tuple[str, int, int]] = []
        for path in inputs:
            try:
                details = path.stat()
                signature.append((str(path.resolve()), details.st_mtime_ns, details.st_size))
            except OSError:
                signature.append((str(path.resolve()), -1, -1))
        return tuple(signature)

    @staticmethod
    def _node_executable() -> Path:
        """Locate Node when the editor was launched from Finder."""

        candidates = sorted(
            Path.home().glob(".nvm/versions/node/*/bin/node"), reverse=True
        ) + [Path("/opt/homebrew/bin/node"), Path("/usr/local/bin/node")]
        node = next((candidate for candidate in candidates if candidate.is_file()), None)
        if node is None:
            executable = shutil.which("node")
            node = Path(executable) if executable else None
        if node is None:
            raise FileNotFoundError(
                "No se encontró Node.js para construir la simulación móvil."
            )
        return node

    @staticmethod
    def _mobile_preview_root(process_id: int | None = None) -> Path:
        """Keep preview assets isolated between simultaneous editor processes."""

        owner = os.getpid() if process_id is None else process_id
        return REPO_ROOT / "tmp/mobile_runtime_previews" / f"editor-{owner}"

    @staticmethod
    def _mobile_preview_glosses(
        candidate_gloss: str,
        manifest_path: Path | None = None,
    ) -> list[str]:
        """Include the mobile library plus the candidate under active review."""

        manifest = manifest_path or (
            REPO_ROOT / "mobile/assets/motions/published_signs.json"
        )
        data = json.loads(manifest.read_text(encoding="utf-8"))
        published = data.get("publishedGlosses", [])
        glosses: list[str] = []
        for value in published:
            normalized = str(value).strip().upper()
            if normalized and normalized not in glosses:
                glosses.append(normalized)
        candidate = candidate_gloss.strip().upper()
        if candidate and candidate not in glosses:
            glosses.append(candidate)
        return glosses

    @staticmethod
    def _build_mobile_runtime_preview(
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
    ) -> tuple[ThreadingHTTPServer, str, Path]:
        """Build and serve one candidate through the production mobile runtime."""

        mobile_root = REPO_ROOT / "mobile"
        preview_root = SignAuthoringEditor._mobile_preview_root()
        source_motion_dir = preview_root / "source"
        runtime_dir = preview_root / "runtime"
        if preview_root.exists():
            shutil.rmtree(preview_root)
        source_motion_dir.mkdir(parents=True)
        (runtime_dir / "motions").mkdir(parents=True)

        motion_library = mobile_root / "assets/motions"
        preview_glosses = SignAuthoringEditor._mobile_preview_glosses(gloss)
        SignAuthoringEditor._stage_mobile_preview_recordings(
            preview_glosses,
            runtime_dir,
        )
        for published_gloss in preview_glosses:
            published_motion = motion_library / f"{published_gloss.lower()}.motion.json"
            if published_motion.is_file():
                shutil.copy2(published_motion, source_motion_dir / published_motion.name)
        SignAuthoringEditor._export_mobile_motion_file(
            gloss,
            recipe_path,
            landmark_path,
            source_motion_dir / f"{gloss.lower()}.motion.json",
        )
        (source_motion_dir / "published_signs.json").write_text(
            json.dumps({"publishedGlosses": preview_glosses}, ensure_ascii=False),
            encoding="utf-8",
        )
        profile_overrides = mobile_root / "assets/motions/avatar_profile_overrides.json"
        if profile_overrides.is_file():
            shutil.copy2(
                profile_overrides,
                source_motion_dir / "avatar_profile_overrides.json",
            )

        node = SignAuthoringEditor._node_executable()
        subprocess.run(
            [
                str(node),
                str(mobile_root / "tools/compact-sign-motion.js"),
                str(source_motion_dir),
                str(runtime_dir / "motions"),
            ],
            cwd=mobile_root,
            check=True,
            capture_output=True,
            text=True,
        )

        esbuild = mobile_root / "node_modules/.bin/esbuild"
        if not esbuild.is_file():
            raise FileNotFoundError(
                "No se encontró esbuild. Ejecuta npm install dentro de mobile."
            )
        subprocess.run(
            [
                str(esbuild),
                "tools/avatar-runtime.ts",
                "--bundle",
                "--minify",
                "--format=iife",
                "--platform=browser",
                f"--outfile={runtime_dir / 'runtime.js'}",
            ],
            cwd=mobile_root,
            check=True,
            capture_output=True,
            text=True,
        )

        preview_template = mobile_root / "tools/avatar/preview.html"
        avatar_model = mobile_root / "assets/models/vozual_woman_avatar_hands_v4.glb"
        if not preview_template.is_file() or not avatar_model.is_file():
            raise FileNotFoundError(
                "Falta la plantilla de simulación o el personaje móvil de VOZUAL."
            )
        shutil.copy2(preview_template, runtime_dir / "index.html")
        shutil.copy2(avatar_model, runtime_dir / "vozual_woman_avatar.glb")

        handler = partial(
            _MobilePreviewRequestHandler,
            directory=str(runtime_dir),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        port = int(server.server_address[1])
        return (
            server,
            f"http://127.0.0.1:{port}/?gloss={quote(gloss, safe='')}",
            preview_root,
        )

    @staticmethod
    def _stage_mobile_preview_recordings(
        glosses: list[str],
        runtime_dir: Path,
        recording_root: Path | None = None,
    ) -> dict[str, str]:
        """Expose the newest original take for each gloss in a local preview."""

        recordings_dir = runtime_dir / "recordings"
        recordings_dir.mkdir(parents=True, exist_ok=True)
        manifest: dict[str, str] = {}
        for index, gloss in enumerate(glosses):
            recording = SignAuthoringEditor._recording_for_gloss(
                gloss,
                recording_root,
            )
            if recording is None:
                continue
            destination = recordings_dir / f"source-{index:03d}{recording.suffix.lower()}"
            try:
                os.link(recording, destination)
            except OSError:
                shutil.copy2(recording, destination)
            manifest[gloss.strip().upper()] = f"./recordings/{destination.name}"

        (runtime_dir / "recordings.json").write_text(
            json.dumps(manifest, ensure_ascii=False),
            encoding="utf-8",
        )
        return manifest

    def _stop_mobile_preview_server(self) -> None:
        server = self.mobile_preview_server
        preview_root = self.mobile_preview_root
        self.mobile_preview_server = None
        self.mobile_preview_url = None
        self.mobile_preview_gloss = None
        self.mobile_preview_root = None
        if server is not None:
            server.shutdown()
            server.server_close()
        expected_parent = REPO_ROOT / "tmp/mobile_runtime_previews"
        if preview_root is not None and preview_root.parent == expected_parent:
            shutil.rmtree(preview_root, ignore_errors=True)

    def _close_editor(self) -> None:
        """Release local preview resources before closing the desktop editor."""

        self._stop_mobile_preview_server()
        if self.tracking_capture is not None:
            self.tracking_capture.release()
            self.tracking_capture = None
        self.root.destroy()

    def _preview_in_mobile_runtime(self) -> None:
        """Open a faithful pre-publication simulation of the loaded sign."""

        if self.recipe_path is None or self.landmark_path is None:
            messagebox.showinfo(
                "Carga una seña",
                "Analiza o carga una seña antes de simular la app móvil.",
                parent=self.root,
            )
            return
        gloss = self.gloss.get().strip().upper()
        try:
            self._save_recipe(notify=False)
            signature = self._mobile_preview_signature(
                self.recipe_path,
                self.landmark_path,
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            messagebox.showerror(
                "No se pudo preparar la seña",
                str(error),
                parent=self.root,
            )
            return

        if (
            self.mobile_preview_server is not None
            and self.mobile_preview_url is not None
            and self.mobile_preview_gloss == gloss
            and self.mobile_preview_signatures.get(gloss) == signature
        ):
            subprocess.Popen(["open", self.mobile_preview_url])
            return

        self._stop_mobile_preview_server()
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="disabled", text="CONSTRUYENDO SIMULACIÓN MÓVIL…"
            )
        self._start_progress(
            f"SIMULANDO {gloss} CON EL MISMO MOTOR DE LA APP MÓVIL…"
        )
        self.status.set(
            "VOZUAL está exportando, comprimiendo y cargando el personaje real de Android."
        )
        threading.Thread(
            target=self._build_mobile_preview_in_background,
            args=(gloss, self.recipe_path, self.landmark_path, signature),
            daemon=True,
        ).start()

    def _build_mobile_preview_in_background(
        self,
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
        signature: tuple[tuple[str, int, int], ...],
    ) -> None:
        try:
            server, url, preview_root = self._build_mobile_runtime_preview(
                gloss,
                recipe_path,
                landmark_path,
            )
        except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            details = self._mobile_install_failure_details(error)
            self.root.after(
                0,
                lambda: self._fail_mobile_runtime_preview(details),
            )
            return
        self.root.after(
            0,
            lambda: self._finish_mobile_runtime_preview(
                gloss,
                signature,
                server,
                url,
                preview_root,
            ),
        )

    def _finish_mobile_runtime_preview(
        self,
        gloss: str,
        signature: tuple[tuple[str, int, int], ...],
        server: ThreadingHTTPServer,
        url: str,
        preview_root: Path,
    ) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.mobile_preview_server = server
        self.mobile_preview_url = url
        self.mobile_preview_gloss = gloss
        self.mobile_preview_root = preview_root
        self.mobile_preview_signatures[gloss] = signature
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="VOLVER A VER SIMULACIÓN MÓVIL ✓"
            )
        self.step_status.set(
            f"SIMULACIÓN MÓVIL LISTA: revisa PUNTOS y PERSONAJE para {gloss}."
        )
        self.status.set(
            "No publiques si PUNTOS o PERSONAJE no representan claramente la seña."
        )
        try:
            subprocess.Popen(["open", url])
        except OSError as error:
            self._stop_mobile_preview_server()
            messagebox.showerror(
                "No se pudo abrir la simulación",
                str(error),
                parent=self.root,
            )

    def _fail_mobile_runtime_preview(self, details: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="INTENTAR SIMULACIÓN MÓVIL DE NUEVO"
            )
        self.step_status.set("NO SE PUDO CREAR LA SIMULACIÓN MÓVIL.")
        self.status.set("La seña no fue publicada.")
        self._show_detailed_error(
            "No se pudo simular la app móvil",
            "VOZUAL no pudo construir la vista fiel de Android.",
            details,
        )

    def _confirm_mobile_previews(
        self,
        glosses: list[str],
    ) -> bool:
        """Fail closed when any sign has not been reviewed in the current runtime."""

        missing: list[str] = []
        for gloss in glosses:
            paths = self.created_sign_paths.get(gloss)
            if paths is None:
                missing.append(gloss)
                continue
            signature = self._mobile_preview_signature(paths[0], paths[1])
            if self.mobile_preview_signatures.get(gloss) != signature:
                missing.append(gloss)
        if missing:
            first = missing[0]
            messagebox.showwarning(
                "Falta revisar la simulación móvil",
                f"Antes de publicar, carga {first} y pulsa SIMULAR APP MÓVIL.\n\n"
                "Debes comprobar PUNTOS y PERSONAJE. Si modificas la captura, la "
                "receta o el motor del avatar, VOZUAL pedirá revisarla de nuevo.",
                parent=self.root,
            )
            return False
        label = glosses[0] if len(glosses) == 1 else f"{len(glosses)} señas"
        return messagebox.askyesno(
            "Confirmar revisión móvil",
            f"¿Confirmas que {label} se ve correctamente tanto en PUNTOS como en PERSONAJE?\n\n"
            "Sí: publicar.\nNo: volver al editor sin publicar.",
            parent=self.root,
        )

    def _speech_aliases_for_recipe(self, gloss: str, recipe_path: Path) -> list[str]:
        """Read editor-managed voice variants without creating duplicate clips."""
        try:
            data = json.loads(recipe_path.read_text(encoding="utf-8"))
            aliases = data.get("speech_aliases")
            overridden = bool(data.get("speech_aliases_overridden", False))
            if overridden:
                return self._aliases_for_gloss(
                    gloss,
                    aliases,
                    include_defaults=False,
                )
            # Empty lists only occur in legacy recipes. Display the current
            # linguistic defaults rather than hiding the forms that mobile
            # already understands (for example MUCHO → mucha/muchos/muchas).
            if isinstance(aliases, list) and aliases:
                return self._aliases_for_gloss(gloss, aliases)
            return self._aliases_for_gloss(gloss)
        except (OSError, json.JSONDecodeError, TypeError):
            return self._aliases_for_gloss(gloss)

    @staticmethod
    def _restore_known_linguistic_metadata(
        gloss: str, recipe_path: Path, data: dict[str, object]
    ) -> dict[str, object]:
        """Restore a retired approved entry when its clip is recorded again.

        Removing a motion from the phone must not erase the linguistic decision
        already made for that lexical concept. Freshly imported recipes begin
        with generic draft metadata, so replace only that exact empty state.
        """
        metadata = editor_metadata(gloss)
        is_generic_draft = (
            data.get("linguistic_review_status", "draft") == "draft"
            and data.get("linguistic_categories") == ["sin_clasificar"]
            and data.get("lexical_class", "noun") == "noun"
            and data.get("lsc_verb_type", "none") == "none"
            and not data.get("speech_aliases")
        )
        if not is_generic_draft or metadata["review_status"] not in {
            "approved",
            "legacy_approved",
        }:
            return data
        restored = {
            **data,
            "speech_aliases": list(metadata["speech_aliases"]),
            "linguistic_categories": list(metadata["categories"]),
            "lexical_class": metadata["lexical_class"],
            "lsc_verb_type": metadata["verb_type"],
            "linguistic_review_status": metadata["review_status"],
        }
        recipe_path.write_text(
            json.dumps(restored, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return restored

    def _register_published_linguistic_entry(self, gloss: str, recipe_path: Path) -> None:
        """Publish a completed authoring recipe and preserve its LSC metadata."""
        data = json.loads(recipe_path.read_text(encoding="utf-8"))
        data = self._restore_known_linguistic_metadata(gloss, recipe_path, data)
        review_status = str(data.get("linguistic_review_status", "draft"))
        if review_status == "blocked":
            raise ValueError(
                f"{gloss} está bloqueada y no puede publicarse."
            )
        if review_status not in {"approved", "legacy_approved"}:
            data = {**data, "linguistic_review_status": "approved"}
            recipe_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            review_status = "approved"
        categories = data.get("linguistic_categories", ["sin_clasificar"])
        if not isinstance(categories, list):
            raise ValueError(f"{gloss} necesita categorías lingüísticas válidas.")
        upsert_editor_entry(
            gloss=gloss,
            categories=[str(category).strip() for category in categories if str(category).strip()],
            lexical_class=str(data.get("lexical_class", "noun")),
            verb_type=str(data.get("lsc_verb_type", "none")),
            review_status=review_status,
            speech_aliases=self._speech_aliases_for_recipe(gloss, recipe_path),
            speech_aliases_overridden=bool(
                data.get("speech_aliases_overridden", False)
            ),
        )

    def _publish_all_signs(self) -> None:
        """Publish every locally reviewed sign that is not yet in the mobile catalog."""
        self._refresh_created_signs()
        published = self._published_mobile_glosses()
        pending = sorted(set(self.created_sign_paths) - published)
        if not pending:
            messagebox.showinfo(
                "Biblioteca sincronizada",
                "Todas las señas de VOZUAL ya están publicadas para la app móvil.",
                parent=self.root,
            )
            return
        if not self._confirm_mobile_previews(pending):
            return

        exported: list[str] = []
        failures: list[tuple[str, str]] = []
        for gloss in pending:
            recipe_path, landmark_path = self.created_sign_paths[gloss]
            try:
                self._export_mobile_motion(gloss, recipe_path, landmark_path)
                self._register_published_linguistic_entry(gloss, recipe_path)
                exported.append(gloss)
            except (
                OSError,
                ValueError,
                json.JSONDecodeError,
                subprocess.CalledProcessError,
            ) as error:
                failures.append((gloss, str(error)))

        if exported:
            write_published_motion_manifest()
            self._refresh_created_signs()

        if failures:
            failure_details = "\n".join(
                f"• {gloss}: {error}" for gloss, error in failures
            )
            messagebox.showerror(
                "Algunas señas no se publicaron",
                f"Se publicaron {len(exported)} señas y fallaron {len(failures)}: "
                f"\n\n{failure_details}",
                parent=self.root,
            )
        if not exported:
            return

        publication_label = "1 seña" if len(exported) == 1 else f"{len(exported)} señas"
        self.step_status.set(
            f"PUBLICACIÓN TERMINADA: {publication_label.upper()}. "
            "Decide si quieres actualizar Android ahora."
        )
        self.status.set(
            f"Se publicaron {publication_label} en el catálogo móvil."
        )
        compile_now = messagebox.askyesno(
            "Señas publicadas",
            f"Se publicaron {publication_label} para la app móvil.\n\n"
            "¿Quieres compilar e instalar ahora la app Android?\n\n"
            "Si confirmas, VOZUAL sincronizará toda la biblioteca, construirá el APK "
            "e intentará instalarlo en el teléfono o emulador conectado.",
            parent=self.root,
        )
        if compile_now:
            self._compile_and_install_mobile_app(publication_label)
        else:
            self.status.set(
                f"Se publicaron {publication_label}. Puedes compilar Android más adelante."
            )

    def _publish_selected_sign(self) -> None:
        """Publish one selected sign; retained for internal compatibility."""
        selected = self._selected_created_gloss()
        if selected is None:
            return
        gloss, recipe_path, landmark_path = selected
        if not self._confirm_mobile_previews([gloss]):
            return
        try:
            self._export_mobile_motion(gloss, recipe_path, landmark_path)
            self._register_published_linguistic_entry(gloss, recipe_path)
            write_published_motion_manifest()
        except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            messagebox.showerror("No se pudo publicar", str(error), parent=self.root)
            return
        self._refresh_created_signs()
        self.step_status.set(f"SEÑA PUBLICADA: {gloss}. Decide si quieres actualizar Android ahora.")
        self.status.set(f"{gloss} exportada a mobile/assets/motions y añadida al catálogo móvil.")
        compile_now = messagebox.askyesno(
            "Seña publicada",
            f"{gloss} quedó marcada como EN APP.\n\n"
            "¿Quieres compilar e instalar ahora la app Android?\n\n"
            "Si confirmas, VOZUAL sincronizará la seña, construirá el APK e intentará "
            "instalarlo en el teléfono o emulador conectado.",
            parent=self.root,
        )
        if compile_now:
            self._compile_and_install_mobile_app(gloss)
        else:
            self.status.set(
                f"{gloss} está publicada. Cuando quieras, puedes compilar Android desde VOZUAL."
            )

    def _update_loaded_sign_voice_forms(self) -> None:
        """Persist edited spoken forms and offer an immediate Android update.

        This path deliberately does not export or regenerate the captured motion:
        it changes only the linguistic mapping for an already recorded sign.
        """
        if self.recipe_path is None or self.landmark_path is None:
            messagebox.showerror(
                "Carga una seña primero",
                "Busca y abre una seña de la biblioteca antes de actualizar sus palabras.",
                parent=self.root,
            )
            return
        gloss = self.gloss.get().strip().upper()
        self.speech_aliases_overridden = True
        forms = self._current_speech_aliases()
        if not gloss:
            messagebox.showerror(
                "Falta el nombre",
                "Escribe el nombre de la seña antes de guardar sus palabras.",
                parent=self.root,
            )
            return
        try:
            self._save_recipe(notify=False)
            self._register_published_linguistic_entry(gloss, self.recipe_path)
            write_published_motion_manifest()
            self._refresh_created_signs()
        except (OSError, ValueError, json.JSONDecodeError) as error:
            messagebox.showerror(
                "No se pudieron guardar las palabras", str(error), parent=self.root
            )
            return

        forms_label = ", ".join(forms) if forms else f"{gloss.lower()} (nombre automático)"
        self.step_status.set(
            f"PALABRAS ACTUALIZADAS: {gloss}. Decide si quieres actualizar Android ahora."
        )
        self.status.set(f"{gloss} reconocerá: {forms_label}.")
        compile_now = messagebox.askyesno(
            "Palabras actualizadas",
            f"{gloss} ahora reconocerá:\n{forms_label}\n\n"
            "¿Quieres compilar e instalar ahora la app Android?\n\n"
            "La seña no se vuelve a grabar ni se regenera: solo se actualizan las palabras "
            "que la activan en el celular.",
            parent=self.root,
        )
        if compile_now:
            self._compile_and_install_mobile_app(gloss)
        else:
            self.status.set(
                f"Palabras de {gloss} guardadas para la app móvil. Compila Android cuando quieras."
            )

    def _compile_and_install_mobile_app(self, gloss: str) -> None:
        """Build and install the standalone Android app after a sign is published."""
        mobile_directory = REPO_ROOT / "mobile"
        android_directory = mobile_directory / "android"
        apk_path = android_directory / "app/build/outputs/apk/release/app-release.apk"
        self._start_progress("ACTUALIZANDO APP MÓVIL… compilando e instalando Android.")
        self.status.set(
            f"Preparando {gloss} para Android. Esto puede tardar alrededor de un minuto."
        )
        threading.Thread(
            target=self._compile_and_install_mobile_in_background,
            args=(gloss, mobile_directory, android_directory, apk_path),
            daemon=True,
        ).start()

    def _compile_and_install_mobile_in_background(
        self, gloss: str, mobile_directory: Path, android_directory: Path, apk_path: Path
    ) -> None:
        try:
            npm, adb, environment = self._mobile_build_tools()
            subprocess.run(
                [str(npm), "run", "build:avatar-runtime"],
                cwd=mobile_directory,
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            subprocess.run(
                # The published catalog is imported into the React Native bundle.
                # Force the bundle task so a newly published sign cannot leave an
                # older catalog or count inside an otherwise current APK.
                ["./gradlew", ":app:assembleRelease", "--rerun-tasks"],
                cwd=android_directory,
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            subprocess.run(
                [str(adb), "install", "-r", str(apk_path)],
                cwd=android_directory,
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            subprocess.run(
                [str(adb), "shell", "am", "force-stop", "com.manospeak"],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            subprocess.run(
                [
                    str(adb),
                    "shell",
                    "am",
                    "start",
                    "-n",
                    "com.manospeak/.MainActivity",
                ],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            details = self._mobile_install_failure_details(error)
            self.root.after(
                0,
                lambda: self._finish_mobile_install_failure(gloss, details),
            )
            return
        self.root.after(0, lambda: self._finish_mobile_install(gloss))

    @staticmethod
    def _mobile_install_failure_details(
        error: OSError | subprocess.CalledProcessError,
    ) -> str:
        """Keep the actionable Gradle output instead of only bundle warnings."""
        if isinstance(error, subprocess.CalledProcessError):
            sections = [
                f"Command: {' '.join(str(part) for part in error.cmd)}",
                f"Exit code: {error.returncode}",
            ]
            stdout = str(error.stdout or "").strip()
            stderr = str(error.stderr or "").strip()
            if stdout:
                sections.append(f"Standard output:\n{stdout}")
            if stderr:
                sections.append(f"Error output:\n{stderr}")
            details = "\n\n".join(sections)
        else:
            details = str(error).strip()

        # A failed Android build can emit several megabytes of warnings. Keep
        # enough context for diagnosis without making the desktop dialog heavy.
        maximum_characters = 80_000
        if len(details) > maximum_characters:
            head = details[:10_000]
            tail = details[-65_000:]
            details = (
                f"{head}\n\n… {len(details) - 75_000:,} characters omitted …\n\n{tail}"
            )
        return details or "The Android build stopped without returning diagnostic output."

    @staticmethod
    def _mobile_install_failure_summary(details: str) -> str:
        """Extract one useful cause from a verbose Gradle or adb transcript."""
        lines = [line.strip() for line in details.splitlines() if line.strip()]
        preferred_markers = (
            "INSTALL_FAILED",
            "no devices/emulators found",
            "device unauthorized",
            "execution failed for task",
            "what went wrong:",
            "failure:",
            "error:",
            "no modules to process",
            "command not found",
            "no such file or directory",
        )
        for marker in preferred_markers:
            for line in reversed(lines):
                if marker in line.lower():
                    return line[:320]
        for line in reversed(lines):
            lowered = line.lower()
            if not lowered.startswith(("warning:", "^", "~")):
                return line[:320]
        return "Android no indicó una causa específica. Copia los detalles para revisarlos."

    @staticmethod
    def _mobile_build_tools() -> tuple[Path, Path, dict[str, str]]:
        """Locate Node and Android tools when VOZUAL starts from Finder."""
        home = Path.home()
        npm_candidates = sorted(
            home.glob(".nvm/versions/node/*/bin/npm"), reverse=True
        ) + [Path("/opt/homebrew/bin/npm"), Path("/usr/local/bin/npm")]
        adb_candidates = [
            home / "Library/Android/sdk/platform-tools/adb",
            Path("/opt/homebrew/bin/adb"),
            Path("/usr/local/bin/adb"),
        ]
        npm = next((path for path in npm_candidates if path.is_file()), None)
        adb = next((path for path in adb_candidates if path.is_file()), None)
        if npm is None:
            raise FileNotFoundError("No se encontró npm. Instala Node.js para compilar Android.")
        if adb is None:
            raise FileNotFoundError("No se encontró adb. Instala Android Platform Tools.")
        environment = dict(os.environ)
        tool_paths = [str(npm.parent), str(adb.parent), environment.get("PATH", "")]
        environment["PATH"] = os.pathsep.join(path for path in tool_paths if path)
        sdk_directory = adb.parent.parent
        environment["ANDROID_HOME"] = str(sdk_directory)
        environment["ANDROID_SDK_ROOT"] = str(sdk_directory)
        return npm, adb, environment

    def _finish_mobile_install(self, gloss: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.step_status.set(f"APP ABIERTA ✓  {gloss} ya está disponible en Android.")
        self.status.set(
            f"APK instalado y app abierta. El celular ya puede reconocer {gloss}."
        )
        messagebox.showinfo(
            "App móvil actualizada",
            f"{gloss} ya quedó instalada y VOZUAL abrió la app Android conectada.",
            parent=self.root,
        )

    def _finish_mobile_install_failure(self, gloss: str, error: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.step_status.set(f"{gloss} fue publicada, pero Android no se pudo actualizar.")
        self.status.set("La seña quedó guardada; conecta Android e inténtalo de nuevo.")
        summary = self._mobile_install_failure_summary(error)
        self._show_detailed_error(
            title="No se pudo actualizar Android",
            summary=(
                "La seña sigue publicada. La compilación o instalación de Android "
                f"no terminó.\n\nCausa detectada: {summary}"
            ),
            details=error,
        )

    def _show_detailed_error(self, title: str, summary: str, details: str) -> None:
        """Show long technical output without hiding the close controls."""
        background = "#07111f"
        card = "#111e2e"
        card_soft = "#172638"
        text_color = "#f5f8fc"
        muted = "#9fb0c4"
        accent = "#20d6ce"
        danger = "#ff5b76"

        dialog = tk.Toplevel(self.root)
        dialog.title(title)
        dialog.configure(bg=background)
        dialog.transient(self.root)
        dialog.minsize(560, 380)
        dialog.grid_columnconfigure(0, weight=1)
        dialog.grid_rowconfigure(1, weight=1)

        screen_width = dialog.winfo_screenwidth()
        screen_height = dialog.winfo_screenheight()
        width = min(780, max(560, screen_width - 120))
        height = min(560, max(380, screen_height - 160))
        x = max(0, (screen_width - width) // 2)
        y = max(0, (screen_height - height) // 2)
        dialog.geometry(f"{width}x{height}+{x}+{y}")

        summary_frame = tk.Frame(dialog, bg=card, padx=22, pady=18)
        summary_frame.grid(row=0, column=0, sticky="ew", padx=16, pady=(16, 8))
        summary_frame.grid_columnconfigure(1, weight=1)
        tk.Label(
            summary_frame,
            text="!",
            bg=danger,
            fg=background,
            font=("Arial", 18, "bold"),
            width=2,
            height=1,
        ).grid(row=0, column=0, sticky="n", padx=(0, 14))
        tk.Label(
            summary_frame,
            text=summary,
            bg=card,
            fg=text_color,
            justify="left",
            anchor="w",
            wraplength=max(420, width - 130),
            font=("Arial", 13, "bold"),
        ).grid(row=0, column=1, sticky="ew")

        details_frame = tk.Frame(dialog, bg=card_soft, padx=14, pady=12)
        details_frame.grid(row=1, column=0, sticky="nsew", padx=16, pady=8)
        details_frame.grid_columnconfigure(0, weight=1)
        details_frame.grid_rowconfigure(1, weight=1)
        tk.Label(
            details_frame,
            text="DETALLES TÉCNICOS",
            bg=card_soft,
            fg=accent,
            anchor="w",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=0, sticky="ew", pady=(0, 8))
        detail_text = tk.Text(
            details_frame,
            bg=background,
            fg=muted,
            insertbackground=text_color,
            relief="flat",
            wrap="word",
            padx=12,
            pady=12,
            font=("Menlo", 10),
        )
        detail_scrollbar = ttk.Scrollbar(
            details_frame, orient="vertical", command=detail_text.yview
        )
        detail_text.configure(yscrollcommand=detail_scrollbar.set)
        detail_text.grid(row=1, column=0, sticky="nsew")
        detail_scrollbar.grid(row=1, column=1, sticky="ns")
        detail_text.insert("1.0", details)
        detail_text.configure(state="disabled")

        button_frame = tk.Frame(dialog, bg=background)
        button_frame.grid(row=2, column=0, sticky="ew", padx=16, pady=(8, 16))
        button_frame.grid_columnconfigure(0, weight=1)

        copy_button = tk.Button(
            button_frame,
            text="COPIAR DETALLES",
            bg=card_soft,
            fg=text_color,
            activebackground=card,
            activeforeground=text_color,
            relief="flat",
            padx=20,
            pady=10,
            font=("Arial", 11, "bold"),
        )

        def copy_details() -> None:
            self.root.clipboard_clear()
            self.root.clipboard_append(details)
            copy_button.configure(text="COPIADO ✓")
            dialog.after(1_500, lambda: copy_button.configure(text="COPIAR DETALLES"))

        copy_button.configure(command=copy_details)
        copy_button.grid(row=0, column=0, sticky="w")
        close_button = tk.Button(
            button_frame,
            text="CERRAR",
            command=dialog.destroy,
            bg=accent,
            fg=background,
            activebackground="#64e3dc",
            activeforeground=background,
            relief="flat",
            padx=34,
            pady=10,
            font=("Arial", 11, "bold"),
        )
        close_button.grid(row=0, column=1, sticky="e")

        dialog.protocol("WM_DELETE_WINDOW", dialog.destroy)
        dialog.bind("<Escape>", lambda _event: dialog.destroy())
        dialog.bind("<Command-w>", lambda _event: dialog.destroy())
        dialog.grab_set()
        close_button.focus_set()

    def _delete_selected_sign(self) -> None:
        """Delete a sign from the local authoring library and mobile catalog."""
        selected = self._selected_created_gloss()
        if selected is None:
            return
        gloss, recipe_path, _landmark_path = selected
        published = gloss in self._published_mobile_glosses()
        scope = (
            "También se retirará de la app móvil en la próxima compilación."
            if published
            else "Solo se eliminará de la biblioteca local de VOZUAL."
        )
        confirmed = messagebox.askyesno(
            "Eliminar seña",
            f"¿Eliminar {gloss}?\n\n"
            "Se borrarán sus puntos y parámetros guardados. "
            "Los videos originales no se borrarán.\n\n"
            f"{scope}",
            icon="warning",
            parent=self.root,
        )
        if not confirmed:
            return

        library = (REPO_ROOT / "tmp/creator_references/video_imports").resolve()
        sign_directory = recipe_path.parent.resolve()
        try:
            sign_directory.relative_to(library)
        except ValueError:
            messagebox.showerror(
                "No se pudo eliminar",
                "La seña seleccionada no pertenece a la biblioteca de VOZUAL.",
                parent=self.root,
            )
            return

        try:
            shutil.rmtree(sign_directory)
            legacy_directory = REPO_ROOT / "tmp/creator_references/desktop"
            if legacy_directory.is_dir():
                for capture_path in legacy_directory.glob("*.json"):
                    try:
                        capture = json.loads(capture_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    if str(capture.get("gloss", "")).strip().upper() == gloss:
                        capture_path.unlink()
            mobile_motion = REPO_ROOT / "mobile/assets/motions" / f"{gloss.lower()}.motion.json"
            mobile_motion.unlink(missing_ok=True)
            unpublish_entry(gloss)
            write_published_motion_manifest()
        except OSError as error:
            messagebox.showerror("No se pudo eliminar", str(error), parent=self.root)
            return

        if self.recipe_path == recipe_path:
            self.recipe_path = None
            self.landmark_path = None
            self.reference_frames = []
            self.tracking_preview_path = None
            self.skeleton_preview_path = None
            self.preview_button.configure(state="disabled", text="VER ANIMACIÓN DEL AVATAR")
            self.tracking_button.configure(state="disabled", text="VER PUNTOS DETECTADOS")
            if self.mobile_preview_button is not None:
                self.mobile_preview_button.configure(
                    state="disabled",
                    text="SIMULAR APP MÓVIL  ·  CARGA UNA SEÑA PRIMERO",
                )
            self.apply_adjustments_button.configure(state="disabled")
        self.mobile_preview_signatures.pop(gloss, None)
        self._refresh_created_signs()
        self.step_status.set(f"SEÑA ELIMINADA: {gloss}.")
        self.status.set(
            f"{gloss} fue eliminada de VOZUAL y retirada del catálogo móvil."
        )
        messagebox.showinfo(
            "Seña eliminada",
            f"{gloss} ya no aparece en la biblioteca ni en la app móvil.\n\n"
            "Para que el celular refleje el cambio, recompila e instala la app.",
            parent=self.root,
        )

    def _migrate_legacy_captures(self, library: Path) -> None:
        """Make earlier valid desktop captures editable without altering them."""
        legacy_directory = REPO_ROOT / "tmp/creator_references/desktop"
        if not legacy_directory.is_dir():
            return
        latest_by_gloss: dict[str, Path] = {}
        for capture_path in legacy_directory.glob("*.json"):
            try:
                data = json.loads(capture_path.read_text(encoding="utf-8"))
                gloss = str(data.get("gloss", "")).strip().upper()
                frames = data.get("rawFrames", [])
                if not gloss or not isinstance(frames, list) or len(frames) < 2:
                    continue
                if not bool(dict(data.get("quality", {})).get("valid", False)):
                    continue
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            previous = latest_by_gloss.get(gloss)
            if previous is None or capture_path.stat().st_mtime > previous.stat().st_mtime:
                latest_by_gloss[gloss] = capture_path
        for gloss, capture_path in latest_by_gloss.items():
            recipe_path = library / gloss.lower() / f"{gloss.lower()}.recipe.json"
            if recipe_path.is_file():
                continue
            try:
                data = json.loads(capture_path.read_text(encoding="utf-8"))
                fps = max(1, int(dict(data.get("capture", {})).get("processorTargetFps", 30)))
                recipe = build_recipe(gloss, capture_path, data["rawFrames"], fps)
                recipe.save(recipe_path)
            except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
                continue

    def _load_created_sign(self) -> None:
        selected = self._selected_created_gloss()
        if selected is None:
            return
        gloss, recipe_path, landmark_path = selected
        data = json.loads(recipe_path.read_text(encoding="utf-8"))
        data = self._restore_known_linguistic_metadata(gloss, recipe_path, data)
        self.gloss.set(gloss)
        self._set_default_speech_aliases(gloss)
        self.speech_aliases_overridden = bool(
            data.get("speech_aliases_overridden", False)
        )
        legacy_work_action = gloss == "TRABAJO"
        # Legacy recipes can contain an empty, generic alias list. Keep the
        # catalog defaults in that case so an existing published sign is easy
        # to enrich from the editor.
        if (
            not legacy_work_action
            and isinstance(data.get("speech_aliases"), list)
            and (data.get("speech_aliases") or self.speech_aliases_overridden)
        ):
            self.speech_aliases.set(
                ", ".join(
                    self._aliases_for_gloss(
                        gloss,
                        data.get("speech_aliases"),
                        include_defaults=not self.speech_aliases_overridden,
                    )
                )
            )
        if not legacy_work_action and isinstance(data.get("linguistic_categories"), list):
            self.linguistic_categories.set(", ".join(str(category) for category in data["linguistic_categories"])
            )
        if not legacy_work_action:
            self.lexical_class.set(str(data.get("lexical_class", self.lexical_class.get())))
            self.lsc_verb_type.set(str(data.get("lsc_verb_type", self.lsc_verb_type.get())))
        self.linguistic_review_status.set(
            str(data.get("linguistic_review_status", self.linguistic_review_status.get()))
        )
        self._update_linguistic_summary()
        self.loaded_review_gloss = gloss
        self.recipe_path = recipe_path
        self.landmark_path = landmark_path
        reference = json.loads(landmark_path.read_text(encoding="utf-8"))
        self.reference_frames = reference.get("rawFrames", [])
        self.reference_fps = int(data.get("output_fps", reference.get("fps", 30)) or 30)
        self.reference_active_hand = str(data.get("active_hand", "right"))
        self._set_tracking_preview(landmark_path)
        self.anchor.set(str(data.get("contact_anchor", "chin")))
        self.contact_palm.set(str(data.get("palm_at_contact", "camera")))
        self.release_palm.set(str(data.get("palm_at_release", "up")))
        self.forward.set(float(data.get("forward_distance", 0.45)))
        self.return_to_rest.set(bool(data.get("return_to_rest", True)))
        self._load_motion_adjustments(data)
        recording = self._latest_recording(self._recording_directory())
        self.video_path.set(str(recording) if recording else "")
        self.save_button.configure(state="normal", text="GUARDAR SIN GENERAR (OPCIONAL)")
        self.automatic_button.configure(
            state="disabled", text="SEÑA CARGADA · REVISA O EDITA A LA DERECHA"
        )
        self.preview_button.configure(state="normal", text="REGENERAR ANIMACIÓN")
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="SIMULAR ESTA SEÑA EN LA APP MÓVIL"
            )
        self.apply_adjustments_button.configure(state="normal")
        self.step_status.set(f"SEÑA CARGADA: {gloss}. Puedes editarla y regenerarla.")
        mobile_state = "está disponible en la app móvil" if gloss in self._published_mobile_glosses() else "todavía es solo de VOZUAL"
        self.status.set(f"Receta cargada desde {recipe_path.name}; {mobile_state}.")
        if legacy_work_action:
            self.status.set(
                "Esta grabación representa TRABAJAR. Se cargaron las conjugaciones de "
                "trabajar y emplear, además de trabajo y empleo. Guarda las palabras "
                "para aplicarlas en la app móvil."
            )
        self.library_selection_status.set(
            f"✓ {gloss} está cargada. Usa las vistas de revisión debajo o EDITAR PARÁMETROS POR SEGUNDO."
        )
        self._set_stage(3)
        messagebox.showinfo(
            "Seña cargada",
            f"{gloss} quedó cargada para editar.\n\n"
            "Ahora puedes abrir Puntos, Esqueleto, Animación o Parámetros por segundo en la sección Revisar.",
            parent=self.root,
        )

    def _choose_video(self) -> None:
        recording_dir = self._recording_directory()
        latest = self._latest_recording(recording_dir)
        selected = filedialog.askopenfilename(
            title="Selecciona una toma guardada",
            initialdir=str(recording_dir),
            initialfile=latest.name if latest is not None else "",
            filetypes=(
                ("Videos", "*.mp4 *.mov *.avi *.mkv"),
                ("Todos", "*.*"),
            ),
            parent=self.root,
        )
        if selected:
            self.video_path.set(selected)
            self._reset_workflow_after_video()

    def _open_source_video(self) -> None:
        """Open the original recording for the current or loaded sign."""

        video = Path(self.video_path.get())
        if not video.is_file():
            messagebox.showinfo(
                "No hay toma para abrir",
                "Carga una seña o elige un video primero.",
                parent=self.root,
            )
            return
        try:
            subprocess.Popen(["open", str(video)])
            self.status.set(f"Abriendo toma original: {video.name}.")
        except OSError as error:
            messagebox.showerror(
                "No se pudo abrir el video",
                f"VOZUAL no pudo abrir {video.name}.\n\n{error}",
                parent=self.root,
            )

    def _recording_directory(self) -> Path:
        base_dir = REPO_ROOT / "tmp/creator_references/recorded_videos"
        sign_dir = base_dir / self.gloss.get().strip().lower()
        if sign_dir.is_dir():
            return sign_dir
        base_dir.mkdir(parents=True, exist_ok=True)
        return base_dir

    @staticmethod
    def _latest_recording(directory: Path) -> Path | None:
        videos = [
            path
            for pattern in ("*.mp4", "*.mov", "*.avi", "*.mkv")
            for path in directory.glob(pattern)
            if path.is_file()
        ]
        return max(videos, key=lambda path: path.stat().st_mtime, default=None)

    @staticmethod
    def _recording_for_gloss(
        gloss: str, recording_root: Path | None = None
    ) -> Path | None:
        """Return the newest original take stored for a library gloss."""

        base_dir = recording_root or (
            REPO_ROOT / "tmp/creator_references/recorded_videos"
        )
        sign_dir = base_dir / gloss.strip().lower()
        if not sign_dir.is_dir():
            return None
        return SignAuthoringEditor._latest_recording(sign_dir)

    def _restore_latest_recording(self) -> None:
        latest = self._latest_recording(self._recording_directory())
        if latest is None:
            return
        self.video_path.set(str(latest))
        self._reset_workflow_after_video()
        self.status.set(
            f"Última toma recuperada: {latest.name}. Puedes analizarla o elegir otra."
        )

    def _reset_workflow_after_video(self) -> None:
        self.recipe_path = None
        self.landmark_path = None
        self.loaded_review_gloss = None
        self.tracking_preview_path = None
        self.skeleton_preview_path = None
        self.avatar_preview_path = None
        self.tracking_button.configure(
            state="normal", text="VER PUNTOS DETECTADOS  ·  ANALIZA UNA SEÑA PRIMERO"
        )
        self.skeleton_button.configure(
            state="normal", text="VER ESQUELETO CAPTURADO  ·  CARGA UNA SEÑA PRIMERO"
        )
        self.save_button.configure(
            state="disabled", text="GUARDAR SIN GENERAR (BLOQUEADO)"
        )
        self.apply_adjustments_button.configure(state="disabled")
        self.preview_button.configure(
            state="normal", text="VISTA 3D CON BLENDER (OPCIONAL)  ·  GENERA O CARGA UNA SEÑA"
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="disabled",
                text="SIMULAR APP MÓVIL  ·  CARGA UNA SEÑA PRIMERO",
            )
        self.automatic_button.configure(
            state="normal", text="ANALIZAR VIDEO Y CREAR ANIMACIÓN  →"
        )
        self.step_status.set("VIDEO LISTO: ahora pulsa ANALIZAR VIDEO Y CREAR ANIMACIÓN.")
        self._set_stage(1)

    def _selected_video_and_gloss(self) -> tuple[Path, str] | None:
        video = Path(self.video_path.get())
        gloss = self.gloss.get().strip()
        if not video.is_file() or not gloss:
            messagebox.showerror(
                "Datos incompletos",
                "Graba o selecciona un video y escribe el nombre de la seña.",
                parent=self.root,
            )
            return None
        if not self.speech_aliases.get().strip():
            self._set_default_speech_aliases(gloss)
        return video, gloss

    def _set_tracking_preview(self, landmark_path: Path) -> None:
        candidate = landmark_path.with_name(
            f"{self.gloss.get().strip().lower()}_tracking_preview.mp4"
        )
        self.tracking_preview_path = candidate if candidate.is_file() else None

        if self.tracking_capture is not None:
            self.tracking_capture.release()
            self.tracking_capture = None
        if self.tracking_preview_path is not None:
            self.tracking_capture = cv2.VideoCapture(str(self.tracking_preview_path))
        self.tracking_button.configure(
            state="normal",
            text=(
                "VER MANO, BRAZO Y 468 PUNTOS DE LA CARA"
                if self.tracking_preview_path
                else "VER PUNTOS DETECTADOS  ·  ANALIZA UNA SEÑA PRIMERO"
            ),
        )

        skeleton_candidate = landmark_path.with_name(
            f"{self.gloss.get().strip().lower()}_captured_skeleton.mp4"
        )
        if not skeleton_candidate.is_file():
            try:
                reference = json.loads(landmark_path.read_text(encoding="utf-8"))
                frames = reference.get("rawFrames", [])
                fps = int(dict(reference.get("capture", {})).get("processorTargetFps", 30))
                write_landmark_skeleton_preview(
                    frames,
                    self.reference_active_hand,
                    skeleton_candidate,
                    fps,
                )
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                pass
        self.skeleton_preview_path = (
            skeleton_candidate if skeleton_candidate.is_file() else None
        )
        self.skeleton_button.configure(
            state="normal",
            text=(
                "VER ESQUELETO CAPTURADO (SIN AVATAR)"
                if self.skeleton_preview_path
                else "VER ESQUELETO CAPTURADO  ·  CARGA UNA SEÑA PRIMERO"
            ),
        )

    @staticmethod
    def _hand_tracking_review_message(landmark_path: Path) -> str:
        """Describe suspicious hand frames without rejecting the recording."""
        try:
            payload = json.loads(landmark_path.read_text(encoding="utf-8"))
            source = dict(payload.get("handTrackingQuality", {})).get("source", {})
            warnings: list[str] = []
            for side, label in (("left", "izquierda"), ("right", "derecha")):
                quality = dict(dict(source).get(side, {}))
                frames = quality.get("unstable_frames", [])
                if isinstance(frames, list) and frames:
                    preview = ", ".join(str(frame) for frame in frames[:10])
                    suffix = "…" if len(frames) > 10 else ""
                    warnings.append(f"mano {label}: cuadros {preview}{suffix}")
            if not warnings:
                return ""
            return (
                "\n\nREVISIÓN DE MANOS RECOMENDADA\n"
                + "\n".join(warnings)
                + "\nMediaPipe detectó cambios anatómicos bruscos. Abre VER PUNTOS "
                "DETECTADOS antes de publicar; si no corresponden al video, "
                "graba nuevamente con ambas manos visibles y sin superponerlas."
            )
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return ""

    def _open_tracking_preview(self) -> None:
        if not self._can_open_loaded_review("los puntos detectados"):
            return
        if self.tracking_preview_path is None or not self.tracking_preview_path.is_file():
            messagebox.showerror(
                "Falta el diagnóstico",
                "Analiza nuevamente el video para generar la vista de puntos.",
                parent=self.root,
            )
            return
        self._open_review_video(
            f"Puntos detectados — {self.loaded_review_gloss}",
            self.tracking_preview_path,
        )

    def _open_skeleton_preview(self) -> None:
        if not self._can_open_loaded_review("el esqueleto capturado"):
            return
        if self.skeleton_preview_path is None or not self.skeleton_preview_path.is_file():
            messagebox.showerror(
                "Falta el esqueleto",
                "Carga o analiza una seña para generar su esqueleto capturado.",
                parent=self.root,
            )
            return
        self._open_review_video(
            f"Esqueleto capturado — {self.loaded_review_gloss}",
            self.skeleton_preview_path,
        )

    def _open_review_video(self, title: str, video_path: Path) -> None:
        """Play one selected diagnostic video inside a dedicated VOZUAL window."""

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            messagebox.showerror(
                "No se pudo abrir el video",
                f"VOZUAL no pudo abrir {video_path.name}.",
                parent=self.root,
            )
            capture.release()
            return

        self.status.set(f"Mostrando {title.lower()}.")
        window = tk.Toplevel(self.root)
        window.title(f"VOZUAL — {title}")
        window.configure(bg="#07111f")
        window.transient(self.root)
        window.geometry("980x720")

        heading = tk.Label(
            window,
            text=title,
            bg="#07111f",
            fg="#69ddd9",
            font=("Arial", 15, "bold"),
            anchor="w",
        )
        heading.pack(fill="x", padx=18, pady=(16, 8))
        video_label = tk.Label(window, bg="#07111f")
        video_label.pack(fill="both", expand=True, padx=18, pady=(0, 12))
        running = {"value": True}
        paused = {"value": False}
        fps = capture.get(cv2.CAP_PROP_FPS)
        delay_ms = max(20, int(1000 / fps)) if fps and fps > 1 else 33

        def close() -> None:
            running["value"] = False
            capture.release()
            if window.winfo_exists():
                window.destroy()

        controls = tk.Frame(window, bg="#07111f")
        controls.pack(fill="x", padx=18, pady=(0, 16))

        pause_button = tk.Button(
            controls,
            text="⏸  PAUSAR",
            bg="#16d9d1",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 10, "bold"),
        )
        pause_button.pack(side="left", fill="x", expand=True, padx=(0, 5), ipady=5)

        tk.Button(
            controls,
            text="CERRAR",
            command=close,
            bg="#26384e",
            fg="#f5f7fb",
            activebackground="#334b67",
            activeforeground="#f5f7fb",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(side="left", fill="x", expand=True, padx=(5, 0), ipady=5)

        def show_next_frame() -> None:
            if not running["value"] or not window.winfo_exists():
                return
            if paused["value"]:
                return
            ok, frame = capture.read()
            if not ok:
                capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = capture.read()
            if ok:
                image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                image.thumbnail((940, 620), Image.LANCZOS)
                photo = ImageTk.PhotoImage(image)
                video_label.configure(image=photo)
                video_label.image = photo
            window.after(delay_ms, show_next_frame)

        def toggle_pause() -> None:
            paused["value"] = not paused["value"]
            if paused["value"]:
                pause_button.configure(text="▶  REANUDAR", bg="#26384e", fg="#f5f7fb")
                self.status.set(f"Video pausado: {title.lower()}.")
                return
            pause_button.configure(text="⏸  PAUSAR", bg="#16d9d1", fg="#07111f")
            self.status.set(f"Reanudando {title.lower()}.")
            show_next_frame()

        pause_button.configure(command=toggle_pause)

        window.protocol("WM_DELETE_WINDOW", close)
        show_next_frame()

    def _can_open_loaded_review(self, view_name: str) -> bool:
        """Allow review actions for the sign already loaded in the editor.

        The library queue is independent from the loaded working sign. A later
        click in that queue must never prevent reviewing the sign on screen.
        """

        if self.loaded_review_gloss is not None:
            return True
        messagebox.showinfo(
            "Carga una seña",
            f"Carga una seña antes de abrir {view_name}.",
            parent=self.root,
        )
        return False

    def _source_avatar(self) -> Path | None:
        source_dir = REPO_ROOT / "tmp/creator_references/gracias/source"
        return next(source_dir.rglob("*.glb"), None)

    def _start_progress(self, message: str) -> None:
        self.step_status.set(message)
        self.analysis_progress.pack(fill="x", pady=(12, 0))
        self.analysis_progress.start(12)
        self._set_stage(2)
        self.root.update_idletasks()

    def _create_automatically(self) -> None:
        selection = self._selected_video_and_gloss()
        if selection is None:
            return
        video, gloss = selection
        output = REPO_ROOT / "tmp/creator_references/video_imports" / gloss.lower()
        self.automatic_button.configure(
            state="disabled", text="CREANDO SEÑA… ESPERA"
        )
        self.analyze_button.configure(state="disabled")
        self.save_button.configure(state="disabled")
        self.preview_button.configure(state="disabled")
        self.status.set(
            "VOZUAL está extrayendo manos, cuerpo y rostro para crear la seña móvil."
        )
        self._start_progress("MODO AUTOMÁTICO: analizando y creando la seña…")
        threading.Thread(
            target=self._automatic_in_background,
            args=(video, gloss, output, float(self.duration_seconds.get())),
            daemon=True,
        ).start()

    def _automatic_in_background(
        self,
        video: Path,
        gloss: str,
        output: Path,
        final_duration_seconds: float,
    ) -> None:
        try:
            landmark_path, recipe_path = import_video(
                video,
                gloss,
                output,
                False,
                final_duration_seconds,
            )
            data = json.loads(recipe_path.read_text(encoding="utf-8"))
            self.root.after(
                0,
                lambda: self._finish_automatic(landmark_path, recipe_path, data),
            )
        except Exception as error:
            error_message = str(error)
            self.root.after(0, lambda: self._fail_automatic(error_message))

    def _finish_automatic(
        self,
        landmark_path: Path,
        recipe_path: Path,
        data: dict[str, object],
    ) -> None:
        self.landmark_path = landmark_path
        self.recipe_path = recipe_path
        self.loaded_review_gloss = self.gloss.get().strip().upper()
        self._set_tracking_preview(landmark_path)
        self.anchor.set(str(data["contact_anchor"]))
        self.contact_palm.set(str(data["palm_at_contact"]))
        self.release_palm.set(str(data["palm_at_release"]))
        self.forward.set(float(data["forward_distance"]))
        self.return_to_rest.set(bool(data["return_to_rest"]))
        self._load_motion_adjustments(data)
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.automatic_button.configure(
            state="normal", text="REHACER ESTA SEÑA CON LA MISMA TOMA"
        )
        self.analyze_button.configure(state="normal", text="ANALIZAR VIDEO DE NUEVO")
        self.save_button.configure(
            state="normal", text="GUARDAR SIN GENERAR (OPCIONAL)"
        )
        self.preview_button.configure(
            state="normal", text="GENERAR VISTA 3D CON BLENDER (OPCIONAL)"
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="SIMULAR ESTA SEÑA EN LA APP MÓVIL"
            )
        self.apply_adjustments_button.configure(state="normal")
        active_hand = "izquierda" if data["active_hand"] == "left" else "derecha"
        contact = str(data["contact_anchor"])
        tracking_review = self._hand_tracking_review_message(landmark_path)
        self.step_status.set(
            "SEÑA AUTOMÁTICA TERMINADA ✓  Revisa las manos antes de publicar."
            if tracking_review
            else "SEÑA AUTOMÁTICA TERMINADA ✓  Lista para revisar y publicar."
        )
        self._set_stage(3)
        self.status.set(
            f"Resultado automático: mano {active_hand}; contacto detectado: {contact}. "
            "Si está correcto, la seña quedó lista."
        )
        self._refresh_created_signs()
        self.root.bell()
        messagebox.showinfo(
            "Seña automática terminada",
            f"VOZUAL extrajo los landmarks sin usar Blender.\n\n"
            f"Mano detectada: {active_hand}.\n"
            f"Contacto detectado: {contact}.\n\n"
            "La seña está lista para publicar. Usa los controles avanzados solo "
            "si necesitas un ajuste fino. La vista 3D con Blender es opcional."
            f"{tracking_review}",
            parent=self.root,
        )

    def _fail_automatic(self, error: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.automatic_button.configure(
            state="normal", text="ANALIZAR VIDEO Y CREAR ANIMACIÓN  →"
        )
        self.analyze_button.configure(state="normal")
        self.step_status.set("NO SE PUDO CREAR AUTOMÁTICAMENTE. Revisa el aviso.")
        self.status.set("El proceso automático no se completó.")
        messagebox.showerror(
            "No se pudo crear la seña",
            error,
            parent=self.root,
        )

    def _review_recording(self, video: Path) -> str:
        """Ask explicitly whether the newly recorded take should be kept."""
        decision = tk.StringVar(value="cancel")
        dialog = tk.Toplevel(self.root)
        dialog.title("Revisar grabación")
        dialog.configure(bg="#07111f")
        dialog.resizable(False, False)
        dialog.transient(self.root)

        tk.Label(
            dialog,
            text="¿Te gustó la grabación?",
            font=("Arial", 18, "bold"),
            fg="white",
            bg="#07111f",
        ).pack(padx=28, pady=(24, 8))
        tk.Label(
            dialog,
            text=(
                "Abre la toma solo si necesitas revisarla antes de decidir.\n"
                "VOZUAL no abre videos automáticamente."
            ),
            font=("Arial", 13),
            fg="#b8c7d9",
            bg="#07111f",
            justify="center",
        ).pack(padx=28, pady=(0, 20))

        tk.Button(
            dialog,
            text="VER ESTA TOMA",
            command=lambda: subprocess.run(["open", str(video)], check=False),
            bg="#26384e",
            fg="#f5f7fb",
            font=("Arial", 12, "bold"),
        ).pack(fill="x", padx=28, pady=(0, 8))

        def finish(value: str) -> None:
            decision.set(value)
            dialog.destroy()

        tk.Button(
            dialog,
            text="USAR ESTA TOMA",
            command=lambda: finish("use"),
            bg="#16d9d1",
            fg="#07111f",
            font=("Arial", 13, "bold"),
        ).pack(fill="x", padx=28, pady=5)
        tk.Button(
            dialog,
            text="VOLVER A GRABAR",
            command=lambda: finish("redo"),
            bg="#ff4968",
            fg="white",
            font=("Arial", 13, "bold"),
        ).pack(fill="x", padx=28, pady=5)
        tk.Button(
            dialog,
            text="CANCELAR Y VOLVER AL EDITOR",
            command=lambda: finish("cancel"),
            font=("Arial", 12),
        ).pack(fill="x", padx=28, pady=(5, 24))

        dialog.protocol("WM_DELETE_WINDOW", lambda: finish("cancel"))
        dialog.update_idletasks()
        x = self.root.winfo_rootx() + (self.root.winfo_width() - dialog.winfo_width()) // 2
        y = self.root.winfo_rooty() + (self.root.winfo_height() - dialog.winfo_height()) // 2
        dialog.geometry(f"+{max(0, x)}+{max(0, y)}")
        dialog.lift()
        dialog.focus_force()
        dialog.grab_set()
        self.root.wait_window(dialog)
        return decision.get()

    def _record_video(self) -> None:
        gloss = self.gloss.get().strip()
        try:
            duration = float(self.duration_seconds.get())
        except (tk.TclError, ValueError):
            messagebox.showerror("Duración inválida", "Escribe una duración válida en segundos.")
            return
        if not gloss:
            messagebox.showerror("Falta el nombre", "Escribe primero el nombre de la seña.")
            return
        if not self._can_create_new_gloss(gloss):
            return
        self.status.set("Abriendo cámara. Prepárate para la cuenta regresiva…")
        self.root.update_idletasks()
        output = REPO_ROOT / "tmp/creator_references/recorded_videos" / gloss.lower()
        try:
            while True:
                video = record_video(0, gloss, duration, output)
                self.video_path.set(str(video))
                self._reset_workflow_after_video()
                decision = self._review_recording(video)
                if decision == "use":
                    self.status.set(
                        f"Grabación elegida: {video.name} ({duration:.1f} s). "
                        "Ahora pulsa CREAR ANIMACIÓN."
                    )
                    break
                if decision == "redo":
                    video.unlink(missing_ok=True)
                    self.video_path.set("")
                    self.status.set("Volviendo a grabar. Prepárate para la cuenta regresiva…")
                    self.root.update_idletasks()
                    continue
                self.status.set(
                    "Revisión cancelada. Puedes conservar la toma o pulsar ABRIR CÁMARA Y GRABAR."
                )
                break
        except Exception as error:
            if "cancelada" not in str(error).lower():
                messagebox.showerror("No se pudo grabar", str(error))
                self.status.set("La grabación no se completó.")
            else:
                self.status.set("Grabación cancelada. Puedes intentarlo nuevamente.")

    def _analyze(self) -> None:
        video = Path(self.video_path.get())
        gloss = self.gloss.get().strip()
        if not video.is_file() or not gloss:
            messagebox.showerror("Datos incompletos", "Selecciona un video y escribe la palabra.")
            return
        if not self._can_create_new_gloss(gloss):
            return
        self.status.set("Analizando cuerpo, rostro y manos. Espera a que aparezca el aviso…")
        self.step_status.set("ANALIZANDO VIDEO… No cierres la aplicación.")
        self.analyze_button.configure(state="disabled", text="ANALIZANDO… ESPERA")
        self.save_button.configure(state="disabled")
        self.preview_button.configure(state="disabled")
        self.analysis_progress.pack(fill="x", pady=(12, 0))
        self.analysis_progress.start(12)
        self._set_stage(2)
        self.root.update_idletasks()
        output = REPO_ROOT / "tmp/creator_references/video_imports" / self.gloss.get().lower()

        threading.Thread(
            target=self._analyze_in_background,
            args=(video, self.gloss.get(), output, float(self.duration_seconds.get())),
            daemon=True,
        ).start()

    def _analyze_in_background(
        self,
        video: Path,
        gloss: str,
        output: Path,
        final_duration_seconds: float,
    ) -> None:
        try:
            landmark_path, recipe_path = import_video(
                video,
                gloss,
                output,
                False,
                final_duration_seconds,
            )
            data = json.loads(recipe_path.read_text(encoding="utf-8"))
            self.root.after(
                0,
                lambda: self._finish_analysis(landmark_path, recipe_path, data),
            )
        except Exception as error:
            error_message = str(error)
            self.root.after(0, lambda: self._fail_analysis(error_message))

    def _stop_analysis_progress(self) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.analyze_button.configure(state="normal", text="ANALIZAR VIDEO DE NUEVO")

    def _finish_analysis(
        self,
        landmark_path: Path,
        recipe_path: Path,
        data: dict[str, object],
    ) -> None:
        self.landmark_path = landmark_path
        self.recipe_path = recipe_path
        self.loaded_review_gloss = self.gloss.get().strip().upper()
        data = {
            **data,
            "speech_aliases": self._current_speech_aliases(),
            "speech_aliases_overridden": self.speech_aliases_overridden,
            "linguistic_categories": self._current_linguistic_categories(),
            "lexical_class": self.lexical_class.get(),
            "lsc_verb_type": self.lsc_verb_type.get(),
            "linguistic_review_status": self.linguistic_review_status.get(),
        }
        recipe_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self._set_tracking_preview(landmark_path)
        self.anchor.set(str(data["contact_anchor"]))
        self.contact_palm.set(str(data["palm_at_contact"]))
        self.release_palm.set(str(data["palm_at_release"]))
        self.forward.set(float(data["forward_distance"]))
        self.return_to_rest.set(bool(data["return_to_rest"]))
        self._load_motion_adjustments(data)
        tracking_review = self._hand_tracking_review_message(landmark_path)
        self._stop_analysis_progress()
        self.save_button.configure(
            state="normal", text="GUARDAR SIN GENERAR (OPCIONAL)"
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="SIMULAR ESTA SEÑA EN LA APP MÓVIL"
            )
        self.apply_adjustments_button.configure(state="normal")
        self.step_status.set(
            "ANÁLISIS TERMINADO ✓  Revisa los puntos de las manos."
            if tracking_review
            else "ANÁLISIS TERMINADO ✓  Ahora pulsa GUARDAR CORRECCIONES."
        )
        self._set_stage(2)
        self.status.set(
            f"Análisis listo. Mano activa: {data['active_hand']}. "
            "Primero puedes revisar los puntos detectados y luego continuar."
        )
        self.root.bell()
        messagebox.showinfo(
            "Análisis terminado",
            "El video terminó de analizarse correctamente.\n\n"
            "Puedes abrir VER LOS 21 PUNTOS para comprobar la captura.\n\n"
            "Siguiente paso: revisa los controles y pulsa\n"
            f"GUARDAR CORRECCIONES.{tracking_review}",
            parent=self.root,
        )
        self.save_button.focus_set()
        self._open_advanced_dialog()

    def _fail_analysis(self, error: str) -> None:
        self._stop_analysis_progress()
        self.step_status.set("EL ANÁLISIS FALLÓ. Corrige el problema e inténtalo nuevamente.")
        messagebox.showerror("No se pudo analizar", error, parent=self.root)
        self.status.set("El análisis no se completó.")

    def _load_motion_adjustments(self, data: dict[str, object]) -> None:
        for key, variable in (
            ("entry_height_cm", self.entry_height_cm),
            ("entry_lateral_cm", self.entry_lateral_cm),
            ("entry_depth_cm", self.entry_depth_cm),
            ("exit_height_cm", self.exit_height_cm),
            ("exit_lateral_cm", self.exit_lateral_cm),
            ("exit_depth_cm", self.exit_depth_cm),
        ):
            variable.set(float(data.get(key, 0.0)))
        stored = data.get("motion_keyframes", [])
        if isinstance(stored, list) and stored:
            self.motion_keyframes = [dict(point) for point in stored]
        else:
            duration = max(0.05, float(self.duration_seconds.get()))
            self.motion_keyframes = [
                {
                    "kind": "entry",
                    "time_seconds": 0.0,
                    "height_cm": float(data.get("entry_height_cm", 0.0)),
                    "lateral_cm": float(data.get("entry_lateral_cm", 0.0)),
                    "depth_cm": float(data.get("entry_depth_cm", 0.0)),
                },
                {
                    "kind": "exit",
                    "time_seconds": duration,
                    "height_cm": float(data.get("exit_height_cm", 0.0)),
                    "lateral_cm": float(data.get("exit_lateral_cm", 0.0)),
                    "depth_cm": float(data.get("exit_depth_cm", 0.0)),
                },
            ]
        self._refresh_motion_tree()

    def _save_recipe(self, notify: bool = True) -> None:
        if self.recipe_path is None:
            messagebox.showerror("Falta análisis", "Primero analiza un video.")
            return
        data = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        recipe = SignRecipe(
            **{
                **data,
                "contact_anchor": self.anchor.get(),
                "palm_at_contact": self.contact_palm.get(),
                "palm_at_release": self.release_palm.get(),
                "forward_distance": self.forward.get(),
                "return_to_rest": self.return_to_rest.get(),
                "entry_height_cm": self.entry_height_cm.get(),
                "entry_lateral_cm": self.entry_lateral_cm.get(),
                "entry_depth_cm": self.entry_depth_cm.get(),
                "exit_height_cm": self.exit_height_cm.get(),
                "exit_lateral_cm": self.exit_lateral_cm.get(),
                "exit_depth_cm": self.exit_depth_cm.get(),
                "motion_keyframes": self.motion_keyframes,
                "speech_aliases": self._current_speech_aliases(),
                "speech_aliases_overridden": self.speech_aliases_overridden,
                "linguistic_categories": self._current_linguistic_categories(),
                "lexical_class": self.lexical_class.get(),
                "lsc_verb_type": self.lsc_verb_type.get(),
                "linguistic_review_status": self.linguistic_review_status.get(),
            }
        )
        landmark_data = json.loads(self.landmark_path.read_text(encoding="utf-8")) if self.landmark_path else {}
        frame_count = len(landmark_data.get("rawFrames", []))
        recipe.validate(frame_count)
        recipe.save(self.recipe_path)
        self.avatar_preview_path = None
        self.preview_button.configure(
            state="normal", text="GENERAR VISTA 3D CON BLENDER (OPCIONAL)"
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="SIMULAR ESTA SEÑA EN LA APP MÓVIL"
            )
        self.step_status.set(
            "AJUSTES GUARDADOS ✓  Ahora revisa la simulación móvil antes de publicar."
        )
        self._set_stage(3)
        self.status.set(f"Receta guardada: {self.recipe_path}")
        if notify:
            messagebox.showinfo(
                "Correcciones guardadas",
                "Los ajustes quedaron guardados.\n\n"
                "Pulsa SIMULAR APP MÓVIL para revisar el resultado real. La vista "
                "de Blender es opcional y no sirve para aprobar la publicación.",
                parent=self.root,
            )

    def _generate_preview(self) -> None:
        if self.avatar_preview_path is not None and self.avatar_preview_path.is_file():
            self._open_review_video("Vista 3D del avatar", self.avatar_preview_path)
            return
        if self.recipe_path is None or self.landmark_path is None:
            messagebox.showerror("Falta análisis", "Primero analiza el video y guarda la receta.")
            return
        try:
            self._save_recipe(notify=False)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            messagebox.showerror("No se pudo guardar", str(error), parent=self.advanced_window)
            return
        source_glb = next((REPO_ROOT / "tmp/creator_references/gracias/source").rglob("*.glb"), None)
        if source_glb is None:
            messagebox.showerror("Falta avatar", "No se encontró el archivo GLB del avatar.")
            return
        self.preview_button.configure(state="disabled", text="GENERANDO VISTA 3D…")
        self.apply_adjustments_button.configure(state="disabled", text="GENERANDO AVATAR…")
        self.status.set("GENERANDO: preparando la vista 3D opcional del avatar…")
        self.step_status.set("GENERANDO VISTA 3D OPCIONAL… puedes seguir viendo esta ventana.")
        self.analysis_progress.pack(fill="x", pady=(12, 0))
        self.analysis_progress.start(12)
        self.root.update_idletasks()

        threading.Thread(
            target=self._generate_preview_in_background,
            args=(self.landmark_path, self.recipe_path, source_glb),
            daemon=True,
        ).start()

    def _generate_preview_in_background(
        self, landmark_path: Path, recipe_path: Path, source_glb: Path
    ) -> None:
        try:
            outputs = generate_preview(
                landmark_path=landmark_path,
                recipe_path=recipe_path,
                source_avatar=source_glb,
            )
            self.root.after(0, lambda: self._finish_preview_generation(outputs.video))
        except Exception as error:
            error_message = str(error)
            self.root.after(
                0, lambda: self._fail_preview_generation(error_message)
            )

    def _finish_preview_generation(self, video: Path) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.avatar_preview_path = video
        self.preview_button.configure(state="normal", text="VER VISTA 3D GENERADA")
        self.apply_adjustments_button.configure(state="normal", text="GUARDAR Y REGENERAR AHORA")
        self.status.set(
            "VISTA 3D LISTA ✓  Disponible cuando pulses VER VISTA 3D GENERADA."
        )
        self.step_status.set("VISTA 3D OPCIONAL LISTA ✓  No se abrió ningún video.")

    def _fail_preview_generation(self, error: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.preview_button.configure(state="normal", text="GENERAR VISTA 3D CON BLENDER (OPCIONAL)")
        self.apply_adjustments_button.configure(state="normal", text="GUARDAR Y REGENERAR AHORA")
        self.status.set("No se pudo generar la animación.")
        self.step_status.set("LA GENERACIÓN FALLÓ. Revisa el aviso e inténtalo nuevamente.")
        messagebox.showerror("No se pudo generar", error, parent=self.advanced_window)


def main() -> None:
    root = tk.Tk()
    SignAuthoringEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
