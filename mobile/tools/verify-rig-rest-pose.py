"""Compare exported bone rest matrices with the original Blender source.

Run with ``blender --background --python-exit-code 1 --python
tools/verify-rig-rest-pose.py -- source.blend exported.glb``.
This checks rest matrices only; it does not certify animation or deformation.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def armature() -> bpy.types.Object:
    candidates = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one armature, found {len(candidates)}")
    return candidates[0]


def main() -> None:
    try:
        index = sys.argv.index("--")
        source = Path(sys.argv[index + 1]).expanduser().resolve(strict=True)
        target = Path(sys.argv[index + 2]).expanduser().resolve(strict=True)
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass source.blend and exported.glb after --") from error
    if source.suffix.lower() != ".blend" or target.suffix.lower() != ".glb":
        raise RuntimeError("Expected a Blender source and GLB export")

    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    bpy.context.view_layer.update()
    source_rig = armature()
    references = {
        bone.name: (source_rig.matrix_world @ bone.matrix_local).copy()
        for bone in source_rig.data.bones
    }
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(target))
    bpy.context.view_layer.update()
    target_rig = armature()
    if not target_rig.data.bones:
        raise RuntimeError("Export contains no bones")
    errors: list[tuple[float, str]] = []
    for bone in target_rig.data.bones:
        reference = references.get(bone.name)
        if reference is None:
            raise RuntimeError(f"Exported bone has no source reference: {bone.name}")
        actual = target_rig.matrix_world @ bone.matrix_local
        maximum = max(abs(reference[row][col] - actual[row][col]) for row in range(4) for col in range(4))
        errors.append((maximum, bone.name))
    maximum, name = max(errors)
    if maximum > 1e-4:
        raise RuntimeError(f"Rest matrix mismatch: {name}, component error {maximum:.9g}, limit 0.0001")
    print(f"PASS: {len(errors)} exported rest matrices; max component error {maximum:.9g} ({name})")


if __name__ == "__main__":
    main()
