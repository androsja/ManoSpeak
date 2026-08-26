"""Export the licensed VOZUAL character as an Android-ready GLB.

Run with Blender, not the system Python:

    blender --background <source.blend> --python tools/prepare-rigged-avatar.py -- <output.glb>

The purchased source file is never modified. Only renderable meshes and the
deformation skeleton are exported; cameras, lights, Rigify controls and lower
body footwear are intentionally omitted from the mobile asset.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def output_path() -> Path:
    try:
        separator = sys.argv.index("--")
        requested = Path(sys.argv[separator + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass the output GLB path after --") from error
    requested.parent.mkdir(parents=True, exist_ok=True)
    return requested


def select_mobile_character() -> list[str]:
    # Some Rigify widget objects are stored outside the visible scene and are
    # still followed by the glTF dependency graph. Remove them only from this
    # in-memory export copy so they cannot cover the avatar at runtime.
    for item in list(bpy.data.objects):
        if item.name.startswith("WGT-") or item.name in {"Cube", "Icosphere"}:
            bpy.data.objects.remove(item, do_unlink=True)
    view_layer = bpy.context.scene.view_layers[0]
    for item in view_layer.objects:
        item.select_set(False, view_layer=view_layer)
    selected: list[str] = []
    unsupported_transparency_meshes = {
        # Character Creator relies on Blender-only shaders for these two
        # overlays. In glTF they become opaque gray shells in front of the
        # real textured eyes, so the mobile character must use the underlying
        # eye and cornea geometry directly.
        "NUG_Base_EyeONUGlusion",
        "NUG_Base_TearLine",
    }
    for item in bpy.context.scene.objects:
        is_armature = item.type == "ARMATURE" and item.name == "1_Rigify"
        is_character_mesh = (
            item.type == "MESH"
            and len(item.data.polygons) > 0
            and item.name != "Sport_sneakers"
            and item.name not in unsupported_transparency_meshes
            and not item.name.startswith("WGT-")
        )
        if not (is_armature or is_character_mesh):
            continue
        item.hide_viewport = False
        item.hide_render = False
        item.select_set(True, view_layer=view_layer)
        selected.append(item.name)
        if is_armature:
            view_layer.objects.active = item
            item.data.pose_position = "REST"
            # Rigify controller widgets are Blender editor aids, not character
            # geometry. Clear their references so the exporter cannot pull a
            # large cube/icosphere into the Android scene.
            for pose_bone in item.pose.bones:
                pose_bone.custom_shape = None
    return selected


def resize_embedded_textures(maximum_dimension: int = 1024) -> int:
    resized = 0
    for image in bpy.data.images:
        width, height = image.size
        if width <= 0 or height <= 0 or max(width, height) <= maximum_dimension:
            continue
        scale = maximum_dimension / max(width, height)
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
        resized += 1
    return resized


def main() -> None:
    destination = output_path()
    selected = select_mobile_character()
    resized = resize_embedded_textures()
    if "1_Rigify" not in selected:
        raise RuntimeError("The expected Rigify armature was not found")

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_def_bones=True,
        export_armature_object_remove=False,
        export_animations=False,
        # This source contains hundreds of unused Character Creator shape
        # keys. VOZUAL drives the supplied facial deform bones instead, so
        # shipping those duplicate vertex targets would add tens of MB.
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
    size_mb = destination.stat().st_size / (1024 * 1024)
    print(f"VOZUAL mobile avatar: {destination}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"Resized textures: {resized}")
    print(f"GLB size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
