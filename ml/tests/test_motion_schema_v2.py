"""Tests for the dependency-free motion-schema-v2 MVP."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from src.motion_schema_v2 import (
    FINGER_BONES,
    MotionValidationError,
    canonical_sha256,
    euler_xyz_intrinsic_to_quaternion,
    validate_motion,
)


FIXTURES = Path(__file__).parents[2] / "schemas" / "fixtures" / "motion-v2"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_valid_synthetic_fixture_is_structurally_and_semantically_valid() -> None:
    validate_motion(load_fixture("valid-synthetic.json"))


def test_formal_schema_is_parseable_and_declares_required_boundary() -> None:
    schema_path = FIXTURES.parents[1] / "motion-schema-v2.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert schema["$schema"].endswith("draft/2020-12/schema")
    assert schema["properties"]["schemaVersion"]["const"] == 2
    assert set(("capture", "recipe", "presentation", "compiled")).issubset(schema["required"])
    assert schema["$defs"]["keyframe"]["properties"]["body"] == {"$ref": "#/$defs/body"}
    assert schema["$defs"]["bodySide"]["properties"]["shoulderPositionM"] == {
        "$ref": "#/$defs/vec3"
    }
    assert schema["$defs"]["nonManual"]["properties"]["gaze"] == {
        "$ref": "#/$defs/gaze"
    }
    assert schema["$defs"]["mouth"]["properties"]["leftCorner"]["minimum"] == -1


@pytest.mark.parametrize(
    ("fixture", "expected_path"),
    [
        (
            "invalid-missing-palm-orientation.json",
            "$.recipe.timeline.keyframes[0].hands.right.palmOrientationQuat",
        ),
        (
            "invalid-missing-finger-bone.json",
            "$.recipe.timeline.keyframes[1].hands.left.bones",
        ),
        (
            "invalid-missing-nonmanual.json",
            "$.recipe.timeline.keyframes[1].nonManual",
        ),
        ("invalid-no-timeline.json", "$.recipe.timeline"),
    ],
)
def test_invalid_fixtures_fail_at_expected_path(fixture: str, expected_path: str) -> None:
    with pytest.raises(MotionValidationError) as raised:
        validate_motion(load_fixture(fixture))
    assert raised.value.path == expected_path


def test_valid_fixture_has_exactly_fifteen_deform_bones_per_hand() -> None:
    document = load_fixture("valid-synthetic.json")
    for keyframe in document["recipe"]["timeline"]["keyframes"]:
        for hand in keyframe["hands"].values():
            assert tuple(hand["bones"]) == FINGER_BONES


def test_time_is_strict_and_final_keyframe_fits_duration() -> None:
    document = load_fixture("valid-synthetic.json")
    keyframes = document["recipe"]["timeline"]["keyframes"]

    out_of_duration = copy.deepcopy(document)
    out_of_duration["recipe"]["timeline"]["keyframes"][-1]["timeMs"] = 1001
    with pytest.raises(MotionValidationError, match="must be <= durationMs"):
        validate_motion(out_of_duration)

    non_strict = copy.deepcopy(document)
    non_strict["recipe"]["timeline"]["keyframes"][1]["timeMs"] = keyframes[0]["timeMs"]
    with pytest.raises(MotionValidationError, match="strictly increasing"):
        validate_motion(non_strict)


def test_quaternion_must_be_finite_and_unit_length() -> None:
    document = load_fixture("valid-synthetic.json")
    bad_norm = copy.deepcopy(document)
    bad_norm["recipe"]["timeline"]["keyframes"][0]["hands"]["left"]["palmOrientationQuat"] = [0, 0, 0, 0]
    with pytest.raises(MotionValidationError) as raised:
        validate_motion(bad_norm)
    assert raised.value.path.endswith("palmOrientationQuat")
    assert raised.value.code == "MOTION.QUATERNION_NORM"

    non_finite = copy.deepcopy(document)
    non_finite["recipe"]["timeline"]["keyframes"][0]["hands"]["left"]["palmOrientationQuat"] = [0, 0, 0, float("nan")]
    with pytest.raises(MotionValidationError):
        validate_motion(non_finite)


def test_published_motion_requires_review_and_compiled_asset() -> None:
    document = load_fixture("valid-synthetic.json")
    document["recipe"]["status"] = "published"
    with pytest.raises(MotionValidationError) as raised:
        validate_motion(document)
    assert raised.value.path == "$.linguisticReview.status"

    document["linguisticReview"]["status"] = "approved"
    with pytest.raises(MotionValidationError) as raised:
        validate_motion(document)
    assert raised.value.path == "$.compiled.status"

    document["compiled"]["status"] = "compiled"
    validate_motion(document)


@pytest.mark.parametrize(
    ("path", "value", "expected_error_path"),
    [
        (("kind",), "other", "$.kind"),
        (("id",), "NOT VALID", "$.id"),
        (("revision",), 0, "$.revision"),
        (("units", "length"), "cm", "$.units.length"),
        (("coordinateSystem", "up"), "+Z", "$.coordinateSystem.up"),
        (("dominantHand",), "up", "$.dominantHand"),
        (("recipe", "status"), "ready", "$.recipe.status"),
        (("recipe", "timeline", "durationMs"), 1000.5, "$.recipe.timeline.durationMs"),
        (("recipe", "timeline", "nominalFps"), 0, "$.recipe.timeline.nominalFps"),
        (
            ("recipe", "timeline", "keyframes", 0, "curve"),
            "bezier",
            "$.recipe.timeline.keyframes[0].curve",
        ),
        (
            ("recipe", "timeline", "keyframes", 0, "body", "left", "shoulderPositionM"),
            "invalid",
            "$.recipe.timeline.keyframes[0].body.left.shoulderPositionM",
        ),
        (
            ("recipe", "timeline", "keyframes", 0, "nonManual", "mouth", "opening"),
            1.5,
            "$.recipe.timeline.keyframes[0].nonManual.mouth.opening",
        ),
    ],
)
def test_validator_rejects_formal_schema_constraint_violations(
    path: tuple[str | int, ...],
    value: object,
    expected_error_path: str,
) -> None:
    document = load_fixture("valid-synthetic.json")
    target: Any = document
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value

    with pytest.raises(MotionValidationError) as raised:
        validate_motion(document)
    assert raised.value.path == expected_error_path


@pytest.mark.parametrize(
    "path",
    [
        ("recipe", "intent"),
        ("recipe", "contacts"),
        ("recipe", "timeline", "nominalFps"),
        ("recipe", "timeline", "keyframes", 0, "id"),
        ("recipe", "timeline", "keyframes", 0, "curve"),
    ],
)
def test_validator_rejects_missing_formal_schema_fields(path: tuple[str | int, ...]) -> None:
    document = load_fixture("valid-synthetic.json")
    target: Any = document
    for part in path[:-1]:
        target = target[part]
    del target[path[-1]]

    with pytest.raises(MotionValidationError):
        validate_motion(document)


def test_validator_rejects_additional_properties() -> None:
    document = load_fixture("valid-synthetic.json")
    document["unexpected"] = True
    with pytest.raises(MotionValidationError) as raised:
        validate_motion(document)
    assert raised.value.path == "$"


def test_canonical_hash_is_deterministic_and_key_order_independent() -> None:
    document = load_fixture("valid-synthetic.json")
    reordered = {key: document[key] for key in reversed(tuple(document))}
    assert canonical_sha256(document) == canonical_sha256(reordered)
    assert canonical_sha256(document) == canonical_sha256(copy.deepcopy(document))


def test_intrinsic_xyz_euler_conversion_golden() -> None:
    quaternion = euler_xyz_intrinsic_to_quaternion((30.0, -20.0, 10.0))
    expected = (
        0.2392983377447303,
        -0.18930785741199999,
        0.03813457647485015,
        0.9515485246437885,
    )
    assert quaternion == pytest.approx(expected, abs=1e-15)
    assert sum(component * component for component in quaternion) == pytest.approx(1.0, abs=1e-15)
    assert euler_xyz_intrinsic_to_quaternion((30.0, -20.0, 10.0)) == quaternion
