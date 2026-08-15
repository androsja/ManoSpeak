"""Compose a clean body/hand trajectory with a full Face Mesh recording.

Desktop captures may lose Face Mesh while a hand is near the face.  This tool
keeps the accurately tracked body trajectory, carries over the tracked hand
relative to its wrist, and supplies the face landmarks from a matching video
capture.  The result stays in the same 543-landmark format used by the app.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


POSE_COUNT = 33
HAND_STARTS = (33, 54)
HAND_SIZE = 21
FACE_START = 75
FACE_SIZE = 468
Point = list[float]
RawFrame = list[Point]


def present(point: Point) -> bool:
    return any(abs(value) > 1e-8 for value in point)


def mix(first: Point, second: Point, amount: float) -> Point:
    if not present(first):
        return list(second)
    if not present(second):
        return list(first)
    return [first[index] + (second[index] - first[index]) * amount for index in range(3)]


def sample(frames: list[RawFrame], position: float) -> RawFrame:
    if len(frames) == 1:
        return [list(point) for point in frames[0]]
    scaled = max(0.0, min(1.0, position)) * (len(frames) - 1)
    lower = int(scaled)
    upper = min(len(frames) - 1, lower + 1)
    amount = scaled - lower
    return [mix(frames[lower][index], frames[upper][index], amount) for index in range(len(frames[0]))]


def nearest_wrist(frame: RawFrame, hand_start: int) -> int | None:
    root = frame[hand_start]
    if not present(root):
        return None
    choices = [15, 16]
    usable = [index for index in choices if present(frame[index])]
    if not usable:
        return None
    return min(
        usable,
        key=lambda index: sum((root[axis] - frame[index][axis]) ** 2 for axis in range(3)),
    )


def tracked_hand(frame: RawFrame) -> tuple[int, int] | None:
    candidates = []
    for hand_start in HAND_STARTS:
        wrist = nearest_wrist(frame, hand_start)
        if wrist is not None:
            candidates.append((hand_start, wrist))
    if not candidates:
        return None
    # The sign hand has the most tracked finger joints in the source frame.
    return max(candidates, key=lambda item: sum(present(frame[item[0] + offset]) for offset in range(HAND_SIZE)))


def frames_from(path: Path) -> list[RawFrame]:
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    frames = payload.get("rawFrames", [])
    if not frames or any(len(frame) < FACE_START + FACE_SIZE for frame in frames):
        raise ValueError(f"{path} does not contain 543-landmark frames.")
    return frames


def compose(body_source: Path, face_source: Path, output: Path, frame_count: int, fps: int) -> None:
    body_frames = frames_from(body_source)
    face_frames = frames_from(face_source)
    result: list[dict[str, list[Point]]] = []
    for index in range(frame_count):
        progress = index / max(1, frame_count - 1)
        body = sample(body_frames, progress)
        face_frame = sample(face_frames, progress)
        body_hands = [list(point) for point in body[:FACE_START]]
        source_hand = tracked_hand(face_frame)
        if source_hand is not None:
            hand_start, source_wrist_index = source_hand
            target_wrist_index = source_wrist_index
            source_wrist = face_frame[source_wrist_index]
            target_wrist = body_hands[target_wrist_index]
            if present(source_wrist) and present(target_wrist):
                delta = [target_wrist[axis] - source_wrist[axis] for axis in range(3)]
                for finger_index in range(HAND_SIZE):
                    point = face_frame[hand_start + finger_index]
                    if present(point):
                        body_hands[33 + finger_index] = [point[axis] + delta[axis] for axis in range(3)]
        result.append({"bodyHands": body_hands, "face": face_frame[FACE_START : FACE_START + FACE_SIZE]})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"version": 1, "fps": fps, "frames": result, "layout": "pose33_left21_right21_face468"}, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("body_source", type=Path)
    parser.add_argument("face_source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", type=int, default=30)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()
    compose(args.body_source, args.face_source, args.output, args.frames, args.fps)


if __name__ == "__main__":
    main()
