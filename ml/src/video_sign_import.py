"""Import a local sign video into the ManoSpeak avatar-authoring format."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

import cv2
import mediapipe as mp  # type: ignore[import-untyped]
import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.desktop_creator_capture import (
        CaptureQuality,
        build_raw_frame,
        evaluate_quality,
        has_hand,
        normalize_frame,
    )
    from src.sign_recipe import SignRecipe
else:
    from .desktop_creator_capture import (
        CaptureQuality,
        build_raw_frame,
        evaluate_quality,
        has_hand,
        normalize_frame,
    )
    from .sign_recipe import SignRecipe

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
POSE_LEFT_WRIST = 15
POSE_RIGHT_WRIST = 16
LEFT_HAND_START = 33
RIGHT_HAND_START = 54
HAND_COUNT = 21
FACE_START = 75
FACE_CHIN = FACE_START + 152
FACE_UPPER_LIP = FACE_START + 13
FACE_FOREHEAD = FACE_START + 10
FINGERTIP_INDICES = (8, 12, 16, 20)
DEFAULT_OUTPUT_FPS = 30
POSE_ARM_INDICES = {
    "left": (11, 13, 15),
    "right": (12, 14, 16),
}
HAND_CONNECTIONS = tuple(mp.solutions.hands.HAND_CONNECTIONS)
POSE_CONNECTIONS = tuple(mp.solutions.pose.POSE_CONNECTIONS)
FACE_ANCHORS = (
    (FACE_CHIN, "MENTON", (0, 90, 255)),
    (FACE_UPPER_LIP, "BOCA", (255, 80, 220)),
    (FACE_FOREHEAD, "FRENTE", (80, 255, 120)),
)


def tracked(point: list[float]) -> bool:
    return any(abs(value) > 1e-8 for value in point)


def hand_motion_score(frames: list[list[list[float]]], wrist_index: int) -> float:
    previous: np.ndarray | None = None
    score = 0.0
    for frame in frames:
        if not tracked(frame[wrist_index]):
            continue
        current = np.asarray(frame[wrist_index], dtype=np.float64)
        if previous is not None:
            score += float(np.linalg.norm(current - previous))
        previous = current
    return score


def detailed_hand_presence(frames: list[list[list[float]]], side: str) -> int:
    """Count frames where MediaPipe tracked enough fingers for one hand."""
    start = LEFT_HAND_START if side == "left" else RIGHT_HAND_START
    return sum(
        sum(tracked(point) for point in frame[start : start + HAND_COUNT]) >= 12
        for frame in frames
    )


def detailed_hand_motion_score(
    frames: list[list[list[float]]], side: str
) -> float:
    """Measure motion from the detailed palm instead of the noisy pose wrist."""
    start = LEFT_HAND_START if side == "left" else RIGHT_HAND_START
    previous: np.ndarray | None = None
    score = 0.0
    for frame in frames:
        points = [
            point
            for point in frame[start : start + HAND_COUNT]
            if tracked(point)
        ]
        if len(points) < 12:
            continue
        current = np.asarray(points, dtype=np.float64).mean(axis=0)
        if previous is not None:
            score += float(np.linalg.norm(current - previous))
        previous = current
    return score


def choose_active_hand(frames: list[list[list[float]]]) -> str:
    left_presence = detailed_hand_presence(frames, "left")
    right_presence = detailed_hand_presence(frames, "right")
    # Detailed finger tracking is stronger evidence than pose-wrist motion.
    # Pose wrists can jump when one arm is occluded and previously caused the
    # almost-undetected hand to be selected for GRACIAS (2 versus 34 frames).
    if left_presence != right_presence:
        return "left" if left_presence > right_presence else "right"
    left_detailed_motion = detailed_hand_motion_score(frames, "left")
    right_detailed_motion = detailed_hand_motion_score(frames, "right")
    if not np.isclose(left_detailed_motion, right_detailed_motion):
        return "left" if left_detailed_motion > right_detailed_motion else "right"
    left_score = hand_motion_score(frames, POSE_LEFT_WRIST)
    right_score = hand_motion_score(frames, POSE_RIGHT_WRIST)
    return "left" if left_score >= right_score else "right"


def resample_landmark_sequence(
    frames: list[list[list[float]]],
    final_duration_seconds: float,
    output_fps: int = DEFAULT_OUTPUT_FPS,
) -> tuple[list[list[list[float]]], list[float]]:
    """Compress a slow capture while preserving every landmark trajectory.

    The creator can perform a difficult sign over several seconds. All source
    frames are analyzed first; only the extracted coordinates are then sampled
    across the complete motion for the requested final animation duration.
    """
    if final_duration_seconds <= 0.0:
        raise ValueError("The final sign duration must be greater than zero.")
    if not frames:
        raise ValueError("At least one landmark frame is required.")
    target_count = max(2, round(final_duration_seconds * output_fps))
    source_positions = np.linspace(0.0, len(frames) - 1, target_count)
    source = np.asarray(frames, dtype=np.float64)
    output = np.zeros((target_count, source.shape[1], 3), dtype=np.float64)
    # Interpolate each complete trajectory across temporary MediaPipe misses.
    # Looking only at the two frames surrounding a target timestamp caused
    # wrists and palms to vanish when a finger briefly crossed another finger.
    for point_index in range(source.shape[1]):
        available = np.flatnonzero(np.any(np.abs(source[:, point_index, :]) > 1e-8, axis=1))
        if not available.size:
            continue
        for axis in range(3):
            output[:, point_index, axis] = np.interp(
                source_positions,
                available,
                source[available, point_index, axis],
            )
    resampled = output.tolist()
    timestamps = [index / output_fps for index in range(target_count)]
    return resampled, timestamps


def _pixel(point: list[float], width: int, height: int) -> tuple[int, int]:
    return int(round(point[0] * width)), int(round(point[1] * height))


def draw_tracking_overlay(
    image: np.ndarray,
    frame: list[list[float]],
    active_hand: str,
) -> np.ndarray:
    """Draw the exact landmarks used by retargeting on the source image."""
    overlay = image.copy()
    height, width = overlay.shape[:2]
    face_points = frame[FACE_START : FACE_START + 468]
    hand_specs = (
        ("left", LEFT_HAND_START, (80, 220, 255)),
        ("right", RIGHT_HAND_START, (22, 217, 209)),
    )

    # Face Mesh is part of the retargeting input, so expose every detected
    # facial landmark in the diagnostic video. Drawing points without the full
    # tessellation keeps the hand readable while still proving that the chin,
    # mouth, and forehead anchors were captured.
    face_radius = 2 if min(width, height) >= 600 else 1
    detected_face_count = 0
    for point in face_points:
        if not tracked(point):
            continue
        detected_face_count += 1
        cv2.circle(
            overlay,
            _pixel(point, width, height),
            face_radius,
            (255, 190, 40),
            -1,
            cv2.LINE_AA,
        )

    for index, label, color in FACE_ANCHORS:
        point = frame[index]
        if not tracked(point):
            continue
        center = _pixel(point, width, height)
        cv2.circle(overlay, center, 8, color, 2, cv2.LINE_AA)
        cv2.putText(
            overlay,
            label,
            (center[0] + 10, center[1] - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            color,
            2,
            cv2.LINE_AA,
        )

    detected_hands: dict[str, int] = {}
    for side, hand_start, hand_color in hand_specs:
        shoulder_index, elbow_index, pose_wrist_index = POSE_ARM_INDICES[side]
        arm_indices = (shoulder_index, elbow_index, pose_wrist_index)
        arm_thickness = 5 if side == active_hand else 3
        for first, second in zip(arm_indices, arm_indices[1:]):
            if tracked(frame[first]) and tracked(frame[second]):
                cv2.line(
                    overlay,
                    _pixel(frame[first], width, height),
                    _pixel(frame[second], width, height),
                    hand_color,
                    arm_thickness,
                    cv2.LINE_AA,
                )

        hand_points = frame[hand_start : hand_start + HAND_COUNT]
        for first, second in HAND_CONNECTIONS:
            if tracked(hand_points[first]) and tracked(hand_points[second]):
                cv2.line(
                    overlay,
                    _pixel(hand_points[first], width, height),
                    _pixel(hand_points[second], width, height),
                    hand_color,
                    3 if side == active_hand else 2,
                    cv2.LINE_AA,
                )
        detected_hands[side] = sum(tracked(point) for point in hand_points)
        for index, point in enumerate(hand_points):
            if not tracked(point):
                continue
            center = _pixel(point, width, height)
            color = (40, 40, 255) if index == 0 else (255, 255, 255)
            radius = 8 if index == 0 else 5
            cv2.circle(overlay, center, radius, color, -1, cv2.LINE_AA)
            if index == 0 and side == active_hand:
                cv2.putText(
                    overlay,
                    "MUNECA MANO ACTIVA (PUNTO 0)",
                    (center[0] + 12, center[1] + 24),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    color,
                    2,
                    cv2.LINE_AA,
                )

    panel = overlay.copy()
    cv2.rectangle(panel, (0, 0), (width, 82), (7, 17, 31), -1)
    cv2.addWeighted(panel, 0.88, overlay, 0.12, 0.0, overlay)
    cv2.putText(
        overlay,
        (
            f"MANOS: IZQ {detected_hands['left']}/21 | DER {detected_hands['right']}/21 | "
            f"CARA: {detected_face_count}/468"
        ),
        (24, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        overlay,
        "Ambas manos y brazos: colores distintos | Cara: celeste | Rojo: muneca activa",
        (24, 66),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (22, 217, 209),
        1,
        cv2.LINE_AA,
    )
    return overlay


def write_tracking_preview(
    video_path: Path,
    frames: list[list[list[float]]],
    active_hand: str,
    output_path: Path,
    mirror: bool,
    fps: float,
) -> Path:
    """Write a reviewable MP4 proving which source points were detected."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Could not reopen video for tracking preview: {video_path}")
    ok, image = capture.read()
    if not ok:
        capture.release()
        raise ValueError("The source video could not be read for tracking preview.")
    if mirror:
        image = cv2.flip(image, 1)
    height, width = image.shape[:2]
    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps if fps > 0.0 else 30.0,
        (width, height),
    )
    if not writer.isOpened():
        capture.release()
        raise RuntimeError("The tracking-preview MP4 encoder could not be opened.")
    try:
        index = 0
        while ok and index < len(frames):
            writer.write(draw_tracking_overlay(image, frames[index], active_hand))
            index += 1
            ok, image = capture.read()
            if ok and mirror:
                image = cv2.flip(image, 1)
    finally:
        writer.release()
        capture.release()
    return output_path


def write_landmark_skeleton_preview(
    frames: list[list[list[float]]],
    active_hand: str,
    output_path: Path,
    fps: float,
) -> Path:
    """Render the stored landmark motion without an avatar retargeting step.

    This is intentionally a clean projected skeleton, not a recording overlay.
    It gives authors a direct visual proof of the mathematical motion asset that
    will later be mapped to an avatar rig.
    """
    if not frames:
        raise ValueError("Cannot render a skeleton preview without landmark frames.")
    width, height, margin = 720, 720, 44
    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps if fps > 0.0 else 30.0,
        (width, height),
    )
    if not writer.isOpened():
        raise RuntimeError("The skeleton-preview MP4 encoder could not be opened.")

    visible_points = [
        point
        for frame in frames
        for point in frame
        if tracked(point) and -0.2 <= point[0] <= 1.2 and -0.2 <= point[1] <= 1.4
    ]
    if not visible_points:
        raise ValueError("The captured sequence contains no visible landmarks.")
    minimum_x = min(point[0] for point in visible_points)
    maximum_x = max(point[0] for point in visible_points)
    minimum_y = min(point[1] for point in visible_points)
    maximum_y = max(point[1] for point in visible_points)
    extent = max(maximum_x - minimum_x, maximum_y - minimum_y, 0.2) * 1.12
    center_x = (minimum_x + maximum_x) * 0.5
    center_y = (minimum_y + maximum_y) * 0.5

    def pixel(point: list[float]) -> tuple[int, int]:
        # One shared scale keeps the measured pose geometry intact while
        # fitting the whole captured upper body into the review frame.
        scale = (min(width, height) - margin * 2) / extent
        return (
            int(round(width * 0.5 + (point[0] - center_x) * scale)),
            int(round(height * 0.5 + (point[1] - center_y) * scale)),
        )

    def draw_connection(
        image: np.ndarray,
        points: list[list[float]],
        first: int,
        second: int,
        color: tuple[int, int, int],
        thickness: int,
    ) -> None:
        if tracked(points[first]) and tracked(points[second]):
            cv2.line(image, pixel(points[first]), pixel(points[second]), color, thickness, cv2.LINE_AA)

    active_start = LEFT_HAND_START if active_hand == "left" else RIGHT_HAND_START
    try:
        for frame_number, frame in enumerate(frames, start=1):
            image = np.full((height, width, 3), (16, 29, 44), dtype=np.uint8)
            pose = frame[:33]
            for first, second in POSE_CONNECTIONS:
                draw_connection(image, pose, first, second, (217, 214, 32), 4)
            for index, point in enumerate(pose):
                if tracked(point):
                    cv2.circle(image, pixel(point), 5 if index in (11, 12, 13, 14, 15, 16) else 3, (250, 248, 245), -1, cv2.LINE_AA)

            # MediaPipe body pose and Face Mesh are separate landmark sets.
            # Join their measured chin to the shoulder midpoint so the review
            # reads as one articulated skeleton rather than floating dots.
            chin = frame[FACE_CHIN]
            if tracked(pose[11]) and tracked(pose[12]) and tracked(chin):
                shoulder_midpoint = [
                    (pose[11][0] + pose[12][0]) * 0.5,
                    (pose[11][1] + pose[12][1]) * 0.5,
                    0.0,
                ]
                cv2.line(image, pixel(shoulder_midpoint), pixel(chin), (217, 214, 32), 4, cv2.LINE_AA)
            face_points = [
                point for point in frame[FACE_START : FACE_START + 468] if tracked(point)
            ]
            if len(face_points) >= 8:
                left = min(point[0] for point in face_points)
                right = max(point[0] for point in face_points)
                top = min(point[1] for point in face_points)
                bottom = max(point[1] for point in face_points)
                face_center = pixel([(left + right) * 0.5, (top + bottom) * 0.5, 0.0])
                face_size = pixel([right, bottom, 0.0])
                face_origin = pixel([left, top, 0.0])
                axes = (
                    max(8, abs(face_size[0] - face_origin[0]) // 2),
                    max(10, abs(face_size[1] - face_origin[1]) // 2),
                )
                cv2.ellipse(image, face_center, axes, 0, 0, 360, (180, 180, 180), 2, cv2.LINE_AA)

            for side, start in (("left", LEFT_HAND_START), ("right", RIGHT_HAND_START)):
                hand = frame[start : start + HAND_COUNT]
                color = (64, 220, 255) if side == active_hand else (130, 120, 90)
                for first, second in HAND_CONNECTIONS:
                    draw_connection(image, hand, first, second, color, 3)
                for point in hand:
                    if tracked(point):
                        cv2.circle(image, pixel(point), 3, color, -1, cv2.LINE_AA)
                pose_wrist = POSE_LEFT_WRIST if side == "left" else POSE_RIGHT_WRIST
                if tracked(frame[pose_wrist]) and tracked(hand[0]):
                    cv2.line(image, pixel(frame[pose_wrist]), pixel(hand[0]), color, 3, cv2.LINE_AA)

            # Face points are sparse on purpose: they establish head and mouth
            # movement without obscuring the skeletal arm and hand route.
            for point in frame[FACE_START : FACE_START + 468 : 6]:
                if tracked(point):
                    cv2.circle(image, pixel(point), 1, (150, 150, 150), -1, cv2.LINE_AA)
            cv2.putText(
                image,
                "ESQUELETO CAPTURADO - SIN CORRECCION DE AVATAR",
                (24, 34),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.58,
                (225, 225, 225),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                image,
                f"CUADRO {frame_number}/{len(frames)} - MANO ACTIVA: {'IZQUIERDA' if active_start == LEFT_HAND_START else 'DERECHA'}",
                (24, 62),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (32, 214, 206),
                1,
                cv2.LINE_AA,
            )
            writer.write(image)
    finally:
        writer.release()
    return output_path


def detected_hand_center(frame: list[list[float]], side: str) -> np.ndarray | None:
    start = LEFT_HAND_START if side == "left" else RIGHT_HAND_START
    points = [point for point in frame[start : start + HAND_COUNT] if tracked(point)]
    if not points:
        return None
    return np.asarray(points, dtype=np.float64).mean(axis=0)


def fingertip_contact_center(
    frame: list[list[float]], side: str
) -> np.ndarray | None:
    """Use the central fingertip group that visibly contacts a body anchor."""
    start = LEFT_HAND_START if side == "left" else RIGHT_HAND_START
    fingertips = [
        frame[start + index]
        for index in FINGERTIP_INDICES
        if tracked(frame[start + index])
    ]
    if len(fingertips) < 3:
        return None
    return np.asarray(fingertips, dtype=np.float64).mean(axis=0)


def infer_contact_window(
    frames: list[list[list[float]]], side: str
) -> tuple[str, int, int, int]:
    """Find a sustained multi-fingertip contact with a facial anchor."""
    anchors = (
        ("chin", FACE_CHIN),
        ("mouth", FACE_UPPER_LIP),
        ("forehead", FACE_FOREHEAD),
    )
    distances: dict[str, list[float]] = {
        name: [float("inf")] * len(frames) for name, _ in anchors
    }
    for frame_index, frame in enumerate(frames):
        center = fingertip_contact_center(frame, side)
        if center is None:
            continue
        for name, landmark_index in anchors:
            anchor = frame[landmark_index]
            if tracked(anchor):
                distances[name][frame_index] = float(
                    np.linalg.norm(center[:2] - np.asarray(anchor[:2]))
                )

    best_name, best_frame, best_distance = "none", max(0, len(frames) // 3), float("inf")
    for name, values in distances.items():
        frame_index = int(np.argmin(values)) if values else 0
        if values and values[frame_index] < best_distance:
            best_name, best_frame, best_distance = name, frame_index, values[frame_index]
    if best_distance > 0.18:
        return "none", best_frame, best_frame, best_frame

    # Grow one continuous window around the best frame. The adaptive margin
    # tolerates tracking noise while preventing approach/departure frames from
    # being mistaken for stable contact.
    threshold = min(0.12, max(0.055, best_distance + 0.035))
    values = distances[best_name]
    start = best_frame
    while start > 0 and values[start - 1] <= threshold:
        start -= 1
    end = best_frame
    while end + 1 < len(values) and values[end + 1] <= threshold:
        end += 1
    return best_name, start, best_frame, end


def infer_contact(frames: list[list[list[float]]], side: str) -> tuple[str, int]:
    anchor, _, contact_frame, _ = infer_contact_window(frames, side)
    return anchor, contact_frame


def build_recipe(
    gloss: str,
    landmark_source: Path,
    frames: list[list[list[float]]],
    fps: int,
) -> SignRecipe:
    active_hand = choose_active_hand(frames)
    anchor, contact_start, contact_frame, contact_end = infer_contact_window(
        frames, active_hand
    )
    release_frame = min(
        len(frames) - 1,
        max(contact_end + 1, int(len(frames) * 0.75)),
    )
    recipe = SignRecipe(
        version=1,
        gloss=gloss.upper(),
        landmark_source=str(landmark_source),
        active_hand=active_hand,  # type: ignore[arg-type]
        contact_anchor=anchor,  # type: ignore[arg-type]
        contact_frame=contact_frame,
        release_frame=release_frame,
        palm_at_contact="camera",
        palm_at_release="up" if anchor != "none" else "camera",
        forward_distance=0.45 if anchor != "none" else 0.2,
        return_to_rest=True,
        output_fps=fps,
        contact_start_frame=contact_start,
        contact_end_frame=contact_end,
    )
    recipe.validate(len(frames))
    return recipe


def import_video(
    video_path: Path,
    gloss: str,
    output_dir: Path,
    mirror: bool,
    final_duration_seconds: float | None = None,
) -> tuple[Path, Path]:
    if video_path.suffix.lower() not in SUPPORTED_VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported video type: {video_path.suffix}")
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 15.0
    frames: list[list[list[float]]] = []
    timestamps: list[float] = []
    frame_index = 0
    with mp.solutions.holistic.Holistic(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        refine_face_landmarks=False,
    ) as holistic:
        while capture.isOpened():
            ok, image = capture.read()
            if not ok:
                break
            if mirror:
                image = cv2.flip(image, 1)
            result = holistic.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            frames.append(build_raw_frame(result))
            timestamps.append(frame_index / source_fps)
            frame_index += 1
    capture.release()
    if not frames:
        raise ValueError("The video contained no readable frames.")

    quality: CaptureQuality = evaluate_quality(frames, timestamps)
    if not quality.valid:
        reasons = ", ".join(quality.reasons)
        raise ValueError(
            "The video could not be used because pose or hand tracking was incomplete: "
            f"{reasons}. Keep the upper body and complete signing hand visible."
        )
    source_frames = frames
    source_frame_count = len(source_frames)
    source_duration_seconds = timestamps[-1] if len(timestamps) > 1 else 0.0
    output_fps = max(1, round(source_fps))
    if final_duration_seconds is not None:
        output_fps = DEFAULT_OUTPUT_FPS
        frames, timestamps = resample_landmark_sequence(
            frames,
            final_duration_seconds,
            output_fps,
        )

    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{gloss.lower()}_video_reference"
    landmark_path = output_dir / f"{stem}.json"
    source_active_hand = choose_active_hand(source_frames)
    tracking_preview_path = output_dir / f"{gloss.lower()}_tracking_preview.mp4"
    write_tracking_preview(
        video_path,
        source_frames,
        source_active_hand,
        tracking_preview_path,
        mirror,
        source_fps,
    )
    skeleton_preview_path = output_dir / f"{gloss.lower()}_captured_skeleton.mp4"
    write_landmark_skeleton_preview(
        frames, choose_active_hand(frames), skeleton_preview_path, output_fps
    )
    payload: dict[str, Any] = {
        "version": 3,
        "purpose": "creator_reference",
        "trainingEligible": False,
        "gloss": gloss.upper(),
        "createdAt": created_at,
        "capture": {
            "platform": "video_import",
            "horizontallyMirrored": mirror,
            "sourceFps": source_fps,
            "sourceFrameCount": source_frame_count,
            "sourceDurationMs": round(source_duration_seconds * 1000),
            "finalDurationMs": round((len(frames) / output_fps) * 1000),
            "temporallyResampled": final_duration_seconds is not None,
            "trackingPreview": str(tracking_preview_path),
            "skeletonPreview": str(skeleton_preview_path),
            "landmarkLayout": "pose33_left21_right21_face468",
            "localOnly": True,
        },
        "timestamps": timestamps,
        "handPresence": [has_hand(frame) for frame in frames],
        "quality": asdict(quality),
        "rawFrames": frames,
        "normalizedFrames": [normalize_frame(frame) for frame in frames],
    }
    landmark_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    recipe = build_recipe(gloss, landmark_path, frames, output_fps)
    recipe_path = output_dir / f"{gloss.lower()}.recipe.json"
    recipe.save(recipe_path)
    return landmark_path, recipe_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a local sign video for avatar authoring.")
    parser.add_argument("video", type=Path)
    parser.add_argument("--gloss", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("tmp/creator_references/video_imports"))
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--final-duration-seconds", type=float)
    args = parser.parse_args()
    landmark_path, recipe_path = import_video(
        args.video,
        args.gloss,
        args.output_dir,
        args.mirror,
        args.final_duration_seconds,
    )
    print(f"LANDMARKS={landmark_path}")
    print(f"RECIPE={recipe_path}")


if __name__ == "__main__":
    main()
