"""Orchestrate local video-to-avatar sign preview generation."""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
DRAFT_BUILDER = REPO_ROOT / "ml/src/blender_build_avatar_draft.py"
RECIPE_APPLIER = REPO_ROOT / "ml/src/blender_apply_recipe.py"
PREVIEW_RENDERER = REPO_ROOT / "ml/src/blender_render_preview.py"
SPATIAL_INTENT_COMPILER = REPO_ROOT / "mobile/tools/compile-spatial-authoring-intent.cjs"
SPATIAL_INTENT_PROFILE = REPO_ROOT / "schemas/rig-profiles/vozual-rig-1.v2.json"
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


@dataclass(frozen=True)
class SpatialAuthoringValidation:
    """A validated spatial trace for review; never an executable motion plan."""

    trace: dict[str, object]


def build_phrase_scoped_spatial_draft(
    spoken_text: str,
    gloss_sequence: tuple[str, ...],
    trace: Mapping[str, object],
) -> dict[str, object]:
    """Bind an unreviewed spatial trace to exactly one phrase's source content."""
    phrase_context = {
        "spokenText": spoken_text.strip(),
        "glossSequence": list(gloss_sequence),
    }
    if not phrase_context["spokenText"] or not gloss_sequence:
        raise ValueError("A phrase draft needs its text and sign sequence.")
    if (
        trace.get("schema") != "vozual.bound-spatial-authoring-trace"
        or trace.get("execution") != "authoring-only-not-executable"
        or trace.get("linguisticReviewStatus") != "unreviewed"
    ):
        raise ValueError("Only an unreviewed, non-executable spatial trace can bind to a phrase draft.")

    phrase_bytes = json.dumps(
        phrase_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    phrase_sha256 = hashlib.sha256(phrase_bytes).hexdigest()
    return {
        "schema": "vozual.phrase-spatial-authoring-draft",
        "schemaVersion": 1,
        "status": "draft-unreviewed",
        "phraseRef": {
            "id": f"phrase.{phrase_sha256[:24]}",
            "sha256": phrase_sha256,
        },
        "phrase": phrase_context,
        "spatialTrace": dict(trace),
        "execution": "authoring-only-not-executable",
        "linguisticReviewStatus": "unreviewed",
    }


def save_phrase_scoped_spatial_draft(
    destination: Path,
    draft: dict[str, object],
) -> Path:
    """Atomically save a user-selected phrase draft file, never a shared catalog entry."""
    if destination.suffix.lower() != ".json" or not destination.parent.is_dir():
        raise ValueError("Choose a JSON file in an existing authoring folder.")
    if (
        draft.get("schema") != "vozual.phrase-spatial-authoring-draft"
        or draft.get("execution") != "authoring-only-not-executable"
        or draft.get("linguisticReviewStatus") != "unreviewed"
    ):
        raise ValueError("Only an unreviewed, non-executable phrase draft can be saved.")
    trace = draft.get("spatialTrace")
    if (
        not isinstance(trace, Mapping)
        or trace.get("schema") != "vozual.bound-spatial-authoring-trace"
        or not isinstance(trace.get("formatVersion"), int)
        or isinstance(trace.get("formatVersion"), bool)
        or trace.get("formatVersion") != 2
        or trace.get("execution") != draft.get("execution")
        or trace.get("linguisticReviewStatus") != draft.get("linguisticReviewStatus")
    ):
        raise ValueError("Invalid or inconsistent spatial trace in phrase draft.")
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(draft, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def validate_spatial_authoring_draft(
    draft_path: Path,
    temporal_path: Path | None = None,
) -> SpatialAuthoringValidation:
    """Validate a selected spatial draft through the v2 CLI without persisting it."""
    node = require_executable("node")
    paths = [draft_path, SPATIAL_INTENT_PROFILE, SPATIAL_INTENT_COMPILER]
    if temporal_path is not None:
        paths.append(temporal_path)
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(path)

    command = [
        node,
        str(SPATIAL_INTENT_COMPILER),
        "--draft",
        str(draft_path.resolve()),
        "--profile",
        str(SPATIAL_INTENT_PROFILE),
    ]
    if temporal_path is not None:
        command.extend(("--timeline", str(temporal_path.resolve())))
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(details[-3000:] or "Spatial authoring validation failed.")

    try:
        trace = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Spatial authoring validator returned invalid JSON.") from error
    if (
        not isinstance(trace, dict)
        or trace.get("schema") != "vozual.bound-spatial-authoring-trace"
        or trace.get("execution") != "authoring-only-not-executable"
        or trace.get("linguisticReviewStatus") != "unreviewed"
    ):
        raise RuntimeError("Spatial authoring validator returned an unexpected or executable result.")
    return SpatialAuthoringValidation(trace=trace)


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
    parser = argparse.ArgumentParser(description="Generate a Vozual avatar preview.")
    parser.add_argument("landmarks", type=Path)
    parser.add_argument("recipe", type=Path)
    parser.add_argument("avatar", type=Path)
    args = parser.parse_args()
    outputs = generate_preview(args.landmarks, args.recipe, args.avatar)
    print(f"BLEND={outputs.corrected}")
    print(f"VIDEO={outputs.video}")


if __name__ == "__main__":
    main()
