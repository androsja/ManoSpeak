"""Fail-closed structural verification for an exported VOZUAL avatar rig.

Run with Blender:

    blender --background --python-exit-code 1 --python tools/verify-rig-export.py -- avatar.glb profile.json
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import bpy


def input_paths() -> tuple[Path, Path]:
    try:
        separator = sys.argv.index("--")
        source = Path(sys.argv[separator + 1]).expanduser().resolve()
        profile = Path(sys.argv[separator + 2]).expanduser().resolve()
        return source, profile
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass an exported .glb and profile path after --") from error


def require_chain(armature: bpy.types.Object, side: str, names: list[str]) -> None:
    if len(names) < 2 or len(set(names)) != len(names):
        raise RuntimeError(f"Invalid {side} profile chain")
    bones = armature.data.bones
    for parent_name, child_name in zip(names, names[1:]):
        child = bones.get(child_name)
        if child is None or child.parent is None or child.parent.name != parent_name:
            actual = child.parent.name if child and child.parent else "ROOT/MISSING"
            raise RuntimeError(f"Invalid {side} deform chain: {child_name} parent is {actual}, expected {parent_name}")


def require_facial_hierarchy(armature: bpy.types.Object) -> int:
    prefixes = (
        "DEF-brow.", "DEF-cheek.", "DEF-forehead.", "DEF-temple.", "DEF-ear.",
        "DEF-jaw", "DEF-chin", "DEF-tongue", "DEF-eye.", "DEF-lid.",
        "DEF-lip.", "DEF-nose", "DEF-teeth.",
    )
    head = armature.data.bones.get("DEF-spine.006")
    if head is None:
        raise RuntimeError("Missing DEF-spine.006 facial parent")
    facial = [bone for bone in armature.data.bones if bone.name.startswith(prefixes)]
    if not facial:
        raise RuntimeError("Export contains no recognized facial deform bones")
    detached = [bone.name for bone in facial if bone.parent is None]
    if detached:
        raise RuntimeError(f"Detached facial deform bones: {', '.join(detached[:8])}")
    wrong_parent = [bone.name for bone in facial if bone.parent != head]
    if wrong_parent:
        raise RuntimeError(f"Facial bones do not use the declared head parent: {', '.join(wrong_parent[:8])}")
    return len(facial)


def main() -> None:
    source, profile_path = input_paths()
    profile_json = profile_path.read_bytes()
    profile = json.loads(profile_json)
    # Use the compiler's canonical number formatting for the same profile bytes.
    digest = subprocess.run(
        ["node", "-e", "const {profileSha256} = require('./rig-capability-profile.cjs');"
         "process.stdout.write(profileSha256(JSON.parse(require('fs').readFileSync(0, 'utf8'))));"],
        cwd=Path(__file__).resolve().parent, input=profile_json, stdout=subprocess.PIPE, check=True,
    ).stdout.decode("ascii")
    if digest != profile.get("sha256"):
        raise RuntimeError("Rig profile checksum mismatch")
    if profile.get("schema") != "vozual.rig-capability-profile" or profile.get("schemaVersion") != 2:
        raise RuntimeError("A v2 rig capability profile is required")
    if hashlib.sha256(source.read_bytes()).hexdigest() != profile.get("asset", {}).get("candidateSha256"):
        raise RuntimeError("Candidate asset checksum mismatch")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected exactly one armature, found {len(armatures)}")
    for side in ("left", "right"):
        chain = profile.get("deformChains", {}).get(side)
        if not isinstance(chain, list) or any(not isinstance(name, str) or not name for name in chain):
            raise RuntimeError(f"Missing {side} profile chain")
        require_chain(armatures[0], side, chain)
    facial_count = require_facial_hierarchy(armatures[0])
    print(f"PASS: candidate hash, bilateral deform chains, and {facial_count} facial parent links for {source.name}")


if __name__ == "__main__":
    main()
