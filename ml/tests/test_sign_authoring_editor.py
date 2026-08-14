import os
from pathlib import Path

from src.sign_authoring_editor import SignAuthoringEditor


def test_latest_recording_returns_newest_supported_video(tmp_path: Path) -> None:
    older = tmp_path / "older.mp4"
    newer = tmp_path / "newer.mov"
    ignored = tmp_path / "notes.txt"
    older.touch()
    newer.touch()
    ignored.touch()
    older_mtime = 1_700_000_000
    newer_mtime = older_mtime + 10
    os.utime(older, (older_mtime, older_mtime))
    os.utime(newer, (newer_mtime, newer_mtime))

    assert SignAuthoringEditor._latest_recording(tmp_path) == newer


def test_latest_recording_returns_none_for_empty_directory(tmp_path: Path) -> None:
    assert SignAuthoringEditor._latest_recording(tmp_path) is None
