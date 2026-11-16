"""Dependency-free structural and semantic validation for Vozual motion v2.

The authored contract uses readable local Euler angles for finger bones. Palm
orientation is authored directly as an xyzw quaternion. The compiler boundary
can use :func:`euler_xyz_intrinsic_to_quaternion` to produce normalized local
quaternions deterministically.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Mapping, Sequence


FINGER_BONES: tuple[str, ...] = (
    "thumb.01",
    "thumb.02",
    "thumb.03",
    "f_index.01",
    "f_index.02",
    "f_index.03",
    "f_middle.01",
    "f_middle.02",
    "f_middle.03",
    "f_ring.01",
    "f_ring.02",
    "f_ring.03",
    "f_pinky.01",
    "f_pinky.02",
    "f_pinky.03",
)
NON_MANUAL_FIELDS: tuple[str, ...] = ("head", "gaze", "eyelids", "brows", "mouth")
QUATERNION_TOLERANCE = 1e-6
MOTION_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")


class MotionValidationError(ValueError):
    """A validation error with a machine-readable path and stable code."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = code
        self.path = path
        self.message = message
        super().__init__(f"{path}: {message}")

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


def _required(value: Mapping[str, Any], key: str, path: str) -> Any:
    if key not in value:
        raise MotionValidationError("MOTION.REQUIRED", f"{path}.{key}", "required field")
    return value[key]


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MotionValidationError("MOTION.TYPE", path, "object required")
    return value


def _no_extra_keys(value: Mapping[str, Any], allowed: set[str], path: str) -> None:
    extra = set(value) - allowed
    if extra:
        names = ",".join(sorted(str(key) for key in extra))
        raise MotionValidationError("MOTION.ADDITIONAL_PROPERTY", path, f"unexpected fields: {names}")


def _string(value: Any, path: str, *, non_empty: bool = False) -> str:
    if not isinstance(value, str) or (non_empty and not value):
        qualifier = "non-empty " if non_empty else ""
        raise MotionValidationError("MOTION.STRING", path, f"{qualifier}string required")
    return value


def _integer(value: Any, path: str, *, minimum: int | None = None) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not float(value).is_integer()
    ):
        raise MotionValidationError("MOTION.INTEGER", path, "integer required")
    integer = int(value)
    if minimum is not None and integer < minimum:
        raise MotionValidationError("MOTION.RANGE", path, f"must be >= {minimum}")
    return integer


def _enum(value: Any, path: str, allowed: set[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        choices = ",".join(sorted(allowed))
        raise MotionValidationError("MOTION.ENUM", path, f"must be one of: {choices}")
    return value


def _finite_number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise MotionValidationError("MOTION.NUMBER", path, "finite number required")
    return float(value)


def _vector(value: Any, path: str, length: int) -> tuple[float, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != length:
        raise MotionValidationError("MOTION.VECTOR", path, f"exactly {length} numbers required")
    return tuple(_finite_number(component, f"{path}[{index}]") for index, component in enumerate(value))


def _bounded(value: Any, path: str, minimum: float, maximum: float) -> None:
    number = _finite_number(value, path)
    if number < minimum or number > maximum:
        raise MotionValidationError("MOTION.RANGE", path, f"must be between {minimum} and {maximum}")


def _quaternion(value: Any, path: str) -> tuple[float, float, float, float]:
    quaternion = _vector(value, path, 4)
    norm = math.sqrt(sum(component * component for component in quaternion))
    if not math.isfinite(norm) or norm == 0.0 or abs(norm - 1.0) > QUATERNION_TOLERANCE:
        raise MotionValidationError(
            "MOTION.QUATERNION_NORM",
            path,
            f"xyzw quaternion must be finite and unit length; norm={norm:.9f}",
        )
    return (quaternion[0], quaternion[1], quaternion[2], quaternion[3])


def _require_vec3(value: Mapping[str, Any], key: str, path: str) -> None:
    _vector(_required(value, key, path), f"{path}.{key}", 3)


def _validate_hand(hand: Any, path: str) -> None:
    mapping = _mapping(hand, path)
    _no_extra_keys(mapping, {"wristPositionM", "palmOrientationQuat", "bones"}, path)
    _require_vec3(mapping, "wristPositionM", path)
    _quaternion(_required(mapping, "palmOrientationQuat", path), f"{path}.palmOrientationQuat")
    bones = _mapping(_required(mapping, "bones", path), f"{path}.bones")
    actual = set(bones)
    expected = set(FINGER_BONES)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        details = []
        if missing:
            details.append(f"missing={','.join(missing)}")
        if extra:
            details.append(f"extra={','.join(extra)}")
        raise MotionValidationError(
            "MOTION.FINGER_BONES",
            f"{path}.bones",
            "exactly 15 deform bones required (" + "; ".join(details) + ")",
        )
    for bone in FINGER_BONES:
        bone_value = _mapping(bones[bone], f"{path}.bones.{bone}")
        _no_extra_keys(bone_value, {"rotationDeg"}, f"{path}.bones.{bone}")
        _vector(_required(bone_value, "rotationDeg", f"{path}.bones.{bone}"), f"{path}.bones.{bone}.rotationDeg", 3)


def _validate_non_manual(value: Any, path: str) -> None:
    mapping = _mapping(value, path)
    actual = set(mapping)
    expected = set(NON_MANUAL_FIELDS)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        detail = f"missing={','.join(missing)}" if missing else f"extra={','.join(extra)}"
        raise MotionValidationError("MOTION.NON_MANUAL", path, f"complete nonManual declaration required ({detail})")
    head = _mapping(mapping["head"], f"{path}.head")
    _no_extra_keys(head, {"rotationDeg"}, f"{path}.head")
    _require_vec3(head, "rotationDeg", f"{path}.head")
    gaze = _mapping(mapping["gaze"], f"{path}.gaze")
    _no_extra_keys(gaze, {"direction", "vergenceDeg"}, f"{path}.gaze")
    direction = _vector(_required(gaze, "direction", f"{path}.gaze"), f"{path}.gaze.direction", 3)
    if math.sqrt(sum(component * component for component in direction)) == 0.0:
        raise MotionValidationError("MOTION.GAZE_DIRECTION", f"{path}.gaze.direction", "non-zero direction required")
    _bounded(_required(gaze, "vergenceDeg", f"{path}.gaze"), f"{path}.gaze.vergenceDeg", -30.0, 30.0)
    for group, fields in {
        "eyelids": ("leftClosure", "rightClosure", "leftWidening", "rightWidening"),
        "brows": ("leftInnerLift", "rightInnerLift", "leftInnerLower", "rightInnerLower"),
    }.items():
        group_value = _mapping(mapping[group], f"{path}.{group}")
        _no_extra_keys(group_value, set(fields), f"{path}.{group}")
        for field in fields:
            _bounded(_required(group_value, field, f"{path}.{group}"), f"{path}.{group}.{field}", 0.0, 1.0)
    mouth = _mapping(mapping["mouth"], f"{path}.mouth")
    _no_extra_keys(
        mouth,
        {"opening", "pucker", "width", "leftCorner", "rightCorner"},
        f"{path}.mouth",
    )
    for field in ("opening", "pucker", "width"):
        _bounded(_required(mouth, field, f"{path}.mouth"), f"{path}.mouth.{field}", 0.0, 1.0)
    for field in ("leftCorner", "rightCorner"):
        _bounded(_required(mouth, field, f"{path}.mouth"), f"{path}.mouth.{field}", -1.0, 1.0)


def validate_motion(document: Mapping[str, Any]) -> None:
    """Validate one motion document, raising :class:`MotionValidationError`."""

    root = _mapping(document, "$")
    root_fields = {
        "schema", "schemaVersion", "kind", "id", "revision", "units", "coordinateSystem",
        "dominantHand", "capture", "recipe", "presentation", "compiled", "provenance",
        "linguisticReview", "compatibility",
    }
    _no_extra_keys(root, root_fields, "$")
    for key in root_fields:
        _required(root, key, "$")
    if root["schema"] != "vozual.motion-schema":
        raise MotionValidationError("MOTION.SCHEMA", "$.schema", "vozual.motion-schema required")
    if root["schemaVersion"] != 2:
        raise MotionValidationError("MOTION.SCHEMA_VERSION", "$.schemaVersion", "motion-schema-v2 required")

    if root["kind"] != "authored-motion":
        raise MotionValidationError("MOTION.KIND", "$.kind", "authored-motion required")
    motion_id = _string(root["id"], "$.id", non_empty=True)
    if MOTION_ID_PATTERN.fullmatch(motion_id) is None:
        raise MotionValidationError("MOTION.ID", "$.id", "invalid motion identifier")
    _integer(root["revision"], "$.revision", minimum=1)

    units = _mapping(root["units"], "$.units")
    expected_units = {"length": "m", "angle": "deg", "time": "ms"}
    _no_extra_keys(units, set(expected_units), "$.units")
    for key, expected in expected_units.items():
        if _required(units, key, "$.units") != expected:
            raise MotionValidationError("MOTION.UNITS", f"$.units.{key}", f"{expected} required")

    coordinate_system = _mapping(root["coordinateSystem"], "$.coordinateSystem")
    expected_coordinates = {
        "name": "vozual-avatar-local",
        "handedness": "right",
        "up": "+Y",
        "forward": "+Z",
        "right": "+X",
        "origin": "pelvis_center",
    }
    _no_extra_keys(coordinate_system, set(expected_coordinates), "$.coordinateSystem")
    for key, expected in expected_coordinates.items():
        if _required(coordinate_system, key, "$.coordinateSystem") != expected:
            raise MotionValidationError(
                "MOTION.COORDINATE_SYSTEM",
                f"$.coordinateSystem.{key}",
                f"{expected} required",
            )

    _enum(root["dominantHand"], "$.dominantHand", {"left", "right", "ambidextrous"})
    for field in ("capture", "presentation", "provenance", "compatibility"):
        _mapping(root[field], f"$.{field}")

    recipe = _mapping(root["recipe"], "$.recipe")
    recipe_fields = {"status", "intent", "timeline", "contacts", "trajectories", "transitions"}
    _no_extra_keys(recipe, recipe_fields, "$.recipe")
    for key in recipe_fields:
        _required(recipe, key, "$.recipe")
    status = _enum(recipe["status"], "$.recipe.status", {"draft", "approved", "published"})
    intent = _mapping(recipe["intent"], "$.recipe.intent")
    for key in ("id", "meaning", "glossSequence", "regionalVariant"):
        _required(intent, key, "$.recipe.intent")
    for key in ("contacts", "trajectories", "transitions"):
        if not isinstance(recipe[key], list):
            raise MotionValidationError("MOTION.TYPE", f"$.recipe.{key}", "array required")

    timeline = _mapping(_required(recipe, "timeline", "$.recipe"), "$.recipe.timeline")
    timeline_fields = {"durationMs", "nominalFps", "keyframes"}
    _no_extra_keys(timeline, timeline_fields, "$.recipe.timeline")
    for key in timeline_fields:
        _required(timeline, key, "$.recipe.timeline")
    duration = _integer(timeline["durationMs"], "$.recipe.timeline.durationMs", minimum=1)
    nominal_fps = _finite_number(timeline["nominalFps"], "$.recipe.timeline.nominalFps")
    if nominal_fps <= 0:
        raise MotionValidationError("MOTION.RANGE", "$.recipe.timeline.nominalFps", "must be positive")
    keyframes = _required(timeline, "keyframes", "$.recipe.timeline")
    if not isinstance(keyframes, list) or len(keyframes) < 2:
        raise MotionValidationError("MOTION.KEYFRAMES", "$.recipe.timeline.keyframes", "at least two keyframes required")
    previous = -1.0
    for index, keyframe_value in enumerate(keyframes):
        path = f"$.recipe.timeline.keyframes[{index}]"
        keyframe = _mapping(keyframe_value, path)
        keyframe_fields = {"id", "timeMs", "body", "hands", "nonManual", "curve"}
        _no_extra_keys(keyframe, keyframe_fields, path)
        for key in keyframe_fields:
            _required(keyframe, key, path)
        _string(keyframe["id"], f"{path}.id", non_empty=True)
        time_ms = _integer(keyframe["timeMs"], f"{path}.timeMs", minimum=0)
        if time_ms <= previous:
            raise MotionValidationError("MOTION.TIME_ORDER", f"{path}.timeMs", "keyframe times must be strictly increasing")
        previous = time_ms
        if time_ms > duration:
            raise MotionValidationError("MOTION.TIME_DURATION", f"{path}.timeMs", "must be <= durationMs")
        body = _mapping(_required(keyframe, "body", path), f"{path}.body")
        _no_extra_keys(body, {"torsoRotationDeg", "left", "right"}, f"{path}.body")
        _require_vec3(body, "torsoRotationDeg", f"{path}.body")
        for side in ("left", "right"):
            side_body = _mapping(_required(body, side, f"{path}.body"), f"{path}.body.{side}")
            _no_extra_keys(
                side_body,
                {"shoulderPositionM", "elbowPositionM"},
                f"{path}.body.{side}",
            )
            _require_vec3(side_body, "shoulderPositionM", f"{path}.body.{side}")
            _require_vec3(side_body, "elbowPositionM", f"{path}.body.{side}")
        hands = _mapping(_required(keyframe, "hands", path), f"{path}.hands")
        _no_extra_keys(hands, {"left", "right"}, f"{path}.hands")
        for side in ("left", "right"):
            _validate_hand(_required(hands, side, f"{path}.hands"), f"{path}.hands.{side}")
        _validate_non_manual(_required(keyframe, "nonManual", path), f"{path}.nonManual")
        _enum(keyframe["curve"], f"{path}.curve", {"hold", "linear", "smoothstep"})
    if previous > duration:
        raise MotionValidationError("MOTION.TIME_DURATION", "$.recipe.timeline.keyframes[-1].timeMs", "must be <= durationMs")

    if status == "published":
        review = _mapping(root["linguisticReview"], "$.linguisticReview")
        compiled = _mapping(root["compiled"], "$.compiled")
        if review.get("status") != "approved":
            raise MotionValidationError("MOTION.PUBLICATION_REVIEW", "$.linguisticReview.status", "published motion requires approved review")
        if compiled.get("status") != "compiled":
            raise MotionValidationError("MOTION.PUBLICATION_COMPILED", "$.compiled.status", "published motion requires compiled asset")

    compiled = _mapping(root["compiled"], "$.compiled")
    _no_extra_keys(compiled, {"status", "format", "formatVersion"}, "$.compiled")
    _enum(_required(compiled, "status", "$.compiled"), "$.compiled.status", {"not_compiled", "compiled"})
    if "format" in compiled and compiled["format"] != "VZMV":
        raise MotionValidationError("MOTION.COMPILED_FORMAT", "$.compiled.format", "VZMV required")
    if "formatVersion" in compiled and compiled["formatVersion"] != 2:
        raise MotionValidationError("MOTION.COMPILED_FORMAT", "$.compiled.formatVersion", "2 required")

    review = _mapping(root["linguisticReview"], "$.linguisticReview")
    review_fields = {"status", "language", "reviewerId", "reviewedAt"}
    _no_extra_keys(review, review_fields, "$.linguisticReview")
    for key in review_fields:
        _required(review, key, "$.linguisticReview")
    _enum(review["status"], "$.linguisticReview.status", {"not_applicable", "pending", "approved", "rejected"})
    if review["language"] != "lsc-CO":
        raise MotionValidationError("MOTION.REVIEW_LANGUAGE", "$.linguisticReview.language", "lsc-CO required")
    for key in ("reviewerId", "reviewedAt"):
        if review[key] is not None:
            _string(review[key], f"$.linguisticReview.{key}")


def euler_xyz_intrinsic_to_quaternion(rotation_deg: Sequence[float]) -> tuple[float, float, float, float]:
    """Convert readable local intrinsic XYZ Euler degrees to normalized xyzw."""

    x, y, z = (math.radians(value) for value in _vector(rotation_deg, "rotationDeg", 3))
    half_x, half_y, half_z = x / 2.0, y / 2.0, z / 2.0
    qx = (math.sin(half_x), 0.0, 0.0, math.cos(half_x))
    qy = (0.0, math.sin(half_y), 0.0, math.cos(half_y))
    qz = (0.0, 0.0, math.sin(half_z), math.cos(half_z))

    def multiply(first: tuple[float, ...], second: tuple[float, ...]) -> tuple[float, float, float, float]:
        ax, ay, az, aw = first
        bx, by, bz, bw = second
        return (
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        )

    raw = multiply(qx, multiply(qy, qz))
    norm = math.sqrt(sum(component * component for component in raw))
    if norm == 0.0 or not math.isfinite(norm):
        raise MotionValidationError("MOTION.EULER_QUATERNION", "rotationDeg", "cannot normalize quaternion")
    return tuple(component / norm for component in raw)  # type: ignore[return-value]


def canonical_json(document: Mapping[str, Any]) -> str:
    """Return deterministic JSON suitable for hashing and golden fixtures."""

    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_sha256(document: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()
