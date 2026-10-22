import json
from dataclasses import replace
from pathlib import Path

import pytest

from src.sign_recipe import SignRecipe, load_recipe


def test_recipe_round_trip(tmp_path: Path) -> None:
    recipe = SignRecipe(
        version=1,
        gloss="GRACIAS",
        landmark_source="reference.json",
        active_hand="right",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=15,
        arm_trajectory_smoothing_passes=3,
    )
    path = tmp_path / "gracias.recipe.json"
    recipe.save(path)
    assert load_recipe(path, 15) == recipe


def test_recipe_rejects_excessive_arm_trajectory_smoothing() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="BUENOS DÍAS",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=15,
        arm_trajectory_smoothing_passes=13,
    )

    with pytest.raises(ValueError, match="smoothing passes"):
        recipe.validate(15)


def test_recipe_rejects_invalid_frame_order(tmp_path: Path) -> None:
    path = tmp_path / "invalid.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "gloss": "HOLA",
                "landmark_source": "reference.json",
                "active_hand": "right",
                "contact_anchor": "forehead",
                "contact_frame": 8,
                "release_frame": 3,
                "palm_at_contact": "camera",
                "palm_at_release": "out",
                "forward_distance": 0.2,
                "return_to_rest": True,
                "output_fps": 15,
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="release frame"):
        load_recipe(path, 12)


def test_legacy_recipe_defaults_motion_adjustments_to_zero(tmp_path: Path) -> None:
    path = tmp_path / "legacy.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "gloss": "GRACIAS",
                "landmark_source": "reference.json",
                "active_hand": "left",
                "contact_anchor": "chin",
                "contact_frame": 4,
                "release_frame": 10,
                "palm_at_contact": "camera",
                "palm_at_release": "up",
                "forward_distance": 0.45,
                "return_to_rest": True,
                "output_fps": 15,
            }
        ),
        encoding="utf-8",
    )

    recipe = load_recipe(path, 15)

    assert recipe.entry_height_cm == 0.0
    assert recipe.exit_height_cm == 0.0
    assert recipe.exit_depth_cm == 0.0
    assert recipe.rig_contact_bias == 0.0
    assert recipe.rig_stable_open_hand is False
    assert recipe.rig_soft_hand_curl is False
    assert recipe.rig_pointing_hand is False


def test_recipe_accepts_avatar_hand_rig_options(tmp_path: Path) -> None:
    path = tmp_path / "avatar-rig.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "gloss": "QUERER",
                "landmark_source": "reference.json",
                "active_hand": "left",
                "contact_anchor": "chin",
                "contact_frame": 4,
                "release_frame": 10,
                "palm_at_contact": "camera",
                "palm_at_release": "up",
                "forward_distance": 0.45,
                "return_to_rest": True,
                "output_fps": 15,
                "rig_contact_bias": 0.07,
                "rig_stable_open_hand": True,
                "rig_soft_hand_curl": True,
                "rig_pointing_hand": False,
            }
        ),
        encoding="utf-8",
    )

    recipe = load_recipe(path, 15)

    assert recipe.rig_contact_bias == 0.07
    assert recipe.rig_stable_open_hand is True
    assert recipe.rig_soft_hand_curl is True
    assert recipe.rig_pointing_hand is False


def test_recipe_accepts_safe_entry_and_exit_adjustments(tmp_path: Path) -> None:
    recipe = SignRecipe(
        version=1,
        gloss="GRACIAS",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=15,
        entry_height_cm=-2.0,
        exit_height_cm=5.0,
        exit_depth_cm=3.0,
    )

    recipe.validate(15)
    path = tmp_path / "adjusted.json"
    recipe.save(path)

    assert load_recipe(path, 15) == recipe


def test_recipe_rejects_unsafe_motion_adjustment() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="GRACIAS",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=15,
    )

    with pytest.raises(ValueError, match="between -30 and 30 cm"):
        replace(recipe, exit_height_cm=31.0).validate(15)


def test_recipe_accepts_editable_motion_points_at_any_second() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="GRACIAS",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=10,
        motion_keyframes=[
            {"kind": "entry", "time_seconds": 0.0, "height_cm": 0.0, "mouth_pucker": 0.0},
            {"kind": "point", "time_seconds": 0.5, "height_cm": 4.0, "mouth_pucker": 0.6},
            {"kind": "exit", "time_seconds": 1.0, "height_cm": 2.0},
        ],
    )

    recipe.validate(11)


def test_recipe_rejects_an_invalid_mouth_rounding_value() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="YO",
        landmark_source="reference.json",
        active_hand="right",
        contact_anchor="chest",
        contact_frame=2,
        release_frame=8,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.2,
        return_to_rest=True,
        output_fps=10,
        motion_keyframes=[{"kind": "point", "time_seconds": 0.5, "mouth_pucker": 1.1}],
    )

    with pytest.raises(ValueError, match="Facial motion values"):
        recipe.validate(11)


def test_recipe_accepts_closing_keyframe_at_captured_duration() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="MAMA",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chest",
        contact_frame=10,
        release_frame=25,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=30,
        motion_keyframes=[{"kind": "exit", "time_seconds": 1.0}],
    )

    recipe.validate(30)


def test_recipe_validates_timeline_against_trimmed_source_range() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="BUENAS TARDES",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=0,
        release_frame=18,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=30,
        source_start_frame=18,
        source_end_frame=47,
        contact_start_frame=0,
        contact_end_frame=8,
        motion_keyframes=[{"kind": "exit", "time_seconds": 1.0}],
    )

    recipe.validate(48)

    with pytest.raises(ValueError, match="source end frame"):
        replace(recipe, source_end_frame=18).validate(48)


def test_recipe_rejects_duplicate_motion_point_times() -> None:
    recipe = SignRecipe(
        version=1,
        gloss="GRACIAS",
        landmark_source="reference.json",
        active_hand="left",
        contact_anchor="chin",
        contact_frame=4,
        release_frame=10,
        palm_at_contact="camera",
        palm_at_release="up",
        forward_distance=0.45,
        return_to_rest=True,
        output_fps=10,
        motion_keyframes=[
            {"kind": "entry", "time_seconds": 0.0},
            {"kind": "point", "time_seconds": 0.5},
            {"kind": "exit", "time_seconds": 0.5},
        ],
    )

    with pytest.raises(ValueError, match="same time"):
        recipe.validate(11)
