"""Prepare the licensed Eric character for the VOZUAL mobile runtime.

The source FBX contains four orientation/pose variants and desktop-size texture
maps.  The Y-up T-pose is the canonical source for retargeting LSC motion.  This
script embeds a phone-sized copy of its textures in one GLB without modifying
the licensed source files.
"""

from __future__ import annotations

from pathlib import Path
import sys

import bpy


MAX_TEXTURE_EDGE = 1024


def prepare(source_path: Path, output_path: Path) -> None:
    """Import a rigged FBX and write a portable GLB for Android."""
    if not source_path.is_file():
        raise FileNotFoundError(source_path)

    bpy.ops.import_scene.fbx(filepath=str(source_path), use_image_search=True)

    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    # Blender's startup scene may still contain its default cube.  Only the
    # mesh parented to Eric's armature belongs to the imported character.
    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH" and item.parent in armatures]
    if len(armatures) != 1 or len(meshes) != 1:
        raise RuntimeError(
            f"Expected one armature and one mesh, found {len(armatures)} armatures "
            f"and {len(meshes)} meshes."
        )

    required_bones = {
        "hand_l", "hand_r", "thumb_01_l", "thumb_01_r", "index_01_l", "index_01_r",
        "middle_01_l", "middle_01_r", "ring_01_l", "ring_01_r", "pinky_01_l", "pinky_01_r",
        "jaw", "eye_l", "eye_r", "eyebrow_l", "eyebrow_r",
    }
    available_bones = {bone.name for bone in armatures[0].data.bones}
    missing_bones = sorted(required_bones - available_bones)
    if missing_bones:
        raise RuntimeError(f"The Eric FBX is missing required signing bones: {', '.join(missing_bones)}")

    # The avatar is framed from the torso upward on phones.  1K retains the
    # visible face and hands while avoiding a 27 MB texture payload per APK.
    for image in bpy.data.images:
        width, height = image.size
        longest = max(width, height)
        if longest > MAX_TEXTURE_EDGE:
            ratio = MAX_TEXTURE_EDGE / longest
            image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))

    bpy.ops.object.select_all(action="DESELECT")
    armatures[0].select_set(True)
    meshes[0].select_set(True)
    bpy.context.view_layer.objects.active = armatures[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_image_format="AUTO",
        export_image_quality=80,
        export_lights=False,
        export_cameras=False,
    )
    print(f"ERIC_AVATAR={output_path}")


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 2:
        raise SystemExit(
            "Usage: blender --background --python blender_prepare_eric_avatar.py -- SOURCE.fbx OUTPUT.glb"
        )
    prepare(*(Path(value).resolve() for value in arguments))
