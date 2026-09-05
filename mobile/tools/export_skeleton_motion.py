"""Export a compact, avatar-independent landmark motion for the mobile viewer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


POSE_AND_HAND_POINT_COUNT = 75
FACE_START = 75
ARM_TRAJECTORY_POINT_INDEXES = (13, 14, 15, 16, 33, 54)
HAND_START_INDEXES = (33, 54)
SMOOTHING_WEIGHTS = (1, 4, 6, 4, 1)


def _is_valid_point(point: list[float]) -> bool:
    return any(abs(coordinate) > 1e-8 for coordinate in point)


def _smooth_point_trajectories(
    frames: list[dict[str, list[list[float]]]], passes: int
) -> None:
    """Smooth arm travel without deforming the captured palm or fingers."""
    if passes <= 0 or len(frames) < 3:
        return

    trajectories = {
        point_index: [frame["bodyHands"][point_index][:] for frame in frames]
        for point_index in ARM_TRAJECTORY_POINT_INDEXES
    }
    radius = len(SMOOTHING_WEIGHTS) // 2
    for _ in range(min(12, passes)):
        previous = trajectories
        trajectories = {}
        for point_index, points in previous.items():
            smoothed_points: list[list[float]] = []
            for frame_index in range(len(points)):
                weighted = [0.0, 0.0, 0.0]
                total_weight = 0
                for weight_index, weight in enumerate(SMOOTHING_WEIGHTS):
                    sample_index = min(
                        len(points) - 1,
                        max(0, frame_index + weight_index - radius),
                    )
                    sample = points[sample_index]
                    if not _is_valid_point(sample):
                        continue
                    total_weight += weight
                    for coordinate in range(3):
                        weighted[coordinate] += sample[coordinate] * weight
                smoothed_points.append(
                    [coordinate / total_weight for coordinate in weighted]
                    if total_weight > 0
                    else points[frame_index][:]
                )
            trajectories[point_index] = smoothed_points

    for frame_index, frame in enumerate(frames):
        body_hands = frame["bodyHands"]
        for point_index in ARM_TRAJECTORY_POINT_INDEXES[:4]:
            if _is_valid_point(body_hands[point_index]):
                body_hands[point_index] = trajectories[point_index][frame_index]
        for hand_start in HAND_START_INDEXES:
            captured_wrist = body_hands[hand_start]
            if not _is_valid_point(captured_wrist):
                continue
            smoothed_wrist = trajectories[hand_start][frame_index]
            offset = [
                smoothed_wrist[coordinate] - captured_wrist[coordinate]
                for coordinate in range(3)
            ]
            for hand_index in range(hand_start, hand_start + 21):
                body_hands[hand_index] = [
                    body_hands[hand_index][coordinate] + offset[coordinate]
                    for coordinate in range(3)
                ]


def export_motion(source: Path, output: Path, fps: int, recipe_path: Path | None = None) -> None:
    """Keep the full captured body, hand and Face Mesh motion."""
    payload = json.loads(source.read_text(encoding="utf-8"))
    frames = payload.get("rawFrames", [])
    if not frames:
        raise ValueError("The source capture contains no landmark frames.")
    recipe: dict[str, object] = {}
    if recipe_path is not None:
        recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
        source_start = int(recipe.get("source_start_frame", 0))
        raw_source_end = recipe.get("source_end_frame")
        source_end = len(frames) - 1 if raw_source_end is None else int(raw_source_end)
        if not 0 <= source_start < source_end < len(frames):
            raise ValueError("The recipe source frame range is invalid.")
        frames = frames[source_start : source_end + 1]
    motion_frames: list[dict[str, list[list[float]]]] = []
    for frame in frames:
        if len(frame) < FACE_START + 468:
            raise ValueError("The source capture does not use the 543-point layout.")
        motion_frames.append(
            {
                "bodyHands": frame[:POSE_AND_HAND_POINT_COUNT],
                "face": frame[FACE_START : FACE_START + 468],
            }
        )
    smoothing_passes = int(recipe.get("arm_trajectory_smoothing_passes", 0))
    _smooth_point_trajectories(motion_frames, smoothing_passes)
    output.parent.mkdir(parents=True, exist_ok=True)
    profile: dict[str, object] = {}
    if recipe_path is not None:
        profile = {
            "activeHand": str(recipe.get("active_hand", "left")),
            "contactAnchor": str(recipe.get("contact_anchor", "none")),
            "contactStartFrame": int(recipe.get("contact_start_frame", recipe.get("contact_frame", -1))),
            "contactEndFrame": int(recipe.get("contact_end_frame", recipe.get("contact_frame", -1))),
            "palmAtContact": str(recipe.get("palm_at_contact", "camera")),
        }
    output.write_text(
        json.dumps(
            {
                "version": 1,
                "fps": fps,
                "frames": motion_frames,
                "layout": "pose33_left21_right21_face468",
                "avatarProfile": profile,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--recipe", type=Path)
    args = parser.parse_args()
    export_motion(args.source, args.output, args.fps, args.recipe)


if __name__ == "__main__":
    main()
