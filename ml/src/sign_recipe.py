"""Reusable sign-animation recipes for the ManoSpeak avatar authoring flow."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import math
from pathlib import Path
from typing import Literal

HandSide = Literal["left", "right"]
PalmOrientation = Literal["camera", "up", "down", "in", "out"]
BodyAnchor = Literal["none", "chin", "mouth", "forehead", "cheek", "chest"]


@dataclass(frozen=True)
class SignRecipe:
    version: int
    gloss: str
    landmark_source: str
    active_hand: HandSide
    contact_anchor: BodyAnchor
    contact_frame: int
    release_frame: int
    palm_at_contact: PalmOrientation
    palm_at_release: PalmOrientation
    forward_distance: float
    return_to_rest: bool
    output_fps: int
    contact_start_frame: int | None = None
    contact_end_frame: int | None = None
    entry_height_cm: float = 0.0
    entry_lateral_cm: float = 0.0
    entry_depth_cm: float = 0.0
    exit_height_cm: float = 0.0
    exit_lateral_cm: float = 0.0
    exit_depth_cm: float = 0.0
    motion_keyframes: list[dict[str, object]] = field(default_factory=list)

    def validate(self, frame_count: int) -> None:
        if self.version != 1:
            raise ValueError("Only sign recipe version 1 is supported.")
        if not self.gloss.strip():
            raise ValueError("The gloss cannot be empty.")
        if frame_count < 2:
            raise ValueError("At least two landmark frames are required.")
        if not 0 <= self.contact_frame < frame_count:
            raise ValueError("The contact frame is outside the captured sequence.")
        if not self.contact_frame <= self.release_frame < frame_count:
            raise ValueError("The release frame must follow the contact frame.")
        contact_start = (
            self.contact_frame
            if self.contact_start_frame is None
            else self.contact_start_frame
        )
        contact_end = (
            self.contact_frame
            if self.contact_end_frame is None
            else self.contact_end_frame
        )
        if not 0 <= contact_start <= self.contact_frame <= contact_end < frame_count:
            raise ValueError("The contact window must contain the contact frame.")
        if not 0.0 <= self.forward_distance <= 1.0:
            raise ValueError("Forward distance must be between 0 and 1.")
        if not 1 <= self.output_fps <= 60:
            raise ValueError("Output FPS must be between 1 and 60.")
        adjustments = (
            self.entry_height_cm,
            self.entry_lateral_cm,
            self.entry_depth_cm,
            self.exit_height_cm,
            self.exit_lateral_cm,
            self.exit_depth_cm,
        )
        if any(not math.isfinite(value) or abs(value) > 30.0 for value in adjustments):
            raise ValueError("Motion adjustments must be between -30 and 30 cm.")
        # A captured sequence with N samples at FPS represents N / FPS seconds
        # in the authoring timeline.  In particular, a 30-frame 30-fps take
        # must allow its closing keyframe at 1.0 s.
        duration_seconds = frame_count / self.output_fps
        seen_times: set[float] = set()
        for keyframe in self.motion_keyframes:
            kind = str(keyframe.get("kind", "point"))
            if kind not in {"entry", "point", "exit"}:
                raise ValueError("Motion point kind must be entry, point or exit.")
            try:
                time_seconds = float(keyframe["time_seconds"])
                values = (
                    float(keyframe.get("height_cm", 0.0)),
                    float(keyframe.get("lateral_cm", 0.0)),
                    float(keyframe.get("depth_cm", 0.0)),
                )
                facial_values = (
                    float(keyframe.get("jaw_open", 0.0)),
                    float(keyframe.get("eye_wide", 0.0)),
                    float(keyframe.get("brow_raise", 0.0)),
                )
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError("Motion points require numeric time and offsets.") from error
            if not math.isfinite(time_seconds) or not 0.0 <= time_seconds <= duration_seconds + 1e-6:
                raise ValueError("Motion point time is outside the captured sequence.")
            rounded_time = round(time_seconds, 4)
            if rounded_time in seen_times:
                raise ValueError("Motion points cannot share the same time.")
            seen_times.add(rounded_time)
            if any(not math.isfinite(value) or abs(value) > 30.0 for value in values):
                raise ValueError("Motion point offsets must be between -30 and 30 cm.")
            if any(not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in facial_values):
                raise ValueError("Facial motion values must be between 0 and 1.")

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


def load_recipe(path: Path, frame_count: int) -> SignRecipe:
    data = json.loads(path.read_text(encoding="utf-8"))
    recipe = SignRecipe(**data)
    recipe.validate(frame_count)
    return recipe
