"""Build the Blender rig used by the automatic video-to-avatar pipeline."""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


source_glb, landmark_path, recipe_path, output_path = sys.argv[
    sys.argv.index("--") + 1 :
]
reference = json.loads(Path(landmark_path).read_text(encoding="utf-8"))
recipe = json.loads(Path(recipe_path).read_text(encoding="utf-8"))
frames = reference["rawFrames"]
timestamps = reference.get("timestamps", [])

bpy.ops.import_scene.gltf(filepath=source_glb)
for name in ("Cube", "Icosphere"):
    helper = bpy.data.objects.get(name)
    if helper is not None:
        helper.hide_render = True

armature = next(item for item in bpy.context.scene.objects if item.type == "ARMATURE")
rig_suffix = ".l" if recipe["active_hand"] == "left" else ".r"
inactive_suffix = ".r" if rig_suffix == ".l" else ".l"
upper_arm = armature.pose.bones[f"arm_stretch{rig_suffix}"]
forearm = armature.pose.bones[f"forearm_stretch{rig_suffix}"]
hand = armature.pose.bones[f"hand{rig_suffix}"]


def world_head(bone_name: str) -> Vector:
    return armature.matrix_world @ armature.pose.bones[bone_name].head


# The anatomical route is driven by two world-space targets. The recipe
# applier writes their animation after it has aligned captured body contact to
# the avatar's actual proportions.
wrist_target = bpy.data.objects.new("ManoSpeakWristTarget", None)
wrist_target.location = world_head(f"hand{rig_suffix}")
bpy.context.scene.collection.objects.link(wrist_target)
elbow_pole = bpy.data.objects.new("ManoSpeakElbowPole", None)
elbow_pole.location = world_head(f"forearm_stretch{rig_suffix}")
bpy.context.scene.collection.objects.link(elbow_pole)

ik_constraint = hand.constraints.new("IK")
ik_constraint.name = "ManoSpeakWristIK"
ik_constraint.target = wrist_target
ik_constraint.pole_target = elbow_pole
ik_constraint.pole_angle = 0.0 if rig_suffix == ".l" else math.pi
ik_constraint.chain_count = 2
ik_constraint.use_stretch = False
ik_constraint.iterations = 128
# Direct joint targets avoid elbow flips; IK remains available for inspecting
# reachability but does not compete with the tracked route.
ik_constraint.influence = 0.0

upper_track = upper_arm.constraints.new("DAMPED_TRACK")
upper_track.name = "ManoSpeakElbowTrack"
upper_track.target = elbow_pole
upper_track.track_axis = "TRACK_Y"
forearm_track = forearm.constraints.new("DAMPED_TRACK")
forearm_track.name = "ManoSpeakWristTrack"
forearm_track.target = wrist_target
forearm_track.track_axis = "TRACK_Y"

orientation_target = bpy.data.objects.new("ManoSpeakHandOrientation", None)
orientation_target.rotation_mode = "QUATERNION"
orientation_target.rotation_quaternion = (
    armature.matrix_world @ hand.matrix
).to_quaternion()
bpy.context.scene.collection.objects.link(orientation_target)
orientation_lock = hand.constraints.new("COPY_ROTATION")
orientation_lock.name = "ManoSpeakRigidHandWorldLock"
orientation_lock.target = orientation_target
orientation_lock.target_space = "WORLD"
orientation_lock.owner_space = "WORLD"

# Only one arm participates in a one-handed sign. Place the other arm in the
# avatar's relaxed pose so an imported T-pose never leaks into the preview.
inactive_upper_arm = armature.pose.bones[f"arm_stretch{inactive_suffix}"]
inactive_upper_arm.rotation_mode = "XYZ"
inactive_upper_arm.rotation_euler = (-1.05, 0.0, 0.0)
inactive_upper_arm.keyframe_insert(data_path="rotation_euler", frame=1)
inactive_upper_arm.keyframe_insert(
    data_path="rotation_euler", frame=max(2, len(frames))
)


def tracked(point: list[float]) -> bool:
    return any(abs(value) > 1e-8 for value in point)


def joint_bend(a: list[float], b: list[float], c: list[float]) -> float:
    first = Vector(a) - Vector(b)
    second = Vector(c) - Vector(b)
    if first.length < 1e-6 or second.length < 1e-6:
        return 0.0
    return math.pi - first.angle(second)


# Finger articulation stays independent from the arm route. Every tracked
# finger landmark contributes to a joint bend; missing frames retain the last
# reliable pose rather than collapsing the hand.
hand_start = 33 if recipe["active_hand"] == "left" else 54
finger_points = {
    "thumb": (1, 2, 3, 4),
    "index": (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring": (13, 14, 15, 16),
    "pinky": (17, 18, 19, 20),
}
baseline_bends: dict[tuple[str, int], float] = {}
last_hand: list[list[float]] | None = None
pose_wrist_index = 15 if recipe["active_hand"] == "left" else 16
first_visible_frame = next(
    (
        index + 1
        for index, landmarks in enumerate(frames)
        if tracked(landmarks[pose_wrist_index])
        and 0.0 <= landmarks[pose_wrist_index][0] <= 1.0
        and 0.0 <= landmarks[pose_wrist_index][1] <= 1.05
    ),
    1,
)
for frame_number, landmarks in enumerate(frames, start=1):
    if frame_number < first_visible_frame:
        continue
    candidate = landmarks[hand_start : hand_start + 21]
    if sum(tracked(point) for point in candidate) >= 12:
        last_hand = candidate
    if last_hand is None:
        continue
    for finger, indices in finger_points.items():
        chain = (0,) + indices
        for joint in (1, 2, 3):
            bend = joint_bend(
                last_hand[chain[joint - 1]],
                last_hand[chain[joint]],
                last_hand[chain[joint + 1]],
            )
            bend_key = (finger, joint)
            baseline_bends.setdefault(bend_key, bend)
            pose_bone = armature.pose.bones[f"c_{finger}{joint}{rig_suffix}"]
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = (
                (bend - baseline_bends[bend_key]) * 0.65,
                0.0,
                0.0,
            )
            pose_bone.keyframe_insert(
                data_path="rotation_euler", frame=frame_number
            )

scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = max(2, len(frames))
if len(timestamps) > 1 and timestamps[-1] > timestamps[0]:
    measured_fps = (len(timestamps) - 1) / (timestamps[-1] - timestamps[0])
    scene.render.fps = max(1, round(measured_fps))
else:
    scene.render.fps = max(1, int(recipe["output_fps"]))

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.studio_light = "paint.sl"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100

camera = bpy.data.objects.get("Camera")
if camera is None:
    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
camera.location = (0.0, -3.35, 1.35)
camera.data.lens = 58
camera.rotation_euler = (
    Vector((0.0, 0.0, 1.35)) - camera.location
).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera

bpy.ops.wm.save_as_mainfile(filepath=output_path)
