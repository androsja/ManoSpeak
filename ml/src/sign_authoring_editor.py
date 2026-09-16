"""Small desktop editor for video-driven VOZUAL sign authoring."""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
import unicodedata
from collections.abc import Callable, Iterable
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import parse_qs, quote

import cv2
import numpy as np
from PIL import Image, ImageTk

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.authoring_pipeline import generate_preview
    from src.linguistic_catalog import (
        editor_metadata,
        find_entry,
        is_mobile_compilation_eligible,
        load_catalog,
        owner_approval_status,
        owner_review_fingerprint,
        preview_renderable_plan,
        set_owner_approval,
        set_owner_review_fingerprint,
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
        find_entry,
        is_mobile_compilation_eligible,
        load_catalog,
        owner_approval_status,
        owner_review_fingerprint,
        preview_renderable_plan,
        set_owner_approval,
        set_owner_review_fingerprint,
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
AVATAR_PROFILE_OVERRIDES_PATH = (
    REPO_ROOT / "mobile/assets/motions/avatar_profile_overrides.json"
)
FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
FINGER_LABELS = {
    "thumb": "Pulgar",
    "index": "Índice",
    "middle": "Medio",
    "ring": "Anular",
    "pinky": "Meñique",
}
FINGER_STATE_OPTIONS = ("capturado", "extendido", "cerrado")
FINGER_STATE_TO_PROFILE = {
    "capturado": "captured",
    "extendido": "extended",
    "cerrado": "closed",
}
PROFILE_TO_FINGER_STATE = {
    value: key for key, value in FINGER_STATE_TO_PROFILE.items()
}

DURATION_MODE_MATCH_RECORDING = "IGUAL A LA GRABACIÓN"
DURATION_MODE_CUSTOM = "PERSONALIZADA"
DURATION_MODE_OPTIONS = (
    DURATION_MODE_MATCH_RECORDING,
    DURATION_MODE_CUSTOM,
)
MIN_SIGN_DURATION_SECONDS = 0.5
MAX_SIGN_DURATION_SECONDS = 15.0

RIG_EDIT_FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _resolved_avatar_duration_seconds(
    recording_duration_seconds: float,
    requested_avatar_duration_seconds: float,
    mode: str,
) -> float:
    """Resolve and validate the final avatar duration selected by the author."""

    values = (recording_duration_seconds, requested_avatar_duration_seconds)
    if any(not math.isfinite(value) for value in values):
        raise ValueError("Sign durations must be finite numbers.")
    if not MIN_SIGN_DURATION_SECONDS <= recording_duration_seconds <= MAX_SIGN_DURATION_SECONDS:
        raise ValueError("Recording duration must be between 0.5 and 15 seconds.")
    if mode == DURATION_MODE_MATCH_RECORDING:
        return recording_duration_seconds
    if mode != DURATION_MODE_CUSTOM:
        raise ValueError("Unsupported avatar duration mode.")
    if not MIN_SIGN_DURATION_SECONDS <= requested_avatar_duration_seconds <= MAX_SIGN_DURATION_SECONDS:
        raise ValueError("Avatar duration must be between 0.5 and 15 seconds.")
    return requested_avatar_duration_seconds


def _normalized_rig_hand_keyframes(value: object) -> list[dict[str, object]]:
    """Validate browser-authored avatar keyframes before they touch source assets."""

    if not isinstance(value, list) or len(value) > 256:
        raise ValueError("Avatar keyframes must be a list with at most 256 entries.")

    def bounded_number(raw: object, minimum: float, maximum: float) -> float:
        if isinstance(raw, bool):
            raise ValueError("Avatar edit values must be numeric.")
        try:
            number = float(raw)
        except (TypeError, ValueError) as error:
            raise ValueError("Avatar edit values must be numeric.") from error
        if not math.isfinite(number) or not minimum <= number <= maximum:
            raise ValueError("A hand edit value is outside its supported range.")
        return number

    def normalized_pose(raw: object) -> dict[str, object]:
        pose = raw if isinstance(raw, dict) else {}
        fingers = pose.get("fingers", {})
        if not isinstance(fingers, dict):
            raise ValueError("Finger edits must be a JSON object.")
        finger_joints = pose.get("fingerJoints", {})
        if not isinstance(finger_joints, dict):
            raise ValueError("Finger joint edits must be a JSON object.")

        def normalized_joints(finger: str) -> list[float]:
            raw_joints = finger_joints.get(finger, [0.0, 0.0, 0.0])
            if not isinstance(raw_joints, list):
                raise ValueError("Each finger joint edit must be a JSON list.")
            return [
                bounded_number(
                    raw_joints[joint] if joint < len(raw_joints) else 0.0,
                    -1.0,
                    1.0,
                )
                for joint in range(3)
            ]
        return {
            "elbowRotation": bounded_number(
                pose.get("elbowRotation", 0.0), -180.0, 180.0
            ),
            "wristPitch": bounded_number(pose.get("wristPitch", 0.0), -180.0, 180.0),
            "wristYaw": bounded_number(pose.get("wristYaw", 0.0), -180.0, 180.0),
            "wristRoll": bounded_number(pose.get("wristRoll", 0.0), -180.0, 180.0),
            "horizontalOffset": bounded_number(
                pose.get("horizontalOffset", 0.0), -1.0, 1.0
            ),
            "verticalOffset": bounded_number(
                pose.get("verticalOffset", 0.0), -1.0, 1.0
            ),
            "depthOffset": bounded_number(pose.get("depthOffset", 0.0), -1.0, 1.0),
            "fist": bounded_number(pose.get("fist", 0.0), 0.0, 1.0),
            "fingers": {
                finger: bounded_number(fingers.get(finger, 0.0), -1.0, 1.0)
                for finger in RIG_EDIT_FINGERS
            },
            "fingerJoints": {
                finger: normalized_joints(finger) for finger in RIG_EDIT_FINGERS
            },
        }

    keyframes_by_frame: dict[int, dict[str, object]] = {}
    for raw_keyframe in value:
        if not isinstance(raw_keyframe, dict):
            raise ValueError("Each hand keyframe must be a JSON object.")
        frame_value = bounded_number(raw_keyframe.get("frame"), 0.0, 65535.0)
        transition_value = bounded_number(
            raw_keyframe.get("transitionFrames", 6), 1.0, 120.0
        )
        frame = int(round(frame_value))
        keyframes_by_frame[frame] = {
            "frame": frame,
            "transitionFrames": int(round(transition_value)),
            "smile": bounded_number(raw_keyframe.get("smile", 0.0), 0.0, 1.0),
            "mouthPucker": bounded_number(raw_keyframe.get("mouthPucker", 0.0), 0.0, 1.0),
            "mouthOpening": bounded_number(raw_keyframe.get("mouthOpening", 0.0), 0.0, 1.0),
            "eyeWidening": bounded_number(raw_keyframe.get("eyeWidening", 0.0), 0.0, 1.0),
            "browRaise": bounded_number(raw_keyframe.get("browRaise", 0.0), 0.0, 1.0),
            "left": normalized_pose(raw_keyframe.get("left")),
            "right": normalized_pose(raw_keyframe.get("right")),
        }
    return [keyframes_by_frame[frame] for frame in sorted(keyframes_by_frame)]


def _merge_rig_hand_keyframes(
    profiles: object,
    gloss: str,
    keyframes: list[dict[str, object]],
) -> dict[str, object]:
    """Update one sign without replacing any of its other avatar corrections."""

    updated = dict(profiles) if isinstance(profiles, dict) else {}
    stored_profile = updated.get(gloss, {})
    profile = dict(stored_profile) if isinstance(stored_profile, dict) else {}
    if keyframes:
        profile["rigHandKeyframes"] = keyframes
    else:
        profile.pop("rigHandKeyframes", None)
    if profile:
        updated[gloss] = profile
    else:
        updated.pop(gloss, None)
    return updated


class _MobilePreviewRequestHandler(SimpleHTTPRequestHandler):
    """Serve the local mobile runtime without writing browser requests to stdout."""

    def __init__(
        self,
        *args: object,
        profile_path: Path | None = None,
        runtime_profile_path: Path | None = None,
        catalog_path: Path | None = None,
        manifest_path: Path | None = None,
        candidate_gloss: str | None = None,
        candidate_motion_path: Path | None = None,
        published_motion_path: Path | None = None,
        reviewed_change_callback: Callable[[str], None] | None = None,
        **kwargs: object,
    ) -> None:
        self.profile_path = profile_path
        self.runtime_profile_path = runtime_profile_path
        self.catalog_path = catalog_path
        self.manifest_path = manifest_path
        self.candidate_gloss = candidate_gloss
        self.candidate_motion_path = candidate_motion_path
        self.published_motion_path = published_motion_path
        self.reviewed_change_callback = reviewed_change_callback
        super().__init__(*args, **kwargs)

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        serialized = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(serialized)))
        self.end_headers()
        self.wfile.write(serialized)

    @staticmethod
    def _write_json(path: Path, payload: dict[str, object]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.writing")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)

    def _notify_reviewed_change(self, gloss: str) -> None:
        """Tell the desktop editor that the open simulation saved its final state."""

        callback = getattr(self, "reviewed_change_callback", None)
        if callable(callback):
            callback(gloss)

    def _compilation_review_payload(self, gloss: str) -> dict[str, object]:
        """Describe the real owner-approved build set for the browser preview."""

        if self.catalog_path is None:
            raise ValueError("Esta vista no fue abierta desde VOZUAL Editor.")
        normalized_gloss = gloss.strip().upper()
        catalog = load_catalog(self.catalog_path)
        entries = catalog["entries"]
        current = next(
            (
                entry
                for entry in entries
                if str(entry.get("gloss", "")).strip().upper() == normalized_gloss
            ),
            None,
        )
        if current is None:
            raise ValueError(f"{normalized_gloss} no está registrada en el catálogo.")

        published = bool(current.get("motion", {}).get("published"))
        linguistic_review = str(current.get("review", {}).get("status", "draft"))
        linguistic_ready = linguistic_review in {"approved", "legacy_approved"}
        candidate_motion_path = getattr(self, "candidate_motion_path", None)
        candidate_publishable = (
            normalized_gloss == str(getattr(self, "candidate_gloss", "")).strip().upper()
            and isinstance(candidate_motion_path, Path)
            and candidate_motion_path.is_file()
            and isinstance(getattr(self, "published_motion_path", None), Path)
        )
        prerequisites_ready = published and linguistic_review in {
            "approved",
            "legacy_approved",
        }
        approved_glosses = sorted(
            str(entry.get("gloss", "")).strip().upper()
            for entry in entries
            if is_mobile_compilation_eligible(entry)
        )
        reviewable_glosses = sorted(
            str(entry.get("gloss", "")).strip().upper()
            for entry in entries
            if entry.get("motion", {}).get("published")
            and entry.get("review", {}).get("status")
            in {"approved", "legacy_approved"}
            and not is_mobile_compilation_eligible(entry)
        )
        return {
            "ok": True,
            "current": {
                "gloss": normalized_gloss,
                "approval": owner_approval_status(current),
                "eligible": is_mobile_compilation_eligible(current),
                "prerequisitesReady": prerequisites_ready,
                "candidatePublishable": candidate_publishable,
                "canApproveHere": linguistic_ready and (
                    published or candidate_publishable
                ),
                "published": published,
                "linguisticReview": linguistic_review,
            },
            "approvedGlosses": approved_glosses,
            "approvedCount": len(approved_glosses),
            "reviewableGlosses": reviewable_glosses,
            "reviewableCount": len(reviewable_glosses),
        }

    def _publish_preview_candidate(self, gloss: str) -> None:
        """Publish the exact candidate already loaded in this review server."""

        if self.catalog_path is None:
            raise ValueError("Esta vista no fue abierta desde VOZUAL Editor.")
        normalized_gloss = gloss.strip().upper()
        if normalized_gloss != str(getattr(self, "candidate_gloss", "")).strip().upper():
            raise ValueError(f"{normalized_gloss} no es la seña preparada en esta vista.")
        candidate_motion_path = getattr(self, "candidate_motion_path", None)
        published_motion_path = getattr(self, "published_motion_path", None)
        if (
            not isinstance(candidate_motion_path, Path)
            or not candidate_motion_path.is_file()
            or not isinstance(published_motion_path, Path)
        ):
            raise ValueError(f"{normalized_gloss} no tiene una animación lista para publicar.")

        catalog = load_catalog(self.catalog_path)
        current = next(
            (
                entry
                for entry in catalog["entries"]
                if str(entry.get("gloss", "")).strip().upper() == normalized_gloss
            ),
            None,
        )
        if current is None:
            raise ValueError(f"{normalized_gloss} no está registrada en el catálogo.")
        review_status = str(current.get("review", {}).get("status", "draft"))
        if review_status not in {"approved", "legacy_approved"}:
            raise ValueError(
                f"{normalized_gloss} necesita revisión lingüística antes de publicarse."
            )

        published_motion_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate_motion_path, published_motion_path)
        current.setdefault("motion", {})["published"] = True
        current["motion"].setdefault("clip", normalized_gloss)
        self._write_json(self.catalog_path, catalog)

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP method name
        request_path, _, query = self.path.partition("?")
        if request_path != "/api/sign-approval":
            super().do_GET()
            return
        try:
            query_values = parse_qs(query, keep_blank_values=True)
            gloss = str(query_values.get("gloss", [""])[0]).strip().upper()
            if not gloss or len(gloss) > 100:
                raise ValueError("Se necesita el nombre de una seña válida.")
            self._send_json(200, self._compilation_review_payload(gloss))
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as error:
            self._send_json(400, {"ok": False, "error": str(error)})

    def do_POST(self) -> None:  # noqa: N802 - inherited HTTP method name
        request_path = self.path.split("?", 1)[0]
        if request_path not in {
            "/api/rig-hand-keyframes",
            "/api/sign-approval",
        }:
            self._send_json(404, {"ok": False, "error": "Unknown editor endpoint."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 0 < content_length <= 1_000_000:
                raise ValueError("The editor request has an invalid size.")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("The editor request must be a JSON object.")
            gloss = str(payload.get("gloss", "")).strip().upper()
            if not gloss or len(gloss) > 100:
                raise ValueError("A valid sign name is required.")
            if request_path == "/api/sign-approval":
                approved = payload.get("approved")
                if not isinstance(approved, bool):
                    raise ValueError("La aprobación debe ser verdadera o falsa.")
                review_payload = self._compilation_review_payload(gloss)
                current = review_payload["current"]
                if (
                    approved
                    and isinstance(current, dict)
                    and not current.get("prerequisitesReady")
                ):
                    if not current.get("canApproveHere"):
                        raise ValueError(
                            f"{gloss} todavía no puede publicarse desde esta vista."
                        )
                    self._publish_preview_candidate(gloss)
                if self.catalog_path is None:
                    raise ValueError("Esta vista no fue abierta desde VOZUAL Editor.")
                set_owner_approval(gloss, approved, self.catalog_path)
                write_published_motion_manifest(self.catalog_path, self.manifest_path)
                self._notify_reviewed_change(gloss)
                self._send_json(200, self._compilation_review_payload(gloss))
                return
            keyframes = _normalized_rig_hand_keyframes(payload.get("keyframes"))
            raw_spread = payload.get("indexMiddleSpread")
            spread = None if raw_spread is None else max(0.0, min(0.08, float(raw_spread)))
            raw_roll = payload.get("forearmAxialRollDegrees")
            roll = None if raw_roll is None else max(-180.0, min(180.0, float(raw_roll)))
            if self.profile_path is None or self.runtime_profile_path is None:
                raise ValueError("This preview was not opened from the VOZUAL editor.")

            try:
                source_profiles = json.loads(self.profile_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                source_profiles = {}
            updated_source = _merge_rig_hand_keyframes(
                source_profiles, gloss, keyframes
            )
            if spread is not None:
                source_profile = dict(updated_source.get(gloss, {}))
                source_profile["rigLeftIndexMiddleSpread"] = round(spread, 3)
                updated_source[gloss] = source_profile
            if spread is not None or roll is not None:
                profile = dict(updated_source.get(gloss, {}))
                if spread is not None:
                    profile["rigLeftIndexMiddleSpread"] = round(spread, 3)
                if roll is not None:
                    profile["rigLeftForearmAxialRollDegrees"] = round(roll, 1)
                updated_source[gloss] = profile
            self._write_json(self.profile_path, updated_source)

            try:
                runtime_profiles = json.loads(
                    self.runtime_profile_path.read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError):
                runtime_profiles = {}
            updated_runtime = _merge_rig_hand_keyframes(
                runtime_profiles, gloss, keyframes
            )
            if spread is not None:
                runtime_profile = dict(updated_runtime.get(gloss, {}))
                runtime_profile["rigLeftIndexMiddleSpread"] = round(spread, 3)
                updated_runtime[gloss] = runtime_profile
            if spread is not None or roll is not None:
                profile = dict(updated_runtime.get(gloss, {}))
                if spread is not None:
                    profile["rigLeftIndexMiddleSpread"] = round(spread, 3)
                if roll is not None:
                    profile["rigLeftForearmAxialRollDegrees"] = round(roll, 1)
                updated_runtime[gloss] = profile
            self._write_json(self.runtime_profile_path, updated_runtime)
            self._notify_reviewed_change(gloss)
            self._send_json(200, {"ok": True, "gloss": gloss, "keyframes": keyframes})
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self._send_json(400, {"ok": False, "error": str(error)})


class SignAuthoringEditor:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("VOZUAL — Editor de señas")
        root.geometry("760x820")
        root.configure(bg="#07111f")
        self.video_path = tk.StringVar()
        self.gloss = tk.StringVar(value="")
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
        self.firebase_published_glosses: set[str] | None = None
        self.firebase_suggestion_status_loading = False
        self.recording_duration_seconds = tk.DoubleVar(value=1.2)
        self.duration_seconds = tk.DoubleVar(value=1.2)
        self.avatar_duration_mode = tk.StringVar(
            value=DURATION_MODE_MATCH_RECORDING
        )
        self.duration_summary = tk.StringVar(
            value="El avatar usará los mismos 1.2 s de la grabación."
        )
        self.avatar_duration_spinbox: tk.Spinbox | None = None
        self.anchor = tk.StringVar(value="chin")
        self.contact_palm = tk.StringVar(value="camera")
        self.release_palm = tk.StringVar(value="up")
        self.left_finger_states = {
            finger: tk.StringVar(value="capturado") for finger in FINGER_NAMES
        }
        self.right_finger_states = {
            finger: tk.StringVar(value="capturado") for finger in FINGER_NAMES
        }
        self.loaded_finger_states = self._default_finger_state_snapshot()
        self.left_index_middle_spread = tk.DoubleVar(value=0.025)
        self.loaded_index_middle_spread = 0.025
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
        self.face_mouth_pucker = tk.DoubleVar(value=0.0)
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
        self.embedded_preview_nonce: str | None = None
        self.mobile_preview_signatures: dict[
            str, tuple[tuple[str, int, int], ...]
        ] = {}
        self.created_sign_paths: dict[str, tuple[Path, Path]] = {}
        self.created_sign_labels: dict[str, str] = {}
        self.created_sign_list: tk.Listbox | None = None
        self.library_filter = tk.StringVar(value="pending")
        self.library_filter_button: tk.Button | None = None
        self.owner_approval_button: tk.Checkbutton | None = None
        self.publish_approved_button: tk.Button | None = None
        self.owner_approval_checked = tk.BooleanVar(value=False)
        self.owner_approval_label = tk.StringVar(
            value="APROBACIÓN PERSONAL: carga o selecciona una seña."
        )
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
            self.face_mouth_pucker,
            self.face_eye_wide,
            self.face_brow_raise,
            self.timeline_seconds,
        ):
            variable.trace_add("write", lambda *_args: self._write_live_avatar_state())
        self._build()
        self.root.protocol("WM_DELETE_WINDOW", self._close_editor)
        self.recording_duration_seconds.trace_add(
            "write", self._recording_duration_changed
        )
        self.speech_aliases.trace_add("write", self._refresh_speech_aliases_input)
        self._set_default_speech_aliases(self.gloss.get())
        self._update_linguistic_summary()
        self._restore_latest_recording()
        self._refresh_created_signs()
        self._refresh_firebase_suggestion_statuses()

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
        tk.Label(self.linguistic_details, text="REVISIÓN LSC", fg=muted, bg=card, font=("Arial", 8, "bold")).grid(row=0, column=3, sticky="w", padx=(6, 0))
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
        duration_box.grid_columnconfigure(0, weight=1)
        duration_box.grid_columnconfigure(1, weight=1)
        tk.Label(
            duration_box,
            text="TIEMPO PARA GRABAR (SEG)",
            fg=muted,
            bg=card,
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=0, sticky="w", pady=(0, 5))
        tk.Spinbox(
            duration_box,
            textvariable=self.recording_duration_seconds,
            from_=MIN_SIGN_DURATION_SECONDS,
            to=MAX_SIGN_DURATION_SECONDS,
            increment=0.1,
            bg=card_soft,
            fg=text,
            buttonbackground=card_soft,
            relief="flat",
            font=("Arial", 11, "bold"),
            width=7,
        ).grid(row=1, column=0, sticky="w", ipady=2)
        tk.Label(
            duration_box,
            text="Puedes hacer la seña lentamente frente a la cámara.",
            fg=muted,
            bg=card,
            font=("Arial", 8),
            wraplength=260,
            justify="left",
        ).grid(row=2, column=0, sticky="w", pady=(4, 0))

        avatar_duration_box = tk.Frame(duration_box, bg=card)
        avatar_duration_box.grid(
            row=0,
            column=1,
            rowspan=3,
            sticky="nsew",
            padx=(14, 0),
        )
        avatar_duration_box.grid_columnconfigure(0, weight=1)
        tk.Label(
            avatar_duration_box,
            text="DURACIÓN FINAL DEL AVATAR",
            fg=muted,
            bg=card,
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 5))
        avatar_duration_combo = ttk.Combobox(
            avatar_duration_box,
            textvariable=self.avatar_duration_mode,
            values=DURATION_MODE_OPTIONS,
            state="readonly",
            font=("Arial", 9, "bold"),
            width=23,
        )
        avatar_duration_combo.grid(row=1, column=0, sticky="ew", padx=(0, 7))
        avatar_duration_combo.bind(
            "<<ComboboxSelected>>", self._avatar_duration_mode_changed
        )
        self.avatar_duration_spinbox = tk.Spinbox(
            avatar_duration_box,
            textvariable=self.duration_seconds,
            from_=MIN_SIGN_DURATION_SECONDS,
            to=MAX_SIGN_DURATION_SECONDS,
            increment=0.1,
            bg=card_soft,
            fg=text,
            disabledbackground=card_soft,
            disabledforeground=muted,
            buttonbackground=card_soft,
            relief="flat",
            font=("Arial", 11, "bold"),
            width=7,
            command=self._update_duration_controls,
        )
        self.avatar_duration_spinbox.grid(row=1, column=1, sticky="e", ipady=2)
        self.avatar_duration_spinbox.bind(
            "<KeyRelease>", self._avatar_duration_mode_changed
        )
        self.avatar_duration_spinbox.bind(
            "<FocusOut>", self._avatar_duration_mode_changed
        )
        tk.Label(
            avatar_duration_box,
            textvariable=self.duration_summary,
            fg=accent,
            bg=card,
            font=("Arial", 8, "bold"),
            wraplength=300,
            justify="left",
        ).grid(row=2, column=0, columnspan=2, sticky="w", pady=(4, 0))
        self._update_duration_controls()

        review_card = tk.Frame(frame, bg=card, padx=18, pady=16)
        review_card.grid(row=1, column=1, sticky="nsew", padx=(7, 0), pady=(14, 0))
        tk.Label(
            review_card,
            text="FINALIZAR Y ENVIAR A LA APP",
            fg=text,
            bg=card,
            font=("Arial", 16, "bold"),
        ).pack(anchor="w")
        tk.Label(
            review_card,
            text=(
                "Guardar conserva los cambios en este Mac. Solo el botón ENVIAR A "
                "FIREBASE los publica para que el celular pueda descargarlos."
            ),
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
            text=(
                "Selecciona una seña y completa dos pasos: 1) revisarla y aprobarla; "
                "2) enviarla a Firebase."
            ),
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
        ).grid(row=0, column=0, sticky="ew", ipady=4)
        approval_card = tk.Frame(created_card, bg="#0d1928", padx=8, pady=7)
        approval_card.pack(fill="x", pady=(7, 0))
        self.owner_approval_button = tk.Checkbutton(
            approval_card,
            text="1. YA REVISÉ ESTA SEÑA Y LA APRUEBO",
            variable=self.owner_approval_checked,
            command=self._toggle_owner_approval,
            bg="#0d1928",
            fg="#f5f8fc",
            activebackground="#0d1928",
            activeforeground="#20d6ce",
            selectcolor="#26384e",
            disabledforeground="#6f8094",
            anchor="w",
            relief="flat",
            font=("Arial", 8, "bold"),
            state="disabled",
        )
        self.owner_approval_button.pack(fill="x")
        tk.Label(
            approval_card,
            textvariable=self.owner_approval_label,
            fg="#9fb0c4",
            bg="#0d1928",
            font=("Arial", 8),
            wraplength=360,
            justify="left",
        ).pack(anchor="w", pady=(3, 0))
        self.publish_approved_button = tk.Button(
            created_card,
            text="2. ENVIAR A FIREBASE · CARGA UNA SEÑA",
            command=self._publish_current_sign_to_firebase,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#63e5df",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 8, "bold"),
            cursor="pointinghand",
            state="disabled",
        )
        self.publish_approved_button.pack(fill="x", pady=(4, 0), ipady=2)
        self.library_filter_button = tk.Button(
            created_card,
            text="BUSCAR CUALQUIER SEÑA",
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
            text="VISTA 3D INTERNA",
            command=self._generate_preview,
            bg=danger,
            fg="#172638",
            activebackground="#ff7890",
            activeforeground=text,
            font=("Arial", 9, "bold"),
            relief="flat",
        )

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

        finger_panel = tk.LabelFrame(
            inspector,
            text="FORMA DE LOS DEDOS EN EL PERSONAJE",
            fg=accent,
            bg=card_soft,
            font=("Arial", 9, "bold"),
            padx=8,
            pady=7,
        )
        finger_panel.pack(fill="x", pady=(14, 0))
        tk.Label(
            finger_panel,
            text=(
                "Usa CAPTURADO normalmente. Corrige un dedo solo cuando el "
                "video lo oculta o lo interpreta mal. El ajuste se aplica "
                "durante toda esta seña y no modifica los puntos originales."
            ),
            fg=muted,
            bg=card_soft,
            font=("Arial", 8),
            wraplength=430,
            justify="left",
        ).grid(row=0, column=0, columnspan=6, sticky="w", pady=(0, 6))
        tk.Label(finger_panel, text="Mano", fg=muted, bg=card_soft).grid(
            row=1, column=0, sticky="w", padx=(0, 6)
        )
        for column, finger in enumerate(FINGER_NAMES, start=1):
            tk.Label(
                finger_panel,
                text=FINGER_LABELS[finger],
                fg=muted,
                bg=card_soft,
                font=("Arial", 8),
            ).grid(row=1, column=column, sticky="ew", padx=2)
            finger_panel.grid_columnconfigure(column, weight=1)
        for row, (side_label, variables) in enumerate(
            (("Izquierda", self.left_finger_states), ("Derecha", self.right_finger_states)),
            start=2,
        ):
            tk.Label(
                finger_panel,
                text=side_label,
                fg=text,
                bg=card_soft,
                font=("Arial", 8, "bold"),
            ).grid(row=row, column=0, sticky="w", padx=(0, 6), pady=2)
            for column, finger in enumerate(FINGER_NAMES, start=1):
                ttk.Combobox(
                    finger_panel,
                    textvariable=variables[finger],
                    values=FINGER_STATE_OPTIONS,
                    state="readonly",
                    width=9,
                ).grid(row=row, column=column, sticky="ew", padx=2, pady=2)

        tk.Label(
            finger_panel,
            text="Separación índice–medio (abanico leve)",
            fg=muted,
            bg=card_soft,
            font=("Arial", 8, "bold"),
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(8, 0))
        tk.Scale(
            finger_panel,
            variable=self.left_index_middle_spread,
            from_=0.0,
            to=0.08,
            resolution=0.005,
            orient="horizontal",
            bg=card_soft,
            fg=text,
            highlightthickness=0,
            troughcolor="#26374b",
        ).grid(row=4, column=2, columnspan=4, sticky="ew", padx=2, pady=(4, 0))

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
                ("Boca redonda (O)", self.face_mouth_pucker, "0 neutral · 1 labios redondos"),
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

    def _duration_values(self) -> tuple[float, float]:
        """Return validated recording and final avatar durations."""

        try:
            recording_duration = float(self.recording_duration_seconds.get())
            requested_avatar_duration = float(self.duration_seconds.get())
        except (tk.TclError, TypeError, ValueError) as error:
            raise ValueError("Escribe duraciones válidas en segundos.") from error
        try:
            avatar_duration = _resolved_avatar_duration_seconds(
                recording_duration,
                requested_avatar_duration,
                self.avatar_duration_mode.get(),
            )
        except ValueError as error:
            raise ValueError(
                "Las duraciones deben estar entre 0.5 y 15 segundos."
            ) from error
        if self.avatar_duration_mode.get() == DURATION_MODE_MATCH_RECORDING:
            self.duration_seconds.set(recording_duration)
        return recording_duration, avatar_duration

    def _recording_duration_changed(self, *_args: object) -> None:
        """Keep the default avatar duration linked to the recording time."""

        self._update_duration_controls()

    def _avatar_duration_mode_changed(self, _event: object | None = None) -> None:
        self._update_duration_controls()

    def _update_duration_controls(self) -> None:
        mode = self.avatar_duration_mode.get()
        if self.avatar_duration_spinbox is not None:
            self.avatar_duration_spinbox.configure(
                state="disabled"
                if mode == DURATION_MODE_MATCH_RECORDING
                else "normal"
            )
        try:
            recording_duration = float(self.recording_duration_seconds.get())
            if mode == DURATION_MODE_MATCH_RECORDING:
                self.duration_seconds.set(recording_duration)
            avatar_duration = float(self.duration_seconds.get())
        except (tk.TclError, TypeError, ValueError):
            self.duration_summary.set("Completa ambos tiempos en segundos.")
            return
        if mode == DURATION_MODE_MATCH_RECORDING:
            self.duration_summary.set(
                f"El avatar usará los mismos {recording_duration:.1f} s de la grabación."
            )
        else:
            self.duration_summary.set(
                f"Grabación {recording_duration:.1f} s → avatar {avatar_duration:.1f} s. "
                "Se conserva todo el movimiento."
            )

    @staticmethod
    def _duration_settings_from_reference(
        reference: dict[str, object],
        final_duration_seconds: float,
    ) -> tuple[float, str]:
        """Recover source timing and whether an imported sign was compressed."""

        recording_duration = final_duration_seconds
        capture = reference.get("capture", {})
        if isinstance(capture, dict):
            try:
                source_frame_count = float(capture.get("sourceFrameCount", 0.0))
                source_fps = float(capture.get("sourceFps", 0.0))
                source_duration_ms = float(capture.get("sourceDurationMs", 0.0))
            except (TypeError, ValueError):
                source_frame_count = source_fps = source_duration_ms = 0.0
            if source_frame_count > 0.0 and source_fps > 0.0:
                recording_duration = source_frame_count / source_fps
            elif source_duration_ms > 0.0:
                recording_duration = source_duration_ms / 1000.0
        recording_duration = round(recording_duration, 1)
        tolerance = max(0.11, final_duration_seconds * 0.03)
        if abs(recording_duration - final_duration_seconds) <= tolerance:
            return round(final_duration_seconds, 1), DURATION_MODE_MATCH_RECORDING
        return recording_duration, DURATION_MODE_CUSTOM

    def _load_duration_settings(
        self,
        reference: dict[str, object],
        final_duration_seconds: float,
    ) -> None:
        recording_duration, mode = self._duration_settings_from_reference(
            reference,
            final_duration_seconds,
        )
        self.avatar_duration_mode.set(mode)
        self.recording_duration_seconds.set(recording_duration)
        self.duration_seconds.set(round(final_duration_seconds, 1))
        self._update_duration_controls()

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
            "mouth_pucker": float(self.face_mouth_pucker.get()),
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
                        "jaw_open", "mouth_pucker", "eye_wide", "brow_raise",
                    )
                },
            }
        self.motion_kind.set(str(point["kind"]))
        self.motion_time_seconds.set(round(current, 3))
        self.motion_height_cm.set(float(point["height_cm"]))
        self.motion_lateral_cm.set(float(point["lateral_cm"]))
        self.motion_depth_cm.set(float(point["depth_cm"]))
        self.face_jaw_open.set(float(point.get("jaw_open", 0.0)))
        self.face_mouth_pucker.set(float(point.get("mouth_pucker", 0.0)))
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
            self.face_mouth_pucker,
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
            "mouth_pucker": float(self.face_mouth_pucker.get()),
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
        self.face_mouth_pucker.set(float(point.get("mouth_pucker", 0.0)))
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
            ) or any(not 0.0 <= float(point[name]) <= 1.0 for name in ("jaw_open", "mouth_pucker", "eye_wide", "brow_raise")):
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
            3: "REVISA Y APRUEBA",
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
            state = "APROBADA ✓" if gloss in published_glosses else "POR REVISAR"
            label = f"{state}  ·  {gloss}"
            self.created_sign_labels[label] = gloss
            self.created_sign_list.insert(tk.END, label)
        if self.library_filter_button is not None:
            self.library_filter_button.configure(
                text=f"BUSCAR ENTRE {len(self.created_sign_paths)} SEÑAS"
            )
        self.mobile_library_status.set(
            self._mobile_library_summary(
                published_glosses, set(self.created_sign_paths)
            )
        )
        loaded_gloss = getattr(self, "loaded_review_gloss", None)
        if self.created_sign_list.size() > 0:
            loaded_index = next(
                (
                    index
                    for index, label in enumerate(
                        self.created_sign_list.get(0, tk.END)
                    )
                    if self.created_sign_labels.get(label) == loaded_gloss
                ),
                None,
            )
            if loaded_index is not None:
                self.created_sign_list.selection_set(loaded_index)
                self._on_created_sign_selection()
            elif loaded_gloss:
                self.created_sign_list.selection_clear(0, tk.END)
                self.library_selection_status.set(
                    f"ABIERTA PARA EDITAR: {loaded_gloss}. La lista muestra otras "
                    "señas pendientes."
                )
                self._refresh_owner_approval_control(loaded_gloss)
            else:
                self.created_sign_list.selection_set(0)
                self._on_created_sign_selection()
        else:
            self.library_selection_status.set(
                "No hay señas pendientes. Usa BUSCAR ENTRE SEÑAS para abrir una publicada."
                if self.created_sign_paths
                else "No hay señas guardadas todavía."
            )
            self._refresh_owner_approval_control()
        self._refresh_sign_suggestions()

    def _owner_approval_target(self) -> tuple[str, Path, Path] | None:
        """Prefer the sign loaded for review over a passive queue selection."""

        if (
            self.loaded_review_gloss
            and self.recipe_path is not None
            and self.landmark_path is not None
        ):
            return self.loaded_review_gloss, self.recipe_path, self.landmark_path
        return self._selected_created_gloss(silent=True)

    def _refresh_owner_approval_control(self, gloss: str | None = None) -> None:
        """Reflect the explicit owner gate without changing it implicitly."""

        if self.owner_approval_button is None:
            return
        target = self._owner_approval_target()
        target_gloss = gloss or (target[0] if target is not None else None)
        if target_gloss is None:
            self.owner_approval_checked.set(False)
            self.owner_approval_button.configure(state="disabled")
            self.owner_approval_label.set(
                "Carga o selecciona una seña para comenzar."
            )
            if self.publish_approved_button is not None:
                self.publish_approved_button.configure(
                    text="2. ENVIAR A FIREBASE · CARGA UNA SEÑA",
                    state="disabled",
                )
            return
        approved = owner_approval_status(find_entry(target_gloss)) == "approved"
        self.owner_approval_checked.set(approved)
        self.owner_approval_button.configure(state="normal")
        self.owner_approval_label.set(
            f"{target_gloss}: "
            + (
                "APROBADA EN ESTE EDITOR ✓ Falta pulsar el botón 2 para enviar los cambios."
                if approved
                else "PENDIENTE. Revisa la simulación y marca el paso 1."
            )
        )
        if self.publish_approved_button is not None:
            self.publish_approved_button.configure(
                text=(
                    f"2. ENVIAR {target_gloss} A FIREBASE"
                    if approved
                    else "2. ENVIAR A FIREBASE · PRIMERO APRUÉBALA"
                ),
                state="normal" if approved else "disabled",
            )

    def _toggle_owner_approval(self) -> None:
        """Add or remove one sign from the owner-approved publication set."""

        target = self._owner_approval_target()
        if target is None:
            self.owner_approval_checked.set(False)
            messagebox.showinfo(
                "Aprobación de la seña",
                "Carga o selecciona una seña antes de cambiar su aprobación.",
                parent=self.root,
            )
            return
        gloss, recipe_path, landmark_path = target
        approved = bool(self.owner_approval_checked.get())
        if approved and not self._confirm_mobile_previews(
            [gloss], request_confirmation=False
        ):
            self.owner_approval_checked.set(False)
            self._refresh_owner_approval_control(gloss)
            return
        try:
            if approved:
                self._export_mobile_motion(gloss, recipe_path, landmark_path)
                self._register_published_linguistic_entry(gloss, recipe_path)
            set_owner_approval(gloss, approved)
            reviewed_signature = self.mobile_preview_signatures.get(gloss)
            if approved and reviewed_signature is not None:
                self._persist_mobile_preview_review(gloss, reviewed_signature)
            write_published_motion_manifest()
        except (
            OSError,
            ValueError,
            json.JSONDecodeError,
            subprocess.CalledProcessError,
        ) as error:
            self.owner_approval_checked.set(not approved)
            messagebox.showerror(
                "No se pudo cambiar la aprobación", str(error), parent=self.root
            )
            return
        self._refresh_created_signs()
        self._refresh_owner_approval_control(gloss)
        self.step_status.set(
            f"{gloss} "
            + (
                "APROBADA: puede publicarse como una seña independiente."
                if approved
                else "RETIRADA DE PUBLICACIÓN: permanece guardada para revisión."
            )
        )
        self.status.set(
            f"{gloss} "
            + (
                "quedó aprobada por ti."
                if approved
                else "quedó marcada como pendiente de tu aprobación."
            )
        )

    def _toggle_library_filter(self) -> None:
        """Keep the publishing queue focused while retaining access to history."""
        self.library_filter.set(
            "all" if self.library_filter.get() == "pending" else "pending"
        )
        self._refresh_created_signs()

    @staticmethod
    def _choose_random_pending_gloss(
        glosses: Iterable[str],
        approved_glosses: set[str],
        previous_gloss: str | None = None,
    ) -> str | None:
        """Choose an unapproved sign and avoid an immediate repeat when possible."""

        candidates = sorted(set(glosses) - approved_glosses)
        if previous_gloss in candidates and len(candidates) > 1:
            candidates.remove(previous_gloss)
        return random.choice(candidates) if candidates else None

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
                "Escribe el nombre de una seña. Usa ⌘ clic para seleccionar varias "
                "y enviarlas juntas cuando estén aprobadas."
            ),
            fg="#9fb0c4",
            bg="#111e2e",
            font=("Arial", 9),
            wraplength=500,
            justify="left",
        ).pack(anchor="w", pady=(4, 12))
        query = tk.StringVar()
        search_row = tk.Frame(panel, bg="#111e2e")
        search_row.pack(fill="x")
        tk.Entry(
            search_row,
            textvariable=query,
            bg="#172638",
            fg="#f5f8fc",
            insertbackground="#f5f8fc",
            relief="flat",
            font=("Arial", 12),
        ).pack(side="left", fill="x", expand=True, ipady=7)
        tk.Button(
            search_row,
            text="SEÑA PENDIENTE ALEATORIA",
            command=lambda: select_random_pending(),
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            relief="flat",
            font=("Arial", 9, "bold"),
        ).pack(side="right", padx=(8, 0), ipadx=10, ipady=7)
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
            columns=("gloss", "category", "aliases", "state", "firebase"),
            show="headings",
            selectmode="extended",
        )
        results.heading("gloss", text="SEÑA")
        results.heading("category", text="CATEGORÍA")
        results.heading("aliases", text="PALABRAS DE VOZ")
        results.heading("state", text="APROBACIÓN")
        results.heading("firebase", text="FIREBASE")
        results.column("gloss", width=120, anchor="w")
        results.column("category", width=145, anchor="w")
        results.column("aliases", width=250, anchor="w")
        results.column("state", width=90, anchor="center")
        results.column("firebase", width=190, anchor="center")
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
        firebase_statuses: dict[str, tuple[str, int | None]] = {}
        firebase_status_loading = True
        firebase_status_failed = False
        represented_forms = tk.StringVar(
            value="Selecciona una seña para ver todas las palabras de voz que representa."
        )

        def firebase_label(gloss: str) -> str:
            if firebase_status_loading:
                return "CONSULTANDO…"
            if firebase_status_failed:
                return "NO SE PUDO CONSULTAR"
            state, version = firebase_statuses.get(
                gloss, ("not_published", None)
            )
            return self._firebase_status_label(state, version)

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
                state = (
                    "APROBADA ✓"
                    if gloss in self._published_mobile_glosses()
                    else "POR REVISAR"
                )
                categories = editor_metadata(gloss)["categories"]
                category = ", ".join(str(item).replace("_", " ") for item in categories)
                aliases = aliases_by_gloss[gloss]
                preview = ", ".join(aliases[:4]) + ("…" if len(aliases) > 4 else "")
                results.insert(
                    "",
                    tk.END,
                    iid=gloss,
                    values=(gloss, category, preview, state, firebase_label(gloss)),
                )
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

        def select_random_pending() -> None:
            selected = results.selection()
            previous = selected[0] if selected else None
            gloss = self._choose_random_pending_gloss(
                self.created_sign_paths,
                self._published_mobile_glosses(),
                previous,
            )
            if gloss is None:
                result_status.set("No quedan señas pendientes de aprobación.")
                messagebox.showinfo(
                    "Biblioteca revisada",
                    "Todas las señas guardadas ya están aprobadas.",
                    parent=dialog,
                )
                return
            query.set(gloss)
            if not results.exists(gloss):
                refresh_results()
            results.selection_set(gloss)
            results.focus(gloss)
            results.see(gloss)
            show_represented_forms()
            result_status.set(
                f"PENDIENTE ALEATORIA: {gloss}. Pulsa ABRIR SEÑA para revisarla."
            )

        def refresh_visible_firebase_states() -> None:
            for gloss in matched_glosses:
                if not results.exists(gloss):
                    continue
                values = list(results.item(gloss, "values"))
                if len(values) < 5:
                    continue
                values[4] = firebase_label(gloss)
                results.item(gloss, values=values)

        def finish_firebase_status_lookup(
            statuses: dict[str, tuple[str, int | None]] | None,
        ) -> None:
            nonlocal firebase_statuses, firebase_status_loading, firebase_status_failed
            try:
                if not dialog.winfo_exists():
                    return
            except tk.TclError:
                return
            firebase_status_loading = False
            firebase_status_failed = statuses is None
            firebase_statuses = statuses or {}
            refresh_visible_firebase_states()
            firebase_send_button.configure(
                state="disabled" if firebase_status_failed else "normal"
            )
            if firebase_status_failed:
                result_status.set(
                    "No se pudo consultar Firebase. Revisa la conexión; la aprobación local sí se muestra."
                )

        def load_firebase_statuses() -> None:
            try:
                statuses = self._firebase_sign_statuses()
            except (
                OSError,
                ValueError,
                json.JSONDecodeError,
                subprocess.SubprocessError,
            ):
                statuses = None
            self.root.after(
                0, lambda: finish_firebase_status_lookup(statuses)
            )

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

        def send_selected_to_firebase() -> None:
            selected = list(results.selection())
            if not selected:
                messagebox.showinfo(
                    "Enviar señas a Firebase",
                    "Selecciona una o varias señas de la tabla primero.",
                    parent=dialog,
                )
                return
            approved = self._published_mobile_glosses()
            unapproved = [gloss for gloss in selected if gloss not in approved]
            if unapproved:
                messagebox.showwarning(
                    "Hay señas sin aprobar",
                    "Estas señas todavía no pueden enviarse:\n• "
                    + "\n• ".join(unapproved)
                    + "\n\nÁbrelas y completa primero el paso 1: YA REVISÉ ESTA SEÑA Y LA APRUEBO.",
                    parent=dialog,
                )
                return
            pending = [
                gloss
                for gloss in selected
                if firebase_statuses.get(gloss, ("not_published", None))[0]
                != "current"
            ]
            if not pending:
                messagebox.showinfo(
                    "Firebase ya está actualizado",
                    "Todas las señas seleccionadas muestran ACTUALIZADA. No hay nada por enviar.",
                    parent=dialog,
                )
                return
            dialog.grab_release()
            if not self._confirm_mobile_previews(
                pending, request_confirmation=False
            ):
                if dialog.winfo_exists():
                    dialog.grab_set()
                return
            try:
                for gloss in pending:
                    recipe_path, landmark_path = self.created_sign_paths[gloss]
                    self._export_mobile_motion(gloss, recipe_path, landmark_path)
                    self._register_published_linguistic_entry(gloss, recipe_path)
                write_published_motion_manifest()
            except (
                OSError,
                ValueError,
                json.JSONDecodeError,
                subprocess.CalledProcessError,
            ) as error:
                if dialog.winfo_exists():
                    dialog.grab_set()
                messagebox.showerror(
                    "No se pudieron preparar las señas",
                    str(error),
                    parent=dialog,
                )
                return
            close_search()
            self._publish_approved_signs_to_firebase(pending)

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
                    "La app móvil las usará después de publicar los cambios en Firebase."
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
        action_row.grid_columnconfigure(2, weight=1)
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
        firebase_send_button = tk.Button(
            action_row,
            text="ENVIAR SELECCIONADAS A FIREBASE",
            command=send_selected_to_firebase,
            bg="#20d6ce",
            fg="#07111f",
            activebackground="#58e8e1",
            activeforeground="#07111f",
            disabledforeground="#62738a",
            relief="flat",
            font=("Arial", 9, "bold"),
            state="disabled",
        )
        firebase_send_button.grid(
            row=0, column=1, sticky="ew", padx=4, ipady=5
        )
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
        ).grid(row=0, column=2, sticky="ew", padx=(4, 0), ipady=5)
        threading.Thread(target=load_firebase_statuses, daemon=True).start()

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

        remote_glosses: set[str] | None = getattr(
            self, "firebase_published_glosses", set()
        )
        if remote_glosses is None:
            self.current_suggestion = None
            if getattr(self, "firebase_suggestion_status_loading", False):
                self.suggestion_label.set("VERIFICANDO FIREBASE…")
            else:
                self.suggestion_label.set(
                    "NO SE PUDO VERIFICAR FIREBASE\n"
                    "Revisa la conexión antes de grabar."
                )
            return

        existing = (
            set(self.created_sign_paths)
            | self._published_mobile_glosses()
            | remote_glosses
        )
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
        self.avatar_duration_mode.set(DURATION_MODE_MATCH_RECORDING)
        self.recording_duration_seconds.set(
            selected.recommended_duration_seconds
        )
        self.duration_seconds.set(selected.recommended_duration_seconds)
        self._update_duration_controls()
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
        """Summarize the explicit owner-approval publication gate."""
        pending_count = len(created_glosses - published_glosses)
        return (
            f"EN ESTE EDITOR: {len(published_glosses)} APROBADAS · "
            f"{pending_count} POR REVISAR"
        )

    @staticmethod
    def _firebase_status_label(state: str, version: int | None) -> str:
        """Translate a verified remote comparison into a concise UI label."""

        if state == "current":
            return f"ACTUALIZADA ✓ v{version}" if version is not None else "ACTUALIZADA ✓"
        if state == "changes_pending":
            return f"CAMBIOS SIN ENVIAR · v{version}" if version is not None else "CAMBIOS SIN ENVIAR"
        if state == "published_not_approved":
            return f"PUBLICADA · APROBACIÓN RETIRADA · v{version}" if version is not None else "PUBLICADA · APROBACIÓN RETIRADA"
        return "NO PUBLICADA"

    def _firebase_sign_statuses(self) -> dict[str, tuple[str, int | None]]:
        """Read current public metadata and compare it with local release hashes."""

        mobile_directory = REPO_ROOT / "mobile"
        result = subprocess.run(
            [
                str(self._node_executable()),
                str(mobile_directory / "tools/firebase-sign-status.js"),
            ],
            cwd=mobile_directory,
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
        payload = json.loads(result.stdout)
        statuses = payload.get("statuses")
        if not isinstance(statuses, list):
            raise ValueError("Firebase returned an invalid sign status list.")
        parsed: dict[str, tuple[str, int | None]] = {}
        for item in statuses:
            if not isinstance(item, dict):
                continue
            gloss = str(item.get("gloss", "")).strip().upper()
            state = str(item.get("state", "")).strip()
            raw_version = item.get("version")
            version = int(raw_version) if isinstance(raw_version, (int, float)) else None
            if gloss and state:
                parsed[gloss] = (state, version)
        return parsed

    @staticmethod
    def _firebase_uploaded_glosses(
        statuses: dict[str, tuple[str, int | None]],
    ) -> set[str]:
        """Return signs whose document already exists in public Firebase."""
        return {
            gloss
            for gloss, (state, _version) in statuses.items()
            if state != "not_published"
        }

    def _refresh_firebase_suggestion_statuses(self) -> None:
        """Refresh suggestion exclusions from the current public Firebase state."""

        if getattr(self, "firebase_suggestion_status_loading", False):
            return
        self.firebase_suggestion_status_loading = True
        self.firebase_published_glosses = None
        self.current_suggestion = None
        self.suggestion_label.set("VERIFICANDO FIREBASE…")

        def worker() -> None:
            try:
                statuses = self._firebase_sign_statuses()
            except (OSError, ValueError, subprocess.SubprocessError):
                statuses = None
            self.root.after(
                0,
                lambda: self._finish_firebase_suggestion_statuses(statuses),
            )

        threading.Thread(target=worker, daemon=True).start()

    def _finish_firebase_suggestion_statuses(
        self,
        statuses: dict[str, tuple[str, int | None]] | None,
    ) -> None:
        """Update suggestions only after Firebase could be verified."""

        self.firebase_suggestion_status_loading = False
        if statuses is None:
            self.firebase_published_glosses = None
            self.current_suggestion = None
            self.suggestion_label.set(
                "NO SE PUDO VERIFICAR FIREBASE\n"
                "Revisa la conexión antes de grabar."
            )
            return
        self.firebase_published_glosses = self._firebase_uploaded_glosses(statuses)
        self._refresh_sign_suggestions()

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
                "YO es un pronombre de primera persona. Si la toma lo requiere, añade boca redonda (O), apertura leve, ojos y cejas en el editor por cuadro."
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
            "está aprobada por ti y puede publicarse como descarga independiente."
            if gloss in self._published_mobile_glosses()
            else "está por revisar y no puede publicarse."
        )
        self.library_selection_status.set(
            f"Seleccionada: {gloss}. CARGAR Y EDITAR abre sus vistas y parámetros; {state}"
        )
        self._refresh_owner_approval_control()

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
        actor_video_path: Path | None = None,
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
                    mobile_root / "package-lock.json",
                    *sorted((mobile_root / "src/services").glob("*.ts")),
                ]
            )
        else:
            inputs.extend(extra_inputs)
        # The original recording, publication manifest, and exported motion files
        # are comparison or delivery artifacts. Approving a reviewed sign updates
        # those files, but it does not change the recipe, capture, or avatar runtime
        # the owner just reviewed.
        signature: list[tuple[str, int, int]] = []
        for path in inputs:
            try:
                details = path.stat()
                signature.append((str(path.resolve()), details.st_mtime_ns, details.st_size))
            except OSError:
                signature.append((str(path.resolve()), -1, -1))
        return tuple(signature)

    @staticmethod
    def _mobile_preview_fingerprint(
        signature: tuple[tuple[str, int, int], ...],
    ) -> str:
        """Create a durable content fingerprint for one reviewed mobile preview."""

        digest = hashlib.sha256()
        for path_value, _modified_at, _size in signature:
            path = Path(path_value)
            try:
                label = str(path.resolve().relative_to(REPO_ROOT))
            except ValueError:
                label = str(path.resolve())
            digest.update(label.encode("utf-8"))
            digest.update(b"\0")
            try:
                with path.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
            except OSError:
                digest.update(b"<missing>")
            digest.update(b"\0")
        return digest.hexdigest()

    def _persist_mobile_preview_review(
        self,
        gloss: str,
        signature: tuple[tuple[str, int, int], ...],
    ) -> bool:
        """Remember an approved review so reopening VOZUAL does not repeat it."""

        try:
            entry = find_entry(gloss)
            if owner_approval_status(entry) != "approved":
                return False
            fingerprint = self._mobile_preview_fingerprint(signature)
            if owner_review_fingerprint(entry) != fingerprint:
                set_owner_review_fingerprint(gloss, fingerprint)
        except (OSError, ValueError, json.JSONDecodeError):
            return False
        return True

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
        catalog_path: Path | None = None,
    ) -> list[str]:
        """Include every reviewable sign plus the candidate under active review.

        The production manifest intentionally contains only owner-approved signs.
        Using it as the preview browser would hide the signs that still need that
        approval, so the editor preview reads the linguistic catalog instead.
        """

        manifest = manifest_path or (
            REPO_ROOT / "mobile/assets/motions/published_signs.json"
        )
        catalog = catalog_path or (
            REPO_ROOT / "mobile/assets/data/lsc_linguistic_catalog.json"
        )
        published: list[object]
        if catalog.is_file():
            entries = load_catalog(catalog).get("entries", [])
            published = sorted(
                str(
                    entry.get("motion", {}).get("clip")
                    or entry.get("gloss", "")
                ).strip().upper()
                for entry in entries
                if isinstance(entry, dict)
                and entry.get("motion", {}).get("published")
                and entry.get("review", {}).get("status")
                in {"approved", "legacy_approved"}
            )
        else:
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
    def _mobile_motion_asset_path(gloss: str, motion_library: Path) -> Path | None:
        """Resolve legacy motion filenames without losing catalog accents."""

        expected = motion_library / f"{gloss.strip().lower()}.motion.json"
        if expected.is_file():
            return expected

        def folded(value: str) -> str:
            return "".join(
                character
                for character in unicodedata.normalize("NFD", value.casefold())
                if unicodedata.category(character) != "Mn"
            )

        target = folded(gloss.strip())
        return next(
            (
                path
                for path in motion_library.glob("*.motion.json")
                if folded(path.name.removesuffix(".motion.json")) == target
            ),
            None,
        )

    @staticmethod
    def _available_mobile_preview_glosses(
        candidate_gloss: str,
        requested_glosses: Iterable[str],
        motion_library: Path,
    ) -> list[str]:
        """Keep the candidate while omitting library rows with missing motion files."""

        candidate = candidate_gloss.strip().upper()
        available: list[str] = []
        for value in requested_glosses:
            gloss = str(value).strip().upper()
            if not gloss or gloss in available:
                continue
            if (
                gloss == candidate
                or SignAuthoringEditor._mobile_motion_asset_path(
                    gloss, motion_library
                )
                is not None
            ):
                available.append(gloss)
        if candidate and candidate not in available:
            available.append(candidate)
        return available

    @staticmethod
    def _build_mobile_runtime_preview(
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
        actor_video_path: Path | None = None,
        reviewed_change_callback: Callable[[str], None] | None = None,
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
        preview_glosses = SignAuthoringEditor._mobile_preview_glosses(
            gloss,
            catalog_path=mobile_root / "assets/data/lsc_linguistic_catalog.json",
        )
        preview_glosses = SignAuthoringEditor._available_mobile_preview_glosses(
            gloss,
            preview_glosses,
            motion_library,
        )
        preferred_recordings: dict[str, Path] | None = None
        recording_start_offsets_ms: dict[str, int] | None = None
        recording_durations_ms: dict[str, int] | None = None
        if actor_video_path is not None and actor_video_path.is_file():
            normalized_gloss = gloss.strip().upper()
            preferred_recordings = {normalized_gloss: actor_video_path}
            recipe_data = json.loads(recipe_path.read_text(encoding="utf-8"))
            output_fps = max(1, int(recipe_data.get("output_fps", 30)))
            source_start_frame = max(
                0,
                int(recipe_data.get("source_start_frame", 0)),
            )
            if source_start_frame:
                recording_start_offsets_ms = {
                    normalized_gloss: round(source_start_frame * 1000 / output_fps)
                }
            source_end_frame = recipe_data.get("source_end_frame")
            if source_end_frame is not None:
                recording_duration_ms = round(
                    (max(source_start_frame, int(source_end_frame)) - source_start_frame + 1)
                    * 1000
                    / output_fps
                )
            else:
                reference_data = json.loads(landmark_path.read_text(encoding="utf-8"))
                capture = reference_data.get("capture", {})
                source_duration_ms = (
                    float(capture.get("sourceDurationMs", 0.0))
                    if isinstance(capture, dict)
                    else 0.0
                )
                start_offset_ms = round(source_start_frame * 1000 / output_fps)
                recording_duration_ms = round(source_duration_ms) - start_offset_ms
            if recording_duration_ms > 0:
                recording_durations_ms = {
                    normalized_gloss: recording_duration_ms
                }
        SignAuthoringEditor._stage_mobile_preview_recordings(
            preview_glosses,
            runtime_dir,
            preferred_recordings=preferred_recordings,
            recording_start_offsets_ms=recording_start_offsets_ms,
            recording_durations_ms=recording_durations_ms,
        )
        for published_gloss in preview_glosses:
            published_motion = SignAuthoringEditor._mobile_motion_asset_path(
                published_gloss,
                motion_library,
            )
            if published_motion is not None:
                shutil.copy2(
                    published_motion,
                    source_motion_dir / f"{published_gloss.lower()}.motion.json",
                )
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
            profile_path=profile_overrides,
            runtime_profile_path=runtime_dir / "motions/avatar_profiles.json",
            catalog_path=REPO_ROOT / "mobile/assets/data/lsc_linguistic_catalog.json",
            manifest_path=REPO_ROOT / "mobile/assets/motions/published_signs.json",
            candidate_gloss=gloss,
            candidate_motion_path=source_motion_dir / f"{gloss.lower()}.motion.json",
            published_motion_path=motion_library / f"{gloss.lower()}.motion.json",
            reviewed_change_callback=reviewed_change_callback,
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
        preferred_recordings: dict[str, Path] | None = None,
        recording_start_offsets_ms: dict[str, int] | None = None,
        recording_durations_ms: dict[str, int] | None = None,
    ) -> dict[str, object]:
        """Expose the newest original take for each gloss in a local preview."""

        recordings_dir = runtime_dir / "recordings"
        recordings_dir.mkdir(parents=True, exist_ok=True)
        manifest: dict[str, object] = {}
        for index, gloss in enumerate(glosses):
            normalized_gloss = gloss.strip().upper()
            preferred = (preferred_recordings or {}).get(normalized_gloss)
            recording = (
                preferred
                if preferred is not None and preferred.is_file()
                else None
            )
            if recording is None:
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
            relative_url = f"./recordings/{destination.name}"
            start_ms = max(
                0,
                int((recording_start_offsets_ms or {}).get(normalized_gloss, 0)),
            )
            duration_ms = max(
                0,
                int((recording_durations_ms or {}).get(normalized_gloss, 0)),
            )
            if start_ms or duration_ms:
                recording_metadata: dict[str, object] = {"url": relative_url}
                if start_ms:
                    recording_metadata["startMs"] = start_ms
                if duration_ms:
                    recording_metadata["durationMs"] = duration_ms
                manifest[normalized_gloss] = recording_metadata
            else:
                manifest[normalized_gloss] = relative_url

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

    def _show_embedded_mobile_preview(self, url: str, gloss: str) -> bool:
        """Ask the native VOZUAL shell to display the local preview internally."""

        request_value = os.environ.get("VOZUAL_EMBEDDED_PREVIEW_REQUEST", "")
        response_value = os.environ.get("VOZUAL_EMBEDDED_PREVIEW_RESPONSE", "")
        if not request_value or not response_value:
            messagebox.showerror(
                "Abre VOZUAL Editor de Señas",
                "La simulación integrada solo está disponible al abrir la aplicación VOZUAL.",
                parent=self.root,
            )
            return False
        request_path = Path(request_value)
        response_path = Path(response_value)
        nonce = str(time.time_ns())
        try:
            request_path.parent.mkdir(parents=True, exist_ok=True)
            response_path.unlink(missing_ok=True)
            _MobilePreviewRequestHandler._write_json(
                request_path,
                {"nonce": nonce, "url": url, "title": gloss},
            )
        except OSError as error:
            messagebox.showerror(
                "No se pudo abrir la simulación integrada",
                str(error),
                parent=self.root,
            )
            return False
        self.embedded_preview_nonce = nonce
        self.root.withdraw()
        self.root.after(250, self._poll_embedded_preview_closed)
        return True

    def _poll_embedded_preview_closed(self) -> None:
        """Restore the desktop workspace when the embedded preview is closed."""

        nonce = self.embedded_preview_nonce
        if nonce is None:
            return
        response_value = os.environ.get("VOZUAL_EMBEDDED_PREVIEW_RESPONSE", "")
        response_path = Path(response_value) if response_value else None
        if response_path is not None:
            try:
                payload = json.loads(response_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = {}
            if payload.get("nonce") == nonce and payload.get("closed") is True:
                self.embedded_preview_nonce = None
                response_path.unlink(missing_ok=True)
                self.root.deiconify()
                self.root.lift()
                self.root.focus_force()
                return
        self.root.after(250, self._poll_embedded_preview_closed)

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
        selected_video = Path(self.video_path.get()).expanduser()
        actor_video_path = (
            selected_video.resolve() if selected_video.is_file() else None
        )
        try:
            self._save_recipe(notify=False)
            # A newly authored motion can be previewed before it has a catalog
            # row. Register its saved linguistic metadata now so the embedded
            # approval control can review it without pretending the motion is
            # already owner-approved or published to Firebase.
            self._register_published_linguistic_entry(gloss, self.recipe_path)
            signature = self._mobile_preview_signature(
                self.recipe_path,
                self.landmark_path,
                actor_video_path=actor_video_path,
            )
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
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
            self._show_embedded_mobile_preview(self.mobile_preview_url, gloss)
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
            args=(
                gloss,
                self.recipe_path,
                self.landmark_path,
                signature,
                actor_video_path,
            ),
            daemon=True,
        ).start()

    def _build_mobile_preview_in_background(
        self,
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
        signature: tuple[tuple[str, int, int], ...],
        actor_video_path: Path | None,
    ) -> None:
        def mark_saved_simulation_as_reviewed(changed_gloss: str) -> None:
            self.root.after(
                0,
                lambda: self._accept_saved_mobile_preview_change(
                    changed_gloss,
                    recipe_path,
                    landmark_path,
                    actor_video_path,
                ),
            )

        try:
            server, url, preview_root = self._build_mobile_runtime_preview(
                gloss,
                recipe_path,
                landmark_path,
                actor_video_path,
                mark_saved_simulation_as_reviewed,
            )
        except (
            OSError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            subprocess.CalledProcessError,
        ) as error:
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

    def _accept_saved_mobile_preview_change(
        self,
        gloss: str,
        recipe_path: Path,
        landmark_path: Path,
        actor_video_path: Path | None,
    ) -> None:
        """Keep a saved change valid when it was reviewed in the open simulation."""

        if self.mobile_preview_gloss != gloss:
            return
        signature = self._mobile_preview_signature(
            recipe_path,
            landmark_path,
            actor_video_path=actor_video_path,
        )
        self.mobile_preview_signatures[gloss] = signature
        self._persist_mobile_preview_review(gloss, signature)
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="ÚLTIMOS CAMBIOS REVISADOS ✓"
            )
        self._refresh_owner_approval_control(gloss)
        approved = owner_approval_status(find_entry(gloss)) == "approved"
        published_glosses = self._published_mobile_glosses()
        self.mobile_library_status.set(
            self._mobile_library_summary(
                published_glosses, set(self.created_sign_paths)
            )
        )
        self.step_status.set(
            (
                f"PASO 1 COMPLETO ✓ {gloss} ESTÁ APROBADA."
                if approved
                else f"REVISIÓN TERMINADA ✓ FALTA APROBAR {gloss}."
            )
        )
        self.status.set(
            (
                f"{gloss} quedó guardada y revisada. Ahora pulsa 2. ENVIAR "
                f"{gloss} A FIREBASE."
                if approved
                else f"{gloss} quedó guardada y revisada. Marca el paso 1 para aprobarla."
            )
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
        self._persist_mobile_preview_review(gloss, signature)
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
        if not self._show_embedded_mobile_preview(url, gloss):
            self._stop_mobile_preview_server()

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
        *,
        request_confirmation: bool = True,
    ) -> bool:
        """Fail closed when any sign changed after its latest approved review."""

        missing: list[str] = []
        for gloss in glosses:
            paths = self.created_sign_paths.get(gloss)
            if paths is None:
                missing.append(gloss)
                continue
            signature = self._mobile_preview_signature(paths[0], paths[1])
            if self.mobile_preview_signatures.get(gloss) == signature:
                continue
            entry = find_entry(gloss)
            persisted_fingerprint = owner_review_fingerprint(entry)
            current_fingerprint = self._mobile_preview_fingerprint(signature)
            if owner_approval_status(entry) == "approved" and (
                persisted_fingerprint is None
                or persisted_fingerprint == current_fingerprint
            ):
                # Existing approvals predate durable fingerprints. Trust that
                # explicit review once, migrate it, and validate all future
                # changes against the exact reviewed content.
                self.mobile_preview_signatures[gloss] = signature
                self._persist_mobile_preview_review(gloss, signature)
                continue
            missing.append(gloss)
        if missing:
            first = missing[0]
            mobile_preview_button = getattr(self, "mobile_preview_button", None)
            if mobile_preview_button is not None:
                mobile_preview_button.configure(
                    state="normal",
                    text="SIMULAR ESTA SEÑA EN LA APP MÓVIL",
                )
            if hasattr(self, "step_status"):
                self.step_status.set(
                    f"CAMBIOS GUARDADOS, PERO FALTA REVISAR {first}."
                )
            if hasattr(self, "status"):
                self.status.set(
                    "Todavía no se enviaron a Firebase. Abre la simulación y, al "
                    "regresar, pulsa el botón 2."
                )
            messagebox.showwarning(
                "Los cambios están guardados, pero aún no enviados",
                f"{first} está GUARDADA en este Mac, pero todavía NO está enviada a Firebase.\n\n"
                f"Haz esto:\n"
                f"1. Cierra este aviso.\n"
                "2. Baja hasta REVISAR LA SEÑA CARGADA.\n"
                "3. Pulsa SIMULAR ESTA SEÑA EN LA APP MÓVIL.\n"
                "4. Comprueba PUNTOS y PERSONAJE.\n"
                "5. Regresa, marca el paso 1 y pulsa "
                f"2. ENVIAR {first} A FIREBASE.\n\n"
                "Guardar no publica ni actualiza el celular.",
                parent=self.root,
            )
            return False
        if not request_confirmation:
            return True
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
        """Prepare pending signs while leaving owner approval explicit."""
        self._refresh_created_signs()
        published = self._published_mobile_glosses()
        pending = sorted(set(self.created_sign_paths) - published)
        if not pending:
            messagebox.showinfo(
                "Biblioteca sincronizada",
                "Todas las señas guardadas ya están aprobadas para publicación.",
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
                "Algunas señas no se prepararon",
                f"Se prepararon {len(exported)} señas y fallaron {len(failures)}: "
                f"\n\n{failure_details}",
                parent=self.root,
            )
        if not exported:
            return

        publication_label = "1 seña" if len(exported) == 1 else f"{len(exported)} señas"
        self.step_status.set(
            f"PREPARACIÓN TERMINADA: {publication_label.upper()}. "
            "Revísalas y marca APROBADA POR MÍ una por una."
        )
        self.status.set(
            f"Se prepararon {publication_label}; ninguna aprobación personal cambió."
        )
        messagebox.showinfo(
            "Señas preparadas",
            f"Se prepararon {publication_label}.\n\n"
            "Ahora revisa cada simulación y marca APROBADA POR MÍ. Solo esas señas "
            "se publicarán cuando pulses PUBLICAR CAMBIOS EN FIREBASE.",
            parent=self.root,
        )

    def _publish_selected_sign(self) -> None:
        """Prepare one selected sign without granting owner approval."""
        selected = self._selected_created_gloss()
        if selected is None:
            return
        gloss, recipe_path, landmark_path = selected
        if not self._confirm_mobile_previews(
            [gloss], request_confirmation=False
        ):
            return
        try:
            self._export_mobile_motion(gloss, recipe_path, landmark_path)
            self._register_published_linguistic_entry(gloss, recipe_path)
            write_published_motion_manifest()
        except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            messagebox.showerror("No se pudo preparar", str(error), parent=self.root)
            return
        self._refresh_created_signs()
        self.step_status.set(
            f"SEÑA PREPARADA: {gloss}. Marca APROBADA POR MÍ después de revisarla."
        )
        self.status.set(
            f"{gloss} está preparada, pero no podrá publicarse sin tu aprobación."
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
            f"PALABRAS ACTUALIZADAS: {gloss}."
        )
        self.status.set(f"{gloss} reconocerá: {forms_label}.")
        if gloss not in self._published_mobile_glosses():
            messagebox.showinfo(
                "Palabras guardadas",
                f"{gloss} ahora reconocerá:\n{forms_label}\n\n"
                "La seña sigue POR REVISAR. Cuando la apruebes, estas palabras "
                "se incluirán en los metadatos de su descarga independiente.",
                parent=self.root,
            )
            return
        publish_now = messagebox.askyesno(
            "Palabras actualizadas",
            f"{gloss} ahora reconocerá:\n{forms_label}\n\n"
            "¿Quieres publicar este cambio en Firebase ahora?\n\n"
            "Se actualizará únicamente esta seña independiente; la aplicación móvil no se "
            "reconstruirá.",
            parent=self.root,
        )
        if publish_now:
            self._publish_approved_signs_to_firebase(gloss)
        else:
            self.status.set(
                f"Palabras de {gloss} guardadas. Publícalas en Firebase cuando quieras."
            )

    def _publish_current_sign_to_firebase(self) -> None:
        """Export and publish only the sign currently being reviewed."""

        target = self._owner_approval_target()
        if target is None:
            messagebox.showinfo(
                "Carga una seña primero",
                "Carga la seña que deseas publicar antes de continuar.",
                parent=self.root,
            )
            return
        gloss, recipe_path, landmark_path = target
        if gloss not in self._published_mobile_glosses():
            messagebox.showwarning(
                "Falta tu aprobación",
                f"Marca {gloss} como APROBADA POR MÍ antes de publicarla.",
                parent=self.root,
            )
            return
        if not self._confirm_mobile_previews(
            [gloss], request_confirmation=False
        ):
            return
        try:
            self._export_mobile_motion(gloss, recipe_path, landmark_path)
            self._register_published_linguistic_entry(gloss, recipe_path)
            write_published_motion_manifest()
        except (
            OSError,
            ValueError,
            json.JSONDecodeError,
            subprocess.CalledProcessError,
        ) as error:
            messagebox.showerror(
                "No se pudo preparar la publicación",
                str(error),
                parent=self.root,
            )
            return
        self._publish_approved_signs_to_firebase(gloss)

    def _publish_approved_signs_to_firebase(
        self, gloss: str | list[str]
    ) -> None:
        """Publish selected new or changed owner-approved signs to Firebase."""

        glosses = [gloss] if isinstance(gloss, str) else list(dict.fromkeys(gloss))
        label = ", ".join(glosses)
        self._start_progress("PUBLICANDO EN FIREBASE… verificando cambios aprobados.")
        self.status.set(
            f"Enviando {label} a Firebase. No cierres VOZUAL Editor."
        )
        threading.Thread(
            target=self._publish_approved_signs_in_background,
            args=(glosses,),
            daemon=True,
        ).start()

    def _publish_approved_signs_in_background(self, gloss: str | list[str]) -> None:
        mobile_directory = REPO_ROOT / "mobile"
        publish_script = mobile_directory / "tools/publish-approved-signs.js"
        glosses = [gloss] if isinstance(gloss, str) else list(dict.fromkeys(gloss))
        label = ", ".join(glosses)
        arguments = [str(self._node_executable()), str(publish_script)]
        for selected_gloss in glosses:
            arguments.extend(["--gloss", selected_gloss])
        try:
            result = subprocess.run(
                arguments,
                cwd=mobile_directory,
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            details = self._mobile_install_failure_details(error)
            self.root.after(
                0,
                lambda: self._finish_firebase_publication_failure(label, details),
            )
            return
        self.root.after(
            0,
            lambda: self._finish_firebase_publication(label, result.stdout),
        )

    def _finish_firebase_publication(self, label: str, output: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        try:
            details = json.loads(output)
            project = str(details.get("project", "Firebase"))
            published = details.get("published", [])
            unchanged = details.get("unchanged", [])
            retired = details.get("retired", [])
            if not isinstance(published, list) or not isinstance(unchanged, list):
                raise ValueError("Invalid publication result")
        except (json.JSONDecodeError, TypeError, ValueError):
            self._finish_firebase_publication_failure(
                label,
                "Firebase terminó sin devolver un resultado verificable.",
            )
            return
        self._refresh_created_signs()
        self._refresh_firebase_suggestion_statuses()
        if published:
            published_labels = [
                f"{item.get('gloss', 'SEÑA')} v{item.get('version', '?')}"
                for item in published
                if isinstance(item, dict)
            ]
            summary = ", ".join(published_labels)
            self.step_status.set(
                f"ENVIADA A FIREBASE ✓  {summary}."
            )
            self.status.set(
                "Terminaste. Vozual móvil detectará esta actualización y permitirá descargarla."
            )
            messagebox.showinfo(
                "Seña enviada correctamente",
                f"Firebase: {project}\n\n"
                f"Enviada y verificada:\n• " + "\n• ".join(published_labels)
                + "\n\nYa terminaste: no necesitas pulsar ningún otro botón."
                + (f"\nRetiradas: {len(retired)}" if retired else "")
                + "\n\nLa app móvil avisará que hay una actualización y solo la descargará si el usuario acepta.",
                parent=self.root,
            )
            return
        self.step_status.set(f"{label.upper()} YA ESTÁ EN FIREBASE ✓")
        self.status.set(
            "No había cambios nuevos por enviar. Ya terminaste."
        )
        messagebox.showinfo(
            "La seña ya estaba actualizada",
            f"{label} ya tiene su última versión en {project}. No necesitas hacer nada más.",
            parent=self.root,
        )

    def _finish_firebase_publication_failure(self, label: str, details: str) -> None:
        self.analysis_progress.stop()
        self.analysis_progress.pack_forget()
        self.step_status.set(f"NO SE PUDIERON PUBLICAR {label.upper()}.")
        self.status.set("Firebase no recibió el cambio. La copia guardada en este Mac no se perdió.")
        self._show_detailed_error(
            title="No se pudieron publicar las señas",
            summary="La publicación y verificación en Firebase no terminó.",
            details=details,
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
                [str(adb), "shell", "am", "force-stop", "com.androsja.vozual"],
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
                    "com.androsja.vozual/.MainActivity",
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
            "También se retirará de Firebase cuando pulses PUBLICAR CAMBIOS EN FIREBASE."
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
        final_duration_seconds = float(self.duration_seconds.get())
        if self.reference_frames:
            final_duration_seconds = (
                self._recipe_output_frame_count(data, len(self.reference_frames))
                / max(1, self.reference_fps)
            )
        self._load_duration_settings(reference, final_duration_seconds)
        self.reference_active_hand = str(data.get("active_hand", "right"))
        self._set_tracking_preview(landmark_path)
        self.anchor.set(str(data.get("contact_anchor", "chin")))
        self.contact_palm.set(str(data.get("palm_at_contact", "camera")))
        self.release_palm.set(str(data.get("palm_at_release", "up")))
        self.forward.set(float(data.get("forward_distance", 0.45)))
        self.return_to_rest.set(bool(data.get("return_to_rest", True)))
        self._load_avatar_finger_states(gloss)
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
            f"✓ {gloss} está cargada. Revísala con SIMULAR APP MÓVIL."
        )
        self._refresh_owner_approval_control(gloss)
        self._set_stage(3)
        messagebox.showinfo(
            "Seña cargada",
            f"{gloss} quedó cargada para editar.\n\n"
            "Ahora puedes abrir Puntos, Esqueleto o SIMULAR APP MÓVIL en la sección Revisar.",
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
            state="normal", text="VISTA 3D INTERNA"
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
        try:
            _recording_duration, avatar_duration = self._duration_values()
        except ValueError as error:
            messagebox.showerror("Duración inválida", str(error), parent=self.root)
            return
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
            args=(video, gloss, output, avatar_duration),
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
        self._load_avatar_finger_states(self.loaded_review_gloss)
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
            state="normal", text="GENERAR VISTA 3D INTERNA"
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
            f"VOZUAL extrajo los landmarks correctamente.\n\n"
            f"Mano detectada: {active_hand}.\n"
            f"Contacto detectado: {contact}.\n\n"
            "La seña está lista para revisar en SIMULAR APP MÓVIL."
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
            recording_duration, avatar_duration = self._duration_values()
        except ValueError as error:
            messagebox.showerror("Duración inválida", str(error), parent=self.root)
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
                video = record_video(0, gloss, recording_duration, output)
                self.video_path.set(str(video))
                self._reset_workflow_after_video()
                decision = self._review_recording(video)
                if decision == "use":
                    self.status.set(
                        f"Grabación elegida: {video.name} ({recording_duration:.1f} s). "
                        f"El avatar durará {avatar_duration:.1f} s. "
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
        try:
            _recording_duration, avatar_duration = self._duration_values()
        except ValueError as error:
            messagebox.showerror("Duración inválida", str(error), parent=self.root)
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
            args=(video, self.gloss.get(), output, avatar_duration),
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
        self._load_avatar_finger_states(self.loaded_review_gloss)
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
            "Siguiente paso: pulsa SIMULAR APP MÓVIL para revisarla en la web."
            f"{tracking_review}",
            parent=self.root,
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.focus_set()

    def _fail_analysis(self, error: str) -> None:
        self._stop_analysis_progress()
        self.step_status.set("EL ANÁLISIS FALLÓ. Corrige el problema e inténtalo nuevamente.")
        messagebox.showerror("No se pudo analizar", error, parent=self.root)
        self.status.set("El análisis no se completó.")

    @staticmethod
    def _default_finger_state_snapshot() -> dict[str, dict[str, str]]:
        return {
            side: {finger: "captured" for finger in FINGER_NAMES}
            for side in ("left", "right")
        }

    def _finger_state_snapshot(self) -> dict[str, dict[str, str]]:
        return {
            "left": {
                finger: FINGER_STATE_TO_PROFILE[self.left_finger_states[finger].get()]
                for finger in FINGER_NAMES
            },
            "right": {
                finger: FINGER_STATE_TO_PROFILE[self.right_finger_states[finger].get()]
                for finger in FINGER_NAMES
            },
        }

    @staticmethod
    def _finger_states_from_profile(
        profile: dict[str, object],
    ) -> dict[str, dict[str, str]]:
        snapshot = SignAuthoringEditor._default_finger_state_snapshot()
        for side, key in (
            ("left", "rigLeftFingerStates"),
            ("right", "rigRightFingerStates"),
        ):
            stored = profile.get(key, {})
            if not isinstance(stored, dict):
                continue
            for finger in FINGER_NAMES:
                state = stored.get(finger)
                if state in PROFILE_TO_FINGER_STATE:
                    snapshot[side][finger] = str(state)
        return snapshot

    def _load_avatar_finger_states(self, gloss: str) -> None:
        try:
            profiles = json.loads(
                AVATAR_PROFILE_OVERRIDES_PATH.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            profiles = {}
        profile = profiles.get(gloss, {}) if isinstance(profiles, dict) else {}
        if isinstance(profile, dict):
            self.left_index_middle_spread.set(float(profile.get("rigLeftIndexMiddleSpread", 0.025)))
            self.loaded_index_middle_spread = self.left_index_middle_spread.get()
        snapshot = self._finger_states_from_profile(
            profile if isinstance(profile, dict) else {}
        )
        for side, variables in (
            ("left", self.left_finger_states),
            ("right", self.right_finger_states),
        ):
            for finger in FINGER_NAMES:
                variables[finger].set(
                    PROFILE_TO_FINGER_STATE[snapshot[side][finger]]
                )
        self.loaded_finger_states = snapshot

    @staticmethod
    def _merge_finger_states_into_profiles(
        profiles: dict[str, object],
        gloss: str,
        current: dict[str, dict[str, str]],
        previous: dict[str, dict[str, str]],
    ) -> tuple[dict[str, object], bool]:
        updated = dict(profiles)
        stored_profile = updated.get(gloss, {})
        profile = dict(stored_profile) if isinstance(stored_profile, dict) else {}
        changed = False
        for side, states_key, shape_key in (
            ("left", "rigLeftFingerStates", "rigLeftHandShape"),
            ("right", "rigRightFingerStates", "rigRightHandShape"),
        ):
            if current[side] == previous[side]:
                continue
            changed = True
            # Once an editor explicitly configures the fingers, that choice
            # replaces any older whole-hand preset for this side.
            profile.pop(shape_key, None)
            authored = {
                finger: state
                for finger, state in current[side].items()
                if state != "captured"
            }
            if authored:
                profile[states_key] = authored
            else:
                profile.pop(states_key, None)
        if changed:
            if profile:
                updated[gloss] = profile
            else:
                updated.pop(gloss, None)
        return updated, changed

    def _save_avatar_finger_states(self, gloss: str) -> bool:
        try:
            profiles = json.loads(
                AVATAR_PROFILE_OVERRIDES_PATH.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            profiles = {}
        if not isinstance(profiles, dict):
            profiles = {}
        current = self._finger_state_snapshot()
        updated, changed = self._merge_finger_states_into_profiles(
            profiles,
            gloss,
            current,
            self.loaded_finger_states,
        )
        spread = round(float(self.left_index_middle_spread.get()), 3)
        if abs(spread - self.loaded_index_middle_spread) > 0.0001:
            profile = dict(updated.get(gloss, {})) if isinstance(updated.get(gloss, {}), dict) else {}
            profile["rigLeftIndexMiddleSpread"] = spread
            updated[gloss] = profile
            changed = True
        if changed:
            AVATAR_PROFILE_OVERRIDES_PATH.write_text(
                json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            self.loaded_finger_states = current
            self.loaded_index_middle_spread = spread
        return changed

    @staticmethod
    def _recipe_output_frame_count(
        data: dict[str, object],
        raw_frame_count: int,
    ) -> int:
        """Return the exported frame count after applying a recipe source trim."""

        if raw_frame_count <= 0:
            return 0
        source_start = int(data.get("source_start_frame", 0))
        raw_source_end = data.get("source_end_frame")
        source_end = (
            raw_frame_count - 1
            if raw_source_end is None
            else int(raw_source_end)
        )
        return max(0, source_end - source_start + 1)

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
        captured_duration = (
            self._recipe_output_frame_count(data, len(self.reference_frames))
            / max(1, self.reference_fps)
            if self.reference_frames
            else float(self.duration_seconds.get())
        )
        duration = max(0.05, captured_duration)
        stored = data.get("motion_keyframes", [])
        if isinstance(stored, list) and stored:
            self.motion_keyframes = self._fit_motion_keyframes_to_duration(
                stored,
                duration,
            )
        else:
            self.motion_keyframes = self._default_motion_keyframes(data, duration)
        self._refresh_motion_tree()

    @staticmethod
    def _default_motion_keyframes(
        data: dict[str, object],
        duration: float,
    ) -> list[dict[str, object]]:
        """Build neutral timeline endpoints from the captured duration."""

        return [
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

    @staticmethod
    def _fit_motion_keyframes_to_duration(
        stored: list[object],
        duration: float,
    ) -> list[dict[str, object]]:
        """Scale legacy timeline points into the actual captured sequence."""

        points = [dict(point) for point in stored if isinstance(point, dict)]
        times = [float(point.get("time_seconds", 0.0)) for point in points]
        latest_time = max(times, default=0.0)
        scale = duration / latest_time if latest_time > duration else 1.0
        for point, time_seconds in zip(points, times):
            point["time_seconds"] = max(
                0.0,
                min(duration, time_seconds * scale),
            )
        return points

    def _save_recipe(self, notify: bool = True) -> None:
        if self.recipe_path is None:
            messagebox.showerror("Falta análisis", "Primero analiza un video.")
            return
        data = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        landmark_data = (
            json.loads(self.landmark_path.read_text(encoding="utf-8"))
            if self.landmark_path
            else {}
        )
        frame_count = len(landmark_data.get("rawFrames", []))
        output_fps = max(1, int(data.get("output_fps", 30)))
        captured_duration = (
            self._recipe_output_frame_count(data, frame_count) / output_fps
        )
        updated_data = {
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
        scalar_motion_fields = (
            "contact_anchor",
            "palm_at_contact",
            "palm_at_release",
            "forward_distance",
            "return_to_rest",
            "entry_height_cm",
            "entry_lateral_cm",
            "entry_depth_cm",
            "exit_height_cm",
            "exit_lateral_cm",
            "exit_depth_cm",
        )
        stored_keyframes = data.get("motion_keyframes", [])
        original_keyframes = (
            [dict(point) for point in stored_keyframes if isinstance(point, dict)]
            if isinstance(stored_keyframes, list) and stored_keyframes
            else self._default_motion_keyframes(data, captured_duration)
        )
        motion_changed = (
            any(
                data.get(field) != updated_data.get(field)
                for field in scalar_motion_fields
            )
            or original_keyframes != self.motion_keyframes
        )
        approval_invalidated = False
        recipe = SignRecipe(**updated_data)
        recipe.validate(frame_count)
        recipe.save(self.recipe_path)
        gloss = self.gloss.get().strip().upper()
        finger_states_changed = self._save_avatar_finger_states(gloss)
        motion_changed = motion_changed or finger_states_changed
        if (
            motion_changed
            and owner_approval_status(find_entry(gloss)) == "approved"
        ):
            set_owner_approval(gloss, False)
            write_published_motion_manifest()
            self.mobile_preview_signatures.pop(gloss, None)
            self._refresh_created_signs()
            self._refresh_owner_approval_control(gloss)
            approval_invalidated = True
        self.avatar_preview_path = None
        self.preview_button.configure(
            state="normal", text="GENERAR VISTA 3D INTERNA"
        )
        if self.mobile_preview_button is not None:
            self.mobile_preview_button.configure(
                state="normal", text="SIMULAR ESTA SEÑA EN LA APP MÓVIL"
            )
        self.step_status.set(
            "AJUSTES GUARDADOS ✓  Ahora revisa la simulación móvil antes de aprobar."
        )
        self._set_stage(3)
        self.status.set(
            f"Receta guardada: {self.recipe_path}. "
            + (
                "La aprobación anterior se retiró porque cambió el movimiento."
                if approval_invalidated
                else ""
            )
        )
        if notify:
            messagebox.showinfo(
                "Correcciones guardadas",
                "Los ajustes quedaron guardados.\n\n"
                "Pulsa SIMULAR APP MÓVIL para revisar el resultado real.",
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
        self.preview_button.configure(state="normal", text="GENERAR VISTA 3D INTERNA")
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
