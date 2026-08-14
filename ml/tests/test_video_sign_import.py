import numpy as np

from src.video_sign_import import (
    build_recipe,
    choose_active_hand,
    draw_tracking_overlay,
    infer_contact,
    infer_contact_window,
    resample_landmark_sequence,
)


def empty_frame() -> list[list[float]]:
    return [[0.0, 0.0, 0.0] for _ in range(543)]


def test_choose_active_hand_uses_wrist_motion() -> None:
    frames = []
    for index in range(4):
        frame = empty_frame()
        frame[15] = [0.2 + index * 0.1, 0.5, 0.0]
        frame[16] = [0.8, 0.5, 0.0]
        frames.append(frame)
    assert choose_active_hand(frames) == "left"


def test_choose_active_hand_prioritizes_continuous_finger_tracking() -> None:
    frames = []
    for index in range(8):
        frame = empty_frame()
        frame[15] = [0.4 + index * 0.01, 0.5, 0.0]
        frame[16] = [0.8 if index % 2 else 0.1, 0.5, 0.0]
        for point in range(33, 54):
            frame[point] = [0.4, 0.5, 0.0]
        if index == 7:
            for point in range(54, 75):
                frame[point] = [0.8, 0.5, 0.0]
        frames.append(frame)

    assert choose_active_hand(frames) == "left"


def test_choose_active_hand_uses_detailed_motion_when_both_hands_are_visible() -> None:
    frames = []
    for index in range(8):
        frame = empty_frame()
        # Pose wrists contain the kind of false jump produced by occlusion.
        frame[15] = [0.4, 0.5, 0.0]
        frame[16] = [0.8 if index % 2 else 0.1, 0.5, 0.0]
        for point in range(21):
            frame[33 + point] = [0.3 + index * 0.04, 0.5, -0.01]
            frame[54 + point] = [0.7, 0.5, -0.01]
        frames.append(frame)

    assert choose_active_hand(frames) == "left"


def test_infer_contact_finds_chin() -> None:
    frames = []
    for index in range(3):
        frame = empty_frame()
        frame[75 + 152] = [0.5, 0.4, 0.0]
        for point in range(33, 54):
            frame[point] = [0.5 + index * 0.01, 0.41, 0.0]
        frames.append(frame)
    anchor, frame_index = infer_contact(frames, "left")
    assert anchor == "chin"
    assert frame_index == 0


def test_infer_contact_window_uses_sustained_fingertip_contact() -> None:
    frames = []
    for index in range(9):
        frame = empty_frame()
        frame[75 + 152] = [0.5, 0.4, 0.0]
        distance = 0.03 if 3 <= index <= 6 else 0.2
        for point in range(33, 54):
            frame[point] = [0.7, 0.6, 0.0]
        for tip in (8, 12, 16, 20):
            frame[33 + tip] = [0.5 + distance, 0.4, 0.0]
        frames.append(frame)

    anchor, start, peak, end = infer_contact_window(frames, "left")

    assert anchor == "chin"
    assert (start, end) == (3, 6)
    assert start <= peak <= end


def test_build_recipe_uses_detected_contact_and_source_fps(tmp_path) -> None:
    frames = []
    for index in range(8):
        frame = empty_frame()
        frame[11] = [0.35, 0.4, 0.0]
        frame[12] = [0.65, 0.4, 0.0]
        frame[15] = [0.45 + index * 0.01, 0.42, 0.0]
        frame[75 + 152] = [0.5, 0.4, 0.0]
        for point in range(33, 54):
            frame[point] = [0.5, 0.41, 0.0]
        frames.append(frame)

    recipe = build_recipe("gracias", tmp_path / "capture.json", frames, 24)

    assert recipe.gloss == "GRACIAS"
    assert recipe.active_hand == "left"
    assert recipe.contact_anchor == "chin"
    assert recipe.output_fps == 24


def test_resample_landmark_sequence_compresses_complete_slow_motion() -> None:
    frames = []
    for index in range(6):
        frame = empty_frame()
        value = float(index + 1)
        frame[33] = [value, value * 2, value * 3]
        frames.append(frame)

    resampled, timestamps = resample_landmark_sequence(
        frames,
        final_duration_seconds=1.0,
        output_fps=4,
    )

    assert len(resampled) == 4
    assert timestamps == [0.0, 0.25, 0.5, 0.75]
    assert resampled[0][33] == [1.0, 2.0, 3.0]
    assert resampled[-1][33] == [6.0, 12.0, 18.0]
    assert 1.0 < resampled[1][33][0] < 6.0


def test_resample_landmark_sequence_bridges_temporary_tracking_loss() -> None:
    frames = [empty_frame() for _ in range(5)]
    frames[0][33] = [0.2, 0.4, -0.1]
    frames[4][33] = [0.8, 0.6, 0.1]

    resampled, _ = resample_landmark_sequence(frames, 1.0, output_fps=5)

    assert resampled[2][33] == [0.5, 0.5, 0.0]


def test_tracking_overlay_draws_hand_and_arm_points() -> None:
    image = np.zeros((200, 300, 3), dtype=np.uint8)
    frame = empty_frame()
    frame[11] = [0.2, 0.3, 0.0]
    frame[13] = [0.3, 0.5, 0.0]
    frame[15] = [0.4, 0.7, 0.0]
    for index in range(21):
        frame[33 + index] = [0.45 + index * 0.005, 0.55, -0.01 * index]

    overlay = draw_tracking_overlay(image, frame, "left")

    assert overlay.shape == image.shape
    assert int(np.count_nonzero(overlay)) > 500


def test_tracking_overlay_draws_face_points_and_contact_anchors() -> None:
    image = np.zeros((600, 800, 3), dtype=np.uint8)
    frame = empty_frame()
    for index in range(468):
        frame[75 + index] = [0.35 + (index % 20) * 0.01, 0.25 + (index // 20) * 0.01, 0.0]
    frame[75 + 152] = [0.5, 0.55, 0.01]
    frame[75 + 13] = [0.5, 0.47, 0.01]
    frame[75 + 10] = [0.5, 0.28, 0.01]

    overlay = draw_tracking_overlay(image, frame, "left")

    # Ordinary Face Mesh points and the three retargeting anchors must all be
    # visible in the diagnostic frame.
    assert np.any(overlay[150, 280] != 0)
    assert np.any(overlay[330, 400] != 0)  # chin
    assert np.any(overlay[282, 400] != 0)  # mouth
    assert np.any(overlay[168, 400] != 0)  # forehead
