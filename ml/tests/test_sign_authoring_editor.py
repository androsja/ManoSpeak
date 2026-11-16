import io
import json
import os
from pathlib import Path
from typing import Any

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


def test_mobile_preview_prefers_the_actor_video_selected_in_editor(
    tmp_path: Path,
) -> None:
    recording_root = tmp_path / "recorded"
    sign_directory = recording_root / "ayudar"
    sign_directory.mkdir(parents=True)
    (sign_directory / "library.mp4").write_bytes(b"library")
    selected_video = tmp_path / "selected-actor.mov"
    selected_video.write_bytes(b"selected")
    runtime_dir = tmp_path / "runtime"

    manifest = SignAuthoringEditor._stage_mobile_preview_recordings(
        ["AYUDAR"],
        runtime_dir,
        recording_root,
        {"AYUDAR": selected_video},
    )

    assert manifest == {"AYUDAR": "./recordings/source-000.mov"}
    assert (runtime_dir / "recordings/source-000.mov").read_bytes() == b"selected"


def test_mobile_preview_records_trim_offset_for_actor_comparison(
    tmp_path: Path,
) -> None:
    selected_video = tmp_path / "buenas-tardes.mp4"
    selected_video.write_bytes(b"selected")
    runtime_dir = tmp_path / "runtime"

    manifest = SignAuthoringEditor._stage_mobile_preview_recordings(
        ["BUENAS TARDES"],
        runtime_dir,
        preferred_recordings={"BUENAS TARDES": selected_video},
        recording_start_offsets_ms={"BUENAS TARDES": 600},
    )

    assert manifest == {
        "BUENAS TARDES": {
            "url": "./recordings/source-000.mp4",
            "startMs": 600,
        }
    }
    assert json.loads((runtime_dir / "recordings.json").read_text()) == manifest


def test_mobile_preview_records_source_duration_for_synchronized_playback(
    tmp_path: Path,
) -> None:
    selected_video = tmp_path / "cuanto.mp4"
    selected_video.write_bytes(b"selected")
    runtime_dir = tmp_path / "runtime"

    manifest = SignAuthoringEditor._stage_mobile_preview_recordings(
        ["CUÁNTO"],
        runtime_dir,
        preferred_recordings={"CUÁNTO": selected_video},
        recording_durations_ms={"CUÁNTO": 1667},
    )

    assert manifest == {
        "CUÁNTO": {
            "url": "./recordings/source-000.mp4",
            "durationMs": 1667,
        }
    }
    assert json.loads((runtime_dir / "recordings.json").read_text()) == manifest


def test_recipe_output_frame_count_applies_source_trim() -> None:
    assert SignAuthoringEditor._recipe_output_frame_count(
        {"source_start_frame": 18, "source_end_frame": 47},
        48,
    ) == 30


def test_avatar_duration_matches_recording_by_default() -> None:
    duration = sign_authoring_editor._resolved_avatar_duration_seconds(
        10.0,
        1.5,
        sign_authoring_editor.DURATION_MODE_MATCH_RECORDING,
    )

    assert duration == 10.0


def test_avatar_duration_can_compress_a_slow_recording() -> None:
    duration = sign_authoring_editor._resolved_avatar_duration_seconds(
        10.0,
        1.5,
        sign_authoring_editor.DURATION_MODE_CUSTOM,
    )

    assert duration == 1.5


def test_loaded_compressed_sign_restores_both_duration_controls() -> None:
    recording_duration, mode = SignAuthoringEditor._duration_settings_from_reference(
        {
            "capture": {
                "sourceFrameCount": 300,
                "sourceFps": 30,
                "sourceDurationMs": 9967,
            }
        },
        1.5,
    )

    assert recording_duration == 10.0
    assert mode == sign_authoring_editor.DURATION_MODE_CUSTOM


def test_loaded_regular_sign_keeps_linked_duration_mode() -> None:
    recording_duration, mode = SignAuthoringEditor._duration_settings_from_reference(
        {"capture": {"sourceFrameCount": 36, "sourceFps": 30}},
        1.2,
    )

    assert recording_duration == 1.2
    assert mode == sign_authoring_editor.DURATION_MODE_MATCH_RECORDING


def test_mobile_preview_normalizes_generic_hand_keyframes() -> None:
    normalized = sign_authoring_editor._normalized_rig_hand_keyframes(
        [
            {
                "frame": 14,
                "transitionFrames": 5,
                "smile": 0.22,
                "mouthPucker": 0.6,
                "mouthOpening": 0.15,
                "eyeWidening": 0.2,
                "browRaise": 0.25,
                "left": {
                    "elbowRotation": 22,
                    "wristRoll": -24,
                    "horizontalOffset": -0.25,
                    "verticalOffset": 0.3,
                "depthOffset": 0.65,
                "fist": 0.75,
                "pinch": 1.0,
                "fingers": {"index": -0.4},
                "fingerJoints": {"index": [0.2, 0.5, 0.8]},
                },
            },
            {"frame": 4, "right": {"wristYaw": 18}},
        ]
    )

    assert [keyframe["frame"] for keyframe in normalized] == [4, 14]
    assert normalized[1]["smile"] == 0.22
    assert normalized[1]["mouthPucker"] == 0.6
    assert normalized[1]["mouthOpening"] == 0.15
    assert normalized[1]["eyeWidening"] == 0.2
    assert normalized[1]["browRaise"] == 0.25
    assert normalized[1]["left"]["elbowRotation"] == 22
    assert normalized[1]["left"]["wristRoll"] == -24
    assert normalized[1]["left"]["horizontalOffset"] == -0.25
    assert normalized[1]["left"]["verticalOffset"] == 0.3
    assert normalized[1]["left"]["depthOffset"] == 0.65
    assert normalized[1]["left"]["fist"] == 0.75
    assert normalized[1]["left"]["pinch"] == 1.0
    assert normalized[1]["left"]["fingers"]["index"] == -0.4
    assert normalized[1]["left"]["fingerJoints"]["index"] == [0.2, 0.5, 0.8]
    assert normalized[1]["left"]["fingerJoints"]["thumb"] == [0.0, 0.0, 0.0]
    assert normalized[1]["right"]["wristRoll"] == 0


def test_mobile_preview_hand_keyframes_preserve_other_profile_fields() -> None:
    updated = sign_authoring_editor._merge_rig_hand_keyframes(
        {"BLANCO": {"forceTwoHands": True, "rigLeftHandShape": "index-only"}},
        "BLANCO",
        [{"frame": 7, "transitionFrames": 4, "left": {}, "right": {}}],
    )

    assert updated["BLANCO"]["forceTwoHands"] is True
    assert updated["BLANCO"]["rigLeftHandShape"] == "index-only"
    assert updated["BLANCO"]["rigHandKeyframes"][0]["frame"] == 7


def test_mobile_preview_saves_hand_keyframes_to_source_and_runtime(
    tmp_path: Path,
) -> None:
    source_profiles = tmp_path / "avatar_profile_overrides.json"
    runtime_profiles = tmp_path / "runtime/motions/avatar_profiles.json"
    runtime_profiles.parent.mkdir(parents=True)
    source_profiles.write_text('{"BLANCO":{"forceTwoHands":true}}', encoding="utf-8")
    runtime_profiles.write_text('{"BLANCO":{"forceTwoHands":true}}', encoding="utf-8")
    request_body = json.dumps(
        {
            "gloss": "BLANCO",
            "keyframes": [
                {
                    "frame": 9,
                    "transitionFrames": 5,
                    "smile": 0.2,
                    "mouthPucker": 0.6,
                    "mouthOpening": 0.15,
                    "eyeWidening": 0.2,
                    "browRaise": 0.25,
                    "left": {
                        "wristRoll": -20,
                        "depthOffset": 0.7,
                        "fist": 0.6,
                    },
                }
            ],
            "indexMiddleSpread": {"left": 0.031, "right": 0.046},
            "forearmAxialRollDegrees": {"left": -12, "right": 24},
        }
    ).encode("utf-8")
    handler: Any = sign_authoring_editor._MobilePreviewRequestHandler.__new__(
        sign_authoring_editor._MobilePreviewRequestHandler
    )
    handler.path = "/api/rig-hand-keyframes"
    handler.headers = {"Content-Length": str(len(request_body))}
    handler.rfile = io.BytesIO(request_body)
    handler.wfile = io.BytesIO()
    handler.profile_path = source_profiles
    handler.runtime_profile_path = runtime_profiles
    reviewed_changes: list[str] = []
    handler.reviewed_change_callback = reviewed_changes.append
    response_status: list[int] = []
    handler.send_response = lambda status: response_status.append(status)
    handler.send_header = lambda *_args: None
    handler.end_headers = lambda: None

    handler.do_POST()
    result = json.loads(handler.wfile.getvalue())

    assert response_status == [200]
    assert result["ok"] is True
    assert reviewed_changes == ["BLANCO"]
    for path in (source_profiles, runtime_profiles):
        profile = json.loads(path.read_text(encoding="utf-8"))["BLANCO"]
        assert profile["forceTwoHands"] is True
        assert profile["rigHandKeyframes"][0]["frame"] == 9
        assert profile["rigHandKeyframes"][0]["smile"] == 0.2
        assert profile["rigHandKeyframes"][0]["mouthPucker"] == 0.6
        assert profile["rigHandKeyframes"][0]["mouthOpening"] == 0.15
        assert profile["rigHandKeyframes"][0]["eyeWidening"] == 0.2
        assert profile["rigHandKeyframes"][0]["browRaise"] == 0.25
        assert profile["rigHandKeyframes"][0]["left"]["wristRoll"] == -20
        assert profile["rigHandKeyframes"][0]["left"]["depthOffset"] == 0.7
        assert profile["rigLeftIndexMiddleSpread"] == 0.031
        assert profile["rigRightIndexMiddleSpread"] == 0.046
        assert profile["rigLeftForearmAxialRollDegrees"] == -12
        assert profile["rigRightForearmAxialRollDegrees"] == 24


def test_mobile_preview_accepts_legacy_left_hand_profile_scalars() -> None:
    assert sign_authoring_editor._normalized_hand_profile_values(
        0.035, 0.0, 0.08
    ) == {"left": 0.035, "right": None}
    assert sign_authoring_editor._normalized_hand_profile_values(
        -22, -180.0, 180.0
    ) == {"left": -22.0, "right": None}


def test_mobile_preview_distinguishes_library_state_from_hand_corrections() -> None:
    preview_path = (
        Path(sign_authoring_editor.__file__).resolve().parents[2]
        / "mobile/tools/avatar/preview.html"
    )
    preview = preview_path.read_text(encoding="utf-8")

    assert "rig-app-state-title" in preview
    assert "GUARDAR CAMBIOS EN ESTE MAC · NO PUBLICA" in preview
    assert 'id="rig-smile"' in preview
    assert 'id="rig-mouth-round"' in preview
    assert 'id="rig-mouth-opening"' in preview
    assert 'id="rig-eye-widening"' in preview
    assert 'id="rig-brow-raise"' in preview
    assert 'id="rig-depth-offset"' in preview
    assert 'id="rig-elbow-rotation"' in preview
    assert 'id="rig-horizontal-offset"' in preview
    assert 'id="rig-vertical-offset"' in preview
    assert 'id="rig-precision-finger"' in preview
    assert 'id="rig-joint-base"' in preview
    assert 'id="rig-joint-middle"' in preview
    assert 'id="rig-joint-tip"' in preview
    assert 'id="rig-hacer-fingertips"' in preview
    assert "APLICAR MANO EN PICO" in preview
    assert "function applyHacerFingertipsPreset()" in preview
    assert "hand.pinch = 1" in preview
    assert "targetProfile.indexMiddleSpread = pose.indexMiddleSpread" in preview
    assert "rigEditorHandProfiles[rigEditorHand.value]" in preview
    assert "rigHandProfilesSignature(rigEditorHandProfiles)" in preview
    assert "right: rigEditorHandProfiles.right.indexMiddleSpread" in preview
    assert "right: rigEditorHandProfiles.right.forearmAxialRollDegrees" in preview
    assert "all five fingertips meet as one soft cone" in preview
    assert (
        "document.getElementById('rig-hacer-fingertips')"
        ".addEventListener('click', applyHacerFingertipsPreset);"
    ) in preview
    assert "+${value}% DELANTE" in preview
    assert "${value}% DERECHA" in preview
    assert "${value}% ARRIBA" in preview
    assert "Este botón solo guarda los ajustes de manos y rostro." in preview
    assert "No hay correcciones manuales nuevas para guardar." in preview
    assert "PASO 1 · REVISAR Y APROBAR" in preview
    assert "APROBADA EN ESTE EDITOR" in preview
    assert "1. GUARDAR Y APROBAR ESTA SEÑA" in preview
    assert "persistRigEditorKeyframes" in preview
    assert 'id="previous-reviewable-sign"' in preview
    assert 'id="next-reviewable-sign"' in preview
    assert "reviewableGlossesForNavigation" in preview
    assert "selectRelativeReviewableGloss" in preview
    assert "seña(s) aprobada(s) en total" in preview
    assert 'id="approved-list"' in preview
    assert "VER APROBADAS" in preview
    assert ".visual-comparison {\n        position: sticky;" in preview
    assert ".visual-comparison { position: static; justify-content: center; }" in preview
    assert "sourceVideoTargetSeconds" in preview
    assert "synchronizeSourceVideo(state, {force: true, pauseAtEnd: true})" in preview
    assert "loadPreviewLibrary" in preview
    assert "./motions/published_signs.json" in preview
    assert ".normalize('NFD')" in preview


def test_desktop_review_does_not_expose_legacy_blender_or_timeline_buttons() -> None:
    editor_source = Path(sign_authoring_editor.__file__).read_text(encoding="utf-8")

    assert 'text="VISTA 3D CON BLENDER (OPCIONAL)' not in editor_source
    assert 'text="EDITAR PARÁMETROS POR SEGUNDO  ⚙"' not in editor_source
    assert "self._open_advanced_dialog()" not in editor_source


def test_mobile_preview_owner_approval_updates_catalog_and_manifest(
    tmp_path: Path,
) -> None:
    source_catalog = (
        Path(sign_authoring_editor.__file__).resolve().parents[2]
        / "mobile/assets/data/lsc_linguistic_catalog.json"
    )
    catalog_path = tmp_path / "catalog.json"
    catalog = json.loads(source_catalog.read_text(encoding="utf-8"))
    blanco = next(entry for entry in catalog["entries"] if entry["gloss"] == "BLANCO")
    blanco.setdefault("motion", {})["published"] = True
    blanco.setdefault("motion", {})["clip"] = "BLANCO"
    blanco.setdefault("review", {})["status"] = "approved"
    blanco["review"]["ownerApproval"] = {
        "status": "pending",
        "approvedBy": "project_owner",
        "approvedAt": None,
    }
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    manifest_path = tmp_path / "published_signs.json"
    request_body = json.dumps({"gloss": "BLANCO", "approved": True}).encode(
        "utf-8"
    )
    handler: Any = sign_authoring_editor._MobilePreviewRequestHandler.__new__(
        sign_authoring_editor._MobilePreviewRequestHandler
    )
    handler.path = "/api/sign-approval"
    handler.headers = {"Content-Length": str(len(request_body))}
    handler.rfile = io.BytesIO(request_body)
    handler.wfile = io.BytesIO()
    handler.catalog_path = catalog_path
    handler.manifest_path = manifest_path
    response_status: list[int] = []
    handler.send_response = lambda status: response_status.append(status)
    handler.send_header = lambda *_args: None
    handler.end_headers = lambda: None

    handler.do_POST()
    result = json.loads(handler.wfile.getvalue())

    assert response_status == [200]
    assert result["current"]["approval"] == "approved"
    assert result["current"]["eligible"] is True
    assert "BLANCO" in result["approvedGlosses"]
    assert "BLANCO" in json.loads(manifest_path.read_text())["publishedGlosses"]


def test_mobile_preview_publishes_candidate_and_approves_it_in_one_action(
    tmp_path: Path,
) -> None:
    source_catalog = (
        Path(sign_authoring_editor.__file__).resolve().parents[2]
        / "mobile/assets/data/lsc_linguistic_catalog.json"
    )
    catalog_path = tmp_path / "catalog.json"
    catalog = json.loads(source_catalog.read_text(encoding="utf-8"))
    caballo = next(entry for entry in catalog["entries"] if entry["gloss"] == "CABALLO")
    caballo.setdefault("motion", {})["published"] = False
    caballo.setdefault("review", {})["status"] = "approved"
    caballo["review"]["ownerApproval"] = {
        "status": "pending",
        "approvedBy": "project_owner",
        "approvedAt": None,
    }
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    manifest_path = tmp_path / "published_signs.json"
    candidate_motion_path = tmp_path / "preview/caballo.motion.json"
    candidate_motion_path.parent.mkdir(parents=True)
    candidate_motion_path.write_text('{"gloss":"CABALLO"}', encoding="utf-8")
    published_motion_path = tmp_path / "mobile/caballo.motion.json"
    request_body = json.dumps({"gloss": "CABALLO", "approved": True}).encode(
        "utf-8"
    )
    handler: Any = sign_authoring_editor._MobilePreviewRequestHandler.__new__(
        sign_authoring_editor._MobilePreviewRequestHandler
    )
    handler.path = "/api/sign-approval"
    handler.headers = {"Content-Length": str(len(request_body))}
    handler.rfile = io.BytesIO(request_body)
    handler.wfile = io.BytesIO()
    handler.catalog_path = catalog_path
    handler.manifest_path = manifest_path
    handler.candidate_gloss = "CABALLO"
    handler.candidate_motion_path = candidate_motion_path
    handler.published_motion_path = published_motion_path
    response_status: list[int] = []
    handler.send_response = lambda status: response_status.append(status)
    handler.send_header = lambda *_args: None
    handler.end_headers = lambda: None

    handler.do_POST()
    result = json.loads(handler.wfile.getvalue())

    assert response_status == [200]
    assert result["current"]["published"] is True
    assert result["current"]["approval"] == "approved"
    assert result["current"]["eligible"] is True
    assert published_motion_path.read_text(encoding="utf-8") == '{"gloss":"CABALLO"}'
    saved_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    saved_caballo = next(
        entry for entry in saved_catalog["entries"] if entry["gloss"] == "CABALLO"
    )
    assert saved_caballo["motion"]["published"] is True
    assert saved_caballo["review"]["ownerApproval"]["status"] == "approved"
    assert "CABALLO" in json.loads(manifest_path.read_text())["publishedGlosses"]


def test_mobile_preview_owner_approval_get_lists_approved_signs(
    tmp_path: Path,
) -> None:
    source_catalog = (
        Path(sign_authoring_editor.__file__).resolve().parents[2]
        / "mobile/assets/data/lsc_linguistic_catalog.json"
    )
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(source_catalog.read_text(encoding="utf-8"), encoding="utf-8")
    handler: Any = sign_authoring_editor._MobilePreviewRequestHandler.__new__(
        sign_authoring_editor._MobilePreviewRequestHandler
    )
    handler.path = "/api/sign-approval?gloss=BLANCO"
    handler.wfile = io.BytesIO()
    handler.catalog_path = catalog_path
    response_status: list[int] = []
    handler.send_response = lambda status: response_status.append(status)
    handler.send_header = lambda *_args: None
    handler.end_headers = lambda: None

    handler.do_GET()
    result = json.loads(handler.wfile.getvalue())

    assert response_status == [200]
    assert result["ok"] is True
    assert result["current"]["gloss"] == "BLANCO"
    assert isinstance(result["approvedGlosses"], list)
    assert isinstance(result["reviewableGlosses"], list)
    assert result["approvedCount"] == len(result["approvedGlosses"])
    assert result["reviewableCount"] == len(result["reviewableGlosses"])


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


def test_mobile_preview_signature_ignores_reference_video_changes(
    tmp_path: Path,
) -> None:
    recipe = tmp_path / "hola.recipe.json"
    landmarks = tmp_path / "hola.landmarks.json"
    runtime = tmp_path / "avatar-runtime.ts"
    actor_video = tmp_path / "hola.mp4"
    recipe.write_text("recipe", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    runtime.write_text("runtime", encoding="utf-8")
    actor_video.write_text("video-v1", encoding="utf-8")
    original = SignAuthoringEditor._mobile_preview_signature(
        recipe,
        landmarks,
        (runtime,),
        actor_video,
    )

    actor_video.write_text("video-v2-with-change", encoding="utf-8")
    changed = SignAuthoringEditor._mobile_preview_signature(
        recipe,
        landmarks,
        (runtime,),
        actor_video,
    )

    assert changed == original


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

    glosses = SignAuthoringEditor._mobile_preview_glosses(
        "ALLÁ",
        manifest,
        tmp_path / "missing_catalog.json",
    )

    assert glosses == ["HOLA", "AYUDAR", "ALLÁ"]


def test_mobile_preview_skips_approved_rows_with_missing_motion_files(
    tmp_path: Path,
) -> None:
    (tmp_path / "hola.motion.json").write_text("{}", encoding="utf-8")

    glosses = SignAuthoringEditor._available_mobile_preview_glosses(
        "GRACIAS",
        ["HOLA", "ALLÁ", "GRACIAS"],
        tmp_path,
    )

    assert glosses == ["HOLA", "GRACIAS"]


def test_mobile_preview_lists_every_reviewable_catalog_sign(
    tmp_path: Path,
) -> None:
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "version": 1,
                "language": "LSC",
                "entries": [
                    {
                        "gloss": "BLANCO",
                        "motion": {"published": True},
                        "review": {"status": "approved"},
                    },
                    {
                        "gloss": "AYUDAR",
                        "motion": {"published": True},
                        "review": {"status": "legacy_approved"},
                    },
                    {
                        "gloss": "ÉL",
                        "motion": {"clip": "EL", "published": True},
                        "review": {"status": "approved"},
                    },
                    {
                        "gloss": "BORRADOR",
                        "motion": {"published": True},
                        "review": {"status": "draft"},
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    glosses = SignAuthoringEditor._mobile_preview_glosses(
        "NUEVA",
        tmp_path / "missing_manifest.json",
        catalog,
    )

    assert glosses == ["AYUDAR", "BLANCO", "EL", "NUEVA"]


def test_mobile_preview_resolves_legacy_motion_filename_without_accents(
    tmp_path: Path,
) -> None:
    legacy_motion = tmp_path / "el.motion.json"
    legacy_motion.write_text("{}", encoding="utf-8")

    resolved = SignAuthoringEditor._mobile_motion_asset_path("ÉL", tmp_path)

    assert resolved == legacy_motion


def test_publication_is_blocked_until_current_mobile_preview_is_reviewed(
    tmp_path: Path,
    monkeypatch,
) -> None:
    recipe = tmp_path / "hola.recipe.json"
    landmarks = tmp_path / "hola.landmarks.json"
    recipe.write_text("recipe", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = object()
    editor.created_sign_paths = {"HOLA": (recipe, landmarks)}
    editor.mobile_preview_signatures = {}
    warnings: list[str] = []
    monkeypatch.setattr(
        sign_authoring_editor.messagebox,
        "showwarning",
        lambda _title, message, **_kwargs: warnings.append(message),
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "find_entry",
        lambda _gloss: {"review": {"ownerApproval": {"status": "pending"}}},
    )

    assert editor._confirm_mobile_previews(["HOLA"]) is False
    assert "SIMULAR ESTA SEÑA EN LA APP MÓVIL" in warnings[0]
    assert "Baja hasta REVISAR LA SEÑA CARGADA" in warnings[0]
    assert "Guardar no publica" in warnings[0]

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


def test_approved_review_survives_reopening_the_editor(
    tmp_path: Path,
    monkeypatch,
) -> None:
    recipe = tmp_path / "alla.recipe.json"
    landmarks = tmp_path / "alla.landmarks.json"
    recipe.write_text("recipe", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.created_sign_paths = {"ALLÁ": (recipe, landmarks)}
    editor.mobile_preview_signatures = {}
    persisted: list[str] = []
    def persist_review(gloss: str, _signature: object) -> bool:
        persisted.append(gloss)
        return True

    editor._persist_mobile_preview_review = persist_review
    monkeypatch.setattr(
        sign_authoring_editor,
        "find_entry",
        lambda _gloss: {"review": {"ownerApproval": {"status": "approved"}}},
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "owner_review_fingerprint",
        lambda _entry: None,
    )

    assert editor._confirm_mobile_previews(
        ["ALLÁ"], request_confirmation=False
    ) is True
    assert "ALLÁ" in editor.mobile_preview_signatures
    assert persisted == ["ALLÁ"]


def test_saved_preview_approval_refreshes_the_main_firebase_button(
    tmp_path: Path,
    monkeypatch,
) -> None:
    recipe = tmp_path / "hola.recipe.json"
    landmarks = tmp_path / "hola.landmarks.json"
    recipe.write_text("recipe", encoding="utf-8")
    landmarks.write_text("landmarks", encoding="utf-8")
    button_updates: list[dict[str, object]] = []
    refreshed: list[str] = []
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.mobile_preview_gloss = "HOLA"
    editor.mobile_preview_signatures = {}
    editor.mobile_preview_button = type(
        "Button",
        (),
        {"configure": lambda _self, **values: button_updates.append(values)},
    )()
    editor.created_sign_paths = {"HOLA": (recipe, landmarks)}
    editor.mobile_library_status = _StatusValue()
    editor.step_status = _StatusValue()
    editor.status = _StatusValue()
    editor._published_mobile_glosses = lambda: {"HOLA"}
    editor._refresh_owner_approval_control = refreshed.append
    monkeypatch.setattr(
        sign_authoring_editor,
        "find_entry",
        lambda _gloss: {
            "review": {"ownerApproval": {"status": "approved"}}
        },
    )

    editor._accept_saved_mobile_preview_change(
        "HOLA", recipe, landmarks, None
    )

    assert refreshed == ["HOLA"]
    assert button_updates[-1]["text"] == "ÚLTIMOS CAMBIOS REVISADOS ✓"
    assert "PASO 1 COMPLETO" in str(editor.step_status.value)
    assert "ENVIAR HOLA A FIREBASE" in str(editor.status.value)


def test_mobile_preview_uses_the_native_app_bridge_without_a_browser(
    tmp_path: Path,
    monkeypatch,
) -> None:
    request_path = tmp_path / "preview-request.json"
    response_path = tmp_path / "preview-response.json"
    monkeypatch.setenv("VOZUAL_EMBEDDED_PREVIEW_REQUEST", str(request_path))
    monkeypatch.setenv("VOZUAL_EMBEDDED_PREVIEW_RESPONSE", str(response_path))

    callbacks: list[object] = []
    events: list[str] = []
    root = type(
        "PreviewRoot",
        (),
        {
            "withdraw": lambda _self: events.append("withdraw"),
            "deiconify": lambda _self: events.append("deiconify"),
            "lift": lambda _self: events.append("lift"),
            "focus_force": lambda _self: events.append("focus"),
            "after": lambda _self, _delay, callback: callbacks.append(callback),
        },
    )()
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = root
    editor.embedded_preview_nonce = None
    editor.embedded_preview_return_window = None

    assert editor._show_embedded_mobile_preview(
        "http://127.0.0.1:54321/?gloss=BIEN",
        "BIEN",
    ) is True
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["url"].startswith("http://127.0.0.1:54321/")
    assert request["title"] == "BIEN"
    assert events == ["withdraw"]

    response_path.write_text(
        json.dumps({"nonce": request["nonce"], "closed": True}),
        encoding="utf-8",
    )
    editor._poll_embedded_preview_closed()

    assert editor.embedded_preview_nonce is None
    assert events == ["withdraw", "deiconify", "lift", "focus"]


def test_mobile_library_summary_only_reports_counts() -> None:
    summary = SignAuthoringEditor._mobile_library_summary(
        {"HOLA", "MAMA"}, {"HOLA", "MAMA", "YO"}
    )

    assert summary == "EN ESTE EDITOR: 2 APROBADAS · 1 POR REVISAR"
    assert "HOLA" not in summary


def test_firebase_status_labels_distinguish_remote_and_local_state() -> None:
    assert SignAuthoringEditor._firebase_status_label("current", 2) == (
        "ACTUALIZADA ✓ v2"
    )
    assert SignAuthoringEditor._firebase_status_label("changes_pending", 4) == (
        "CAMBIOS SIN ENVIAR · v4"
    )
    assert SignAuthoringEditor._firebase_status_label("not_published", None) == (
        "NO PUBLICADA"
    )


def test_firebase_publication_runs_the_independent_sign_publisher(
    monkeypatch,
) -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    captured: dict[str, object] = {}
    editor.root = type(
        "ImmediateRoot",
        (),
        {"after": lambda _self, _delay, callback: callback()},
    )()
    editor._node_executable = lambda: Path("/test/node")
    editor._finish_firebase_publication = (
        lambda label, output: captured.update(label=label, output=output)
    )
    editor._finish_firebase_publication_failure = (
        lambda label, details: captured.update(failed_label=label, details=details)
    )

    def run(command, **options):
        captured["command"] = command
        captured["options"] = options
        return sign_authoring_editor.subprocess.CompletedProcess(
            command,
            0,
            stdout='{"project":"vozual-test","published":[],"unchanged":[]}',
            stderr="",
        )

    monkeypatch.setattr(sign_authoring_editor.subprocess, "run", run)

    editor._publish_approved_signs_in_background("BUENOS DÍAS")

    command = captured["command"]
    assert isinstance(command, list)
    assert command[0] == "/test/node"
    assert str(command[1]).endswith("mobile/tools/publish-approved-signs.js")
    assert command[2:] == ["--gloss", "BUENOS DÍAS"]
    assert captured["label"] == "BUENOS DÍAS"
    assert '"project":"vozual-test"' in str(captured["output"])
    assert "failed_label" not in captured


def test_firebase_button_exports_and_publishes_only_the_loaded_sign(
    monkeypatch,
) -> None:
    recipe = Path("buenos-dias.recipe.json")
    landmarks = Path("buenos-dias.landmarks.json")
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = object()
    editor._owner_approval_target = lambda: (
        "BUENOS DÍAS",
        recipe,
        landmarks,
    )
    editor._published_mobile_glosses = lambda: {"BUENOS DÍAS", "HOLA"}
    confirmation_requests: list[tuple[list[str], bool]] = []
    def confirm_previews(glosses: list[str], **kwargs: bool) -> bool:
        confirmation_requests.append((glosses, kwargs.get("request_confirmation", True)))
        return glosses == ["BUENOS DÍAS"]

    editor._confirm_mobile_previews = confirm_previews

    exported: list[tuple[str, Path, Path]] = []
    registered: list[tuple[str, Path]] = []
    published: list[tuple[str, dict[str, bool]]] = []
    manifests: list[bool] = []
    editor._export_mobile_motion = (
        lambda gloss, recipe_path, landmark_path: exported.append(
            (gloss, recipe_path, landmark_path)
        )
    )
    editor._register_published_linguistic_entry = (
        lambda gloss, recipe_path: registered.append((gloss, recipe_path))
    )
    editor._publish_approved_signs_to_firebase = (
        lambda gloss, **options: published.append((gloss, options))
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "write_published_motion_manifest",
        lambda: manifests.append(True),
    )

    editor._publish_current_sign_to_firebase()

    assert exported == [("BUENOS DÍAS", recipe, landmarks)]
    assert registered == [("BUENOS DÍAS", recipe)]
    assert manifests == [True]
    assert published == [("BUENOS DÍAS", {"include_phrase_suggestions": True})]
    assert confirmation_requests == [(["BUENOS DÍAS"], False)]


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
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)

    assert editor._speech_aliases_for_recipe("HERMANO", recipe_path) == ["hermana"]


def test_loaded_sign_review_is_not_blocked_by_another_queue_selection() -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
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


def test_mobile_preview_registers_a_new_catalog_candidate_first(
    tmp_path: Path,
    monkeypatch,
) -> None:
    recipe = tmp_path / "alla.recipe.json"
    landmarks = tmp_path / "alla.landmarks.json"
    recipe.write_text("{}", encoding="utf-8")
    landmarks.write_text("{}", encoding="utf-8")
    registered: list[tuple[str, Path]] = []
    started: list[bool] = []

    class DeferredThread:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def start(self) -> None:
            started.append(True)

    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.recipe_path = recipe
    editor.landmark_path = landmarks
    editor.gloss = _StatusValue("ALLÁ")
    editor.video_path = _StatusValue("")
    editor.mobile_preview_server = None
    editor.mobile_preview_url = None
    editor.mobile_preview_gloss = None
    editor.mobile_preview_signatures = {}
    editor.mobile_preview_button = None
    editor.status = _StatusValue()
    editor._save_recipe = lambda **_kwargs: None
    editor._register_published_linguistic_entry = (
        lambda gloss, recipe_path: registered.append((gloss, recipe_path))
    )
    editor._mobile_preview_signature = lambda *_args, **_kwargs: ()
    editor._stop_mobile_preview_server = lambda: None
    editor._start_progress = lambda _message: None
    monkeypatch.setattr(sign_authoring_editor.threading, "Thread", DeferredThread)

    editor._preview_in_mobile_runtime()

    assert registered == [("ALLÁ", recipe)]
    assert started == [True]


def test_empty_legacy_timeline_uses_the_captured_duration() -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.reference_frames = [[] for _index in range(24)]
    editor.reference_fps = 30
    editor.duration_seconds = _StatusValue(1.2)
    editor.motion_keyframes = []
    editor._refresh_motion_tree = lambda: None
    for field in (
        "entry_height_cm",
        "entry_lateral_cm",
        "entry_depth_cm",
        "exit_height_cm",
        "exit_lateral_cm",
        "exit_depth_cm",
    ):
        setattr(editor, field, _StatusValue(0.0))

    editor._load_motion_adjustments({})

    assert editor.motion_keyframes[0]["time_seconds"] == 0.0
    assert editor.motion_keyframes[-1]["time_seconds"] == 0.8


def test_finger_editor_replaces_a_legacy_whole_hand_preset() -> None:
    previous = SignAuthoringEditor._default_finger_state_snapshot()
    current = SignAuthoringEditor._default_finger_state_snapshot()
    current["left"] = {
        "thumb": "closed",
        "index": "extended",
        "middle": "closed",
        "ring": "closed",
        "pinky": "closed",
    }

    profiles, changed = SignAuthoringEditor._merge_finger_states_into_profiles(
        {"BLANCO": {"rigLeftHandShape": "fully-open", "rigLeftPalmScaleMin": 1}},
        "BLANCO",
        current,
        previous,
    )

    assert changed is True
    assert "rigLeftHandShape" not in profiles["BLANCO"]
    assert profiles["BLANCO"]["rigLeftFingerStates"] == current["left"]
    assert profiles["BLANCO"]["rigLeftPalmScaleMin"] == 1


def test_finger_editor_does_not_touch_profiles_when_controls_are_unchanged() -> None:
    snapshot = SignAuthoringEditor._default_finger_state_snapshot()
    original = {"HOLA": {"rigLeftHandShape": "open"}}

    profiles, changed = SignAuthoringEditor._merge_finger_states_into_profiles(
        original,
        "HOLA",
        snapshot,
        snapshot,
    )

    assert changed is False
    assert profiles == original


def test_hand_presentation_control_persists_and_clears_pinched_shape(
    tmp_path: Path,
    monkeypatch,
) -> None:
    profile_path = tmp_path / "avatar_profile_overrides.json"
    profile_path.write_text(
        json.dumps({"HACER": {"forceTwoHands": True}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "AVATAR_PROFILE_OVERRIDES_PATH",
        profile_path,
    )
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.left_finger_states = {
        finger: _StatusValue("capturado")
        for finger in sign_authoring_editor.FINGER_NAMES
    }
    editor.right_finger_states = {
        finger: _StatusValue("capturado")
        for finger in sign_authoring_editor.FINGER_NAMES
    }
    editor.loaded_finger_states = editor._default_finger_state_snapshot()
    editor.left_index_middle_spread = _StatusValue(0.025)
    editor.loaded_index_middle_spread = 0.025
    editor.left_hand_presentation = _StatusValue(
        "mano en pico (dedos reunidos)"
    )
    editor.right_hand_presentation = _StatusValue("capturada")
    editor.loaded_left_hand_presentation = "capturada"
    editor.loaded_right_hand_presentation = "capturada"
    editor.rig_left_soft_hand_curl = _StatusValue(False)
    editor.rig_right_soft_hand_curl = _StatusValue(False)
    editor.loaded_rig_left_soft_hand_curl = False
    editor.loaded_rig_right_soft_hand_curl = False

    assert editor._save_avatar_finger_states("HACER") is True
    stored = json.loads(profile_path.read_text(encoding="utf-8"))
    assert stored["HACER"]["rigLeftHandShape"] == "pinched"
    assert stored["HACER"]["forceTwoHands"] is True

    editor.left_hand_presentation.set("capturada")
    assert editor._save_avatar_finger_states("HACER") is True
    stored = json.loads(profile_path.read_text(encoding="utf-8"))
    assert "rigLeftHandShape" not in stored["HACER"]
    assert stored["HACER"]["forceTwoHands"] is True


def test_legacy_timeline_is_scaled_inside_the_captured_sequence() -> None:
    fitted = SignAuthoringEditor._fit_motion_keyframes_to_duration(
        [
            {"kind": "entry", "time_seconds": 0.0},
            {"kind": "point", "time_seconds": 0.6},
            {"kind": "exit", "time_seconds": 1.2},
        ],
        0.8,
    )

    assert [round(sign_authoring_editor.numeric_value(point["time_seconds"]), 3) for point in fitted] == [
        0.0,
        0.4,
        0.8,
    ]


def test_using_suggestion_loads_it_then_requests_a_different_random_word() -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.current_suggestion = SignCatalogEntry(
        category="Necesidades y emergencia",
        gloss="EMERGENCIA",
    )
    editor.gloss = _StatusValue()
    editor.recording_duration_seconds = _StatusValue()
    editor.duration_seconds = _StatusValue()
    editor.avatar_duration_mode = _StatusValue()
    editor.duration_summary = _StatusValue()
    editor.avatar_duration_spinbox = None
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
    assert editor.recording_duration_seconds.value == 1.6
    assert editor.duration_seconds.value == 1.6
    assert (
        editor.avatar_duration_mode.value
        == sign_authoring_editor.DURATION_MODE_MATCH_RECORDING
    )
    assert editor.video_path.value == ""
    assert aliases_loaded == ["EMERGENCIA"]
    assert workflow_resets == [True]
    assert excluded == ["EMERGENCIA"]
    assert "otra palabra" in str(editor.status.value)


def test_random_suggestion_excludes_the_word_just_prepared(monkeypatch) -> None:
    previous = SignCatalogEntry("Necesidades y emergencia", "EMERGENCIA")
    next_word = SignCatalogEntry("Necesidades y emergencia", "HOSPITAL")
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
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


def test_firebase_uploaded_glosses_exclude_every_remote_state() -> None:
    statuses = {
        "HOLA": ("current", 1),
        "GRACIAS": ("changes_pending", 2),
        "ADIÓS": ("published_not_approved", 3),
        "PAGAR": ("not_published", None),
    }

    assert SignAuthoringEditor._firebase_uploaded_glosses(statuses) == {
        "HOLA",
        "GRACIAS",
        "ADIÓS",
    }


def test_suggestion_excludes_gloss_already_uploaded_to_firebase(monkeypatch) -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.created_sign_paths = {}
    editor.firebase_published_glosses = {"GRACIAS"}
    editor.suggestion_category = _StatusValue("Todas las categorías")
    editor.suggestion_label = _StatusValue()
    editor._published_mobile_glosses = lambda: set()
    editor._aliases_for_gloss = lambda _gloss: []
    captured_existing: list[set[str]] = []

    def capture_suggestions(existing: set[str], _category: str) -> tuple[()]:
        captured_existing.append(existing)
        return ()

    monkeypatch.setattr(sign_authoring_editor, "suggested_signs", capture_suggestions)

    editor._refresh_sign_suggestions()

    assert captured_existing == [{"GRACIAS"}]
    assert editor.current_suggestion is None


def test_random_pending_sign_excludes_approved_and_previous(monkeypatch) -> None:
    offered_pools: list[list[str]] = []

    def choose(pool: list[str]) -> str:
        offered_pools.append(pool)
        return pool[0]

    monkeypatch.setattr(sign_authoring_editor.random, "choice", choose)

    selected = SignAuthoringEditor._choose_random_pending_gloss(
        ["HOLA", "MAMA", "YO"],
        {"HOLA"},
        "MAMA",
    )

    assert selected == "YO"
    assert offered_pools == [["YO"]]
    assert (
        SignAuthoringEditor._choose_random_pending_gloss(
            ["HOLA"],
            {"HOLA"},
        )
        is None
    )


def test_publish_all_signs_exports_every_pending_sign(monkeypatch) -> None:
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
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
    monkeypatch.setattr(sign_authoring_editor.messagebox, "showinfo", lambda *args, **kwargs: None)

    editor._publish_all_signs()

    assert exported == ["MAMA", "YO"]
    assert registered == ["MAMA", "YO"]
    assert wrote_manifest == [True]
    assert editor.step_status.value.startswith("PREPARACIÓN TERMINADA: 2 SEÑAS")


def test_owner_check_exports_and_adds_only_the_reviewed_sign(monkeypatch) -> None:
    recipe = Path("bien.recipe.json")
    landmarks = Path("bien.landmarks.json")
    editor: Any = SignAuthoringEditor.__new__(SignAuthoringEditor)
    editor.root = object()
    editor.loaded_review_gloss = "BIEN"
    editor.recipe_path = recipe
    editor.landmark_path = landmarks
    editor.owner_approval_checked = _StatusValue(True)
    editor.mobile_preview_signatures = {}
    editor.step_status = _StatusValue()
    editor.status = _StatusValue()
    editor._confirm_mobile_previews = lambda glosses, **_kwargs: glosses == ["BIEN"]
    editor._refresh_created_signs = lambda: None
    editor._refresh_owner_approval_control = lambda _gloss=None: None

    exported: list[str] = []
    registered: list[str] = []
    approvals: list[tuple[str, bool]] = []
    manifests: list[bool] = []
    editor._export_mobile_motion = (
        lambda gloss, _recipe, _landmarks: exported.append(gloss)
    )
    editor._register_published_linguistic_entry = (
        lambda gloss, _recipe: registered.append(gloss)
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "set_owner_approval",
        lambda gloss, approved: approvals.append((gloss, approved)),
    )
    monkeypatch.setattr(
        sign_authoring_editor,
        "write_published_motion_manifest",
        lambda: manifests.append(True),
    )

    editor._toggle_owner_approval()

    assert exported == ["BIEN"]
    assert registered == ["BIEN"]
    assert approvals == [("BIEN", True)]
    assert manifests == [True]
    assert "APROBADA" in str(editor.step_status.value)
