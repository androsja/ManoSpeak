"""Fail-closed structural verification for an exported VOZUAL avatar rig.

Run with Blender:

    blender --background --python tools/verify-rig-export.py -- avatar.glb
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def input_path() -> Path:
    try:
        separator = sys.argv.index("--")
        return Path(sys.argv[separator + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass an exported .glb path after --") from error


def require_chain(armature: bpy.types.Object, side: str) -> None:
    names = (
        "DEF-spine.003",
        f"DEF-shoulder.{side}",
        f"DEF-upper_arm.{side}",
        f"DEF-upper_arm.{side}.001",
        f"DEF-forearm.{side}",
        f"DEF-forearm.{side}.001",
        f"DEF-hand.{side}",
    )
    bones = armature.data.bones
    for parent_name, child_name in zip(names, names[1:]):
        child = bones.get(child_name)
        if child is None or child.parent is None or child.parent.name != parent_name:
            actual = child.parent.name if child and child.parent else "ROOT/MISSING"
            raise RuntimeError(f"Invalid {side} deform chain: {child_name} parent is {actual}, expected {parent_name}")


def main() -> None:
    source = input_path()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected exactly one armature, found {len(armatures)}")
    for side in ("L", "R"):
        require_chain(armatures[0], side)
    print(f"PASS: certified structural deform chains for {source.name}")


if __name__ == "__main__":
    main()
