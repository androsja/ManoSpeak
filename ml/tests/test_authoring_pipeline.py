from pathlib import Path

import pytest

from src import authoring_pipeline


def test_blender_pipeline_scripts_live_in_source_tree() -> None:
    scripts = (
        authoring_pipeline.DRAFT_BUILDER,
        authoring_pipeline.RECIPE_APPLIER,
        authoring_pipeline.PREVIEW_RENDERER,
    )

    assert all(path.is_file() for path in scripts)
    assert all(
        "tmp" not in path.relative_to(authoring_pipeline.REPO_ROOT).parts
        for path in scripts
    )


def test_require_executable_uses_shell_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(authoring_pipeline.shutil, "which", lambda name: f"/bin/{name}")

    assert authoring_pipeline.require_executable("blender") == "/bin/blender"


def test_require_executable_uses_macos_application_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executable = tmp_path / "Blender"
    executable.touch()
    monkeypatch.setattr(authoring_pipeline.shutil, "which", lambda name: None)
    monkeypatch.setitem(
        authoring_pipeline.EXECUTABLE_CANDIDATES,
        "blender",
        (executable,),
    )

    assert authoring_pipeline.require_executable("blender") == str(executable)


def test_require_executable_reports_missing_dependency(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(authoring_pipeline.shutil, "which", lambda name: None)
    monkeypatch.setitem(
        authoring_pipeline.EXECUTABLE_CANDIDATES,
        "blender",
        (tmp_path / "missing",),
    )

    with pytest.raises(RuntimeError, match="No se encontró blender"):
        authoring_pipeline.require_executable("blender")
