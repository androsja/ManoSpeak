"""Contract checks for the additive universal motion-semantics schema."""

from __future__ import annotations

import json
from pathlib import Path
import re


ROOT = Path(__file__).parents[2]
SCHEMA = ROOT / "schemas" / "motion-semantics-v1.schema.json"
FIXTURE = ROOT / "schemas" / "fixtures" / "motion-semantics-v1" / "hola.semantic.json"
MOTIONS = ROOT / "mobile" / "assets" / "motions"
V2_SCHEMA = ROOT / "schemas" / "motion-semantics-v2.schema.json"
V2_FIXTURES = ROOT / "schemas" / "fixtures" / "motion-semantics-v2"


def test_semantic_schema_and_hola_fixture_are_parseable() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    assert schema["$schema"].endswith("draft/2020-12/schema")
    assert schema["properties"]["schemaVersion"]["const"] == 1
    assert fixture["schema"] == "vozual.motion-semantics"
    assert fixture["schemaVersion"] == 1
    assert fixture["handMode"] == "left"
    assert fixture["language"] == "lsc"
    assert fixture["regionalVariant"] == "lsc-CO"
    assert fixture["hands"]["left"]["joints"]["elbow"]
    assert fixture["hands"]["left"]["palm"]["facing"] == "camera"
    assert fixture["contact"]["anchor"] == "forehead"
    assert {phase["kind"] for phase in fixture["phases"]} == {"hold", "release"}


def test_semantics_contract_covers_all_legacy_landmark_dimensions() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    counts = fixture["validation"]["landmarkCounts"]
    assert counts == {"pose": 33, "leftHand": 21, "rightHand": 21, "face": 468}
    assert set(fixture["nonManual"]) == {"head", "torso", "gaze", "eyes", "brows", "mouth"}

    legacy = sorted(MOTIONS.glob("*.motion.json"))
    assert len(legacy) == 80
    assert all("semantic" not in json.loads(path.read_text(encoding="utf-8")) for path in legacy)


def test_v2_schema_is_a_new_additive_contract_with_typed_temporal_channels() -> None:
    schema = json.loads(V2_SCHEMA.read_text(encoding="utf-8"))

    assert schema["$schema"].endswith("draft/2020-12/schema")
    assert schema["properties"]["schemaVersion"]["const"] == 2
    assert schema["$id"].endswith("motion-semantics-v2.schema.json")
    assert set(schema["required"]) >= {
        "manualTracks",
        "trajectories",
        "anatomicalRelations",
        "bilateralCoordination",
        "handshapeEvents",
        "nonManualEvents",
    }

    definitions = schema["$defs"]
    assert definitions["anatomicalRelation"]["oneOf"]
    assert definitions["trajectory"]["properties"]["effector"] == {"$ref": "#/$defs/endpoint"}
    assert definitions["bilateralCoordination"]["properties"]["mode"]["enum"] == [
        "synchronous",
        "mirrored",
        "alternating",
        "independent",
    ]
    assert definitions["handshapeEvent"]["properties"]["span"] == {"$ref": "#/$defs/span"}
    assert definitions["nonManualEvent"]["properties"]["channels"]["minItems"] == 1


def test_v2_valid_fixture_covers_all_new_semantic_channels() -> None:
    fixture = json.loads((V2_FIXTURES / "valid-bilateral.semantic.json").read_text(encoding="utf-8"))

    assert fixture["schemaVersion"] == 2
    assert fixture["language"] == "lsc"
    assert fixture["regionalVariant"] == "lsc-CO"
    assert fixture["manualTracks"]["left"]["participation"] == "active"
    assert fixture["trajectories"][0]["effector"] == "hand.left.wrist"
    assert fixture["anatomicalRelations"][0]["type"] == "proximity"
    assert fixture["anatomicalRelations"][1]["type"] == "joint_coupling"
    assert fixture["bilateralCoordination"][0]["mode"] == "mirrored"
    assert fixture["handshapeEvents"][0]["span"] == {"fromMs": 100, "toMs": 300}
    assert fixture["nonManualEvents"][0]["channels"] == [
        "brows.leftInnerLift",
        "brows.rightInnerLift",
    ]


def test_v2_invalid_fixture_has_an_endpoint_rejected_by_the_typed_anatomy_pattern() -> None:
    schema = json.loads(V2_SCHEMA.read_text(encoding="utf-8"))
    fixture = json.loads((V2_FIXTURES / "invalid-untyped-anatomy.semantic.json").read_text(encoding="utf-8"))

    endpoint_pattern = schema["$defs"]["endpoint"]["pattern"]
    invalid_endpoint = fixture["anatomicalRelations"][0]["a"]
    assert re.fullmatch(endpoint_pattern, invalid_endpoint) is None
