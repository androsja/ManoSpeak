"""Export a compact, avatar-independent landmark motion for the mobile viewer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


POSE_AND_HAND_POINT_COUNT = 75
FACE_START = 75


def export_motion(source: Path, output: Path, fps: int) -> None:
    """Keep the full captured body, hand and Face Mesh motion."""
    payload = json.loads(source.read_text(encoding="utf-8"))
    frames = payload.get("rawFrames", [])
    if not frames:
        raise ValueError("The source capture contains no landmark frames.")
    motion_frames = []
    for frame in frames:
        if len(frame) < FACE_START + 468:
            raise ValueError("The source capture does not use the 543-point layout.")
        motion_frames.append(
            {
                "bodyHands": frame[:POSE_AND_HAND_POINT_COUNT],
                "face": frame[FACE_START : FACE_START + 468],
            }
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "version": 1,
                "fps": fps,
                "frames": motion_frames,
                "layout": "pose33_left21_right21_face468",
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
    args = parser.parse_args()
    export_motion(args.source, args.output, args.fps)


if __name__ == "__main__":
    main()
