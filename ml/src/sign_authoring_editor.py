"""Small desktop editor for video-driven ManoSpeak sign authoring."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.authoring_pipeline import generate_preview
    from src.sign_catalog import CATEGORIES, CATEGORY_ALL, SignCatalogEntry, suggested_signs
    from src.sign_recipe import SignRecipe
    from src.video_reference_recorder import record_video
    from src.video_sign_import import (
        build_recipe,
        import_video,
        write_landmark_skeleton_preview,
    )
else:
    from .authoring_pipeline import generate_preview
    from .sign_catalog import CATEGORIES, CATEGORY_ALL, SignCatalogEntry, suggested_signs
    from .sign_recipe import SignRecipe
    from .video_reference_recorder import record_video
    from .video_sign_import import (
        build_recipe,
        import_video,
        write_landmark_skeleton_preview,
    )

REPO_ROOT = Path(__file__).resolve().parents[2]


class SignAuthoringEditor:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("VOZUAL — Editor de señas")
        root.geometry("760x820")
        root.configure(bg="#07111f")
        self.video_path = tk.StringVar()
        self.gloss = tk.StringVar(value="GRACIAS")
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
        self.created_sign_paths: dict[str, tuple[Path, Path]] = {}
        self.created_sign_labels: dict[str, str] = {}
        self.created_sign_list: tk.Listbox | None = None
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
        frame.grid_rowconfigure(2, weight=1)

        header = tk.Frame(frame, bg=background)
        header.grid(row=0, column=0, columnspan=2, sticky="ew")
        brand = tk.Frame(header, bg=background)
        brand.pack(side="left")
        tk.Label(
            brand,
            text="VOZUAL",
            fg=text,
            bg=background,
            font=("Arial", 26, "bold"),
        ).pack(anchor="w")
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

        steps = tk.Frame(frame, bg=background)
        steps.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(18, 14))
        self.step_badges: list[tk.Label] = []
        for column, (number, title, subtitle) in enumerate(
            (
                ("1", "GRABA", "Haz la seña despacio"),
                ("2", "PROCESA", "VOZUAL sigue tus puntos"),
                ("3", "REVISA", "Mira el avatar y guarda"),
            )
        ):
            step = tk.Frame(steps, bg=card_soft, padx=12, pady=8)
            step.grid(
                row=0,
                column=column,
                sticky="ew",
                padx=(0 if column == 0 else 6, 0),
            )
            steps.grid_columnconfigure(column, weight=1)
            badge = tk.Label(
                step,
                text=number,
                fg=background,
                bg=accent if column == 0 else muted,
                width=2,
                font=("Arial", 10, "bold"),
            )
            badge.pack(side="left", padx=(0, 10))
            self.step_badges.append(badge)
            copy = tk.Frame(step, bg=card_soft)
            copy.pack(side="left")
            tk.Label(copy, text=title, fg=text, bg=card_soft, font=("Arial", 10, "bold")).pack(anchor="w")
            tk.Label(copy, text=subtitle, fg=muted, bg=card_soft, font=("Arial", 8)).pack(anchor="w")

        capture_card = tk.Frame(frame, bg=card, padx=22, pady=20)
        capture_card.grid(row=2, column=0, sticky="nsew", padx=(0, 7))
        tk.Label(
            capture_card,
            text="CREAR UNA SEÑA",
            fg=text,
            bg=card,
            font=("Arial", 16, "bold"),
        ).pack(anchor="w")
        tk.Label(
            capture_card,
            text=(
                "Para una seña nueva: 1. escribe el nombre, 2. graba la toma, "
                "3. analiza y crea la animación.\n"
                "Para una seña existente: cárgala desde la biblioteca de la derecha; "
                "no necesitas grabar otra vez."
            ),
            fg=muted,
            bg=card,
            font=("Arial", 10),
        ).pack(anchor="w", pady=(3, 16))

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
        ).pack(fill="x", ipady=9)

        suggestion_card = tk.Frame(capture_card, bg=card_soft, padx=12, pady=10)
        suggestion_card.pack(fill="x", pady=(13, 0))
        tk.Label(
            suggestion_card,
            text="RUTA GUIADA DE VOCABULARIO",
            fg=accent,
            bg=card_soft,
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=0, columnspan=2, sticky="w")
        tk.Label(
            suggestion_card,
            text="Elige una categoría y usa la siguiente seña pendiente. Las ya creadas o publicadas no se recomiendan.",
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
        duration_box.grid(row=1, column=0, sticky="ew", pady=(14, 0))
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
            font=("Arial", 13, "bold"),
        ).pack(fill="x", ipady=7)
        tk.Label(
            duration_box,
            text="Este único tiempo se usa igual para grabar y para reproducir la seña.",
            fg=muted,
            bg=card,
            font=("Arial", 8),
        ).pack(anchor="w", pady=(4, 0))

        camera_button = tk.Button(
            capture_card,
            text="1. ABRIR CÁMARA Y GRABAR",
            command=self._record_video,
            bg=accent,
            fg=background,
            activebackground="#58e8e1",
            activeforeground=background,
            relief="flat",
            font=("Arial", 14, "bold"),
            cursor="pointinghand",
        )
        camera_button.pack(fill="x", ipady=11, pady=(18, 10))

        video_row = tk.Frame(capture_card, bg=card_soft, padx=12, pady=9)
        video_row.pack(fill="x")
        tk.Label(video_row, text="VIDEO", fg=accent, bg=card_soft, font=("Arial", 9, "bold")).pack(side="left", padx=(0, 9))
        tk.Entry(
            video_row,
            textvariable=self.video_path,
            bg=card_soft,
            fg=muted,
            readonlybackground=card_soft,
            relief="flat",
            state="readonly",
        ).pack(side="left", fill="x", expand=True, ipady=4)
        tk.Button(
            video_row,
            text="ELEGIR OTRO",
            command=self._choose_video,
            bg="#26384e",
            fg=text,
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 9, "bold"),
        ).pack(side="right", padx=(10, 0), ipady=5)

        separator = tk.Frame(capture_card, bg="#26384e", height=1)
        separator.pack(fill="x", pady=(18, 16))
        tk.Label(
            capture_card,
            text="2. ANALIZAR LA TOMA Y CREAR LA SEÑA",
            fg=text,
            bg=card,
            font=("Arial", 12, "bold"),
        ).pack(anchor="w")
        tk.Label(
            capture_card,
            text=(
                "Solo después de grabar o elegir un video. VOZUAL extraerá manos, "
                "muñecas, codos, hombros y rostro automáticamente."
            ),
            fg=muted,
            bg=card,
            font=("Arial", 9),
            wraplength=580,
            justify="left",
        ).pack(anchor="w", pady=(3, 12))
        self.automatic_button = tk.Button(
            capture_card,
            text="2. GRABA O ELIGE UN VIDEO PRIMERO",
            command=self._create_automatically,
            bg=accent,
            fg=background,
            activebackground="#58e8e1",
            activeforeground=background,
            relief="flat",
            font=("Arial", 14, "bold"),
            cursor="pointinghand",
            state="disabled",
        )
        self.automatic_button.pack(fill="x", ipady=11)

        review_card = tk.Frame(frame, bg=card, padx=22, pady=20)
        review_card.grid(row=2, column=1, sticky="nsew", padx=(7, 0))
        tk.Label(
            review_card,
            text="ESTADO Y RESULTADO",
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
        ).pack(anchor="w", pady=(3, 14))

        status_card = tk.Frame(review_card, bg=card_soft, padx=16, pady=14)
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

        created_card = tk.Frame(review_card, bg=card_soft, padx=14, pady=13)
        created_card.pack(fill="x", pady=(12, 0))
        tk.Label(
            created_card,
            text="BIBLIOTECA DE SEÑAS",
            fg=accent,
            bg=card_soft,
            font=("Arial", 9, "bold"),
        ).pack(anchor="w")
        tk.Label(
            created_card,
            text="1. Selecciona una seña.  2. Cárgala para editarla o publícala cuando esté aprobada.",
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
            height=5,
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
        ).grid(row=0, column=0, sticky="ew", padx=(0, 4), ipady=7)
        tk.Button(
            action_row,
            text="PUBLICAR TODAS EN APP MÓVIL",
            command=self._publish_all_signs,
            bg=accent,
            fg=background,
            activebackground="#63e5df",
            activeforeground=background,
            relief="flat",
            font=("Arial", 9, "bold"),
            cursor="pointinghand",
        ).grid(row=0, column=1, sticky="ew", padx=(4, 0), ipady=7)
        tk.Button(
            action_row,
            text="ELIMINAR SEÑA SELECCIONADA",
            command=self._delete_selected_sign,
            bg="#ff5b76",
            fg="#172638",
            activebackground="#ff7c91",
            activeforeground="#172638",
            relief="flat",
            font=("Arial", 8, "bold"),
            cursor="pointinghand",
        ).grid(row=1, column=0, columnspan=2, sticky="ew", pady=(6, 0), ipady=5)
        tk.Button(
            created_card,
            text="↻  RECARGAR LISTA DE SEÑAS",
            command=self._refresh_created_signs,
            bg="#172638",
            fg="#172638",
            activebackground="#26384e",
            activeforeground=text,
            relief="flat",
            font=("Arial", 8, "bold"),
        ).pack(fill="x", pady=(5, 0), ipady=4)

        self.analysis_progress = ttk.Progressbar(
            status_card,
            mode="indeterminate",
            style="VOZUAL.Horizontal.TProgressbar",
        )

        result = tk.Frame(review_card, bg=card)
        result.pack(fill="both", expand=True, pady=(14, 0))
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
            font=("Arial", 11, "bold"),
        )
        self.tracking_button.pack(fill="x", ipady=10, pady=(0, 8))
        self.skeleton_button = tk.Button(
            result,
            text="VER ESQUELETO CAPTURADO  ·  CARGA UNA SEÑA PRIMERO",
            command=self._open_skeleton_preview,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 11, "bold"),
        )
        self.skeleton_button.pack(fill="x", ipady=10, pady=(0, 8))
        self.preview_button = tk.Button(
            result,
            text="VER ANIMACIÓN DEL AVATAR  ·  GENERA O CARGA UNA SEÑA",
            command=self._generate_preview,
            bg=danger,
            fg="#172638",
            activebackground="#ff7890",
            activeforeground=text,
            font=("Arial", 11, "bold"),
            relief="flat",
        )
        self.preview_button.pack(fill="x", ipady=10, pady=(0, 8))
        tk.Button(
            result,
            text="EDITAR PARÁMETROS POR SEGUNDO  ⚙",
            command=self._open_advanced_dialog,
            bg="#26384e",
            fg="#172638",
            activebackground="#344b65",
            activeforeground=text,
            relief="flat",
            font=("Arial", 10, "bold"),
            cursor="pointinghand",
        ).pack(fill="x", ipady=8)
        tk.Label(
            result,
            text="Todo se procesa en este Mac. No se guarda audio ni se envían videos a Internet.",
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
            text="1. ANALIZAR VIDEO",
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
        for index, badge in enumerate(self.step_badges, start=1):
            badge.configure(
                bg="#20d6ce" if index <= stage else "#9fb0c4",
                fg="#07111f",
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
            state = "✓ EN APP" if gloss in published_glosses else "○ SOLO VOZUAL"
            label = f"{state}  ·  {gloss}"
            self.created_sign_labels[label] = gloss
            self.created_sign_list.insert(tk.END, label)
        self.mobile_library_status.set(
            self._mobile_library_summary(
                published_glosses, set(self.created_sign_paths)
            )
        )
        if self.created_sign_paths and self.created_sign_list.size() > 0:
            self.created_sign_list.selection_set(0)
            self._on_created_sign_selection()
        else:
            self.library_selection_status.set("No hay señas guardadas todavía.")
        self._refresh_sign_suggestions()

    def _on_suggestion_category_changed(
        self, _event: tk.Event[tk.Misc] | None = None
    ) -> None:
        self._refresh_sign_suggestions()

    def _refresh_sign_suggestions(self) -> None:
        """Show the next uncreated LSC gloss without exposing duplicate choices."""

        existing = set(self.created_sign_paths) | self._published_mobile_glosses()
        suggestions = suggested_signs(existing, self.suggestion_category.get())
        self.current_suggestion = suggestions[0] if suggestions else None
        if self.current_suggestion is None:
            category = self.suggestion_category.get()
            self.suggestion_label.set(f"✓ {category}: no quedan señas pendientes")
            return
        self.suggestion_label.set(
            "HACER AHORA: "
            f"{self.current_suggestion.gloss} · "
            f"{self.current_suggestion.recommended_duration_seconds:.1f} s\n"
            f"{self.current_suggestion.category}"
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
        self.gloss.set(self.current_suggestion.gloss)
        self.duration_seconds.set(self.current_suggestion.recommended_duration_seconds)
        self.video_path.set("")
        self._reset_workflow_after_video()
        self.step_status.set(
            f"SIGUIENTE SEÑA: {self.current_suggestion.gloss}. Pulsa ABRIR CÁMARA Y GRABAR."
        )
        self.status.set(
            f"Recomendada: {self.current_suggestion.gloss} "
            f"({self.current_suggestion.recommended_duration_seconds:.1f} s, "
            f"{self.current_suggestion.category})."
        )

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
    def _published_mobile_glosses() -> set[str]:
        """Read the explicit mobile publication list without inspecting scratch files."""
        manifest = REPO_ROOT / "mobile/assets/motions/published_signs.json"
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            glosses = data.get("publishedGlosses", [])
            return {str(gloss).strip().upper() for gloss in glosses if str(gloss).strip()}
        except (OSError, json.JSONDecodeError, TypeError):
            return set()

    @staticmethod
    def _write_published_mobile_glosses(glosses: set[str]) -> None:
        """Persist the explicit catalog consumed by the mobile app at build time."""
        manifest = REPO_ROOT / "mobile/assets/motions/published_signs.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "publishedGlosses": sorted(glosses)}
        manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

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
            else "solo existe en VOZUAL: publícala cuando su revisión esté aprobada."
        )
        self.library_selection_status.set(
            f"Seleccionada: {gloss}. CARGAR Y EDITAR abre sus vistas y parámetros; {state}"
        )

    @staticmethod
    def _export_mobile_motion(
        gloss: str, recipe_path: Path, landmark_path: Path
    ) -> None:
        """Export one captured motion into the format consumed by the mobile app."""
        recipe_data = json.loads(recipe_path.read_text(encoding="utf-8"))
        fps = max(1, int(recipe_data.get("output_fps", 30)))
        output = REPO_ROOT / "mobile/assets/motions" / f"{gloss.lower()}.motion.json"
        exporter = REPO_ROOT / "mobile/tools/export_skeleton_motion.py"
        subprocess.run(
            [
                sys.executable,
                str(exporter),
                str(landmark_path),
                str(output),
                "--fps",
                str(fps),
            ],
            check=True,
            capture_output=True,
            text=True,
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

        exported: list[str] = []
        failures: list[tuple[str, str]] = []
        for gloss in pending:
            recipe_path, landmark_path = self.created_sign_paths[gloss]
            try:
                self._export_mobile_motion(gloss, recipe_path, landmark_path)
                exported.append(gloss)
            except (
                OSError,
                ValueError,
                json.JSONDecodeError,
                subprocess.CalledProcessError,
            ) as error:
                failures.append((gloss, str(error)))

        if exported:
            published.update(exported)
            self._write_published_mobile_glosses(published)
            self._refresh_created_signs()

        if failures:
            failed_names = ", ".join(gloss for gloss, _error in failures)
            messagebox.showerror(
                "Algunas señas no se publicaron",
                f"Se publicaron {len(exported)} señas y fallaron {len(failures)}: "
                f"{failed_names}.",
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
        try:
            self._export_mobile_motion(gloss, recipe_path, landmark_path)
            published = self._published_mobile_glosses()
            published.add(gloss)
            self._write_published_mobile_glosses(published)
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
            details = getattr(error, "stderr", "") or str(error)
            self.root.after(
                0,
                lambda: self._finish_mobile_install_failure(gloss, str(details).strip()),
            )
            return
        self.root.after(0, lambda: self._finish_mobile_install(gloss))

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
        messagebox.showerror(
            "No se pudo actualizar la app móvil",
            "La seña sigue publicada, pero no se pudo compilar o instalar Android.\n\n"
            f"Detalle: {error}",
            parent=self.root,
        )

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
            published_glosses = self._published_mobile_glosses()
            published_glosses.discard(gloss)
            self._write_published_mobile_glosses(published_glosses)
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
            self.apply_adjustments_button.configure(state="disabled")
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
        self.gloss.set(gloss)
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
        self.apply_adjustments_button.configure(state="normal")
        self.step_status.set(f"SEÑA CARGADA: {gloss}. Puedes editarla y regenerarla.")
        mobile_state = "está disponible en la app móvil" if gloss in self._published_mobile_glosses() else "todavía es solo de VOZUAL"
        self.status.set(f"Receta cargada desde {recipe_path.name}; {mobile_state}.")
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
            state="normal", text="VER ANIMACIÓN DEL AVATAR  ·  GENERA O CARGA UNA SEÑA"
        )
        self.automatic_button.configure(
            state="normal", text="2. ANALIZAR VIDEO Y CREAR ANIMACIÓN  →"
        )
        self.step_status.set("VIDEO LISTO: ahora pulsa 2. ANALIZAR VIDEO Y CREAR ANIMACIÓN.")
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
        fps = capture.get(cv2.CAP_PROP_FPS)
        delay_ms = max(20, int(1000 / fps)) if fps and fps > 1 else 33

        def close() -> None:
            running["value"] = False
            capture.release()
            if window.winfo_exists():
                window.destroy()

        tk.Button(
            window,
            text="CERRAR",
            command=close,
            bg="#26384e",
            fg="#f5f7fb",
            activebackground="#334b67",
            activeforeground="#f5f7fb",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(pady=(0, 16))

        def show_next_frame() -> None:
            if not running["value"] or not window.winfo_exists():
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

        window.protocol("WM_DELETE_WINDOW", close)
        show_next_frame()

    def _can_open_loaded_review(self, view_name: str) -> bool:
        """Prevent a stale review window from being shown for another library selection."""

        selected = self._selected_created_gloss(silent=True)
        selected_gloss = selected[0] if selected is not None else None
        if self.loaded_review_gloss is not None and (
            selected_gloss is None or selected_gloss == self.loaded_review_gloss
        ):
            return True
        if selected_gloss:
            messagebox.showinfo(
                "Carga la seña seleccionada",
                f"Seleccionaste {selected_gloss}. Pulsa CARGAR Y EDITAR antes de abrir {view_name}.",
                parent=self.root,
            )
        else:
            messagebox.showinfo(
                "Carga una seña",
                f"Selecciona y carga una seña antes de abrir {view_name}.",
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
        source_avatar = self._source_avatar()
        if source_avatar is None:
            messagebox.showerror(
                "Falta avatar",
                "No se encontró el archivo GLB del avatar.",
                parent=self.root,
            )
            return
        output = REPO_ROOT / "tmp/creator_references/video_imports" / gloss.lower()
        self.automatic_button.configure(
            state="disabled", text="CREANDO SEÑA… ESPERA"
        )
        self.analyze_button.configure(state="disabled")
        self.save_button.configure(state="disabled")
        self.preview_button.configure(state="disabled")
        self.status.set(
            "VOZUAL está siguiendo manos, cuerpo y rostro, corrigiendo la trayectoria "
            "y preparando el avatar."
        )
        self._start_progress("MODO AUTOMÁTICO: analizando y generando la seña…")
        threading.Thread(
            target=self._automatic_in_background,
            args=(video, gloss, output, source_avatar, float(self.duration_seconds.get())),
            daemon=True,
        ).start()

    def _automatic_in_background(
        self,
        video: Path,
        gloss: str,
        output: Path,
        source_avatar: Path,
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
            outputs = generate_preview(
                landmark_path=landmark_path,
                recipe_path=recipe_path,
                source_avatar=source_avatar,
            )
            self.root.after(
                0,
                lambda: self._finish_automatic(
                    landmark_path, recipe_path, data, outputs.video
                ),
            )
        except Exception as error:
            error_message = str(error)
            self.root.after(0, lambda: self._fail_automatic(error_message))

    def _finish_automatic(
        self,
        landmark_path: Path,
        recipe_path: Path,
        data: dict[str, object],
        video: Path,
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
        self.analyze_button.configure(state="normal", text="1. ANALIZAR VIDEO DE NUEVO")
        self.save_button.configure(
            state="normal", text="GUARDAR SIN GENERAR (OPCIONAL)"
        )
        self.preview_button.configure(
            state="normal", text="VER O REGENERAR ANIMACIÓN"
        )
        self.apply_adjustments_button.configure(state="normal")
        active_hand = "izquierda" if data["active_hand"] == "left" else "derecha"
        contact = str(data["contact_anchor"])
        self.step_status.set("SEÑA AUTOMÁTICA TERMINADA ✓  Revisa el video abierto.")
        self._set_stage(3)
        self.status.set(
            f"Resultado automático: mano {active_hand}; contacto detectado: {contact}. "
            "Si está correcto, la seña quedó lista."
        )
        self._refresh_created_signs()
        subprocess.run(["open", str(video)], check=False)
        self.root.bell()
        messagebox.showinfo(
            "Seña automática terminada",
            f"VOZUAL terminó sin consumir tokens.\n\n"
            f"Mano detectada: {active_hand}.\n"
            f"Contacto detectado: {contact}.\n\n"
            "Revisa el video que se abrió. Si necesitas un ajuste fino, utiliza "
            "los controles avanzados.",
            parent=self.root,
        )

    def _fail_automatic(self, error: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.automatic_button.configure(
            state="normal", text="2. ANALIZAR VIDEO Y CREAR ANIMACIÓN  →"
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
                "El video se abrió para que puedas revisarlo.\n"
                "Puedes cerrarlo normalmente con el botón rojo."
            ),
            font=("Arial", 13),
            fg="#b8c7d9",
            bg="#07111f",
            justify="center",
        ).pack(padx=28, pady=(0, 20))

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
                subprocess.run(["open", str(video)], check=False)
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
        self.analyze_button.configure(state="normal", text="1. ANALIZAR VIDEO DE NUEVO")

    def _finish_analysis(
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
        self._stop_analysis_progress()
        self.save_button.configure(
            state="normal", text="GUARDAR SIN GENERAR (OPCIONAL)"
        )
        self.apply_adjustments_button.configure(state="normal")
        self.step_status.set(
            "ANÁLISIS TERMINADO ✓  Ahora pulsa 2. GUARDAR CORRECCIONES."
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
            "2. GUARDAR CORRECCIONES.",
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
            }
        )
        landmark_data = json.loads(self.landmark_path.read_text(encoding="utf-8")) if self.landmark_path else {}
        frame_count = len(landmark_data.get("rawFrames", []))
        recipe.validate(frame_count)
        recipe.save(self.recipe_path)
        self.preview_button.configure(
            state="normal", text="GENERAR ANIMACIÓN DEL AVATAR"
        )
        self.step_status.set(
            "AJUSTES GUARDADOS ✓  Pulsa GUARDAR Y REGENERAR AHORA para verlos en el avatar."
        )
        self._set_stage(3)
        self.status.set(f"Receta guardada: {self.recipe_path}")
        if notify:
            messagebox.showinfo(
                "Correcciones guardadas",
                "Los ajustes quedaron guardados.\n\n"
                "Para verlos en el avatar, pulsa GUARDAR Y REGENERAR AHORA.",
                parent=self.root,
            )

    def _generate_preview(self) -> None:
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
        self.preview_button.configure(state="disabled", text="GENERANDO ANIMACIÓN…")
        self.apply_adjustments_button.configure(state="disabled", text="GENERANDO AVATAR…")
        self.status.set("GENERANDO: preparando el avatar y renderizando el MP4…")
        self.step_status.set("GENERANDO ANIMACIÓN… puedes seguir viendo esta ventana.")
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
            self.root.after(0, lambda: self._fail_preview_generation(str(error)))

    def _finish_preview_generation(self, video: Path) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.preview_button.configure(state="normal", text="VER O REGENERAR ANIMACIÓN")
        self.apply_adjustments_button.configure(state="normal", text="GUARDAR Y REGENERAR AHORA")
        self.status.set(f"ANIMACIÓN LISTA ✓  Se abrió: {video.name}")
        self.step_status.set("ANIMACIÓN ACTUALIZADA ✓  Revisa el video abierto.")
        subprocess.run(["open", str(video)], check=False)

    def _fail_preview_generation(self, error: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.preview_button.configure(state="normal", text="VER O REGENERAR ANIMACIÓN")
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
