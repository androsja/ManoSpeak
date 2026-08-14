"""Capture private avatar-reference landmarks from a macOS webcam.

This utility deliberately never records video or audio. It shows a live preview
with MediaPipe landmarks and writes only the landmark coordinates after a
creator explicitly starts a configured-duration take.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp  # type: ignore[import-untyped]
import numpy as np

LANDMARK_COUNT = 543
POSE_COUNT = 33
HAND_COUNT = 21
FACE_COUNT = 468
# This is a local avatar-authoring reference, never a training sample. A stable
# 12 FPS minimum is sufficient because the final rig animation is interpolated
# and manually reviewed; it would not be sufficient for model training.
MIN_EFFECTIVE_FPS = 12.0
MAX_FRAME_GAP_MS = 150.0
MIN_ACTIVE_FRAMES = 12
MIN_HAND_FRAME_RATIO = 0.30
DEFAULT_CAPTURE_DURATION_SECONDS = 1.5
COUNTDOWN_SECONDS = 3.0
AUTO_START_STABLE_SECONDS = 0.5
HAND_RELEASE_STABLE_SECONDS = 0.5


@dataclass(frozen=True)
class CaptureQuality:
    valid: bool
    reasons: list[str]
    frameCount: int
    durationMs: float
    effectiveFps: float
    maxFrameGapMs: float
    shoulderFrameRatio: float
    handFrameRatio: float
    activeFrameCount: int


@dataclass(frozen=True)
class DetectionResults:
    pose_landmarks: Any | None
    left_hand_landmarks: Any | None
    right_hand_landmarks: Any | None
    face_landmarks: Any | None = None


def zero_points(count: int) -> list[list[float]]:
    return [[0.0, 0.0, 0.0] for _ in range(count)]


def landmarks_to_points(landmark_list: Any, count: int) -> list[list[float]]:
    points = zero_points(count)
    if landmark_list is None:
        return points
    for index, landmark in enumerate(landmark_list.landmark[:count]):
        points[index] = [float(landmark.x), float(landmark.y), float(landmark.z)]
    return points


def build_raw_frame(results: Any) -> list[list[float]]:
    """Return the stable pose33 + left21 + right21 + face468 layout."""
    pose = landmarks_to_points(results.pose_landmarks, POSE_COUNT)
    left_hand = landmarks_to_points(results.left_hand_landmarks, HAND_COUNT)
    right_hand = landmarks_to_points(results.right_hand_landmarks, HAND_COUNT)
    face = landmarks_to_points(results.face_landmarks, FACE_COUNT)
    frame = pose + left_hand + right_hand + face
    if len(frame) != LANDMARK_COUNT:
        raise ValueError(f"Expected {LANDMARK_COUNT} landmarks, received {len(frame)}")
    return frame


def is_zero(point: list[float]) -> bool:
    return point == [0.0, 0.0, 0.0]


def normalize_frame(frame: list[list[float]]) -> list[list[float]]:
    """Match the mobile shoulder-center normalization for private inspection."""
    left_shoulder, right_shoulder = frame[11], frame[12]
    if not is_zero(left_shoulder) and not is_zero(right_shoulder):
        anchor = [(left_shoulder[i] + right_shoulder[i]) / 2.0 for i in range(3)]
        scale = float(np.linalg.norm(np.subtract(left_shoulder, right_shoulder)))
    else:
        detected = [point for point in frame if not is_zero(point)]
        if not detected:
            return zero_points(len(frame))
        values = np.asarray(detected, dtype=np.float64)
        anchor = values.mean(axis=0).tolist()
        scale = float(np.linalg.norm(values.max(axis=0) - values.min(axis=0)))

    if scale < 1e-5:
        scale = 1.0
    return [
        [0.0, 0.0, 0.0]
        if is_zero(point)
        else [float(np.clip((point[index] - anchor[index]) / scale, -1.0, 1.0)) for index in range(3)]
        for point in frame
    ]


def has_hand(frame: list[list[float]]) -> bool:
    return sum(not is_zero(point) for point in frame[POSE_COUNT : POSE_COUNT + 2 * HAND_COUNT]) >= 16


def subject_is_ready(frame: list[list[float]]) -> bool:
    """Require shoulders and the sign's active hand before starting automatically."""
    return not is_zero(frame[11]) and not is_zero(frame[12]) and has_hand(frame)


def evaluate_quality(frames: list[list[list[float]]], timestamps: list[float]) -> CaptureQuality:
    reasons: list[str] = []
    frame_count = len(frames)
    duration_ms = (timestamps[-1] - timestamps[0]) * 1000.0 if frame_count > 1 else 0.0
    intervals_ms = [
        (timestamps[index] - timestamps[index - 1]) * 1000.0
        for index in range(1, len(timestamps))
    ]
    effective_fps = ((frame_count - 1) * 1000.0 / duration_ms) if duration_ms else 0.0
    max_gap_ms = max(intervals_ms, default=0.0)
    shoulder_frames = sum(not is_zero(frame[11]) and not is_zero(frame[12]) for frame in frames)
    active_frames = sum(has_hand(frame) for frame in frames)
    shoulder_ratio = shoulder_frames / frame_count if frame_count else 0.0
    hand_ratio = active_frames / frame_count if frame_count else 0.0

    if frame_count < MIN_ACTIVE_FRAMES:
        reasons.append("too_few_frames")
    if effective_fps < MIN_EFFECTIVE_FPS:
        reasons.append("low_fps")
    if max_gap_ms > MAX_FRAME_GAP_MS:
        reasons.append("large_frame_gap")
    if shoulder_ratio < 0.9:
        reasons.append("missing_shoulders")
    if hand_ratio < MIN_HAND_FRAME_RATIO:
        reasons.append("missing_hands")

    return CaptureQuality(
        valid=not reasons,
        reasons=reasons,
        frameCount=frame_count,
        durationMs=duration_ms,
        effectiveFps=effective_fps,
        maxFrameGapMs=max_gap_ms,
        shoulderFrameRatio=shoulder_ratio,
        handFrameRatio=hand_ratio,
        activeFrameCount=active_frames,
    )


def draw_preview(image: np.ndarray, results: Any, status: str, fps: float) -> np.ndarray:
    drawing = mp.solutions.drawing_utils
    styles = mp.solutions.drawing_styles
    if results.pose_landmarks:
        drawing.draw_landmarks(
            image,
            results.pose_landmarks,
            mp.solutions.pose.POSE_CONNECTIONS,
            landmark_drawing_spec=styles.get_default_pose_landmarks_style(),
        )
    for hand_landmarks in (results.left_hand_landmarks, results.right_hand_landmarks):
        if hand_landmarks:
            drawing.draw_landmarks(image, hand_landmarks, mp.solutions.hands.HAND_CONNECTIONS)

    font = cv2.FONT_HERSHEY_SIMPLEX
    margin = 24
    max_width = image.shape[1] - 2 * margin
    lines = wrap_preview_text(status, max_width, font, 0.66, 2)
    metrics = f"Puntos: {fps:.1f} FPS | inicia al detectarte | Q salir"
    panel_height = 32 + len(lines) * 34 + 32
    cv2.rectangle(image, (0, 0), (image.shape[1], panel_height), (10, 20, 32), -1)
    for index, line in enumerate(lines):
        cv2.putText(image, line, (margin, 34 + index * 34), font, 0.66, (255, 255, 255), 2)
    cv2.putText(image, metrics, (margin, panel_height - 12), font, 0.45, (145, 220, 255), 1)
    return image


def wrap_preview_text(text: str, max_width: int, font: int, scale: float, thickness: int) -> list[str]:
    """Wrap status text using actual OpenCV glyph widths, not character counts."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            width = cv2.getTextSize(candidate, font, scale, thickness)[0][0]
            if current and width > max_width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current or " ")
    return lines


def detect_pose_and_hands(pose: Any, hands: Any, rgb_frame: np.ndarray) -> DetectionResults:
    """Run the lightweight first-pass tracker used for arm and hand retargeting.

    Facial landmarks are intentionally left as zeroes in this capture route. They
    are unnecessary for the initial HOLA avatar draft and removing Face Mesh is
    what allows a Mac webcam to sustain the required capture rate.
    """
    pose_result = pose.process(rgb_frame)
    hands_result = hands.process(rgb_frame)
    left_hand = None
    right_hand = None
    if hands_result.multi_hand_landmarks and hands_result.multi_handedness:
        for hand_landmarks, handedness in zip(
            hands_result.multi_hand_landmarks,
            hands_result.multi_handedness,
            strict=True,
        ):
            label = handedness.classification[0].label
            if label == "Left":
                left_hand = hand_landmarks
            else:
                right_hand = hand_landmarks
    return DetectionResults(
        pose_landmarks=pose_result.pose_landmarks,
        left_hand_landmarks=left_hand,
        right_hand_landmarks=right_hand,
    )


def capture_result_message(saved: Path | None, quality: CaptureQuality) -> str:
    if saved:
        return f"TOMA ACEPTADA\n{quality.effectiveFps:.1f} FPS."
    improvements: list[str] = []
    if "low_fps" in quality.reasons:
        improvements.append(f"velocidad {quality.effectiveFps:.1f} FPS; se requieren 12")
    if "missing_hands" in quality.reasons:
        improvements.append("mano activa no detectada con continuidad")
    if "missing_shoulders" in quality.reasons:
        improvements.append("mantén ambos hombros a la vista")
    if "too_few_frames" in quality.reasons:
        improvements.append("haz una seña de al menos un segundo")
    return "TOMA NO ACEPTADA\n" + "; ".join(improvements) + "."


def save_sample(
    output_dir: Path,
    gloss: str,
    frames: list[list[list[float]]],
    timestamps: list[float],
    target_duration_seconds: float,
) -> tuple[Path | None, CaptureQuality]:
    quality = evaluate_quality(frames, timestamps)
    if not quality.valid:
        return None, quality
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    payload = {
        "version": 3,
        "purpose": "creator_reference",
        "trainingEligible": False,
        "gloss": gloss.upper(),
        "requestedSpeed": "natural",
        "createdAt": created_at,
        "endReason": "manual_stop",
        "capture": {
            "platform": "macos",
            "cameraPosition": "front",
            "cameraDeviceId": "0",
            "rotationDegrees": 0,
            "horizontallyMirrored": True,
            "previewVisible": True,
            "mediaPipeTasksVersion": mp.__version__,
            "processorTargetFps": 30,
            "targetDurationMs": round(target_duration_seconds * 1000),
            "timestampClock": "monotonic_performance_seconds",
            "landmarkLayout": "pose33_left21_right21_face468",
            "normalizer": "shoulder_center_scale_clip_v1",
            "purpose": "creator_reference",
            "consent": {
                "version": "creator_capture_consent_v1",
                "acceptedAt": created_at,
                "scope": "avatar_animation_reference",
                "localOnly": True,
                "trainingEligible": False,
            },
        },
        "timestamps": timestamps,
        "handPresence": [has_hand(frame) for frame in frames],
        "quality": asdict(quality),
        "rawFrames": frames,
        "normalizedFrames": [normalize_frame(frame) for frame in frames],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"Mac_{gloss.upper()}_NATURAL_{int(time.time() * 1000)}.json"
    output_path = output_dir / filename
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return output_path, quality


def run_capture(
    camera_index: int,
    gloss: str,
    output_dir: Path,
    target_duration_seconds: float,
    target_take_count: int,
) -> None:
    if target_duration_seconds <= 0:
        raise ValueError("The sign duration must be greater than zero.")
    if target_take_count < 1:
        raise ValueError("The number of takes must be at least one.")
    camera = cv2.VideoCapture(camera_index, cv2.CAP_AVFOUNDATION)
    if not camera.isOpened():
        raise RuntimeError("The selected Mac camera could not be opened. Check macOS camera permission.")
    # 640x480 lets the integrated webcam and the pose+hands tracker sustain a
    # substantially higher rate than the original 1280x720 preview.
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    camera.set(cv2.CAP_PROP_FPS, 30)

    window_name = "ManoSpeak private avatar capture"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
    frames: list[list[list[float]]] = []
    timestamps: list[float] = []
    recording = False
    counting_down = False
    awaiting_hand_release = False
    collection_complete = False
    countdown_started_at = 0.0
    capture_started_at = 0.0
    ready_since: float | None = None
    release_since: float | None = None
    accepted_take_count = 0
    fps_timestamps: list[float] = []
    message = f"{gloss.upper()} | toma 1 de {target_take_count}\nUbica hombros y mano activa"

    with mp.solutions.pose.Pose(
        static_image_mode=False,
        # The full pose model is already packaged locally. The lightweight
        # variant would download an additional model at runtime, which is not
        # acceptable for an offline, private capture workflow.
        model_complexity=1,
        smooth_landmarks=True,
    ) as pose, mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        while True:
            ok, frame = camera.read()
            if not ok:
                raise RuntimeError("The Mac camera stopped returning frames.")
            now = time.perf_counter()
            # Process the same mirrored image that the creator sees. Processing
            # before mirroring would place the overlay on the opposite hand and
            # make a visual quality check misleading.
            mirrored_frame = cv2.flip(frame, 1)
            results = detect_pose_and_hands(pose, hands, cv2.cvtColor(mirrored_frame, cv2.COLOR_BGR2RGB))
            fps_timestamps.append(now)
            while fps_timestamps and now - fps_timestamps[0] > 2.0:
                fps_timestamps.pop(0)
            fps = (len(fps_timestamps) - 1) / (fps_timestamps[-1] - fps_timestamps[0]) if len(fps_timestamps) > 1 else 0.0
            current_frame = build_raw_frame(results)

            if awaiting_hand_release:
                if not has_hand(current_frame):
                    if release_since is None:
                        release_since = now
                    elif now - release_since >= HAND_RELEASE_STABLE_SECONDS:
                        awaiting_hand_release = False
                        ready_since = None
                        release_since = None
                        message = (
                            f"{gloss.upper()} | toma {accepted_take_count + 1} de {target_take_count}\n"
                            "Ubica hombros y mano activa"
                        )
                else:
                    release_since = None
            elif not recording and not counting_down and not collection_complete:
                if subject_is_ready(current_frame):
                    if ready_since is None:
                        ready_since = now
                        message = f"Toma {accepted_take_count + 1} de {target_take_count}\nPreparando cuenta regresiva"
                    elif now - ready_since >= AUTO_START_STABLE_SECONDS:
                        counting_down = True
                        countdown_started_at = now
                        message = "PREPARATE: 3"
                else:
                    ready_since = None
                    message = "HOLA lista\nUbica hombros y mano activa; la cuenta inicia sola"

            if recording:
                frames.append(current_frame)
                timestamps.append(now)
                elapsed = now - capture_started_at
                seconds_remaining = max(0.0, target_duration_seconds - elapsed)
                message = f"GRABANDO: {seconds_remaining:.1f} s\nRealiza {gloss.upper()}"
                if elapsed >= target_duration_seconds:
                    recording = False
                    saved, quality = save_sample(
                        output_dir,
                        gloss,
                        frames,
                        timestamps,
                        target_duration_seconds,
                    )
                    if saved:
                        accepted_take_count += 1
                    if accepted_take_count >= target_take_count:
                        collection_complete = True
                        message = (
                            f"SERIE COMPLETA\n{accepted_take_count} tomas aceptadas. Q para salir."
                        )
                    else:
                        awaiting_hand_release = True
                        release_since = None
                        message = (
                            capture_result_message(saved, quality)
                            + "\nRetira la mano activa para preparar la siguiente."
                        )

            if counting_down:
                elapsed = now - countdown_started_at
                seconds_remaining = max(1, int(np.ceil(COUNTDOWN_SECONDS - elapsed)))
                message = f"PREPARATE: {seconds_remaining}"
                if elapsed >= COUNTDOWN_SECONDS:
                    counting_down = False
                    recording = True
                    capture_started_at = now
                    frames = []
                    timestamps = []
                    message = f"GRABANDO: {target_duration_seconds:.1f} s\nRealiza {gloss.upper()}"

            preview = draw_preview(mirrored_frame, results, message, fps)
            cv2.imshow(window_name, preview)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break

    camera.release()
    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture local Mac webcam landmarks for a ManoSpeak avatar draft.")
    parser.add_argument("--gloss", default="HOLA", help="Gloss used only to name the private reference file.")
    parser.add_argument("--camera", type=int, default=0, help="macOS camera index, usually 0 for the built-in camera.")
    parser.add_argument(
        "--duration-seconds",
        type=float,
        default=DEFAULT_CAPTURE_DURATION_SECONDS,
        help="Configured duration for this approved-sign reference, in seconds.",
    )
    parser.add_argument(
        "--takes",
        type=int,
        default=3,
        help="Number of accepted references to capture automatically for this sign.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("tmp/creator_references/desktop"),
        help="Local-only destination for private landmark JSON files.",
    )
    args = parser.parse_args()
    run_capture(args.camera, args.gloss, args.output_dir, args.duration_seconds, args.takes)


if __name__ == "__main__":
    main()
