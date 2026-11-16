"""Detect scoped non-adjacent finger intersections for the Task 3 candidate.

Run with Blender:

    blender --background --python-exit-code 1 --python tools/verify-rig-finger-intersections.py -- avatar.glb

To run the intentionally strict local-X stress probes:

    blender --background --python-exit-code 1 --python tools/verify-rig-finger-intersections.py -- --include-local-x-probes avatar.glb

To include the bilateral arm/index deformation-parity pose:

    blender --background --python-exit-code 1 --python tools/verify-rig-finger-intersections.py -- --include-bilateral-parity-pose avatar.glb

To check bilateral hands against the avatar's non-hand skin surface in that pose:

    blender --background --python-exit-code 1 --python tools/verify-rig-finger-intersections.py -- --include-hand-body-parity-probe avatar.glb

To include mixed hand/non-hand skin transition triangles in rest and parity checks:

    blender --background --python-exit-code 1 --python tools/verify-rig-finger-intersections.py -- --include-transition-seam-probe avatar.glb

The rest-pose pass covers every left and right digit against the corresponding
palm and the other digits. The posed pass covers the calibrated left-index
endpoint; an optional mode adds a conservative, individual local-X probe for
each digit. Another optional mode checks both index fingers under the bilateral
arm/index pose used by the source-to-export deformation-parity suite. These are
geometric checks, not anatomical limits or sign-realization commands. This is intentionally not a whole-body collision
solver or a proof for arbitrary poses, neither of which the candidate profile
declares.
It compares only triangles whose three dominant vertex groups identify a single
finger or the same hand's other geometry; blended-weight transition triangles
are excluded because they cannot establish a non-adjacent surface boundary.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


FINGER_PREFIXES = {
    "left-thumb": "DEF-thumb.",
    "left-index": "DEF-f_index.",
    "left-middle": "DEF-f_middle.",
    "left-ring": "DEF-f_ring.",
    "left-pinky": "DEF-f_pinky.",
    "right-thumb": "DEF-thumb.",
    "right-index": "DEF-f_index.",
    "right-middle": "DEF-f_middle.",
    "right-ring": "DEF-f_ring.",
    "right-pinky": "DEF-f_pinky.",
}
PALM_PREFIXES = ("DEF-hand.L", "DEF-hand.R")
LEFT_SUFFIX = ".L"
RIGHT_SUFFIX = ".R"
POSE = {"DEF-f_index.01.L": 0.15, "DEF-f_index.02.L": 0.20, "DEF-f_index.03.L": 0.15}
LOCAL_X_PROBE_ROTATIONS = {"01": 0.15, "02": 0.20, "03": 0.15}
BILATERAL_PARITY_ROTATIONS_DEG = {
    "DEF-upper_arm.L": (22.0, "X"),
    "DEF-forearm.L": (-18.0, "Y"),
    "DEF-upper_arm.R": (-22.0, "X"),
    "DEF-forearm.R": (18.0, "Y"),
    "DEF-f_index.01.L": (35.0, "X"),
    "DEF-f_index.02.L": (35.0, "X"),
    "DEF-f_index.03.L": (25.0, "X"),
    "DEF-f_index.01.R": (35.0, "X"),
    "DEF-f_index.02.R": (35.0, "X"),
    "DEF-f_index.03.R": (25.0, "X"),
}


def candidate_path() -> Path:
    try:
        index = sys.argv.index("--")
        positional = next(value for value in sys.argv[index + 1:] if not value.startswith("--"))
        path = Path(positional).expanduser().resolve(strict=True)
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass candidate.glb after --") from error
    if path.suffix.lower() != ".glb":
        raise RuntimeError("Expected a .glb candidate")
    return path


def includes_local_x_probes() -> bool:
    return "--include-local-x-probes" in sys.argv


def includes_bilateral_parity_pose() -> bool:
    return "--include-bilateral-parity-pose" in sys.argv


def includes_hand_body_parity_probe() -> bool:
    return "--include-hand-body-parity-probe" in sys.argv


def includes_transition_seam_probe() -> bool:
    return "--include-transition-seam-probe" in sys.argv


def candidate_body() -> bpy.types.Object:
    bodies = [item for item in bpy.context.scene.objects if item.type == "MESH" and item.name == "NUG_Base_Body"]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one NUG_Base_Body mesh, found {len(bodies)}")
    return bodies[0]


def category_for_bone(name: str) -> str | None:
    for category, prefix in FINGER_PREFIXES.items():
        side = LEFT_SUFFIX if category.startswith("left-") else RIGHT_SUFFIX
        if name.startswith(prefix) and name.endswith(side):
            return category
    if name.startswith(PALM_PREFIXES[0]):
        return "left-palm"
    if name.startswith(PALM_PREFIXES[1]):
        return "right-palm"
    return None


def category_by_vertex(body: bpy.types.Object) -> list[str | None]:
    group_names = {group.index: group.name for group in body.vertex_groups}
    categories: list[str | None] = []
    for vertex in body.data.vertices:
        weights = [(entry.weight, group_names.get(entry.group, "")) for entry in vertex.groups]
        if not weights:
            categories.append(None)
            continue
        _, dominant = max(weights)
        categories.append(category_for_bone(dominant))
    return categories


def triangles_for_category(mesh: bpy.types.Mesh, categories: list[str | None], category: str) -> list[tuple[int, int, int]]:
    mesh.calc_loop_triangles()
    triangles: list[tuple[int, int, int]] = []
    for triangle in mesh.loop_triangles:
        vertices = tuple(triangle.vertices)
        if all(categories[index] == category for index in vertices):
            triangles.append(vertices)
    if not triangles:
        raise RuntimeError(f"No triangles classified as {category}")
    return triangles


def triangle_categories(triangle: tuple[int, int, int], categories: list[str | None]) -> str:
    labels = sorted({categories[index] for index in triangle if categories[index] is not None})
    return "+".join(labels) if labels else "unclassified"


def triangles_for_hand(mesh: bpy.types.Mesh, categories: list[str | None], side: str) -> list[tuple[int, int, int]]:
    mesh.calc_loop_triangles()
    prefix = f"{side}-"
    triangles = []
    for triangle in mesh.loop_triangles:
        vertices = tuple(triangle.vertices)
        labels = [categories[index] for index in vertices]
        if all(label is not None and label.startswith(prefix) for label in labels):
            triangles.append(vertices)
    if not triangles:
        raise RuntimeError(f"No fully hand-dominant triangles classified for {side}")
    return triangles


def hand_weight_by_vertex(body: bpy.types.Object, side: str) -> list[tuple[float, float]]:
    group_names = {group.index: group.name for group in body.vertex_groups}
    prefix = f"{side}-"
    weights = []
    for vertex in body.data.vertices:
        hand_weight = sum(
            entry.weight for entry in vertex.groups
            if (category_for_bone(group_names.get(entry.group, "")) or "").startswith(prefix)
        )
        total_weight = sum(entry.weight for entry in vertex.groups)
        weights.append((hand_weight, max(0.0, total_weight - hand_weight)))
    return weights


def triangles_for_transition_seam(
    mesh: bpy.types.Mesh,
    categories: list[str | None],
    hand_weights: list[tuple[float, float]],
    side: str,
) -> list[tuple[int, int, int]]:
    mesh.calc_loop_triangles()
    prefix = f"{side}-"
    triangles = []
    for triangle in mesh.loop_triangles:
        vertices = tuple(triangle.vertices)
        labels = [categories[index] for index in vertices]
        if all(label is not None and label.startswith(prefix) for label in labels):
            continue
        if any(hand_weights[index][0] > 0.0 and hand_weights[index][1] > 0.0 for index in vertices):
            triangles.append(vertices)
    if not triangles:
        raise RuntimeError(f"No mixed hand/non-hand transition triangles classified for {side}")
    return triangles


def evaluate_intersections(
    body: bpy.types.Object, categories: list[str | None], finger: str
) -> list[tuple[str, tuple[float, float, float]]]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(categories):
            raise RuntimeError("Evaluated body mesh topology differs from vertex-group classification")
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        finger_triangles = triangles_for_category(mesh, categories, finger)
        side = finger.split("-", maxsplit=1)[0]
        other_triangles = []
        for triangle in mesh.loop_triangles:
            vertices = tuple(triangle.vertices)
            labels = [categories[index] for index in vertices]
            if all(label is not None and label != finger and label.startswith(side) for label in labels):
                other_triangles.append(vertices)
        if not other_triangles:
            raise RuntimeError(f"No same-hand palm/other-digit triangles classified against {finger}")
        finger_tree = BVHTree.FromPolygons(points, finger_triangles, all_triangles=True)
        other_tree = BVHTree.FromPolygons(points, other_triangles, all_triangles=True)
        collisions: list[tuple[str, tuple[float, float, float]]] = []
        for finger_triangle, other_triangle in finger_tree.overlap(other_tree):
            if not set(finger_triangles[finger_triangle]).intersection(other_triangles[other_triangle]):
                vertices = other_triangles[other_triangle]
                centroid = sum((points[index] for index in vertices), start=Vector((0.0, 0.0, 0.0))) / 3
                collisions.append((triangle_categories(vertices, categories), tuple(round(value, 6) for value in centroid)))
        return collisions
    finally:
        evaluated.to_mesh_clear()


def evaluate_hand_body_intersections(
    body: bpy.types.Object, categories: list[str | None], side: str
) -> list[tuple[str, tuple[float, float, float]]]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(categories):
            raise RuntimeError("Evaluated body mesh topology differs from vertex-group classification")
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        hand_triangles = triangles_for_hand(mesh, categories, side)
        body_triangles = [
            tuple(triangle.vertices)
            for triangle in mesh.loop_triangles
            if all(categories[index] is None for index in triangle.vertices)
        ]
        if not body_triangles:
            raise RuntimeError("No non-hand-dominant skin triangles available for body probe")
        hand_tree = BVHTree.FromPolygons(points, hand_triangles, all_triangles=True)
        body_tree = BVHTree.FromPolygons(points, body_triangles, all_triangles=True)
        collisions = []
        for hand_index, body_index in hand_tree.overlap(body_tree):
            if not set(hand_triangles[hand_index]).intersection(body_triangles[body_index]):
                vertices = body_triangles[body_index]
                centroid = sum((points[index] for index in vertices), start=Vector((0.0, 0.0, 0.0))) / 3
                collisions.append(("non-hand-skin", tuple(round(value, 6) for value in centroid)))
        return collisions
    finally:
        evaluated.to_mesh_clear()


def evaluate_hand_transition_intersections(
    body: bpy.types.Object,
    categories: list[str | None],
    hand_weights: list[tuple[float, float]],
    side: str,
) -> tuple[int, list[tuple[str, tuple[float, float, float]]]]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(categories) or len(mesh.vertices) != len(hand_weights):
            raise RuntimeError("Evaluated body topology differs from vertex-group classification")
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        hand_triangles = triangles_for_hand(mesh, categories, side)
        transition_triangles = triangles_for_transition_seam(mesh, categories, hand_weights, side)
        hand_tree = BVHTree.FromPolygons(points, hand_triangles, all_triangles=True)
        transition_tree = BVHTree.FromPolygons(points, transition_triangles, all_triangles=True)
        collisions = []
        for hand_index, seam_index in hand_tree.overlap(transition_tree):
            if not set(hand_triangles[hand_index]).intersection(transition_triangles[seam_index]):
                vertices = transition_triangles[seam_index]
                centroid = sum((points[index] for index in vertices), start=Vector((0.0, 0.0, 0.0))) / 3
                collisions.append(("mixed-hand-transition", tuple(round(value, 6) for value in centroid)))
        return len(transition_triangles), collisions
    finally:
        evaluated.to_mesh_clear()


def set_index_pose(armature: bpy.types.Object, enabled: bool) -> None:
    for name, rotation in POSE.items():
        bone = armature.pose.bones.get(name)
        if bone is None:
            raise RuntimeError(f"Missing conformance pose bone {name}")
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = rotation if enabled else 0.0
    bpy.context.view_layer.update()


def set_finger_local_x_probe(armature: bpy.types.Object, finger: str, enabled: bool) -> None:
    prefix = FINGER_PREFIXES[finger]
    suffix = LEFT_SUFFIX if finger.startswith("left-") else RIGHT_SUFFIX
    segments = [
        bone for bone in armature.pose.bones
        if bone.name.startswith(prefix) and bone.name.endswith(suffix)
    ]
    if len(segments) != len(LOCAL_X_PROBE_ROTATIONS):
        raise RuntimeError(f"Expected three segments for {finger}, found {len(segments)}")
    for bone in segments:
        segment = bone.name.removesuffix(suffix).rsplit(".", maxsplit=1)[-1]
        rotation = LOCAL_X_PROBE_ROTATIONS.get(segment)
        if rotation is None:
            raise RuntimeError(f"Unexpected segment name for {finger}: {bone.name}")
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = rotation if enabled else 0.0
    bpy.context.view_layer.update()


def set_bilateral_parity_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        for constraint in pose_bone.constraints:
            constraint.influence = 0.0
        pose_bone.matrix_basis = Matrix.Identity(4)
    for name, (degrees, axis) in BILATERAL_PARITY_ROTATIONS_DEG.items():
        pose_bone = armature.pose.bones.get(name)
        if pose_bone is None:
            raise RuntimeError(f"Missing bilateral parity pose bone {name}")
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler["XYZ".index(axis)] = math.radians(degrees)
    bpy.context.view_layer.update()


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path()))
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    body = candidate_body()
    categories = category_by_vertex(body)
    left_hand_weights = hand_weight_by_vertex(body, "left")
    right_hand_weights = hand_weight_by_vertex(body, "right")
    hand_weights = {"left": left_hand_weights, "right": right_hand_weights}
    set_index_pose(armatures[0], False)
    failures: list[str] = []
    for finger in FINGER_PREFIXES:
        collisions = evaluate_intersections(body, categories, finger)
        if collisions:
            labels = sorted({label for label, _ in collisions})
            sample = collisions[0][1]
            failures.append(
                f"rest/{finger}: {len(collisions)} non-adjacent intersections with {labels}; sample centroid {sample}"
            )
        else:
            print(f"PASS: rest/{finger}: no non-adjacent intersections against same-hand palm/other digits")

    if includes_local_x_probes():
        for finger in FINGER_PREFIXES:
            set_finger_local_x_probe(armatures[0], finger, True)
            collisions = evaluate_intersections(body, categories, finger)
            set_finger_local_x_probe(armatures[0], finger, False)
            if collisions:
                labels = sorted({label for label, _ in collisions})
                sample = collisions[0][1]
                failures.append(
                    f"local-x-probe/{finger}: {len(collisions)} non-adjacent intersections with {labels}; sample centroid {sample}"
                )
            else:
                print(f"PASS: local-x-probe/{finger}: no non-adjacent intersections against same-hand palm/other digits")

    if includes_bilateral_parity_pose():
        set_bilateral_parity_pose(armatures[0])
        for finger in ("left-index", "right-index"):
            collisions = evaluate_intersections(body, categories, finger)
            if collisions:
                labels = sorted({label for label, _ in collisions})
                sample = collisions[0][1]
                failures.append(
                    f"bilateral-parity/{finger}: {len(collisions)} non-adjacent intersections with {labels}; sample centroid {sample}"
                )
            else:
                print(f"PASS: bilateral-parity/{finger}: no non-adjacent intersections against same-hand palm/other digits")
        reset_pose(armatures[0])

    if includes_hand_body_parity_probe():
        set_bilateral_parity_pose(armatures[0])
        for side in ("left", "right"):
            collisions = evaluate_hand_body_intersections(body, categories, side)
            if collisions:
                sample = collisions[0][1]
                failures.append(
                    f"hand-body-parity/{side}: {len(collisions)} non-adjacent intersections with non-hand skin; sample centroid {sample}"
                )
            else:
                print(f"PASS: hand-body-parity/{side}: no non-adjacent intersections against non-hand-dominant skin triangles")
        reset_pose(armatures[0])

    if includes_transition_seam_probe():
        for pose_id in ("rest", "bilateral-parity"):
            if pose_id == "bilateral-parity":
                set_bilateral_parity_pose(armatures[0])
            for side in ("left", "right"):
                triangle_count, collisions = evaluate_hand_transition_intersections(
                    body, categories, hand_weights[side], side
                )
                if collisions:
                    sample = collisions[0][1]
                    failures.append(
                        f"transition-seam/{pose_id}/{side}: {len(collisions)} non-adjacent overlaps across {triangle_count} mixed transition triangles; sample centroid {sample}"
                    )
                else:
                    print(
                        f"PASS: transition-seam/{pose_id}/{side}: zero non-adjacent overlaps across {triangle_count} mixed transition triangles"
                    )
            if pose_id == "bilateral-parity":
                reset_pose(armatures[0])

    set_index_pose(armatures[0], True)
    collisions = evaluate_intersections(body, categories, "left-index")
    if collisions:
        labels = sorted({label for label, _ in collisions})
        sample = collisions[0][1]
        failures.append(
            f"left-index-curl-v1: {len(collisions)} non-adjacent intersections with {labels}; sample centroid {sample}"
        )
    else:
        print("PASS: left-index-curl-v1: no non-adjacent left-index intersections against same-hand palm/other digits")
    if failures:
        raise RuntimeError("; ".join(failures))


if __name__ == "__main__":
    main()
