"""Small desktop editor for video-driven ManoSpeak sign authoring."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.authoring_pipeline import generate_preview
    from src.sign_recipe import SignRecipe
    from src.video_reference_recorder import record_video
    from src.video_sign_import import import_video
else:
    from .authoring_pipeline import generate_preview
    from .sign_recipe import SignRecipe
    from .video_reference_recorder import record_video
    from .video_sign_import import import_video

REPO_ROOT = Path(__file__).resolve().parents[2]


class SignAuthoringEditor:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("VOZUAL — Editor de señas")
        root.geometry("760x820")
        root.configure(bg="#07111f")
        self.video_path = tk.StringVar()
        self.gloss = tk.StringVar(value="GRACIAS")
        self.capture_duration_seconds = tk.DoubleVar(value=5.0)
        self.duration_seconds = tk.DoubleVar(value=1.0)
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
        self.motion_height_cm = tk.DoubleVar(value=0.0)
        self.motion_lateral_cm = tk.DoubleVar(value=0.0)
        self.motion_depth_cm = tk.DoubleVar(value=0.0)
        self.status = tk.StringVar(
            value="Escribe el nombre, indica la duración y pulsa GRABAR SEÑA."
        )
        self.step_status = tk.StringVar(
            value="PASO ACTUAL: graba o selecciona un video."
        )
        self.recipe_path: Path | None = None
        self.landmark_path: Path | None = None
        self.tracking_preview_path: Path | None = None
        self._build()
        self._restore_latest_recording()

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
            text="Escribe la palabra y haz el movimiento despacio frente a la cámara.",
            fg=muted,
            bg=card,
            font=("Arial", 10),
        ).pack(anchor="w", pady=(3, 16))

        fields = tk.Frame(capture_card, bg=card)
        fields.pack(fill="x")
        name_field = tk.Frame(fields, bg=card)
        name_field.grid(row=0, column=0, columnspan=2, sticky="ew")
        fields.grid_columnconfigure(0, weight=1)
        fields.grid_columnconfigure(1, weight=1)
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
        for column, label, variable, upper in (
            (0, "TIEMPO PARA GRABAR", self.capture_duration_seconds, 15.0),
            (1, "DURACIÓN DEL AVATAR", self.duration_seconds, 5.0),
        ):
            box = tk.Frame(fields, bg=card)
            box.grid(row=1, column=column, sticky="ew", padx=(0, 6) if column == 0 else (6, 0), pady=(14, 0))
            tk.Label(box, text=f"{label} (SEG)", fg=muted, bg=card, font=("Arial", 9, "bold")).pack(anchor="w", pady=(0, 5))
            tk.Spinbox(
                box,
                textvariable=variable,
                from_=0.5,
                to=upper,
                increment=0.1,
                bg=card_soft,
                fg=text,
                buttonbackground=card_soft,
                relief="flat",
                font=("Arial", 13, "bold"),
            ).pack(fill="x", ipady=7)

        camera_button = tk.Button(
            capture_card,
            text="●  ABRIR CÁMARA Y GRABAR",
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
            text="CONVERTIR VIDEO EN ANIMACIÓN",
            fg=text,
            bg=card,
            font=("Arial", 12, "bold"),
        ).pack(anchor="w")
        tk.Label(
            capture_card,
            text="VOZUAL analizará manos, muñecas, codos, hombros y rostro automáticamente.",
            fg=muted,
            bg=card,
            font=("Arial", 9),
            wraplength=580,
            justify="left",
        ).pack(anchor="w", pady=(3, 12))
        self.automatic_button = tk.Button(
            capture_card,
            text="CREAR ANIMACIÓN  →",
            command=self._create_automatically,
            bg=accent,
            fg=background,
            activebackground="#58e8e1",
            activeforeground=background,
            relief="flat",
            font=("Arial", 14, "bold"),
            cursor="pointinghand",
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

        self.analysis_progress = ttk.Progressbar(
            status_card,
            mode="indeterminate",
            style="VOZUAL.Horizontal.TProgressbar",
        )

        result = tk.Frame(review_card, bg=card)
        result.pack(fill="both", expand=True, pady=(16, 0))
        tk.Label(result, text="COMPROBAR RESULTADO", fg=muted, bg=card, font=("Arial", 9, "bold")).pack(anchor="w", pady=(0, 8))
        self.tracking_button = tk.Button(
            result,
            text="VER PUNTOS DETECTADOS",
            command=self._open_tracking_preview,
            bg="#26384e",
            fg=text,
            disabledforeground="#647386",
            relief="flat",
            font=("Arial", 11, "bold"),
            state="disabled",
        )
        self.tracking_button.pack(fill="x", ipady=10, pady=(0, 8))
        self.preview_button = tk.Button(
            result,
            text="VER ANIMACIÓN DEL AVATAR",
            command=self._generate_preview,
            bg=danger,
            fg=text,
            disabledforeground="#647386",
            activebackground="#ff7890",
            activeforeground=text,
            font=("Arial", 11, "bold"),
            relief="flat",
            state="disabled",
        )
        self.preview_button.pack(fill="x", ipady=10, pady=(0, 8))
        tk.Button(
            result,
            text="EDITAR PARÁMETROS POR SEGUNDO  ⚙",
            command=self._open_advanced_dialog,
            bg=card,
            fg=muted,
            activebackground=card,
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

    def _build_advanced_dialog(
        self,
        background: str,
        card: str,
        card_soft: str,
        text: str,
        muted: str,
        warning: str,
    ) -> None:
        self.advanced_window = tk.Toplevel(self.root)
        self.advanced_window.title("VOZUAL — Parámetros por segundo")
        self.advanced_window.geometry("820x760")
        self.advanced_window.minsize(760, 700)
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

        controls = tk.Frame(self.advanced_panel, bg=card)
        controls.pack(fill="x", pady=(4, 0))
        self._combo(controls, "Contacto corporal", self.anchor, ("none", "chin", "mouth", "forehead", "cheek", "chest"), 0)
        self._combo(controls, "Palma al tocar", self.contact_palm, ("camera", "up", "down", "in", "out"), 1)
        self._combo(controls, "Palma al terminar", self.release_palm, ("camera", "up", "down", "in", "out"), 2)

        tk.Label(self.advanced_panel, text="Distancia hacia adelante", fg=muted, bg=card, font=("Arial", 9, "bold")).pack(anchor="w", pady=(14, 0))
        tk.Scale(self.advanced_panel, variable=self.forward, from_=0.0, to=1.0, resolution=0.05, orient="horizontal", bg=card, fg=text, highlightthickness=0, troughcolor="#26374b").pack(fill="x")
        tk.Checkbutton(self.advanced_panel, text="Regresar la mano a reposo", variable=self.return_to_rest, bg=card, fg=text, selectcolor=card_soft, activebackground=card, activeforeground=text).pack(anchor="w", pady=6)

        adjustments = tk.Frame(self.advanced_panel, bg=card_soft, padx=14, pady=12)
        adjustments.pack(fill="x", pady=(10, 6))
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
        actions = tk.Frame(adjustments, bg=card_soft)
        actions.grid(row=4, column=0, columnspan=5, sticky="ew", pady=(10, 0))
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
                fg=text,
                relief="flat",
                font=("Arial", 8, "bold"),
            ).pack(side="left", expand=True, fill="x", padx=(0, 5), ipady=5)
        tk.Button(
            adjustments,
            text="RESTABLECER TODOS LOS PUNTOS A CERO",
            command=self._reset_motion_adjustments,
            bg="#26384e",
            fg=text,
            relief="flat",
            font=("Arial", 9, "bold"),
        ).grid(row=5, column=0, columnspan=5, sticky="ew", pady=(10, 0), ipady=5)

        self.analyze_button = tk.Button(
            self.advanced_panel,
            text="1. ANALIZAR VIDEO",
            command=self._analyze,
            bg="#26384e",
            fg=text,
            relief="flat",
            font=("Arial", 11, "bold"),
        )
        self.analyze_button.pack(fill="x", ipady=10, pady=(8, 4))
        self.save_button = tk.Button(
            self.advanced_panel,
            text="2. GUARDAR CORRECCIONES (BLOQUEADO)",
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
            text="APLICAR AJUSTES Y REGENERAR ANIMACIÓN",
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
            text="CERRAR AJUSTES",
            command=self.advanced_window.withdraw,
            bg=card_soft,
            fg=text,
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(fill="x", ipady=8, pady=(8, 0))

    def _open_advanced_dialog(self) -> None:
        self.advanced_window.deiconify()
        self.advanced_window.transient(self.root)
        self.advanced_window.lift()
        self.advanced_window.focus_force()

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
            ):
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
        self.tracking_preview_path = None
        self.tracking_button.configure(
            state="disabled", text="VER PUNTOS DETECTADOS"
        )
        self.save_button.configure(
            state="disabled", text="2. GUARDAR CORRECCIONES (BLOQUEADO)"
        )
        self.apply_adjustments_button.configure(state="disabled")
        self.preview_button.configure(
            state="disabled", text="VER ANIMACIÓN DEL AVATAR"
        )
        self.step_status.set("VIDEO LISTO: pulsa CREAR ANIMACIÓN.")
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
        self.tracking_button.configure(
            state="normal" if self.tracking_preview_path else "disabled",
            text=(
                "VER MANO, BRAZO Y 468 PUNTOS DE LA CARA"
                if self.tracking_preview_path
                else "VISTA DE PUNTOS NO DISPONIBLE"
            ),
        )

    def _open_tracking_preview(self) -> None:
        if self.tracking_preview_path is None or not self.tracking_preview_path.is_file():
            messagebox.showerror(
                "Falta el diagnóstico",
                "Analiza nuevamente el video para generar la vista de puntos.",
                parent=self.root,
            )
            return
        subprocess.run(["open", str(self.tracking_preview_path)], check=False)

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
            state="normal", text="CREAR SEÑA AUTOMÁTICAMENTE DE NUEVO"
        )
        self.analyze_button.configure(state="normal", text="1. ANALIZAR VIDEO DE NUEVO")
        self.save_button.configure(
            state="normal", text="2. GUARDAR AJUSTES MANUALES (OPCIONAL)"
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
            state="normal", text="CREAR SEÑA AUTOMÁTICAMENTE"
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
            capture_duration = float(self.capture_duration_seconds.get())
            final_duration = float(self.duration_seconds.get())
        except (tk.TclError, ValueError):
            messagebox.showerror("Duración inválida", "Escribe una duración válida en segundos.")
            return
        if not gloss:
            messagebox.showerror("Falta el nombre", "Escribe primero el nombre de la seña.")
            return
        self.status.set("Abriendo cámara. Prepárate para la cuenta regresiva…")
        self.root.update_idletasks()
        output = REPO_ROOT / "tmp/creator_references/recorded_videos" / gloss.lower()
        try:
            while True:
                video = record_video(0, gloss, capture_duration, output)
                self.video_path.set(str(video))
                self._reset_workflow_after_video()
                subprocess.run(["open", str(video)], check=False)
                decision = self._review_recording(video)
                if decision == "use":
                    self.status.set(
                        f"Grabación lenta elegida: {video.name}. Se comprimirá a "
                        f"{final_duration:.1f} s. Ahora pulsa CREAR ANIMACIÓN."
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
        if not video.is_file() or not self.gloss.get().strip():
            messagebox.showerror("Datos incompletos", "Selecciona un video y escribe la palabra.")
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
        self._set_tracking_preview(landmark_path)
        self.anchor.set(str(data["contact_anchor"]))
        self.contact_palm.set(str(data["palm_at_contact"]))
        self.release_palm.set(str(data["palm_at_release"]))
        self.forward.set(float(data["forward_distance"]))
        self.return_to_rest.set(bool(data["return_to_rest"]))
        self._load_motion_adjustments(data)
        self._stop_analysis_progress()
        self.save_button.configure(
            state="normal", text="2. GUARDAR CORRECCIONES — SIGUIENTE PASO"
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
            "CORRECCIONES GUARDADAS ✓  Ahora pulsa 3. GENERAR VISTA PREVIA."
        )
        self._set_stage(3)
        self.status.set(f"Receta guardada: {self.recipe_path}")
        if notify:
            messagebox.showinfo(
                "Correcciones guardadas",
                "Los ajustes quedaron guardados.\n\n"
                "Siguiente paso: pulsa 3. GENERAR VISTA PREVIA.",
                parent=self.root,
            )

    def _generate_preview(self) -> None:
        if self.recipe_path is None or self.landmark_path is None:
            messagebox.showerror("Falta análisis", "Primero analiza el video y guarda la receta.")
            return
        self._save_recipe(notify=False)
        source_glb = next((REPO_ROOT / "tmp/creator_references/gracias/source").rglob("*.glb"), None)
        if source_glb is None:
            messagebox.showerror("Falta avatar", "No se encontró el archivo GLB del avatar.")
            return
        self.status.set("Generando el avatar y renderizando el MP4…")
        self.root.update_idletasks()
        try:
            outputs = generate_preview(
                landmark_path=self.landmark_path,
                recipe_path=self.recipe_path,
                source_avatar=source_glb,
            )
            self.status.set(f"Vista previa lista: {outputs.video}")
            subprocess.run(["open", str(outputs.video)], check=False)
        except Exception as error:
            messagebox.showerror("No se pudo generar", str(error))


def main() -> None:
    root = tk.Tk()
    SignAuthoringEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
