"""Render deterministic close-ups for comparing VOZUAL hand candidates.

    blender --background --python tools/render-rigged-avatar-hand-pose.py \
      -- input.glb output.png open
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, Path, str]:
    try:
        separator = sys.argv.index("--")
        source = Path(sys.argv[separator + 1]).expanduser().resolve()
        output = Path(sys.argv[separator + 2]).expanduser().resolve()
        pose = sys.argv[separator + 3]
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass input.glb output.png and a pose name after --") from error
    output.parent.mkdir(parents=True, exist_ok=True)
    return source, output, pose


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def pose_fist(armature: bpy.types.Object, side: str = "L") -> None:
    for finger in ("f_index", "f_middle", "f_ring", "f_pinky"):
        for joint, angle in enumerate((52.0, 68.0, 62.0), start=1):
            bone = armature.pose.bones[f"DEF-{finger}.{joint:02d}.{side}"]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = math.radians(angle)
    for joint, angle in enumerate((28.0, 42.0, 36.0), start=1):
        bone = armature.pose.bones[f"DEF-thumb.{joint:02d}.{side}"]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = math.radians(angle)
        bone.rotation_euler.z = math.radians(-14.0)


def pose_index_only(
    armature: bpy.types.Object,
    curl_angles: tuple[float, float, float],
    thumb_angles: tuple[float, float, float],
    thumb_adduction: float = -8.0,
    side: str = "L",
) -> None:
    """Keep the index extended while forming a progressive, non-looping fist."""
    for finger in ("f_middle", "f_ring", "f_pinky"):
        for joint, angle in enumerate(curl_angles, start=1):
            bone = armature.pose.bones[f"DEF-{finger}.{joint:02d}.{side}"]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = math.radians(angle)
    for joint, angle in enumerate(thumb_angles, start=1):
        bone = armature.pose.bones[f"DEF-thumb.{joint:02d}.{side}"]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = math.radians(angle)
        bone.rotation_euler.z = math.radians(thumb_adduction if joint == 1 else 0.0)


def pose_pinched(armature: bpy.types.Object, side: str = "L") -> None:
    """Gather all fingertips into a soft cone without folding into a fist."""
    finger_poses = (
        ("f_index", (-21.5, 63.6, 49.1), -7.4, -30.2),
        ("f_middle", (-19.8, 70.0, 55.0), -1.2, -5.6),
        ("f_ring", (-21.3, 67.2, 48.9), 4.4, 17.5),
        ("f_pinky", (-5.2, 37.6, 22.5), 2.5, 30.9),
    )
    mirrored = 1.0 if side == "L" else -1.0
    for finger, curls, opposition, adduction in finger_poses:
        for joint, angle in enumerate(curls, start=1):
            bone = armature.pose.bones[f"DEF-{finger}.{joint:02d}.{side}"]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = math.radians(angle)
            bone.rotation_euler.y = math.radians(
                opposition * mirrored if joint == 1 else 0.0
            )
            bone.rotation_euler.z = math.radians(
                adduction * mirrored if joint == 1 else 0.0
            )
    for joint, angle in enumerate((84.0, -25.5, -32.5), start=1):
        bone = armature.pose.bones[f"DEF-thumb.{joint:02d}.{side}"]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = math.radians(angle)
        bone.rotation_euler.y = math.radians(
            -39.6 * mirrored if joint == 1 else 0.0
        )
        bone.rotation_euler.z = math.radians(
            -40.1 * mirrored if joint == 1 else 0.0
        )


def configure_scene(output: Path, view: str = "hand", hand_center_x: float = 0.65) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("HandValidationWorld")
    scene.world.color = (0.035, 0.055, 0.085)

    camera_data = bpy.data.cameras.new("HandValidationCamera")
    camera = bpy.data.objects.new("HandValidationCamera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    if view == "hand":
        camera_data.ortho_scale = 0.28
        camera.location = (hand_center_x, -0.52, 1.14)
        target = Vector((hand_center_x, 0.05, 1.14))
    else:
        camera_data.ortho_scale = 1.7
        camera.location = (0.0, -3.0, 1.35)
        target = Vector((0.0, 0.05, 1.25))
    point_camera(camera, target)
    scene.camera = camera

    key_data = bpy.data.lights.new("HandValidationKey", "AREA")
    key_data.energy = 420
    key_data.shape = "DISK"
    key_data.size = 2.0
    key = bpy.data.objects.new("HandValidationKey", key_data)
    scene.collection.objects.link(key)
    key.location = (hand_center_x, -1.0, 1.55) if view == "hand" else (1.8, -2.0, 2.5)
    point_camera(key, target)

    fill_data = bpy.data.lights.new("HandValidationFill", "AREA")
    fill_data.energy = 180
    fill_data.size = 1.5
    fill = bpy.data.objects.new("HandValidationFill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (0.25, -0.45, 1.0) if view == "hand" else (-1.8, -1.8, 1.2)
    point_camera(fill, target)


def main() -> None:
    source, output, pose = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armature = bpy.data.objects.get("1_Rigify")
    if armature is None:
        raise RuntimeError("The expected 1_Rigify armature was not found")
    hand_center_x = 0.65
    if pose == "fist":
        pose_fist(armature)
    elif pose == "index-gentle":
        pose_index_only(armature, (35.0, 45.0, 30.0), (18.0, 24.0, 18.0))
    elif pose == "index-medium":
        pose_index_only(armature, (42.0, 52.0, 36.0), (22.0, 30.0, 22.0))
    elif pose == "index-tight":
        pose_index_only(armature, (48.0, 58.0, 42.0), (26.0, 34.0, 26.0))
    elif pose == "index-thumb-tucked":
        pose_index_only(
            armature,
            (42.0, 52.0, 36.0),
            (30.0, 45.0, 30.0),
            thumb_adduction=-28.0,
        )
    elif pose == "index-thumb-tucked-right":
        pose_index_only(
            armature,
            (42.0, 52.0, 36.0),
            (30.0, 45.0, 30.0),
            thumb_adduction=28.0,
            side="R",
        )
        hand_center_x = -0.65
    elif pose == "pinched":
        pose_pinched(armature)
    elif pose == "pinched-right":
        pose_pinched(armature, side="R")
        hand_center_x = -0.65
    elif pose not in {"open", "upper-body"}:
        raise RuntimeError(f"Unsupported pose: {pose}")
    bpy.context.view_layer.update()
    configure_scene(output, "upper-body" if pose == "upper-body" else "hand", hand_center_x)
    bpy.ops.render.render(write_still=True)
    print(f"VOZUAL hand validation render: {output}")


if __name__ == "__main__":
    main()
