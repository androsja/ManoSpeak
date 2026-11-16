"""Derived semantic summaries for authored and legacy motion JSON.

The summary is deliberately additive: it is not read by the mobile renderer and
does not replace the existing ``frames``/``avatarProfile`` contract.  Values are
derived from landmarks when possible and are marked unavailable otherwise.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence


def _point(value: Sequence[float]) -> list[float]:
    return [float(value[0]), float(value[1]), float(value[2])]


def _sub(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [float(a[i]) - float(b[i]) for i in range(3)]


def _length(value: Sequence[float]) -> float:
    return math.sqrt(sum(float(component) ** 2 for component in value))


def _normal(a: Sequence[float], b: Sequence[float], c: Sequence[float]) -> list[float] | None:
    """Return a unit palm normal from wrist, index MCP and pinky MCP."""
    first, second = _sub(b, a), _sub(c, a)
    cross = [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    ]
    norm = _length(cross)
    return [component / norm for component in cross] if norm > 1e-9 else None


def _facing(normal: Sequence[float] | None) -> str | None:
    if normal is None:
        return None
    axis = max(range(3), key=lambda index: abs(float(normal[index])))
    labels = (("left", "right"), ("down", "up"), ("back", "front"))
    return labels[axis][1 if float(normal[axis]) >= 0 else 0]


def _legacy_hand(frames: Sequence[Mapping[str, Any]], start: int) -> dict[str, Any]:
    wrists = [_point(frame["bodyHands"][start]) for frame in frames]
    orientations: list[dict[str, Any]] = []
    for frame in frames:
        landmarks = frame["bodyHands"]
        palm_normal = _normal(landmarks[start], landmarks[start + 5], landmarks[start + 17])
        orientations.append({"normal": palm_normal, "facing": _facing(palm_normal)})
    displacement = _sub(wrists[-1], wrists[0])
    return {
        "wrist": {"start": wrists[0], "end": wrists[-1]},
        "trajectory": {
            "fromFrame": 0,
            "toFrame": len(frames) - 1,
            "displacement": displacement,
            "pathLength": sum(_length(_sub(current, previous)) for previous, current in zip(wrists, wrists[1:])),
        },
        "palmOrientation": {"start": orientations[0], "end": orientations[-1]},
    }


def derive_legacy_motion_semantics(document: Mapping[str, Any]) -> dict[str, Any]:
    """Derive a renderer-safe semantic block from a legacy captured motion.

    Legacy ``bodyHands`` stores pose landmarks first (MediaPipe indices 11/13/15
    and 12/14/16 are shoulder/elbow/wrist), followed by 21 landmarks per hand.
    """
    frames = document.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError("motion must contain at least two frames")
    if any(not isinstance(frame, Mapping) or len(frame.get("bodyHands", ())) < 75 for frame in frames):
        raise ValueError("legacy motion frames must contain 75 body/hand landmarks")
    profile = document.get("avatarProfile")
    if not isinstance(profile, Mapping):
        profile = {}
    active = str(profile.get("activeHand", "right")).lower()
    if active not in {"left", "right"}:
        active = "right"
    inactive = "left" if active == "right" else "right"
    pose_indices = {
        "left": {"shoulder": 11, "elbow": 13, "wrist": 15},
        "right": {"shoulder": 12, "elbow": 14, "wrist": 16},
    }
    anchors: dict[str, Any] = {}
    for side, indices in pose_indices.items():
        anchors[side] = {
            name: {"start": _point(frames[0]["bodyHands"][index]), "end": _point(frames[-1]["bodyHands"][index])}
            for name, index in indices.items()
        }
    hand_offsets = {"left": 33, "right": 54}
    return {
        "version": 1,
        "gloss": str(document.get("gloss", "HOLA")).upper(),
        "activeHand": active,
        "inactiveHand": inactive,
        "anchors": anchors,
        "hand": {
            "active": _legacy_hand(frames, hand_offsets[active]),
            "inactive": _legacy_hand(frames, hand_offsets[inactive]),
        },
        "contact": {
            "status": "authored" if "contactAnchor" in profile else "none",
            "anchor": profile.get("contactAnchor"),
            "fromFrame": profile.get("contactStartFrame"),
            "toFrame": profile.get("contactEndFrame"),
        },
        "derivation": "legacy-mediapipe-landmarks",
    }


def with_derived_semantics(document: Mapping[str, Any]) -> dict[str, Any]:
    """Return a shallow JSON-compatible copy with an additive ``semantic`` block."""
    result = dict(document)
    result["semantic"] = derive_legacy_motion_semantics(document)
    return result

