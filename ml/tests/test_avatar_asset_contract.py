from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

import pytest

from src.avatar_asset_contract import (
    AvatarAssetContractError,
    APPROVED_CONCEPT_SHA256,
    EXPECTED_AVATAR_ID,
    EXPECTED_BUILDER_VERSION,
    GEOMETRY_METHOD,
    REQUIRED_DEFORM_BONES,
    read_glb_json,
    validate_avatar_candidate,
)


def _glb(document: dict[str, object]) -> bytes:
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    chunk = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


def _png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)


def _candidate(tmp_path: Path) -> Path:
    required = sorted(REQUIRED_DEFORM_BONES)
    files = {
        "blend": ("naira-v2.blend", b"BLENDER-v300"),
        "glb": (
            "naira-v2.glb",
            _glb(
                {
                    "asset": {"version": "2.0"},
                    "nodes": [{"name": name} for name in required],
                    "skins": [{"joints": list(range(len(required)))}],
                    "meshes": [{"name": "NairaSkin"}],
                }
            ),
        ),
        "poseSheet1280x720": ("naira-neutral-pose-sheet-1280x720.png", _png(1280, 720)),
        "poseSheet360x640": ("naira-neutral-pose-sheet-360x640.png", _png(360, 640)),
        "motionContactSheet": ("naira-motion-contact-sheet.png", _png(720, 1280)),
        "motionAuditReport": (
            "naira-motion-audit.json",
            json.dumps(
                {
                    "passed": True,
                    "sampleFps": 60,
                    "renderFps": 30,
                    "quaternionHemisphereContinuity": True,
                    "loopSeamPassed": True,
                    "neutralHoldStable": True,
                }
            ).encode("utf-8"),
        ),
        "motionPreviewMp4": ("naira-motion-preview.mp4", b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isom"),
    }
    outputs: dict[str, object] = {}
    for key, (filename, payload) in files.items():
        path = tmp_path / filename
        path.write_bytes(payload)
        outputs[key] = {
            "path": filename,
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    manifest = {
        "schema": "vozual.avatar-candidate",
        "schemaVersion": 1,
        "avatarId": EXPECTED_AVATAR_ID,
        "builderVersion": EXPECTED_BUILDER_VERSION,
        "character": {
            "name": "Naira",
            "adult": True,
            "fictional": True,
            "originalProceduralGeometry": True,
            "usesThirdPartyMeshOrTexture": False,
        },
        "status": {"productionReady": False, "technicalApproval": "candidate"},
        "scope": {
            "upperBodyOnly": True,
            "visibleRegions": ["head", "neck", "torso", "arms", "wrists", "hands"],
            "structuralAnchorsRetained": ["root", "pelvis", "spine"],
            "excludedLowerBodyDeformBones": ["DEF-thigh.L", "DEF-thigh.R"],
        },
        "motionEvidence": {"notAnLscSign": True, "durationSeconds": 10, "fps": 30, "internalAuditSampleFps": 60},
        "provenance": {
            "builder": "ml/src/blender_build_original_avatar.py",
            "conceptUsedAsGeometryOrTexture": False,
            "conceptPath": "tmp/avatar-candidates/naira-v2-concept/naira-stylized-concept-v1.png",
            "conceptSha256": APPROVED_CONCEPT_SHA256,
            "geometryMethod": GEOMETRY_METHOD,
        },
        "licence": {"asset": "Project-owned", "rigify": "GPL tool", "publicationReviewRequired": True},
        "outputs": outputs,
        "rig": {"requiredDeformBones": required, "deformBoneCount": 5},
        "budgets": {"meshTargetMaximum": 8, "glbMaximumBytes": 20_000_000, "deformBoneMaximum": 200},
    }
    manifest_path = tmp_path / "naira-v2.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path


def test_candidate_contract_accepts_verified_original_asset(tmp_path: Path) -> None:
    manifest_path = _candidate(tmp_path)

    result = validate_avatar_candidate(manifest_path)

    assert result["avatarId"] == EXPECTED_AVATAR_ID
    assert read_glb_json(tmp_path / "naira-v2.glb")["asset"]["version"] == "2.0"


def test_candidate_contract_rejects_checksum_mismatch(tmp_path: Path) -> None:
    manifest_path = _candidate(tmp_path)
    (tmp_path / "naira-v2.glb").write_bytes(b"tampered")

    with pytest.raises(AvatarAssetContractError, match="Byte size mismatch|SHA-256 mismatch"):
        validate_avatar_candidate(manifest_path)


def test_candidate_contract_rejects_missing_facial_or_hand_joint(tmp_path: Path) -> None:
    manifest_path = _candidate(tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["rig"]["requiredDeformBones"].remove("DEF-lip.T.L.001")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(AvatarAssetContractError, match="Manifest omits contract deform bones.*DEF-lip.T.L.001"):
        validate_avatar_candidate(manifest_path)


def test_candidate_contract_rejects_wrong_pose_sheet_dimensions(tmp_path: Path) -> None:
    manifest_path = _candidate(tmp_path)
    mobile = tmp_path / "naira-neutral-pose-sheet-360x640.png"
    payload = _png(390, 844)
    mobile.write_bytes(payload)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["outputs"]["poseSheet360x640"]["bytes"] = len(payload)
    manifest["outputs"]["poseSheet360x640"]["sha256"] = hashlib.sha256(payload).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(AvatarAssetContractError, match="360x640"):
        validate_avatar_candidate(manifest_path)


def test_blender_builder_output_satisfies_contract(tmp_path: Path) -> None:
    blender = shutil.which("blender")
    if blender is None:
        pytest.skip("Blender is required for the avatar builder integration test")
    repository_root = Path(__file__).resolve().parents[2]
    builder = repository_root / "ml" / "src" / "blender_build_original_avatar.py"
    concept = repository_root / "tmp" / "avatar-candidates" / "naira-v2-concept" / "naira-stylized-concept-v1.png"
    if not concept.is_file():
        pytest.skip("The approved Naira v2 visual concept is required for integration testing")
    output_directory = tmp_path / "naira-v2"

    completed = subprocess.run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(builder),
            "--",
            str(output_directory),
            str(concept),
        ],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
        timeout=180,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    manifest_path = output_directory / "naira-v2.manifest.json"
    manifest = validate_avatar_candidate(manifest_path)
    assert manifest["provenance"]["geometryMethod"] == GEOMETRY_METHOD
