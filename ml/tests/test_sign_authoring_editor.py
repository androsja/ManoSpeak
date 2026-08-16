import os
from pathlib import Path

from src import sign_authoring_editor
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


def test_mobile_library_summary_only_reports_counts() -> None:
    summary = SignAuthoringEditor._mobile_library_summary(
        {"HOLA", "MAMA"}, {"HOLA", "MAMA", "YO"}
    )

    assert summary == "APP MÓVIL: 2 PUBLICADAS · 1 PENDIENTES"
    assert "HOLA" not in summary


class _StatusValue:
    def __init__(self) -> None:
        self.value = ""

    def set(self, value: str) -> None:
        self.value = value


def test_publish_all_signs_exports_every_pending_sign(monkeypatch) -> None:
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = object()
    editor.created_sign_paths = {
        "HOLA": (Path("hola.recipe.json"), Path("hola.landmarks.json")),
        "MAMA": (Path("mama.recipe.json"), Path("mama.landmarks.json")),
        "YO": (Path("yo.recipe.json"), Path("yo.landmarks.json")),
    }
    editor.step_status = _StatusValue()
    editor.status = _StatusValue()
    editor._refresh_created_signs = lambda: None
    editor._published_mobile_glosses = lambda: {"HOLA"}

    exported: list[str] = []
    written_catalogs: list[set[str]] = []
    editor._export_mobile_motion = (
        lambda gloss, _recipe, _landmarks: exported.append(gloss)
    )
    editor._write_published_mobile_glosses = (
        lambda glosses: written_catalogs.append(set(glosses))
    )
    monkeypatch.setattr(sign_authoring_editor.messagebox, "askyesno", lambda *args, **kwargs: False)

    editor._publish_all_signs()

    assert exported == ["MAMA", "YO"]
    assert written_catalogs == [{"HOLA", "MAMA", "YO"}]
    assert editor.step_status.value.startswith("PUBLICACIÓN TERMINADA: 2 SEÑAS")
