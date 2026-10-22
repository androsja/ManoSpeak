"""Tests for the mobile landmark motion exporter."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORTER_PATH = REPO_ROOT / "mobile/tools/export_skeleton_motion.py"
SPEC = importlib.util.spec_from_file_location("export_skeleton_motion", EXPORTER_PATH)
assert SPEC is not None and SPEC.loader is not None
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


def _captured_frame(root_x: float) -> list[list[float]]:
    frame = [[0.0, 0.0, 0.0] for _ in range(543)]
    for point_index in (13, 14, 15, 16, 33, 54):
        frame[point_index] = [root_x, 0.0, 0.0]
    for hand_start in (33, 54):
        for hand_offset in range(21):
            frame[hand_start + hand_offset] = [
                root_x + hand_offset * 0.01,
                hand_offset * 0.02,
                0.0,
            ]
    return frame


def test_export_motion_crops_and_smooths_arm_travel_without_deforming_hands(
    tmp_path: Path,
) -> None:
    source = tmp_path / "capture.json"
    output = tmp_path / "motion.json"
    recipe = tmp_path / "recipe.json"
    source.write_text(
        json.dumps(
            {
                "rawFrames": [
                    _captured_frame(value)
                    for value in (0.2, 0.2, 0.2, 1.2, 1.2, 1.2, 1.2)
                ]
            }
        ),
        encoding="utf-8",
    )
    recipe.write_text(
        json.dumps(
            {
                "source_start_frame": 1,
                "source_end_frame": 6,
                "arm_trajectory_smoothing_passes": 2,
                "active_hand": "left",
                "contact_anchor": "chin",
                "contact_start_frame": 1,
                "contact_end_frame": 2,
                "palm_at_contact": "camera",
            }
        ),
        encoding="utf-8",
    )

    EXPORTER.export_motion(source, output, 30, recipe)

    motion = json.loads(output.read_text(encoding="utf-8"))
    assert len(motion["frames"]) == 6
    assert motion["avatarProfile"]["contactStartFrame"] == 1
    root_positions = [frame["bodyHands"][33][0] for frame in motion["frames"]]
    assert root_positions == sorted(root_positions)
    assert 0.2 < root_positions[1] < root_positions[-2] < 1.2
    for frame in motion["frames"]:
        wrist = frame["bodyHands"][33]
        next_landmark = frame["bodyHands"][34]
        assert next_landmark[0] - wrist[0] == pytest.approx(0.01)
        assert next_landmark[1] - wrist[1] == pytest.approx(0.02)
