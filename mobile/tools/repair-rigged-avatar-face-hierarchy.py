"""Repair the exported VOZUAL facial bone hierarchy.

The source Rigify character parents facial deform bones through non-deforming
control bones. Exporting only deform bones removes those intermediate parents,
leaving every facial bone at the armature root. A runtime head rotation then
separates the eyes and facial skin from the skull.

Run with Blender:

    blender --background --python tools/repair-rigged-avatar-face-hierarchy.py \
      -- input.glb output.glb
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


ARMATURE_NAME = "1_Rigify"
HEAD_BONE_NAME = "DEF-spine.006"
FACE_BONE_PREFIXES = (
    "DEF-brow.",
    "DEF-cheek.",
    "DEF-forehead.",
    "DEF-temple.",
    "DEF-ear.",
    "DEF-jaw",
    "DEF-chin",
    "DEF-tongue",
    "DEF-eye.",
    "DEF-lid.",
    "DEF-lip.",
    "DEF-nose",
    "DEF-teeth.",
)
EXCLUDED_OBJECTS = {"Cube", "Icosphere"}


def arguments() -> tuple[Path, Path]:
    try:
        separator = sys.argv.index("--")
        source = Path(sys.argv[separator + 1]).expanduser().resolve()
        destination = Path(sys.argv[separator + 2]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass input.glb and output.glb after --") from error
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    return source, destination


def reparent_face_bones(armature: bpy.types.Object) -> list[str]:
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    armature.data.pose_position = "REST"
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        head = armature.data.edit_bones.get(HEAD_BONE_NAME)
        if head is None:
            raise RuntimeError(f"Missing head bone {HEAD_BONE_NAME}")
        repaired: list[str] = []
        for bone in armature.data.edit_bones:
            if not bone.name.startswith(FACE_BONE_PREFIXES):
                continue
            bone.parent = head
            bone.use_connect = False
            repaired.append(bone.name)
        return repaired
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def select_character(armature: bpy.types.Object) -> list[str]:
    # Rigify custom shapes are editor helpers. Clearing their references keeps
    # the exporter from following an unselected Icosphere into the mobile GLB.
    for pose_bone in armature.pose.bones:
        pose_bone.custom_shape = None
    for item in list(bpy.data.objects):
        if item.name in EXCLUDED_OBJECTS or item.name.startswith("WGT-"):
            bpy.data.objects.remove(item, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    selected: list[str] = []
    for item in bpy.context.scene.objects:
        keep = item == armature or (
            item.type == "MESH"
            and item.name not in EXCLUDED_OBJECTS
            and len(item.data.polygons) > 0
        )
        if not keep:
            continue
        item.hide_viewport = False
        item.hide_render = False
        item.select_set(True)
        selected.append(item.name)
    bpy.context.view_layer.objects.active = armature
    return selected


def export_glb(destination: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_def_bones=True,
        export_armature_object_remove=False,
        export_animations=False,
        export_morph=False,
        export_morph_animation=False,
        export_skins=True,
        export_all_influences=False,
        export_influence_nb=4,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=82,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_yup=True,
    )


def main() -> None:
    source, destination = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armature = bpy.data.objects.get(ARMATURE_NAME)
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(f"Missing armature {ARMATURE_NAME}")

    repaired = reparent_face_bones(armature)
    selected = select_character(armature)
    export_glb(destination)

    print(f"VOZUAL repaired avatar: {destination}")
    print(f"Facial bones parented to {HEAD_BONE_NAME}: {len(repaired)}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"GLB size: {destination.stat().st_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    main()
