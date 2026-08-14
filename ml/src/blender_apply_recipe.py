"""Apply a reusable sign recipe to an imported ManoSpeak avatar draft."""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector


draft_path, recipe_path, output_path = sys.argv[sys.argv.index("--") + 1 :]
recipe = json.loads(Path(recipe_path).read_text(encoding="utf-8"))
landmark_path = Path(recipe["landmark_source"])
if not landmark_path.is_absolute():
    landmark_path = Path.cwd() / landmark_path
reference = json.loads(landmark_path.read_text(encoding="utf-8"))
captured_frames = reference.get("rawFrames", [])

# Blender 5 stores new animation in layered Actions without the legacy
# ``action.fcurves`` collection. Set interpolation before inserting keys so the
# generated route is linear and cannot overshoot its anatomical waypoints.
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"

armature = next(item for item in bpy.context.scene.objects if item.type == "ARMATURE")
wrist_target = bpy.data.objects["ManoSpeakWristTarget"]
elbow_pole = bpy.data.objects["ManoSpeakElbowPole"]
orientation_target = bpy.data.objects["ManoSpeakHandOrientation"]
rig_side = recipe["active_hand"]
rig_suffix = ".l" if rig_side == "left" else ".r"
hand = armature.pose.bones[f"hand{rig_suffix}"]

# The draft contains dense raw landmark keys. They are useful for extracting
# hand pose, but must not remain mixed with the corrected anatomical route.
# Otherwise raw keys after contact can pull the arm through the torso or behind
# the head. The recipe becomes the single owner of wrist, elbow and palm path.
for target in (wrist_target, elbow_pole, orientation_target):
    target.animation_data_clear()

upper_length = (
    armature.data.bones[f"forearm_stretch{rig_suffix}"].head_local
    - armature.data.bones[f"arm_stretch{rig_suffix}"].head_local
).length
forearm_length = (
    armature.data.bones[f"hand{rig_suffix}"].head_local
    - armature.data.bones[f"forearm_stretch{rig_suffix}"].head_local
).length
shoulder = armature.matrix_world @ armature.pose.bones[f"arm_stretch{rig_suffix}"].head
side_sign = 1.0 if rig_side == "left" else -1.0


def tracked(point: list[float]) -> bool:
    return any(abs(value) > 1e-8 for value in point)


def solve_elbow(wrist: Vector, hint: Vector) -> tuple[Vector, Vector]:
    direction = wrist - shoulder
    distance = direction.length
    if distance < 1e-6:
        direction = Vector((0.0, -1.0, 0.0))
        distance = 1.0
    direction.normalize()
    maximum = upper_length + forearm_length - 1e-4
    minimum = abs(upper_length - forearm_length) + 1e-4
    reachable_distance = min(max(distance, minimum), maximum)
    reachable_wrist = shoulder + direction * reachable_distance
    along = (
        upper_length**2 - forearm_length**2 + reachable_distance**2
    ) / (2.0 * reachable_distance)
    height = math.sqrt(max(upper_length**2 - along**2, 0.0))
    # Pose elbows are especially noisy while the forearm overlaps the torso.
    # Blend them toward a rig-proportional anatomical corridor: lateral from
    # the ribs, in front of the jacket, and below the shoulder. This preserves
    # the captured wrist route without allowing an impossible elbow inversion.
    raised = min(1.0, max(0.0, (wrist.z - 1.04) / 0.28))
    forward = min(1.0, max(0.0, (-wrist.y - 0.03) / 0.17))
    activity = max(raised, forward)
    anatomical_hint = Vector(
        (
            shoulder.x + side_sign * (0.14 + 0.05 * activity),
            0.02 * (1.0 - activity) - 0.11 * activity,
            shoulder.z - 0.24 + 0.06 * activity,
        )
    )
    stable_hint = hint.lerp(anatomical_hint, 0.88)
    plane = stable_hint - shoulder
    plane -= direction * plane.dot(direction)
    if plane.length < 1e-5:
        plane = Vector((side_sign, -0.5, -0.5))
    plane.normalize()
    return shoulder + direction * along + plane * height, reachable_wrist


anchor_wrist = {
    "chin": Vector((side_sign * 0.07, -0.15, 1.34)),
    "mouth": Vector((side_sign * 0.07, -0.15, 1.43)),
    "forehead": Vector((side_sign * 0.07, -0.15, 1.62)),
    "cheek": Vector((side_sign * 0.16, -0.15, 1.49)),
    "chest": Vector((side_sign * 0.08, -0.12, 1.25)),
    "none": Vector((side_sign * 0.22, -0.10, 1.30)),
}[recipe["contact_anchor"]]
rest_wrist = Vector((side_sign * 0.38, -0.02, 1.00))
forward_distance = float(recipe["forward_distance"])
if recipe["contact_anchor"] == "chin":
    jaw_bone = armature.pose.bones.get("jaw")
    if jaw_bone is not None:
        jaw_world = armature.matrix_world @ jaw_bone.head
        # The jaw head is inside the lower face. A small vertical inset places
        # the captured contact joint on the visible underside of the chin;
        # the previous 12 cm inset incorrectly landed on the upper chest.
        anchor_wrist = Vector((jaw_world.x, -0.16, jaw_world.z - 0.03))

contact_frame = max(4, int(recipe["contact_frame"]) + 1)
contact_start_frame = max(
    1, int(recipe.get("contact_start_frame") or recipe["contact_frame"]) + 1
)
contact_end_frame = max(
    contact_frame,
    int(recipe.get("contact_end_frame") or recipe["contact_frame"]) + 1,
)
contact_hold_frame = contact_end_frame
release_frame = max(contact_end_frame + 2, int(recipe["release_frame"]) + 1)
release_hold_frame = release_frame + 2
source_end_frame = bpy.context.scene.frame_end
output_fps = max(1, int(recipe["output_fps"]))
# A fixed frame count changes speed when creators export at different frame
# rates. Keep a short, consistent neutral-return duration so independently
# authored signs can be chained without an abrupt pose jump.
neutral_return_frames = max(2, round(output_fps * 0.35))
end_frame = max(source_end_frame, release_hold_frame) + (
    neutral_return_frames if recipe["return_to_rest"] else 0
)

pose_indices = (11, 13, 15) if recipe["active_hand"] == "left" else (12, 14, 16)
hand_start = 33 if recipe["active_hand"] == "left" else 54


def mapped_delta(delta: Vector) -> Vector:
    """Map MediaPipe image/depth axes into the avatar's world axes."""
    return Vector((delta.x * 1.35, delta.z * 0.75, -delta.y * 1.25))


def first_tracked(index: int) -> Vector:
    for captured in captured_frames:
        if tracked(captured[index]):
            return Vector(captured[index])
    return Vector((0.0, 0.0, 0.0))


baseline_shoulder = first_tracked(pose_indices[0])
baseline_hand_points = next(
    (
        captured[hand_start : hand_start + 21]
        for captured in captured_frames
        if sum(tracked(point) for point in captured[hand_start : hand_start + 21]) >= 12
    ),
    [],
)
baseline_palm = (
    sum((Vector(point) for point in baseline_hand_points[:10] if tracked(point)), Vector())
    / max(1, sum(tracked(point) for point in baseline_hand_points[:10]))
    if baseline_hand_points
    else Vector((0.0, 0.0, 0.0))
)


def palm_screen_scale(captured: list[list[float]]) -> float | None:
    """Measure apparent hand size without relying on MediaPipe hand depth."""
    hand_points = captured[hand_start : hand_start + 21]
    pairs = ((0, 5), (0, 9), (0, 13), (0, 17), (5, 17))
    lengths = [
        (Vector(hand_points[end][:2]) - Vector(hand_points[start][:2])).length
        for start, end in pairs
        if tracked(hand_points[start]) and tracked(hand_points[end])
    ]
    return sum(lengths) / len(lengths) if len(lengths) >= 3 else None


def stable_pose_depths() -> list[float | None]:
    """Fuse body-relative pose depth with apparent palm-size perspective."""
    raw_depths = []
    scales = []
    for captured in captured_frames:
        shoulder_point = captured[pose_indices[0]]
        wrist_point = captured[pose_indices[2]]
        raw_depths.append(
            wrist_point[2] - shoulder_point[2]
            if tracked(shoulder_point) and tracked(wrist_point)
            else None
        )
        scales.append(palm_screen_scale(captured))

    reference_index = min(len(captured_frames) - 1, max(0, contact_frame - 1))
    reference_depth = raw_depths[reference_index]
    reference_scale = scales[reference_index]
    filtered: list[float | None] = []
    previous = None
    for index, raw_depth in enumerate(raw_depths):
        nearby = sorted(
            value
            for value in raw_depths[max(0, index - 2) : index + 3]
            if value is not None
        )
        if raw_depth is None or not nearby:
            filtered.append(previous)
            continue
        depth = nearby[len(nearby) // 2]
        scale = scales[index]
        # Hand-world Z is relative to its own wrist, so it cannot describe a
        # hand approaching the camera. Palm growth supplies a small secondary
        # perspective cue while pose depth supplies the body-relative motion.
        if (
            reference_depth is not None
            and reference_scale is not None
            and reference_scale > 1e-5
            and scale is not None
        ):
            scale_change = min(0.8, max(-0.5, scale / reference_scale - 1.0))
            depth += -0.12 * scale_change
        if previous is not None:
            depth = previous * 0.45 + depth * 0.55
            depth = min(previous + 0.10, max(previous - 0.10, depth))
        previous = depth
        filtered.append(depth)
    return filtered


pose_depths = stable_pose_depths()


def captured_target(
    captured: list[list[float]], frame_index: int
) -> tuple[Vector, Vector] | None:
    shoulder_point = captured[pose_indices[0]]
    elbow_point = captured[pose_indices[1]]
    wrist_point = captured[pose_indices[2]]
    if not tracked(shoulder_point) or not tracked(wrist_point):
        return None
    shoulder_capture = Vector(shoulder_point)
    wrist_capture = Vector(wrist_point)
    elbow_capture = Vector(elbow_point) if tracked(elbow_point) else (shoulder_capture + wrist_capture) * 0.5
    hand_points = captured[hand_start : hand_start + 21]
    wrist_delta = wrist_capture - shoulder_capture
    # Keep body-relative depth. MediaPipe Hand z is wrist-relative and erased
    # the visible movement toward the camera in signs such as GRACIAS.
    stable_depth = pose_depths[frame_index]
    if stable_depth is not None:
        wrist_delta.z = stable_depth
    elbow_delta = elbow_capture - shoulder_capture
    return shoulder + mapped_delta(wrist_delta), shoulder + mapped_delta(elbow_delta)


path = []
for source_index, captured in enumerate(captured_frames):
    target = captured_target(captured, source_index)
    if target is not None:
        path.append((source_index + 1, target[0], target[1]))

first_visible_frame = 1
if not path:
    path = [(1, rest_wrist, Vector((side_sign * 0.46, 0.02, 1.27)))]
else:
    # A hand outside the camera is represented by extrapolated landmarks. Keep
    # the avatar in an anatomical rest pose until the pose wrist is visible.
    first_visible_frame = next(
        (
            index + 1
            for index, captured in enumerate(captured_frames)
            if tracked(captured[pose_indices[2]])
            and 0.0 <= captured[pose_indices[2]][0] <= 1.0
            and 0.0 <= captured[pose_indices[2]][1] <= 1.05
        ),
        1,
    )
    rest_elbow = Vector((side_sign * 0.46, 0.02, 1.27))
    path = [
        (frame, rest_wrist, rest_elbow)
        if frame < first_visible_frame
        else (frame, wrist, elbow)
        for frame, wrist, elbow in path
    ]

# Align the tracked contact to the avatar's body without replacing the route.
# The same correction applies to every sign and is inferred from its recipe.
contact_hand_indices = []
if recipe["contact_anchor"] != "none":
    contact_entry = min(path, key=lambda item: abs(item[0] - contact_frame))
    face_index = {"chin": 227, "mouth": 88, "forehead": 85}.get(
        recipe["contact_anchor"]
    )
    contact_samples = captured_frames[
        max(0, contact_start_frame - 1) : min(len(captured_frames), contact_end_frame)
    ]
    contact_hand_indices = [8, 12, 16, 20]
    wrists = [
        Vector(sample[hand_start])
        for sample in contact_samples
        if tracked(sample[hand_start])
    ]
    contact_points = [
        Vector(sample[hand_start + index])
        for sample in contact_samples
        for index in contact_hand_indices
        if tracked(sample[hand_start + index])
    ]
    captured_hand_wrist = (
        sum(wrists, Vector()) / len(wrists) if wrists else Vector()
    )
    contact_landmark = (
        sum(contact_points, Vector()) / len(contact_points)
        if contact_points
        else None
    )
    hand_reach = (
        mapped_delta(contact_landmark - captured_hand_wrist)
        if contact_landmark is not None and wrists and face_index is not None
        else Vector((0.0, 0.0, 0.0))
    )
    desired_contact_wrist = anchor_wrist - hand_reach
    contact_correction = desired_contact_wrist - contact_entry[1]

    def captured_contact_weight(frame: int) -> float:
        if frame <= contact_start_frame:
            value = (frame - 1) / max(1, contact_start_frame - 1)
        elif frame <= contact_end_frame:
            value = 1.0
        else:
            value = (release_frame - frame) / max(
                1, release_frame - contact_end_frame
            )
        value = min(1.0, max(0.0, value))
        return value * value * (3.0 - 2.0 * value)

    path = [
        (
            frame,
            wrist + contact_correction * captured_contact_weight(frame),
            elbow + contact_correction * (0.35 * captured_contact_weight(frame)),
        )
        for frame, wrist, elbow in path
    ]


def smoothstep(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


entry_adjustment = Vector(
    (
        side_sign * float(recipe.get("entry_lateral_cm", 0.0)) / 100.0,
        -float(recipe.get("entry_depth_cm", 0.0)) / 100.0,
        float(recipe.get("entry_height_cm", 0.0)) / 100.0,
    )
)
exit_adjustment = Vector(
    (
        side_sign * float(recipe.get("exit_lateral_cm", 0.0)) / 100.0,
        -float(recipe.get("exit_depth_cm", 0.0)) / 100.0,
        float(recipe.get("exit_height_cm", 0.0)) / 100.0,
    )
)


def manual_adjustment(frame: int) -> Vector:
    """Interpolate editable timeline points, with legacy endpoint support."""
    timeline = recipe.get("motion_keyframes", [])
    if timeline:
        current_seconds = (frame - 1) / max(1, int(recipe["output_fps"]))
        points = sorted(
            (
                float(point["time_seconds"]),
                Vector(
                    (
                        side_sign * float(point.get("lateral_cm", 0.0)) / 100.0,
                        -float(point.get("depth_cm", 0.0)) / 100.0,
                        float(point.get("height_cm", 0.0)) / 100.0,
                    )
                ),
            )
            for point in timeline
        )
        if current_seconds <= points[0][0]:
            return points[0][1]
        if current_seconds >= points[-1][0]:
            return points[-1][1]
        for (start_time, start_value), (end_time, end_value) in zip(
            points, points[1:]
        ):
            if start_time <= current_seconds <= end_time:
                weight = smoothstep(
                    (current_seconds - start_time) / max(1e-6, end_time - start_time)
                )
                return start_value.lerp(end_value, weight)
    entry_weight = 1.0 - smoothstep(
        (frame - 1) / max(1, contact_start_frame - 1)
    )
    exit_weight = smoothstep(
        (frame - contact_end_frame) / max(1, release_frame - contact_end_frame)
    )
    return entry_adjustment * entry_weight + exit_adjustment * exit_weight


path = [
    (
        frame,
        wrist + manual_adjustment(frame),
        elbow + manual_adjustment(frame) * 0.35,
    )
    for frame, wrist, elbow in path
]

if recipe["return_to_rest"]:
    # Tracking depth becomes unreliable as a departing hand overlaps the
    # torso or leaves the image. Preserve the observed route through release,
    # then let Blender interpolate an anatomical return in front of the body.
    # In this rig the front surface of the torso is at negative world Y.
    # Preserve the complete recorded screen-space route, including a hand
    # that stays centered while moving toward the camera. Only clamp unsafe
    # depth while it overlaps the torso; never invent a lateral exit.
    if not path:
        path = [(1, rest_wrist, Vector((side_sign * 0.46, 0.02, 1.27)))]
    safe_front_y = -0.16
    torso_half_width = 0.34
    path = [
        (
            frame,
            Vector(
                (
                    wrist.x,
                    min(wrist.y, safe_front_y)
                    if frame >= contact_start_frame
                    and abs(wrist.x) < torso_half_width
                    else wrist.y,
                    wrist.z,
                )
            ),
            elbow,
        )
        for frame, wrist, elbow in path
    ]
    path.append(
        (end_frame, rest_wrist, Vector((side_sign * 0.46, 0.02, 1.27)))
    )

def key_anatomical_path(route: list[tuple[int, Vector, Vector]]) -> None:
    """Key a continuous elbow corridor while preserving every wrist target."""
    previous_elbow = None
    for frame, wrist, captured_elbow in route:
        elbow, reachable_wrist = solve_elbow(wrist, captured_elbow)
        if previous_elbow is not None:
            # Tracker outliers must not move the elbow to the opposite side of
            # the arm in a single frame. Wrist motion remains unsmoothed.
            elbow = previous_elbow.lerp(elbow, 0.58)
        previous_elbow = elbow.copy()
        wrist_target.location = reachable_wrist
        wrist_target.keyframe_insert(data_path="location", frame=frame)
        elbow_pole.location = elbow
        elbow_pole.keyframe_insert(data_path="location", frame=frame)


key_anatomical_path(path)


def world_bone_head(name: str) -> Vector:
    return armature.matrix_world @ armature.pose.bones[name].head


bpy.context.scene.frame_set(contact_frame)
bpy.context.view_layer.update()
base_world = (armature.matrix_world @ hand.matrix).to_quaternion()
hand_head = world_bone_head(f"hand{rig_suffix}")
source_long = (world_bone_head(f"c_middle1{rig_suffix}") - hand_head).normalized()
source_width = world_bone_head(f"c_index1{rig_suffix}") - world_bone_head(
    f"c_pinky1{rig_suffix}"
)
source_width = (source_width - source_long * source_width.dot(source_long)).normalized()
source_normal = source_width.cross(source_long).normalized()
source_basis = Matrix((source_width, source_long, source_normal)).transposed()


def captured_orientation_keys() -> list[tuple[int, object]]:
    """Retarget and stabilize the palm plane captured from all hand landmarks."""
    landmark_path = Path(recipe["landmark_source"])
    if not landmark_path.is_absolute():
        landmark_path = Path.cwd() / landmark_path
    if not landmark_path.is_file():
        return []

    reference = json.loads(landmark_path.read_text(encoding="utf-8"))
    frames = reference.get("rawFrames", [])
    hand_start = 33 if recipe["active_hand"] == "left" else 54
    keys = []
    previous_rotation = None
    smoothed_rotation = None
    for source_frame, landmarks in enumerate(frames):
        if source_frame + 1 < first_visible_frame:
            continue
        captured_hand = landmarks[hand_start : hand_start + 21]
        if sum(tracked(point) for point in captured_hand) < 12:
            continue

        palm_base = Vector(captured_hand[0])
        knuckles = [Vector(captured_hand[index]) for index in (5, 9, 13, 17)]
        captured_long = sum(
            (knuckle - palm_base for knuckle in knuckles), Vector()
        ) / len(knuckles)
        captured_width = (
            (knuckles[0] + knuckles[1]) * 0.5
            - (knuckles[2] + knuckles[3]) * 0.5
        )
        captured_normal = captured_width.cross(captured_long)
        # MediaPipe image X maps to mirrored avatar X, image Y maps to world Z,
        # and landmark Z maps to camera depth.
        desired_long = Vector(
            (captured_long.x, captured_long.z, -captured_long.y)
        )
        desired_normal = Vector(
            (captured_normal.x, captured_normal.z, -captured_normal.y)
        )
        if desired_long.length < 1e-6 or desired_normal.length < 1e-6:
            continue
        desired_long.normalize()
        desired_normal -= desired_long * desired_normal.dot(desired_long)
        if desired_normal.length < 1e-6:
            continue
        desired_normal.normalize()
        desired_width = desired_long.cross(desired_normal).normalized()
        desired_basis = Matrix(
            (desired_width, desired_long, desired_normal)
        ).transposed()
        rotation = (
            (desired_basis @ source_basis.transposed()).to_quaternion()
            @ base_world
        )
        # Quaternion signs describe the same pose, but alternating signs make
        # interpolation take a visible long turn. Keep one continuous branch.
        if previous_rotation is not None and previous_rotation.dot(rotation) < 0.0:
            rotation.negate()
        if previous_rotation is not None:
            angular_change = previous_rotation.rotation_difference(rotation).angle
            # A palm cannot reverse by a large angle in one animation frame.
            # Clamp tracker outliers while preserving deliberate gradual turns.
            if angular_change > math.radians(35.0):
                rotation = previous_rotation.slerp(
                    rotation,
                    math.radians(35.0) / angular_change,
                )
        previous_rotation = rotation.copy()
        if smoothed_rotation is None:
            smoothed_rotation = rotation.copy()
        else:
            smoothed_rotation = smoothed_rotation.slerp(rotation, 0.55)
        keys.append((source_frame + 1, smoothed_rotation.copy()))
    return keys


def orientation(name: str):
    axes = {
        "camera": (Vector((0.0, 0.0, 1.0)), Vector((0.0, -1.0, 0.0))),
        "up": (Vector((0.0, -1.0, 0.0)), Vector((0.0, 0.0, 1.0))),
        "down": (Vector((0.0, 0.0, -1.0)), Vector((0.0, -1.0, 0.0))),
        "in": (Vector((0.0, 0.0, 1.0)), Vector((1.0, 0.0, 0.0))),
        "out": (Vector((0.0, 0.0, 1.0)), Vector((-1.0, 0.0, 0.0))),
        # Fingertips point from the avatar's right side toward the chin while
        # the palm faces down. This is the bent-wrist contact seen from the
        # user's side reference for the LSC sign GRACIAS.
        "chin_touch": (Vector((1.0, 0.0, 0.08)), Vector((0.0, 0.0, -1.0))),
    }
    long_axis, normal_axis = axes[name]
    normal_axis -= long_axis * normal_axis.dot(long_axis)
    width_axis = long_axis.cross(normal_axis).normalized()
    desired_basis = Matrix((width_axis, long_axis, normal_axis)).transposed()
    return (desired_basis @ source_basis.transposed()).to_quaternion() @ base_world


orientation_target.rotation_mode = "QUATERNION"
captured_keys = captured_orientation_keys()
orientation_keys = [(1, orientation("down"))]
if captured_keys:
    # All reliable hand frames contribute to the visible wrist bend. This
    # preserves sign-specific rotation while the corrected wrist route keeps
    # the arm in front of the body. No word-specific palm pose replaces the
    # video: GRACIAS and every future sign use the same automatic calculation.
    orientation_keys.extend(captured_keys)
else:
    orientation_keys.extend(
        [
            (contact_frame, orientation(recipe["palm_at_contact"])),
            (contact_hold_frame, orientation(recipe["palm_at_contact"])),
            (release_frame, orientation(recipe["palm_at_release"])),
            (release_hold_frame, orientation(recipe["palm_at_release"])),
        ]
    )
if recipe["return_to_rest"]:
    orientation_keys.append((end_frame, orientation("down")))
for frame, rotation in orientation_keys:
    orientation_target.rotation_quaternion = rotation
    orientation_target.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def rig_hand_landmark_world(index: int) -> Vector:
    """Return the rig joint corresponding to one MediaPipe hand landmark."""
    if index == 0:
        return world_bone_head(f"hand{rig_suffix}")
    ranges = (
        (1, "thumb"),
        (5, "index"),
        (9, "middle"),
        (13, "ring"),
        (17, "pinky"),
    )
    start, finger = max(
        (start, finger) for start, finger in ranges if index >= start
    )
    joint_offset = min(3, index - start)
    bone = armature.pose.bones[f"c_{finger}{max(1, joint_offset)}{rig_suffix}"]
    return armature.matrix_world @ (bone.head if joint_offset == 0 else bone.tail)


def contact_weight(frame: int) -> float:
    """Blend anatomical correction in and out without displacing rest poses."""
    if frame <= contact_start_frame:
        value = (frame - 1) / max(1, contact_start_frame - 1)
    elif frame <= contact_end_frame:
        value = 1.0
    else:
        value = (release_frame - frame) / max(
            1, release_frame - contact_end_frame
        )
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


# Landmark-space lengths do not equal this avatar's hand-bone lengths. After
# palm orientation is known, align the corresponding *rig joint* to the body
# anchor and re-solve the arm. This is what guarantees visible chin contact.
if contact_hand_indices:
    for _ in range(3):
        bpy.context.scene.frame_set(contact_frame)
        bpy.context.view_layer.update()
        rig_contact = sum(
            (rig_hand_landmark_world(index) for index in contact_hand_indices),
            Vector(),
        ) / len(contact_hand_indices)
        rig_correction = anchor_wrist - rig_contact
        if rig_correction.length < 0.003:
            break
        corrected_path = []
        for frame, wrist, captured_elbow in path:
            weight = contact_weight(frame)
            corrected_wrist = wrist + rig_correction * weight
            corrected_hint = captured_elbow + rig_correction * (0.35 * weight)
            corrected_path.append((frame, corrected_wrist, corrected_hint))
        path = corrected_path
        key_anatomical_path(path)

scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = end_frame
scene.render.fps = output_fps
bpy.ops.wm.save_as_mainfile(filepath=output_path)
