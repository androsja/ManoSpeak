"""Orchestrate local video-to-avatar sign preview generation."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import shutil
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
DRAFT_BUILDER = REPO_ROOT / "ml/src/blender_build_avatar_draft.py"
RECIPE_APPLIER = REPO_ROOT / "ml/src/blender_apply_recipe.py"
PREVIEW_RENDERER = REPO_ROOT / "ml/src/blender_render_preview.py"
EXECUTABLE_CANDIDATES = {
    "blender": (
        Path("/Applications/Blender.app/Contents/MacOS/Blender"),
        Path("/opt/homebrew/bin/blender"),
        Path("/usr/local/bin/blender"),
    ),
    "ffmpeg": (
        Path("/opt/homebrew/bin/ffmpeg"),
        Path("/usr/local/bin/ffmpeg"),
    ),
}


@dataclass(frozen=True)
class AuthoringOutputs:
    draft: Path
    corrected: Path
    video: Path


def require_executable(name: str) -> str:
    executable = shutil.which(name)
    if executable is not None:
        return executable
    for candidate in EXECUTABLE_CANDIDATES.get(name, ()):
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError(
        f"No se encontró {name}. Instálalo o abre VOZUAL nuevamente después de instalarlo."
    )


def run_checked(command: list[str]) -> None:
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(details[-3000:])


def generate_preview(
    landmark_path: Path,
    recipe_path: Path,
    source_avatar: Path,
) -> AuthoringOutputs:
    """Generate a corrected Blender file and an H.264 MP4 preview."""
    blender = require_executable("blender")
    ffmpeg = require_executable("ffmpeg")
    for path in (landmark_path, recipe_path, source_avatar):
        if not path.is_file():
            raise FileNotFoundError(path)

    output_dir = recipe_path.resolve().parent
    draft = output_dir / "avatar_draft.blend"
    corrected = output_dir / "avatar_corrected.blend"
    frames_dir = output_dir / "preview_frames"
    video = output_dir / "avatar_preview.mp4"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old_frame in frames_dir.glob("frame_*.png"):
        old_frame.unlink()
    # A failed generation must never leave a stale preview that looks like the
    # new result. The editor only opens a video created by this exact run.
    video.unlink(missing_ok=True)

    run_checked(
        [
            blender,
            "--background",
            "--python",
            str(DRAFT_BUILDER),
            "--",
            str(source_avatar.resolve()),
            str(landmark_path.resolve()),
            str(recipe_path.resolve()),
            str(draft),
        ]
    )
    run_checked(
        [
            blender,
            "--background",
            str(draft),
            "--python",
            str(RECIPE_APPLIER),
            "--",
            str(draft),
            str(recipe_path.resolve()),
            str(corrected),
        ]
    )
    run_checked(
        [
            blender,
            "--background",
            str(corrected),
            "--python",
            str(PREVIEW_RENDERER),
            "--",
            str(frames_dir),
        ]
    )

    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    fps = max(1, int(recipe["output_fps"]))
    run_checked(
        [
            ffmpeg,
            "-y",
            "-framerate",
            str(fps),
            "-i",
            str(frames_dir / "frame_%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(video),
        ]
    )
    return AuthoringOutputs(draft=draft, corrected=corrected, video=video)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a ManoSpeak avatar preview.")
    parser.add_argument("landmarks", type=Path)
    parser.add_argument("recipe", type=Path)
    parser.add_argument("avatar", type=Path)
    args = parser.parse_args()
    outputs = generate_preview(args.landmarks, args.recipe, args.avatar)
    print(f"BLEND={outputs.corrected}")
    print(f"VIDEO={outputs.video}")


if __name__ == "__main__":
    main()
