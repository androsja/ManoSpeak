import json
import os
from pathlib import Path

from src import sign_authoring_editor
from src.sign_authoring_editor import SignAuthoringEditor
from src.sign_catalog import SignCatalogEntry


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


def test_recording_for_gloss_finds_take_inside_its_library_folder(
    tmp_path: Path,
) -> None:
    sign_directory = tmp_path / "emergencia"
    sign_directory.mkdir()
    recording = sign_directory / "take.mp4"
    recording.touch()

    assert (
        SignAuthoringEditor._recording_for_gloss("EMERGENCIA", tmp_path)
        == recording
    )
    assert SignAuthoringEditor._recording_for_gloss("HOLA", tmp_path) is None


def test_mobile_preview_stages_latest_recordings_and_manifest(tmp_path: Path) -> None:
    recording_root = tmp_path / "recorded"
    sign_directory = recording_root / "ayer"
    sign_directory.mkdir(parents=True)
    older = sign_directory / "older.mp4"
    newest = sign_directory / "newest.mp4"
    older.write_bytes(b"older")
    newest.write_bytes(b"newest")
    os.utime(older, (1_700_000_000, 1_700_000_000))
    os.utime(newest, (1_700_000_010, 1_700_000_010))
    runtime_dir = tmp_path / "runtime"

    manifest = SignAuthoringEditor._stage_mobile_preview_recordings(
        ["AYER", "HOLA"],
        runtime_dir,
        recording_root,
    )

    assert manifest == {"AYER": "./recordings/source-000.mp4"}
    assert (runtime_dir / "recordings/source-000.mp4").read_bytes() == b"newest"
    assert json.loads((runtime_dir / "recordings.json").read_text()) == manifest


def test_mobile_preview_signature_changes_when_reviewed_input_changes(
    tmp_path: Path,
) -> None:
    recipe = tmp_path / "hola.recipe.json"
    landmarks = tmp_path / "hola.landmarks.json"
    runtime = tmp_path / "avatar-runtime.ts"
    recipe.write_text("recipe-v1", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    runtime.write_text("runtime", encoding="utf-8")
    original = SignAuthoringEditor._mobile_preview_signature(
        recipe,
        landmarks,
        (runtime,),
    )

    recipe.write_text("recipe-v2-with-change", encoding="utf-8")
    changed = SignAuthoringEditor._mobile_preview_signature(
        recipe,
        landmarks,
        (runtime,),
    )

    assert changed != original


def test_mobile_preview_directories_are_isolated_between_editor_processes() -> None:
    first = SignAuthoringEditor._mobile_preview_root(1001)
    second = SignAuthoringEditor._mobile_preview_root(1002)

    assert first != second
    assert first.parent == second.parent
    assert first.name == "editor-1001"
    assert second.name == "editor-1002"


def test_mobile_preview_includes_library_and_unpublished_candidate(
    tmp_path: Path,
) -> None:
    manifest = tmp_path / "published_signs.json"
    manifest.write_text(
        '{"publishedGlosses": ["HOLA", "AYUDAR", "HOLA"]}',
        encoding="utf-8",
    )

    glosses = SignAuthoringEditor._mobile_preview_glosses("ALLÁ", manifest)

    assert glosses == ["HOLA", "AYUDAR", "ALLÁ"]


def test_publication_is_blocked_until_current_mobile_preview_is_reviewed(
    tmp_path: Path,
    monkeypatch,
) -> None:
    recipe = tmp_path / "hola.recipe.json"
    landmarks = tmp_path / "hola.landmarks.json"
    recipe.write_text("recipe", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = object()
    editor.created_sign_paths = {"HOLA": (recipe, landmarks)}
    editor.mobile_preview_signatures = {}
    warnings: list[str] = []
    monkeypatch.setattr(
        sign_authoring_editor.messagebox,
        "showwarning",
        lambda _title, message, **_kwargs: warnings.append(message),
    )

    assert editor._confirm_mobile_previews(["HOLA"]) is False
    assert "SIMULAR APP MÓVIL" in warnings[0]

    editor.mobile_preview_signatures["HOLA"] = editor._mobile_preview_signature(
        recipe,
        landmarks,
    )
    monkeypatch.setattr(
        sign_authoring_editor.messagebox,
        "askyesno",
        lambda *_args, **_kwargs: True,
    )

    assert editor._confirm_mobile_previews(["HOLA"]) is True


def test_mobile_library_summary_only_reports_counts() -> None:
    summary = SignAuthoringEditor._mobile_library_summary(
        {"HOLA", "MAMA"}, {"HOLA", "MAMA", "YO"}
    )

    assert summary == "APP MÓVIL: 2 PUBLICADAS · 1 PENDIENTES"
    assert "HOLA" not in summary


def test_edited_voice_words_are_exact_and_keep_the_base_name_automatic() -> None:
    aliases = SignAuthoringEditor._parse_edited_speech_aliases(
        "HERMANO",
        "hermana, hermanos\nHERMANA, hermano",
    )

    assert aliases == ["hermana", "hermanos"]


def test_recipe_voice_override_does_not_restore_deleted_defaults(
    tmp_path: Path,
) -> None:
    recipe_path = tmp_path / "hermano.recipe.json"
    recipe_path.write_text(
        '{"speech_aliases": ["hermana"], "speech_aliases_overridden": true}',
        encoding="utf-8",
    )
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)

    assert editor._speech_aliases_for_recipe("HERMANO", recipe_path) == ["hermana"]


def test_loaded_sign_review_is_not_blocked_by_another_queue_selection() -> None:
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.loaded_review_gloss = "GRACIAS"
    editor._selected_created_gloss = lambda silent=False: ("AYER", Path("ayer.recipe.json"), Path("ayer.landmarks.json"))

    assert editor._can_open_loaded_review("los puntos detectados") is True


def test_mobile_install_failure_details_keep_stdout_and_stderr() -> None:
    error = sign_authoring_editor.subprocess.CalledProcessError(
        1,
        ["./gradlew", ":app:assembleRelease"],
        output="FAILURE: Build failed\nExecution failed for task ':app:bundleReleaseJsAndAssets'.",
        stderr="warning: generated bundle warning",
    )

    details = SignAuthoringEditor._mobile_install_failure_details(error)

    assert "Execution failed for task" in details
    assert "generated bundle warning" in details
    assert "Exit code: 1" in details


def test_mobile_install_failure_summary_prefers_actionable_error() -> None:
    details = """warning: generated bundle warning
No modules to process in combine-js-to-schema-cli.
Execution failed for task ':app:bundleReleaseJsAndAssets'.
"""

    summary = SignAuthoringEditor._mobile_install_failure_summary(details)

    assert summary == "Execution failed for task ':app:bundleReleaseJsAndAssets'."


class _StatusValue:
    def __init__(self, value: object = "") -> None:
        self.value = value

    def set(self, value: object) -> None:
        self.value = value

    def get(self) -> object:
        return self.value


def test_using_suggestion_loads_it_then_requests_a_different_random_word() -> None:
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.current_suggestion = SignCatalogEntry(
        category="Necesidades y emergencia",
        gloss="EMERGENCIA",
    )
    editor.gloss = _StatusValue()
    editor.duration_seconds = _StatusValue()
    editor.video_path = _StatusValue("old.mp4")
    editor.step_status = _StatusValue()
    editor.status = _StatusValue()
    aliases_loaded: list[str] = []
    workflow_resets: list[bool] = []
    excluded: list[str | None] = []
    editor._set_default_speech_aliases = aliases_loaded.append
    editor._reset_workflow_after_video = lambda: workflow_resets.append(True)
    editor._refresh_sign_suggestions = (
        lambda exclude_gloss=None: excluded.append(exclude_gloss)
    )

    editor._use_current_suggestion()

    assert editor.gloss.value == "EMERGENCIA"
    assert editor.video_path.value == ""
    assert aliases_loaded == ["EMERGENCIA"]
    assert workflow_resets == [True]
    assert excluded == ["EMERGENCIA"]
    assert "otra palabra" in str(editor.status.value)


def test_random_suggestion_excludes_the_word_just_prepared(monkeypatch) -> None:
    previous = SignCatalogEntry("Necesidades y emergencia", "EMERGENCIA")
    next_word = SignCatalogEntry("Necesidades y emergencia", "HOSPITAL")
    editor = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.created_sign_paths = {}
    editor.suggestion_category = _StatusValue("Necesidades y emergencia")
    editor.suggestion_label = _StatusValue()
    editor._published_mobile_glosses = lambda: set()
    editor._aliases_for_gloss = lambda _gloss: []
    offered_pools: list[tuple[SignCatalogEntry, ...]] = []
    monkeypatch.setattr(
        sign_authoring_editor,
        "suggested_signs",
        lambda _existing, _category: (previous, next_word),
    )

    def choose(pool: tuple[SignCatalogEntry, ...]) -> SignCatalogEntry:
        offered_pools.append(pool)
        return pool[0]

    monkeypatch.setattr(sign_authoring_editor.random, "choice", choose)

    editor._refresh_sign_suggestions(exclude_gloss="EMERGENCIA")

    assert offered_pools == [(next_word,)]
    assert editor.current_suggestion == next_word


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
    editor._confirm_mobile_previews = lambda _glosses: True

    exported: list[str] = []
    registered: list[str] = []
    wrote_manifest: list[bool] = []
    editor._export_mobile_motion = (
        lambda gloss, _recipe, _landmarks: exported.append(gloss)
    )
    editor._register_published_linguistic_entry = (
        lambda gloss, _recipe: registered.append(gloss)
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "write_published_motion_manifest",
        lambda: wrote_manifest.append(True),
    )
    monkeypatch.setattr(sign_authoring_editor.messagebox, "askyesno", lambda *args, **kwargs: False)

    editor._publish_all_signs()

    assert exported == ["MAMA", "YO"]
    assert registered == ["MAMA", "YO"]
    assert wrote_manifest == [True]
    assert editor.step_status.value.startswith("PUBLICACIÓN TERMINADA: 2 SEÑAS")
