from types import SimpleNamespace

from src.desktop_creator_capture import (
    build_raw_frame,
    evaluate_quality,
    normalize_frame,
    subject_is_ready,
    wrap_preview_text,
)


def landmark(x: float, y: float, z: float) -> SimpleNamespace:
    return SimpleNamespace(x=x, y=y, z=z)


def landmark_list(count: int) -> SimpleNamespace:
    return SimpleNamespace(landmark=[landmark(0.4, 0.5, 0.0) for _ in range(count)])


def valid_frame() -> list[list[float]]:
    points = [[0.4, 0.5, 0.0] for _ in range(543)]
    points[11] = [0.35, 0.5, 0.0]
    points[12] = [0.65, 0.5, 0.0]
    return points


def test_build_raw_frame_uses_stable_543_landmark_layout() -> None:
    results = SimpleNamespace(
        pose_landmarks=landmark_list(33),
        left_hand_landmarks=landmark_list(21),
        right_hand_landmarks=landmark_list(21),
        face_landmarks=landmark_list(468),
    )

    frame = build_raw_frame(results)

    assert len(frame) == 543
    assert frame[0] == [0.4, 0.5, 0.0]
    assert frame[542] == [0.4, 0.5, 0.0]


def test_normalize_frame_centers_shoulders_and_preserves_zero_landmarks() -> None:
    frame = valid_frame()
    frame[100] = [0.0, 0.0, 0.0]

    normalized = normalize_frame(frame)

    assert normalized[11] == [-0.5, 0.0, 0.0]
    assert normalized[12] == [0.5, 0.0, 0.0]
    assert normalized[100] == [0.0, 0.0, 0.0]


def test_evaluate_quality_rejects_under_sampled_reference() -> None:
    quality = evaluate_quality([valid_frame() for _ in range(12)], [index * 0.2 for index in range(12)])

    assert not quality.valid
    assert "low_fps" in quality.reasons


def test_evaluate_quality_accepts_stable_reference() -> None:
    quality = evaluate_quality([valid_frame() for _ in range(15)], [index / 30.0 for index in range(15)])

    assert quality.valid


def test_subject_is_ready_requires_shoulders_and_an_active_hand() -> None:
    assert subject_is_ready(valid_frame())

    no_hand = valid_frame()
    no_hand[33:75] = [[0.0, 0.0, 0.0] for _ in range(42)]
    assert not subject_is_ready(no_hand)


def test_wrap_preview_text_keeps_long_status_inside_the_available_width() -> None:
    lines = wrap_preview_text(
        "TOMA NO ACEPTADA mano activa no detectada con continuidad",
        max_width=260,
        font=0,
        scale=0.66,
        thickness=2,
    )

    assert len(lines) > 1
