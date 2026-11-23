"""Tests for the desktop phrase planner's non-executable spatial validator bridge."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from src import authoring_pipeline


def test_spatial_authoring_bridge_invokes_v2_cli_with_exact_profile_and_timeline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    draft = tmp_path / "draft.json"
    timeline = tmp_path / "timeline.json"
    draft.write_text("{}", encoding="utf-8")
    timeline.write_text("{}", encoding="utf-8")
    trace = {
        "schema": "vozual.bound-spatial-authoring-trace",
        "execution": "authoring-only-not-executable",
        "linguisticReviewStatus": "unreviewed",
        "relations": [],
    }
    calls: list[tuple[list[str], Path]] = []

    def fake_run(command: list[str], *, cwd: Path, capture_output: bool, text: bool):
        assert capture_output and text
        calls.append((command, cwd))
        return SimpleNamespace(returncode=0, stdout=json.dumps(trace), stderr="")

    monkeypatch.setattr(authoring_pipeline, "require_executable", lambda _name: "/usr/bin/node")
    monkeypatch.setattr(authoring_pipeline.subprocess, "run", fake_run)

    result = authoring_pipeline.validate_spatial_authoring_draft(draft, timeline)

    command, cwd = calls[0]
    assert command[:2] == ["/usr/bin/node", str(authoring_pipeline.SPATIAL_INTENT_COMPILER)]
    assert command[2:] == [
        "--draft", str(draft.resolve()),
        "--profile", str(authoring_pipeline.SPATIAL_INTENT_PROFILE),
        "--timeline", str(timeline.resolve()),
    ]
    assert cwd == authoring_pipeline.REPO_ROOT
    assert result.trace == trace


def test_spatial_authoring_bridge_rejects_cli_errors_without_creating_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    draft = tmp_path / "draft.json"
    draft.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(authoring_pipeline, "require_executable", lambda _name: "/usr/bin/node")
    monkeypatch.setattr(
        authoring_pipeline.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=2, stdout="", stderr="SCHEMA.INVALID_SPATIAL_INTENT_V2"
        ),
    )

    with pytest.raises(RuntimeError, match="SCHEMA.INVALID_SPATIAL_INTENT_V2"):
        authoring_pipeline.validate_spatial_authoring_draft(draft)

    assert list(tmp_path.iterdir()) == [draft]


def test_phrase_scoped_draft_binds_exact_phrase_and_is_saved_only_when_requested(
    tmp_path: Path,
) -> None:
    trace = {
        "schema": "vozual.bound-spatial-authoring-trace",
        "formatVersion": 2,
        "execution": "authoring-only-not-executable",
        "linguisticReviewStatus": "unreviewed",
        "relations": [],
    }
    first = authoring_pipeline.build_phrase_scoped_spatial_draft(
        "Quiero una manzana.", ("YO", "QUERER", "MANZANA"), trace
    )
    same = authoring_pipeline.build_phrase_scoped_spatial_draft(
        "Quiero una manzana.", ("YO", "QUERER", "MANZANA"), trace
    )
    changed = authoring_pipeline.build_phrase_scoped_spatial_draft(
        "Quiero tres manzanas.", ("YO", "QUERER", "MANZANA"), trace
    )
    destination = tmp_path / "one-phrase.json"

    assert first["phraseRef"] == same["phraseRef"]
    assert first["phraseRef"] != changed["phraseRef"]
    assert first["execution"] == "authoring-only-not-executable"
    assert first["linguisticReviewStatus"] == "unreviewed"
    assert authoring_pipeline.save_phrase_scoped_spatial_draft(destination, first) == destination
    assert json.loads(destination.read_text(encoding="utf-8")) == first
    assert sorted(path.name for path in tmp_path.iterdir()) == ["one-phrase.json"]


@pytest.mark.parametrize("change", [None, [], {}, {"formatVersion": True}, {"execution": "executable"}, {"linguisticReviewStatus": "approved"}, {"schema": "wrong"}])
def test_save_rejects_invalid_nested_trace_before_writing(tmp_path: Path, change: object) -> None:
    trace = {"schema": "vozual.bound-spatial-authoring-trace", "formatVersion": 2,
             "execution": "authoring-only-not-executable", "linguisticReviewStatus": "unreviewed"}
    draft = authoring_pipeline.build_phrase_scoped_spatial_draft("Hola", ("HOLA",), trace)
    if isinstance(change, dict) and change:
        draft["spatialTrace"] = {**trace, **change}
    else:
        draft["spatialTrace"] = change
    with pytest.raises(ValueError, match="spatial trace"):
        authoring_pipeline.save_phrase_scoped_spatial_draft(tmp_path / "draft.json", draft)
    assert list(tmp_path.iterdir()) == []


def test_phrase_scoped_draft_refuses_to_wrap_approved_or_executable_trace() -> None:
    approved_trace = {
        "schema": "vozual.bound-spatial-authoring-trace",
        "execution": "authoring-only-not-executable",
        "linguisticReviewStatus": "approved",
    }

    with pytest.raises(ValueError, match="Only an unreviewed"):
        authoring_pipeline.build_phrase_scoped_spatial_draft(
            "Quiero una manzana.", ("YO", "QUERER", "MANZANA"), approved_trace
        )


@pytest.mark.parametrize(
    "trace",
    [
        {"schema": "wrong", "execution": "authoring-only-not-executable", "linguisticReviewStatus": "unreviewed"},
        {"schema": "vozual.bound-spatial-authoring-trace", "execution": "executable", "linguisticReviewStatus": "unreviewed"},
        {"schema": "vozual.bound-spatial-authoring-trace", "execution": "authoring-only-not-executable", "linguisticReviewStatus": "approved"},
    ],
)
def test_spatial_authoring_bridge_rejects_wrong_or_approved_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, trace: dict[str, str]
) -> None:
    draft = tmp_path / "draft.json"
    draft.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(authoring_pipeline, "require_executable", lambda _name: "/usr/bin/node")
    monkeypatch.setattr(
        authoring_pipeline.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0, stdout=json.dumps(trace), stderr=""
        ),
    )

    with pytest.raises(RuntimeError, match="unexpected or executable result"):
        authoring_pipeline.validate_spatial_authoring_draft(draft)
