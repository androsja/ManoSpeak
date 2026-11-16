"""Compare source and GLB skinned meshes under identical deform-bone poses.

Run with Blender:

    blender --background --python-exit-code 1 --python tools/verify-rig-skin-deformation.py -- source.blend avatar.glb

The comparison uses bidirectional nearest-vertex distances in world meters.
It checks mesh deformation correspondence, not visual or linguistic quality.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree


MAX_SURFACE_ERROR_M = 0.015
POSES = ("DEF-f_index.01.L", "DEF-jaw")


def arguments() -> tuple[Path, Path]:
    try:
        index = sys.argv.index("--")
        source = Path(sys.argv[index + 1]).expanduser().resolve(strict=True)
        target = Path(sys.argv[index + 2]).expanduser().resolve(strict=True)
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass source.blend and exported.glb after --") from error
    if source.suffix.lower() != ".blend" or target.suffix.lower() != ".glb":
        raise RuntimeError("Expected a Blender source and GLB export")
    return source, target


def get_armature() -> bpy.types.Object:
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    return armatures[0]


def evaluated_mesh_points() -> dict[str, list[object]]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    result: dict[str, list[object]] = {}
    for item in bpy.context.scene.objects:
        if item.type != "MESH" or not item.data.vertices:
            continue
        # Blender 5.2's glTF importer creates this 42-vertex placeholder for
        # the source armature widget; it is not a mesh node in the GLB.
        if item.name == "Icosphere" and len(item.data.vertices) == 42 and not item.vertex_groups:
            continue
        evaluated = item.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            result[item.name] = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        finally:
            evaluated.to_mesh_clear()
    return result


def hierarchy_depth(bone: bpy.types.PoseBone) -> int:
    depth = 0
    parent = bone.parent
    while parent is not None:
        depth += 1
        parent = parent.parent
    return depth


def max_matrix_error(first: object, second: object) -> float:
    return max(abs(first[row][column] - second[row][column]) for row in range(4) for column in range(4))


def directed_distances(points: list[object], target_points: list[object]) -> list[float]:
    tree = KDTree(len(target_points))
    for index, point in enumerate(target_points):
        tree.insert(point, index)
    tree.balance()
    return [tree.find(point)[2] for point in points]


def compare_pose(source_path: Path, target_path: Path, bone_name: str) -> list[tuple[str, int, int, float, float]]:
    bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False)
    source_rig = get_armature()
    source_bone = source_rig.pose.bones.get(bone_name)
    if source_bone is None:
        raise RuntimeError(f"Source rig is missing test bone {bone_name}")
    for constraint in source_bone.constraints:
        constraint.mute = True
    source_bone.rotation_mode = "XYZ"
    source_bone.rotation_euler.x = 0.7
    bpy.context.view_layer.update()
    source_matrices = {
        bone.name: (source_rig.matrix_world @ bone.matrix).copy()
        for bone in source_rig.pose.bones
    }
    source_points = evaluated_mesh_points()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(target_path))
    target_rig = get_armature()
    target_inverse = target_rig.matrix_world.inverted()
    for bone in sorted(target_rig.pose.bones, key=hierarchy_depth):
        source_matrix = source_matrices.get(bone.name)
        if source_matrix is None:
            continue
        bone.matrix = target_inverse @ source_matrix
        bpy.context.view_layer.update()

    pose_errors = [
        max_matrix_error(target_rig.matrix_world @ bone.matrix, source_matrices[bone.name])
        for bone in target_rig.pose.bones
        if bone.name in source_matrices
    ]
    if not pose_errors or max(pose_errors) > 1e-4:
        raise RuntimeError(f"Could not reproduce source pose matrices for {bone_name}: {max(pose_errors, default=float('inf')):.9g}")

    target_points = evaluated_mesh_points()
    missing_references = target_points.keys() - source_points.keys()
    if missing_references:
        raise RuntimeError(f"Exported meshes lack source references: {', '.join(sorted(missing_references))}")
    results: list[tuple[str, int, int, float, float]] = []
    for mesh_name, exported_vertices in target_points.items():
        source_vertices = source_points[mesh_name]
        if not source_vertices or not exported_vertices:
            raise RuntimeError(f"Empty source or exported mesh: {mesh_name}")
        distances = directed_distances(source_vertices, exported_vertices)
        distances.extend(directed_distances(exported_vertices, source_vertices))
        ordered = sorted(distances)
        p95 = ordered[int((len(ordered) - 1) * 0.95)]
        maximum = ordered[-1]
        if maximum > MAX_SURFACE_ERROR_M:
            raise RuntimeError(
                f"Surface mismatch for {mesh_name} under {bone_name}: "
                f"max={maximum:.6f} m exceeds {MAX_SURFACE_ERROR_M:.6f} m"
            )
        results.append((mesh_name, len(source_vertices), len(exported_vertices), p95, maximum))
    print(
        f"PASS: {bone_name} pose; max bone-matrix error={max(pose_errors):.9g}; "
        f"bidirectional surface tolerance={MAX_SURFACE_ERROR_M:.3f} m"
    )
    for mesh_name, source_count, target_count, p95, maximum in results:
        print(
            f"  {mesh_name}: vertices={source_count}/{target_count}, "
            f"p95={p95:.6f} m, max={maximum:.6f} m"
        )
    return results


def main() -> None:
    source, target = arguments()
    for bone_name in POSES:
        compare_pose(source, target, bone_name)


if __name__ == "__main__":
    main()
