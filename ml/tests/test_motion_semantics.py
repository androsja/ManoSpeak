"""Tests for the additive semantic summary used by legacy motion assets."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.motion_semantics import derive_legacy_motion_semantics, with_derived_semantics


HOLA = Path(__file__).parents[2] / "mobile" / "assets" / "motions" / "hola.motion.json"


def test_hola_derives_active_hand_anchors_trajectory_contact_and_palm_orientation() -> None:
    summary = derive_legacy_motion_semantics(json.loads(HOLA.read_text(encoding="utf-8")))

    assert summary["gloss"] == "HOLA"
    assert summary["activeHand"] == "left"
    assert summary["inactiveHand"] == "right"
    assert set(summary["anchors"]) == {"left", "right"}
    assert set(summary["anchors"]["left"]) == {"shoulder", "elbow", "wrist"}
    assert summary["hand"]["active"]["trajectory"]["toFrame"] == 35
    assert summary["hand"]["active"]["trajectory"]["pathLength"] > 0
    assert summary["hand"]["active"]["palmOrientation"]["start"]["normal"] is not None
    assert summary["contact"] == {
        "status": "authored",
        "anchor": "forehead",
        "fromFrame": 0,
        "toFrame": 12,
    }


def test_semantics_are_additive_and_do_not_change_renderer_fields() -> None:
    source = json.loads(HOLA.read_text(encoding="utf-8"))
    enriched = with_derived_semantics(source)

    assert set(enriched) == set(source) | {"semantic"}
    assert enriched["frames"] == source["frames"]
    assert enriched["avatarProfile"] == source["avatarProfile"]


def test_invalid_legacy_motion_is_rejected() -> None:
    with pytest.raises(ValueError, match="75 body/hand landmarks"):
        derive_legacy_motion_semantics({"frames": [{"bodyHands": []}, {"bodyHands": []}]})

