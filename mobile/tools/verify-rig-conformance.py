"""Verify a hash-bound rest and manual conformance pose on an exported GLB.

Run with Blender:

    blender --background --python tools/verify-rig-conformance.py -- avatar.glb profile.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import bpy


def canonical_json(value: object) -> str:
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(f"{json.dumps(key)}:{canonical_json(value[key])}" for key in sorted(value)) + "}"
    return json.dumps(value, separators=(",", ":"))


def arguments() -> tuple[Path, Path]:
    try:
        separator = sys.argv.index("--")
        asset, profile = sys.argv[separator + 1 : separator + 3]
    except (ValueError, IndexError, ValueError) as error:
        raise RuntimeError("Pass an exported .glb and rig profile after --") from error
    return Path(asset).expanduser().resolve(), Path(profile).expanduser().resolve()


def load_profile(path: Path) -> dict[str, object]:
    profile = json.loads(path.read_text(encoding="utf-8"))
    expected_hash = profile.pop("sha256", None)
    actual_hash = hashlib.sha256(canonical_json(profile).encode("utf-8")).hexdigest()
    if expected_hash != actual_hash:
        raise RuntimeError("Rig profile checksum does not match its content")
    if profile.get("conformance", {}).get("productionCertified") is not False:
        raise RuntimeError("Only an uncertified profile may use this structural conformance gate")
    return profile


def main() -> None:
    asset_path, profile_path = arguments()
    profile = load_profile(profile_path)
    asset_hash = hashlib.sha256(asset_path.read_bytes()).hexdigest()
    if asset_hash != profile["asset"]["candidateSha256"]:
        raise RuntimeError(f"Candidate asset hash mismatch: {asset_hash}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset_path))
    armature = next((item for item in bpy.context.scene.objects if item.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("Export contains no armature")
    hand = armature.pose.bones.get("DEF-hand.L")
    index = armature.pose.bones.get("DEF-f_index.01.L")
    middle = armature.pose.bones.get("DEF-f_middle.01.L")
    if not hand or not index or not middle:
        raise RuntimeError("Export lacks required manual conformance bones")
    rest_hand_location = hand.bone.matrix_local.translation.copy()
    rest_hand_rotation = hand.bone.matrix_local.to_quaternion()
    bpy.context.view_layer.update()
    initial_error = (hand.matrix.translation - rest_hand_location).length
    initial_angle = hand.matrix.to_quaternion().rotation_difference(rest_hand_rotation).angle
    if initial_error > 1e-6 or initial_angle > 1e-5:
        raise RuntimeError(f"Hand is not in rest pose: {initial_error:.9f} m, {initial_angle:.9f} rad")
    index.rotation_mode = "XYZ"
    middle.rotation_mode = "XYZ"
    index.rotation_euler.x = 0.45
    middle.rotation_euler.x = 0.30
    bpy.context.view_layer.update()
    displacement = (hand.matrix.translation - rest_hand_location).length
    tolerance = float(profile["conformance"]["positionToleranceM"])
    if displacement > tolerance:
        raise RuntimeError(f"Conformance palm displaced {displacement:.6f} m; tolerance is {tolerance:.6f} m")
    index.rotation_euler = (0.0, 0.0, 0.0)
    middle.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    replay_error = (hand.matrix.translation - rest_hand_location).length
    replay_angle = hand.matrix.to_quaternion().rotation_difference(rest_hand_rotation).angle
    if replay_error > 1e-6 or replay_angle > 1e-5:
        raise RuntimeError(f"Neutral replay retained a prior pose offset of {replay_error:.9f} m")
    print(f"PASS: manual conformance pose and neutral replay; palm displacement={displacement:.6f} m")


if __name__ == "__main__":
    main()
