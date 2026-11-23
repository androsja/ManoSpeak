"""Generate and geometrically validate a sampled rig trajectory in Blender.

This tool is an offline diagnostic. It does not authorize runtime execution,
anatomical ranges, or sign validity.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree


ROOT = Path.cwd()
TOOLS = ROOT / "mobile/tools"
PROFILE_PATH = ROOT / "schemas/rig-profiles/vozual-rig-1.v2.json"
COLLISION_MESH_NAMES = {
    "Eyebrows", "HAIR", "NUG_Base_Body", "NUG_Base_Eye", "NUG_Base_Teeth",
    "NUG_Base_Tongue", "SNP_OP_Dress",
}


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load helper module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def validate_profile_hash() -> str:
    script = (
        "const fs=require('fs');"
        "const {profileSha256,validateRigCapabilityProfile}="
        "require('./mobile/tools/rig-capability-profile.cjs');"
        "const profile=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "validateRigCapabilityProfile(profile);"
        "const actual=profileSha256(profile);"
        "if(actual!==profile.sha256) process.exit(2);"
        "process.stdout.write(actual);"
    )
    result = subprocess.run(
        ["node", "-e", script, str(PROFILE_PATH)], cwd=ROOT,
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise ValueError("Rig profile failed its canonical hash or schema validation")
    return result.stdout.strip()


def finite_point(value, name: str) -> Vector:
    if not isinstance(value, list) or len(value) != 3 or any(
        not isinstance(component, (int, float)) or not math.isfinite(component)
        for component in value
    ):
        raise ValueError(f"{name} must be a finite 3-vector")
    return Vector(value)


def normalized(value, name: str) -> Vector:
    vector = finite_point(value, name)
    if vector.length < 1e-9:
        raise ValueError(f"{name} must not be zero")
    return vector.normalized()


def exact_object(value, fields: set[str], name: str) -> None:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError(f"{name} must contain exactly these fields: {sorted(fields)}")


def validate_input(document, profile, candidate_path: Path, calibration_path: Path) -> None:
    fields = {
        "schema", "schemaVersion", "candidateSha256", "profileSha256",
        "coordinateCalibrationSha256", "frameId", "side", "durationMs",
        "sampleRateHz", "collisionPriority", "maxReachErrorM",
        "maxSurfaceQueryDistanceM", "minApproachNormalDot", "standoffM",
        "articulationCommandsWxyz", "waypoints",
    }
    exact_object(document, fields, "trajectory")
    if document["schema"] != "vozual.rig-target-trajectory" or document["schemaVersion"] != 1:
        raise ValueError("Unsupported rig target trajectory schema")
    coordinate_ref = profile["descriptor"]["coordinateCalibration"]
    if document["candidateSha256"] != sha256_file(candidate_path) or document["candidateSha256"] != profile["asset"]["candidateSha256"]:
        raise ValueError("Candidate SHA-256 does not match the bound rig profile")
    if document["profileSha256"] != profile["sha256"] or profile["sha256"] != validate_profile_hash():
        raise ValueError("Profile SHA-256 does not match its canonical contents")
    if document["coordinateCalibrationSha256"] != sha256_file(calibration_path) or document["coordinateCalibrationSha256"] != coordinate_ref["measurementSha256"]:
        raise ValueError("Coordinate calibration SHA-256 does not match the bound rig profile")
    if document["frameId"] != "body" or document["side"] not in {"L", "R"}:
        raise ValueError("Only calibrated body-frame trajectories for one arm are supported")
    duration = document["durationMs"]
    rate = document["sampleRateHz"]
    if not isinstance(duration, int) or not 0 < duration <= 10000:
        raise ValueError("durationMs must be an integer between 1 and 10000")
    if not isinstance(rate, int) or not 30 <= rate <= 120:
        raise ValueError("sampleRateHz must be an integer between 30 and 120")
    if document["collisionPriority"] not in {"required", "preferred"}:
        raise ValueError("collisionPriority must be required or preferred")
    if not isinstance(document["maxReachErrorM"], (int, float)) or not 0 < document["maxReachErrorM"] <= 0.005:
        raise ValueError("maxReachErrorM must be in (0, 0.005]")
    if not isinstance(document["maxSurfaceQueryDistanceM"], (int, float)) or not 0 < document["maxSurfaceQueryDistanceM"] <= 0.05:
        raise ValueError("maxSurfaceQueryDistanceM must be in (0, 0.05]")
    if not isinstance(document["minApproachNormalDot"], (int, float)) or not -1 <= document["minApproachNormalDot"] <= 1:
        raise ValueError("minApproachNormalDot must be in [-1, 1]")
    if not isinstance(document["standoffM"], (int, float)) or not 0 <= document["standoffM"] <= profile["conformance"]["contactToleranceM"]:
        raise ValueError("standoffM must be within the calibrated contact tolerance")
    if not isinstance(document["waypoints"], list) or len(document["waypoints"]) < 2:
        raise ValueError("At least two target waypoints are required")
    previous_time = -1
    for index, waypoint in enumerate(document["waypoints"]):
        exact_object(waypoint, {"timeMs", "queryBodyM"}, f"waypoints[{index}]")
        time_ms = waypoint["timeMs"]
        if not isinstance(time_ms, int) or time_ms <= previous_time or time_ms < 0 or time_ms > duration:
            raise ValueError("Waypoint times must be increasing integers inside the motion duration")
        finite_point(waypoint["queryBodyM"], f"waypoints[{index}].queryBodyM")
        previous_time = time_ms
    if document["waypoints"][0]["timeMs"] != 0 or document["waypoints"][-1]["timeMs"] != duration:
        raise ValueError("Waypoints must cover the complete duration")
    commands = document["articulationCommandsWxyz"]
    if not isinstance(commands, dict):
        raise ValueError("articulationCommandsWxyz must be an object")
    side = document["side"]
    solver_bones = {
        f"DEF-upper_arm.{side}", f"DEF-forearm.{side}", f"DEF-hand.{side}",
    }
    for bone, quaternion in commands.items():
        if bone in solver_bones:
            raise ValueError(f"The arm solver controls {bone}; it cannot be pre-authored")
        if not isinstance(bone, str) or not isinstance(quaternion, list) or len(quaternion) != 4 or any(
            not isinstance(value, (int, float)) or not math.isfinite(value) for value in quaternion
        ):
            raise ValueError(f"Invalid WXYZ articulation command for {bone}")
        if abs(math.sqrt(sum(value * value for value in quaternion)) - 1) > 0.0001:
            raise ValueError(f"Articulation quaternion for {bone} must be normalized")


def body_to_world(point: Vector, frame) -> Vector:
    origin, axis_x, axis_y, axis_z = frame
    return origin + point.x * axis_x + point.y * axis_y + point.z * axis_z


def body_direction_to_world(direction: Vector, frame) -> Vector:
    _, axis_x, axis_y, axis_z = frame
    return (direction.x * axis_x + direction.y * axis_y + direction.z * axis_z).normalized()


def body_coordinates(point: Vector, frame) -> list[float]:
    origin, axis_x, axis_y, axis_z = frame
    delta = point - origin
    return [delta.dot(axis_x), delta.dot(axis_y), delta.dot(axis_z)]


def trajectory_points(document) -> list[tuple[int, Vector]]:
    duration = document["durationMs"]
    rate = document["sampleRateHz"]
    interval = 1000.0 / rate
    times = [0]
    time = interval
    while time < duration:
        times.append(round(time))
        time += interval
    if times[-1] != duration:
        times.append(duration)
    samples = []
    waypoints = document["waypoints"]
    segment = 0
    for time_ms in sorted(set(times)):
        while segment + 1 < len(waypoints) - 1 and time_ms > waypoints[segment + 1]["timeMs"]:
            segment += 1
        left = waypoints[segment]
        right = waypoints[segment + 1]
        amount = (time_ms - left["timeMs"]) / (right["timeMs"] - left["timeMs"])
        a = finite_point(left["queryBodyM"], "waypoint").lerp(finite_point(right["queryBodyM"], "waypoint"), amount)
        samples.append((time_ms, a))
    return samples


def limb_side(name: str) -> str | None:
    for side in ("L", "R"):
        prefixes = (f"DEF-shoulder.{side}", f"DEF-upper_arm.{side}", f"DEF-forearm.{side}", f"DEF-hand.{side}")
        if name.startswith(prefixes):
            return side
        if name.startswith("DEF-f_") and name.endswith(f".{side}"):
            return side
        if name.startswith("DEF-thumb.") and name.endswith(f".{side}"):
            return side
    return None


def vertex_limb_weights(obj, vertex, group_names=None) -> tuple[float, float]:
    if group_names is None:
        group_names = {group.index: group.name for group in obj.vertex_groups}
    left = 0.0
    right = 0.0
    for membership in vertex.groups:
        side = limb_side(group_names.get(membership.group, ""))
        if side == "L":
            left += membership.weight
        elif side == "R":
            right += membership.weight
    return left, right


def classify_limb(weights: tuple[float, float]) -> str:
    left, right = weights
    if left >= 0.2 and left > right:
        return "left"
    if right >= 0.2 and right > left:
        return "right"
    return "body"


def mesh_triangles(obj, evaluated_mesh):
    if len(obj.data.vertices) != len(evaluated_mesh.vertices) or len(obj.data.polygons) != len(evaluated_mesh.polygons):
        raise RuntimeError(f"Evaluated topology changed for {obj.name}")
    if any((tuple(a.vertices), a.material_index) != (tuple(b.vertices), b.material_index)
           for a, b in zip(obj.data.polygons, evaluated_mesh.polygons)):
        raise RuntimeError(f"Evaluated face mapping changed for {obj.name}")
    evaluated_mesh.calc_loop_triangles()
    group_names = {group.index: group.name for group in obj.vertex_groups}
    vertex_weights = [vertex_limb_weights(obj, vertex, group_names) for vertex in obj.data.vertices]
    faces = {"left": [], "right": [], "body": []}
    for triangle in evaluated_mesh.loop_triangles:
        vertices = tuple(triangle.vertices)
        weights = [vertex_weights[index] for index in vertices]
        left = sum(value[0] for value in weights) / 3
        right = sum(value[1] for value in weights) / 3
        if left >= 0.2 and left > right:
            group = "left"
        elif right >= 0.2 and right > left:
            group = "right"
        else:
            group = "body"
        faces[group].append(vertices)
    return faces, vertex_weights


def build_collision_topology(mesh_objects):
    topology = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in mesh_objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            faces, _ = mesh_triangles(obj, mesh)
            topology[obj.name] = faces
        finally:
            evaluated.to_mesh_clear()
    return topology


def collision_measurement(mesh_objects, topology) -> dict:
    points: list[Vector] = []
    faces_by_group = {"left": [], "right": [], "body": []}
    excluded = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in mesh_objects:
        if not obj.vertex_groups:
            excluded.append({"mesh": obj.name, "reason": "no vertex-group skinning"})
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            if len(obj.data.vertices) != len(mesh.vertices) or len(obj.data.polygons) != len(mesh.polygons):
                raise RuntimeError(f"Evaluated topology changed for {obj.name}")
            faces = topology[obj.name]
            offset = len(points)
            object_points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
            points.extend(object_points)
            for group, triangles in faces.items():
                for face in triangles:
                    faces_by_group[group].append((obj.name, tuple(face), tuple(index + offset for index in face)))
        finally:
            evaluated.to_mesh_clear()
    if not faces_by_group["left"] or not faces_by_group["right"] or not faces_by_group["body"]:
        raise RuntimeError("Whole-avatar collision scopes must contain left, right and body triangles")
    trees = {
        group: BVHTree.FromPolygons(points, [row[2] for row in faces], all_triangles=True)
        for group, faces in faces_by_group.items()
    }
    scopes = [("left-right", "left", "right"), ("left-body", "left", "body"),
              ("right-body", "right", "body")]
    counts = {}
    overlap_pair_ids = {}
    for scope, first, second in scopes:
        pair_ids = set()
        for first_index, second_index in trees[first].overlap(trees[second]):
            first_mesh, first_face, _ = faces_by_group[first][first_index]
            second_mesh, second_face, _ = faces_by_group[second][second_index]
            if first_mesh == second_mesh and set(first_face).intersection(second_face):
                continue
            pair_ids.add((first_mesh, first_face, second_mesh, second_face))
        counts[scope] = len(pair_ids)
        overlap_pair_ids[scope] = pair_ids
    for group in ("left", "right", "body"):
        pair_ids = set()
        faces = faces_by_group[group]
        for first_index, second_index in trees[group].overlap(trees[group]):
            if first_index >= second_index:
                continue
            first_mesh, first_face, _ = faces[first_index]
            second_mesh, second_face, _ = faces[second_index]
            if first_mesh == second_mesh and set(first_face).intersection(second_face):
                continue
            pair_ids.add((first_mesh, first_face, second_mesh, second_face))
        counts[f"{group}-self"] = len(pair_ids)
        overlap_pair_ids[f"{group}-self"] = pair_ids
    return {
        "scopedOverlapCounts": counts,
        "overlapPairIds": overlap_pair_ids,
        "triangleCounts": {group: len(faces) for group, faces in faces_by_group.items()},
        "includedSkinnedMeshes": sorted({row[0] for faces in faces_by_group.values() for row in faces}),
        "excludedMeshes": excluded,
    }


def body_surface_query(body, query_world: Vector, categories) -> tuple[Vector, Vector, int, float]:
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(categories) or len(mesh.polygons) != len(body.data.polygons):
            raise RuntimeError("Body surface topology changed during trajectory solve")
        if any((tuple(a.vertices), a.material_index) != (tuple(b.vertices), b.material_index)
               for a, b in zip(body.data.polygons, mesh.polygons)):
            raise RuntimeError("Body surface face mapping changed during trajectory solve")
        mesh.calc_loop_triangles()
        triangles = [tuple(triangle.vertices) for triangle in mesh.loop_triangles
                     if all(categories[index] is None for index in triangle.vertices)]
        if not triangles:
            raise RuntimeError("No non-limb body-surface triangles are available")
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)
        nearest = tree.find_nearest(query_world)
        if nearest is None or nearest[0] is None or nearest[1] is None or nearest[3] is None:
            raise RuntimeError("Body-surface query did not return a triangle point and normal")
        point, normal, triangle_index, distance_m = nearest
        normal = normal.normalized()
        toward_query = query_world - point
        if toward_query.length < 1e-8 or normal.dot(toward_query.normalized()) < 1e-4:
            raise RuntimeError("Surface query must be outside the body and aligned with the measured triangle normal")
        return point.copy(), normal.copy(), int(triangle_index), float(distance_m)
    finally:
        evaluated.to_mesh_clear()


def rotate_at_head(bone, rotation: Quaternion) -> None:
    head = bone.head.copy()
    bone.matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-head) @ bone.matrix
    bpy.context.view_layer.update()


def aim_bone(bone, endpoint: Vector, destination: Vector) -> None:
    source_ray = endpoint - bone.head
    target_ray = destination - bone.head
    if source_ray.length < 1e-8 or target_ray.length < 1e-8:
        raise RuntimeError(f"Cannot aim {bone.name} along a zero-length ray")
    rotate_at_head(bone, source_ray.rotation_difference(target_ray))


def solve_two_bone_arm(rig, side: str, target_rig: Vector, inward_rig: Vector, outward_rig: Vector) -> list[str]:
    upper = rig.pose.bones[f"DEF-upper_arm.{side}"]
    forearm = rig.pose.bones[f"DEF-forearm.{side}"]
    hand = rig.pose.bones[f"DEF-hand.{side}"]
    tip = rig.pose.bones[f"DEF-f_index.03.{side}"].tail.copy()
    upper_length = (forearm.head - upper.head).length
    forearm_length = (hand.head - forearm.head).length
    wrist_to_tip = (tip - hand.head).length
    inward = inward_rig.normalized()
    outward = outward_rig.normalized()
    wrist = target_rig - wrist_to_tip * inward
    shoulder_to_wrist = wrist - upper.head
    distance = shoulder_to_wrist.length
    if not upper_length or not forearm_length or not 0 < distance < upper_length + forearm_length or distance <= abs(upper_length - forearm_length):
        raise ValueError("Target is outside the non-singular two-bone arm reach envelope")
    reach = shoulder_to_wrist.normalized()
    bend = outward - reach.dot(outward) * reach
    if bend.length < 1e-6:
        raise ValueError("Elbow bend direction is parallel to the arm reach axis")
    bend.normalize()
    across = (upper_length**2 - forearm_length**2 + distance**2) / (2 * distance)
    offset_sq = upper_length**2 - across**2
    if offset_sq < -1e-8:
        raise ValueError("Two-bone arm target has no real elbow solution")
    elbow = upper.head + across * reach + math.sqrt(max(0.0, offset_sq)) * bend
    aim_bone(upper, forearm.head.copy(), elbow)
    aim_bone(forearm, hand.head.copy(), wrist)
    aim_bone(hand, rig.pose.bones[f"DEF-f_index.03.{side}"].tail.copy(), target_rig)
    bpy.context.view_layer.update()
    return [upper.name, forearm.name, hand.name]


def reset_pose(rig) -> None:
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def pose_commands(rig) -> dict:
    result = {}
    for bone in rig.pose.bones:
        translation, rotation, scale = bone.matrix_basis.decompose()
        if translation.length > 1e-6 or (scale - Vector((1, 1, 1))).length > 1e-6:
            raise RuntimeError(f"The solved pose requires a translation or scale override on {bone.name}")
        if abs(rotation.w) < 1 - 1e-12:
            result[bone.name] = [rotation.w, rotation.x, rotation.y, rotation.z]
    return dict(sorted(result.items()))


def interpolate_pose_commands(first: dict, second: dict, amount: float) -> dict:
    result = {}
    for bone_name in sorted(set(first) | set(second)):
        a = Quaternion(first.get(bone_name, [1, 0, 0, 0]))
        b = Quaternion(second.get(bone_name, [1, 0, 0, 0]))
        result[bone_name] = list(a.slerp(b, amount))
    return result


def apply_pose_commands(rig, commands: dict) -> None:
    reset_pose(rig)
    for bone_name, quaternion_wxyz in commands.items():
        bone = rig.pose.bones.get(bone_name)
        if bone is None:
            raise ValueError(f"Unknown articulation bone {bone_name}")
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion(quaternion_wxyz)
    bpy.context.view_layer.update()


def run_solver(candidate: Path, trajectory_path: Path, output: Path) -> dict:
    profile = json.loads(PROFILE_PATH.read_text())
    calibration_ref = profile["descriptor"]["coordinateCalibration"]
    calibration_path = ROOT / calibration_ref["measurementArtifact"]
    trajectory_bytes = trajectory_path.read_bytes()
    document = json.loads(trajectory_bytes)
    validate_input(document, profile, candidate, calibration_path)
    calibration = json.loads(calibration_path.read_text())

    coordinate = load_module("coordinate_measurement", TOOLS / "measure-rig-coordinate-contract.py")
    checker = load_module("finger_geometry", TOOLS / "verify-rig-finger-intersections.py")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError("Expected exactly one armature")
    rig = rigs[0]
    body = checker.candidate_body()
    categories = checker.category_by_vertex(body)
    collision_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name in COLLISION_MESH_NAMES]
    if {obj.name for obj in collision_meshes} != COLLISION_MESH_NAMES:
        raise RuntimeError("The candidate is missing a required skinned mesh from the collision domain")
    if any(not obj.vertex_groups for obj in collision_meshes):
        raise RuntimeError("Every collision-domain mesh must preserve its skinning groups")
    collision_topology = build_collision_topology(collision_meshes)

    left_shoulder, right_shoulder, neck, spine = [coordinate.world_head(rig, name) for name in (
        "DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-spine.006", "DEF-spine.003",
    )]
    frame = coordinate.orthonormal_frame((left_shoulder + right_shoulder) / 2,
                                         left_shoulder - right_shoulder, neck - spine)
    if coordinate.frame_report(*frame) != calibration["body"]:
        raise RuntimeError("Candidate body frame differs from the profile-bound calibration")
    calibration_by_id = {row["id"]: row["bodyPositionM"] for row in calibration["anchors"]}
    side = document["side"]
    anchor_side = "left" if side == "L" else "right"
    anchor_tip = f"hand.index.tip.{anchor_side}"
    anchor_root = f"hand.index.segment.01.{anchor_side}"
    if anchor_tip not in calibration_by_id or anchor_root not in calibration_by_id:
        raise RuntimeError("Calibrated index root and tip anchors are required")
    rest_root = coordinate.body_coordinates(rig.matrix_world @ rig.pose.bones[f"DEF-f_index.01.{side}"].head, frame)
    rest_tip = coordinate.body_coordinates(rig.matrix_world @ rig.pose.bones[f"DEF-f_index.03.{side}"].tail, frame)
    if math.dist(rest_root, calibration_by_id[anchor_root]) > 1e-6 or math.dist(rest_tip, calibration_by_id[anchor_tip]) > 1e-6:
        raise RuntimeError("Candidate rest index anchors differ from the calibrated anchor inventory")

    body_to_rig = rig.matrix_world.inverted()
    origin, axis_x, axis_y, axis_z = frame
    output_frames = []
    previous_commands = None
    max_joint_step_deg = 0.0
    max_query_distance_m = 0.0
    collision_summary = {
        "left-right": 0, "left-body": 0, "right-body": 0,
        "left-self": 0, "right-self": 0, "body-self": 0,
    }
    reset_pose(rig)
    baseline_collision = collision_measurement(collision_meshes, collision_topology)
    new_collision_summary = {scope: 0 for scope in collision_summary}
    transition_collision_summary = {scope: 0 for scope in collision_summary}
    transition_new_collision_summary = {scope: 0 for scope in collision_summary}
    transition_only_collision_summary = {scope: 0 for scope in collision_summary}
    transition_samples = []
    target_resolved_collision_summary = {scope: 0 for scope in collision_summary}
    target_resolved_new_collision_summary = {scope: 0 for scope in collision_summary}
    target_resolved_only_collision_summary = {scope: 0 for scope in collision_summary}
    target_resolved_samples = []
    max_transition_reach_error_m = 0.0
    min_transition_approach_normal_dot = 1.0
    transition_surface_projection_pass = True
    discrete_overlap_pair_ids = []
    for time_ms, query_body in trajectory_points(document):
        reset_pose(rig)
        for bone_name, quaternion_wxyz in document["articulationCommandsWxyz"].items():
            bone = rig.pose.bones.get(bone_name)
            if bone is None:
                raise ValueError(f"Unknown articulation bone {bone_name}")
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = Quaternion((quaternion_wxyz[0], quaternion_wxyz[1], quaternion_wxyz[2], quaternion_wxyz[3]))
        bpy.context.view_layer.update()

        query_world = body_to_world(query_body, frame)
        surface_point_world, surface_normal_world, surface_triangle, query_distance_m = body_surface_query(
            body, query_world, categories,
        )
        if query_distance_m > document["maxSurfaceQueryDistanceM"]:
            raise ValueError(
                f"Surface query is {query_distance_m:.6f} m from the body, exceeding "
                f"the {document['maxSurfaceQueryDistanceM']:.6f} m projection limit"
            )
        max_query_distance_m = max(max_query_distance_m, query_distance_m)
        target_world = surface_point_world + document["standoffM"] * surface_normal_world
        target_rig = body_to_rig @ target_world
        outward_rig = body_to_rig.to_3x3() @ surface_normal_world
        inward_rig = -outward_rig
        side_rig = "L" if side == "L" else "R"
        solve_two_bone_arm(rig, side_rig, target_rig, inward_rig, outward_rig)
        bpy.context.view_layer.update()

        tip_world = rig.matrix_world @ rig.pose.bones[f"DEF-f_index.03.{side}"].tail
        root_world = rig.matrix_world @ rig.pose.bones[f"DEF-f_index.01.{side}"].head
        actual_tip_body = coordinate.body_coordinates(tip_world, frame)
        root_body = coordinate.body_coordinates(root_world, frame)
        surface_point_body = coordinate.body_coordinates(surface_point_world, frame)
        surface_normal_body = [surface_normal_world.dot(axis) for axis in (axis_x, axis_y, axis_z)]
        target_body = coordinate.body_coordinates(target_world, frame)
        gap_m = math.dist(actual_tip_body, surface_point_body)
        reach_error_m = math.dist(actual_tip_body, target_body)
        index_direction = Vector(actual_tip_body) - Vector(root_body)
        if index_direction.length < 1e-8:
            raise RuntimeError("Solved index direction is degenerate")
        index_direction.normalize()
        approach_normal_dot = -index_direction.dot(Vector(surface_normal_body).normalized())

        collision = collision_measurement(collision_meshes, collision_topology)
        discrete_overlap_pair_ids.append(collision["overlapPairIds"])
        new_collision_counts = {}
        for key, value in collision["scopedOverlapCounts"].items():
            collision_summary[key] = max(collision_summary[key], value)
            new_pairs = collision["overlapPairIds"][key] - baseline_collision["overlapPairIds"][key]
            new_collision_counts[key] = len(new_pairs)
            new_collision_summary[key] = max(new_collision_summary[key], len(new_pairs))
        commands = pose_commands(rig)
        joint_step_deg = 0.0
        if previous_commands is not None:
            common_bones = set(previous_commands) | set(commands)
            for bone_name in common_bones:
                a = Quaternion(previous_commands.get(bone_name, [1, 0, 0, 0]))
                b = Quaternion(commands.get(bone_name, [1, 0, 0, 0]))
                angle = math.degrees(a.rotation_difference(b).angle)
                joint_step_deg = max(joint_step_deg, angle)
            max_joint_step_deg = max(max_joint_step_deg, joint_step_deg)
        previous_commands = commands
        output_frames.append({
            "timeMs": time_ms,
            "queryBodyM": list(query_body),
            "surfacePointBodyM": surface_point_body,
            "surfaceTriangleIndex": surface_triangle,
            "queryToSurfaceDistanceM": query_distance_m,
            "surfaceNormalBody": surface_normal_body,
            "targetTipBodyM": target_body,
            "actualTipBodyM": actual_tip_body,
            "indexRootBodyM": root_body,
            "surfaceGapM": gap_m,
            "reachErrorM": reach_error_m,
            "jointStepDegFromPreviousFrame": joint_step_deg,
            "approachNormalDot": approach_normal_dot,
            "collisionCounts": collision["scopedOverlapCounts"],
            "newCollisionCountsSinceRest": new_collision_counts,
            "poseCommandsWxyz": commands,
        })

    max_interpolation_step_deg = 2.5
    for frame_index, (first_frame, second_frame) in enumerate(zip(output_frames, output_frames[1:])):
        first_commands = first_frame["poseCommandsWxyz"]
        second_commands = second_frame["poseCommandsWxyz"]
        max_joint_angle_deg = max((
            math.degrees(Quaternion(first_commands.get(name, [1, 0, 0, 0])).rotation_difference(
                Quaternion(second_commands.get(name, [1, 0, 0, 0]))).angle)
            for name in set(first_commands) | set(second_commands)
        ), default=0.0)
        substeps = max(1, math.ceil(max_joint_angle_deg / max_interpolation_step_deg))
        for substep in range(1, substeps):
            amount = substep / substeps
            apply_pose_commands(rig, interpolate_pose_commands(first_commands, second_commands, amount))
            collision = collision_measurement(collision_meshes, collision_topology)
            new_counts = {}
            transition_only_counts = {}
            for key, value in collision["scopedOverlapCounts"].items():
                transition_collision_summary[key] = max(transition_collision_summary[key], value)
                collision_summary[key] = max(collision_summary[key], value)
                new_pairs = collision["overlapPairIds"][key] - baseline_collision["overlapPairIds"][key]
                new_counts[key] = len(new_pairs)
                transition_new_collision_summary[key] = max(transition_new_collision_summary[key], len(new_pairs))
                new_collision_summary[key] = max(new_collision_summary[key], len(new_pairs))
                endpoint_pairs = (discrete_overlap_pair_ids[frame_index][key] |
                                  discrete_overlap_pair_ids[frame_index + 1][key])
                transition_only_pairs = collision["overlapPairIds"][key] - endpoint_pairs
                transition_only_counts[key] = len(transition_only_pairs)
                transition_only_collision_summary[key] = max(
                    transition_only_collision_summary[key], len(transition_only_pairs),
                )
            transition_samples.append({
                "fromTimeMs": first_frame["timeMs"],
                "toTimeMs": second_frame["timeMs"],
                "interpolationFraction": amount,
                "maximumJointStepDeg": max_joint_angle_deg / substeps,
                "collisionCounts": collision["scopedOverlapCounts"],
                "newCollisionCountsSinceRest": new_counts,
                "intermediateOnlyCollisionCountsVsSegmentEndpoints": transition_only_counts,
            })

            query_body = Vector(first_frame["queryBodyM"]).lerp(Vector(second_frame["queryBodyM"]), amount)
            apply_pose_commands(rig, document["articulationCommandsWxyz"])
            query_world = body_to_world(query_body, frame)
            surface_point_world, surface_normal_world, surface_triangle, query_distance_m = body_surface_query(
                body, query_world, categories,
            )
            transition_surface_projection_pass &= query_distance_m <= document["maxSurfaceQueryDistanceM"]
            max_query_distance_m = max(max_query_distance_m, query_distance_m)
            target_world = surface_point_world + document["standoffM"] * surface_normal_world
            target_rig = body_to_rig @ target_world
            outward_rig = body_to_rig.to_3x3() @ surface_normal_world
            solve_two_bone_arm(rig, side_rig, target_rig, -outward_rig, outward_rig)
            bpy.context.view_layer.update()
            tip_world = rig.matrix_world @ rig.pose.bones[f"DEF-f_index.03.{side}"].tail
            root_world = rig.matrix_world @ rig.pose.bones[f"DEF-f_index.01.{side}"].head
            tip_body = Vector(coordinate.body_coordinates(tip_world, frame))
            root_body = Vector(coordinate.body_coordinates(root_world, frame))
            target_body = Vector(coordinate.body_coordinates(target_world, frame))
            normal_body = Vector([surface_normal_world.dot(axis) for axis in (axis_x, axis_y, axis_z)]).normalized()
            index_direction = tip_body - root_body
            if index_direction.length < 1e-8:
                raise RuntimeError("Intermediate solved index direction is degenerate")
            approach_normal_dot = -index_direction.normalized().dot(normal_body)
            reach_error_m = (tip_body - target_body).length
            max_transition_reach_error_m = max(max_transition_reach_error_m, reach_error_m)
            min_transition_approach_normal_dot = min(min_transition_approach_normal_dot, approach_normal_dot)

            target_collision = collision_measurement(collision_meshes, collision_topology)
            target_new_counts = {}
            target_only_counts = {}
            for key, value in target_collision["scopedOverlapCounts"].items():
                target_resolved_collision_summary[key] = max(target_resolved_collision_summary[key], value)
                collision_summary[key] = max(collision_summary[key], value)
                new_pairs = target_collision["overlapPairIds"][key] - baseline_collision["overlapPairIds"][key]
                target_new_counts[key] = len(new_pairs)
                target_resolved_new_collision_summary[key] = max(target_resolved_new_collision_summary[key], len(new_pairs))
                new_collision_summary[key] = max(new_collision_summary[key], len(new_pairs))
                endpoint_pairs = (discrete_overlap_pair_ids[frame_index][key] |
                                  discrete_overlap_pair_ids[frame_index + 1][key])
                only_pairs = target_collision["overlapPairIds"][key] - endpoint_pairs
                target_only_counts[key] = len(only_pairs)
                target_resolved_only_collision_summary[key] = max(
                    target_resolved_only_collision_summary[key], len(only_pairs),
                )
            target_resolved_samples.append({
                "fromTimeMs": first_frame["timeMs"],
                "toTimeMs": second_frame["timeMs"],
                "interpolationFraction": amount,
                "queryBodyM": list(query_body),
                "surfaceTriangleIndex": surface_triangle,
                "queryToSurfaceDistanceM": query_distance_m,
                "reachErrorM": reach_error_m,
                "approachNormalDot": approach_normal_dot,
                "collisionCounts": target_collision["scopedOverlapCounts"],
                "newCollisionCountsSinceRest": target_new_counts,
                "intermediateOnlyCollisionCountsVsSegmentEndpoints": target_only_counts,
            })

    max_observed_reach_error_m = max(
        max(frame["reachErrorM"] for frame in output_frames), max_transition_reach_error_m,
    )
    min_observed_normal_dot = min(
        min(frame["approachNormalDot"] for frame in output_frames), min_transition_approach_normal_dot,
    )
    reach_pass = max_observed_reach_error_m <= document["maxReachErrorM"]
    normal_pass = min_observed_normal_dot >= document["minApproachNormalDot"]
    collision_detected = any(collision_summary.values())
    if document["collisionPriority"] == "required":
        collision_pass = not collision_detected
    else:
        collision_pass = True
    worst_reach_frame = max(output_frames, key=lambda frame: frame["reachErrorM"])
    farthest_query_frame = max(output_frames, key=lambda frame: frame["queryToSurfaceDistanceM"])
    worst_collision_frame = max(output_frames, key=lambda frame: sum(frame["newCollisionCountsSinceRest"].values()))
    worst_transition_sample = max(transition_samples,
                                  key=lambda sample: sum(sample["newCollisionCountsSinceRest"].values()),
                                  default=None)
    worst_target_resolved_reach = max(target_resolved_samples,
                                      key=lambda sample: sample["reachErrorM"], default=None)
    farthest_target_resolved_query = max(target_resolved_samples,
                                         key=lambda sample: sample["queryToSurfaceDistanceM"], default=None)
    lowest_target_resolved_normal = min(target_resolved_samples,
                                        key=lambda sample: sample["approachNormalDot"], default=None)
    worst_target_resolved_collision = max(
        target_resolved_samples,
        key=lambda sample: sum(sample["newCollisionCountsSinceRest"].values()), default=None,
    )
    lowest_alignment_frame = min(output_frames, key=lambda frame: frame["approachNormalDot"])
    closest_surface_frame = min(output_frames, key=lambda frame: frame["surfaceGapM"])
    report = {
        "schema": "vozual.rig-motion-trajectory-diagnostic",
        "schemaVersion": 1,
        "candidateSha256": sha256_file(candidate),
        "profileSha256": profile["sha256"],
        "coordinateCalibrationSha256": sha256_file(calibration_path),
        "inputTrajectorySha256": sha256_bytes(trajectory_bytes),
        "frameId": "body",
        "surfaceId": "body-skin-nonlimb-v1",
        "surfaceMask": "NUG_Base_Body triangles whose three vertices are classified as non-limb dominant; all body materials included",
        "collisionDomain": {
            "skinnedMeshScope": sorted(obj.name for obj in collision_meshes),
            "collisionScope": "left/right limb cross-group overlaps, limb-to-body overlaps, and non-adjacent self-overlaps within each classified group at generated frames and sampled intermediate poses",
            "baselinePose": "imported neutral rig rest pose before trajectory commands",
            "exclusions": ["unskinned Cube and Icosphere placeholders", "continuous between-sample collision is not proven"],
        },
        "solver": {
            "algorithm": "two-bone analytic arm IK with fixed elbow-bend direction",
            "side": side,
            "sampleRateHz": document["sampleRateHz"],
            "sampleCount": len(output_frames),
            "standoffM": document["standoffM"],
            "maxReachErrorM": document["maxReachErrorM"],
            "maxObservedReachErrorM": max_observed_reach_error_m,
            "maxObservedIntermediateReachErrorM": max_transition_reach_error_m,
            "maxSurfaceQueryDistanceM": document["maxSurfaceQueryDistanceM"],
            "maxObservedSurfaceQueryDistanceM": max_query_distance_m,
            "minApproachNormalDot": document["minApproachNormalDot"],
            "minObservedApproachNormalDot": min_observed_normal_dot,
            "minObservedIntermediateApproachNormalDot": min_transition_approach_normal_dot,
            "maxJointStepDeg": max_joint_step_deg,
            "collisionPriority": document["collisionPriority"],
            "anatomicalLimits": "unsupported-not-inferred",
            "runtimeExecutable": False,
        },
        "collisionSummaryMaxOverlapPairsByScope": collision_summary,
        "discreteFrameCollisionSummaryMaxOverlapPairsByScope": {
            key: max((frame["collisionCounts"][key] for frame in output_frames), default=0)
            for key in collision_summary
        },
        "transitionSampleCollisionSummaryMaxOverlapPairsByScope": transition_collision_summary,
        "collisionBaselineOverlapPairsByScope": baseline_collision["scopedOverlapCounts"],
        "collisionSummaryMaxNewPairsSinceRestByScope": new_collision_summary,
        "transitionSampleMaxNewPairsSinceRestByScope": transition_new_collision_summary,
        "transitionSampleMaxPairsAbsentAtBothSegmentEndpointsByScope": transition_only_collision_summary,
        "targetResolvedTransitionMaxOverlapPairsByScope": target_resolved_collision_summary,
        "targetResolvedTransitionMaxNewPairsSinceRestByScope": target_resolved_new_collision_summary,
        "targetResolvedTransitionMaxPairsAbsentAtBothSegmentEndpointsByScope": target_resolved_only_collision_summary,
        "targetResolvedTransitionSampling": {
            "interpolation": "linear interpolation of body-frame queries followed by a fresh surface query and analytic two-bone IK solve",
            "sampleCount": len(target_resolved_samples),
            "samples": target_resolved_samples,
            "continuousCollisionDetection": False,
        },
        "transitionSampling": {
            "interpolation": "shortest-path per-bone quaternion SLERP between adjacent generated pose commands",
            "maximumJointStepDeg": max_interpolation_step_deg,
            "sampleCount": len(transition_samples),
            "samples": transition_samples,
            "continuousCollisionDetection": False,
        },
        "collisionPolicyOutcome": (
            "rejected-required" if collision_detected and document["collisionPriority"] == "required"
            else "reported-preferred" if collision_detected
            else "clear"
        ),
        "constraintPasses": {
            "reachError": reach_pass,
            "surfaceProjection": max_query_distance_m <= document["maxSurfaceQueryDistanceM"] and transition_surface_projection_pass,
            "normalAlignment": normal_pass,
            "collisionPriority": collision_pass,
        },
        "worstSampleDiagnostics": {
            "maxReachError": {"timeMs": worst_reach_frame["timeMs"], "errorM": worst_reach_frame["reachErrorM"]},
            "farthestSurfaceQuery": {"timeMs": farthest_query_frame["timeMs"], "distanceM": farthest_query_frame["queryToSurfaceDistanceM"]},
            "mostNewOverlapPairs": {"timeMs": worst_collision_frame["timeMs"], "counts": worst_collision_frame["newCollisionCountsSinceRest"]},
            "mostNewOverlapPairsBetweenFrames": worst_transition_sample,
            "mostPairsAbsentAtBothEndpointsAfterTargetResolve": max(
                target_resolved_samples,
                key=lambda sample: sum(sample["intermediateOnlyCollisionCountsVsSegmentEndpoints"].values()),
                default=None,
            ),
            "maxReachErrorAtTargetResolvedIntermediate": worst_target_resolved_reach,
            "farthestTargetResolvedSurfaceQuery": farthest_target_resolved_query,
            "lowestTargetResolvedApproachNormalAlignment": lowest_target_resolved_normal,
            "mostNewTargetResolvedOverlapPairs": worst_target_resolved_collision,
            "lowestApproachNormalAlignment": {"timeMs": lowest_alignment_frame["timeMs"], "dot": lowest_alignment_frame["approachNormalDot"]},
            "smallestSurfaceGap": {"timeMs": closest_surface_frame["timeMs"], "gapM": closest_surface_frame["surfaceGapM"]},
        },
        "acceptedForGeometricDiagnostic": reach_pass and normal_pass and collision_pass,
        "frames": output_frames,
        "limitations": [
            "The analytic IK solves one index-tip target per sample; it does not solve arbitrary coupled endpoint constraints.",
            "Collision checks use sampled surface-triangle intersections at generated frames, intermediate command-SLERP poses, and intermediate re-solved target poses; they are not continuous collision detection or signed-volume penetration proof.",
            "Self-overlap checks compare non-adjacent triangles within left, right, and body classified groups; shared-vertex triangle pairs are excluded.",
            "The layered body group can contain distinct skin layers; reported body-self intersections are geometric triangle-pair observations, not proof of signed-volume penetration.",
            "Anatomical joint limits are unsupported by the bound rig profile and are not invented by this diagnostic.",
            "Generated WXYZ pose commands are diagnostic output and are not runtime-activated or sign-approved.",
        ],
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


def main() -> None:
    try:
        args = sys.argv[sys.argv.index("--") + 1:]
        if len(args) != 3:
            raise ValueError("Expected candidate.glb, trajectory.json, and output.json")
        candidate = Path(args[0]).expanduser().resolve(strict=True)
        trajectory = Path(args[1]).expanduser().resolve(strict=True)
        output = Path(args[2]).expanduser().resolve()
        if not output.parent.is_dir():
            raise ValueError("Output directory must already exist")
    except (ValueError, IndexError) as error:
        raise RuntimeError("Usage: blender -b --python solve-validate-rig-trajectory.py -- candidate.glb trajectory.json output.json") from error
    report = run_solver(candidate, trajectory, output)
    print(json.dumps({
        "acceptedForGeometricDiagnostic": report["acceptedForGeometricDiagnostic"],
        "sampleCount": report["solver"]["sampleCount"],
        "maxReachErrorM": report["solver"]["maxObservedReachErrorM"],
        "collisionSummary": report["collisionSummaryMaxOverlapPairsByScope"],
        "maxJointStepDeg": report["solver"]["maxJointStepDeg"],
        "runtimeExecutable": report["solver"]["runtimeExecutable"],
    }, sort_keys=True))
    if not report["acceptedForGeometricDiagnostic"]:
        raise RuntimeError("Trajectory rejected: one or more required geometric checks failed")


if __name__ == "__main__":
    main()
