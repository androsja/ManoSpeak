"""Compare source and exported skinned mesh surfaces under matched bone poses.

Run with Blender:

    blender --background --python-exit-code 1 --python tools/verify-rig-deformation.py -- source.blend candidate.glb

This geometry comparison does not judge the linguistic suitability of a pose.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.kdtree import KDTree


SAMPLE_LIMIT = 30000
MAX_SURFACE_ERROR_M = 0.015
POSES = {
    "rest": {},
    "head-roll": {"DEF-spine.006": (25.0, "Z")},
    "bilateral-arms-and-index": {
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
    },
}
EXCLUDED_SOURCE_MESHES = {
    "Sport_sneakers",
    "NUG_Base_EyeONUGlusion",
    "NUG_Base_TearLine",
}


def inputs() -> tuple[Path, Path]:
    try:
        index = sys.argv.index("--")
        source = Path(sys.argv[index + 1]).expanduser().resolve(strict=True)
        candidate = Path(sys.argv[index + 2]).expanduser().resolve(strict=True)
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass source.blend and candidate.glb after --") from error
    if source.suffix.lower() != ".blend" or candidate.suffix.lower() != ".glb":
        raise RuntimeError("Expected a .blend source and a .glb candidate")
    return source, candidate


def skinned_meshes(objects: list[bpy.types.Object], armature: bpy.types.Object) -> list[bpy.types.Object]:
    return [
        obj for obj in objects
        if obj.type == "MESH"
        and any(mod.type == "ARMATURE" and mod.object == armature for mod in obj.modifiers)
    ]


def evaluated_points(objects: list[bpy.types.Object], limit: int = SAMPLE_LIMIT) -> list[tuple[float, float, float]]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    samples: list[tuple[float, float, float]] = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            stride = max(1, math.ceil(len(mesh.vertices) / max(1, limit // max(1, len(objects)))))
            samples.extend(
                tuple(evaluated.matrix_world @ mesh.vertices[index].co)
                for index in range(0, len(mesh.vertices), stride)
            )
        finally:
            evaluated.to_mesh_clear()
    if len(samples) > limit:
        stride = math.ceil(len(samples) / limit)
        samples = samples[::stride][:limit]
    return samples


def symmetric_surface_error(
    source_points: list[tuple[float, float, float]],
    candidate_points: list[tuple[float, float, float]],
) -> tuple[float, float, float]:
    if not source_points or not candidate_points:
        raise RuntimeError("Both source and candidate must contain skinned mesh vertices")
    distances: list[float] = []
    for points, references in ((source_points, candidate_points), (candidate_points, source_points)):
        tree = KDTree(len(references))
        for index, point in enumerate(references):
            tree.insert(point, index)
        tree.balance()
        distances.extend(tree.find(point)[2] for point in points)
    distances.sort()
    percentile = lambda value: distances[min(len(distances) - 1, round((len(distances) - 1) * value))]
    return percentile(0.50), percentile(0.95), distances[-1]


def configure_pose(
    armature: bpy.types.Object,
    rest_matrices: dict[str, Matrix],
    rotations: dict[str, tuple[float, str]],
) -> None:
    for pose_bone in armature.pose.bones:
        for constraint in pose_bone.constraints:
            constraint.influence = 0
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    inverse_world = armature.matrix_world.inverted()
    for bone_name, (angle, axis) in rotations.items():
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            raise RuntimeError(f"Missing pose bone {bone_name}")
        desired = rest_matrices[bone_name] @ Matrix.Rotation(math.radians(angle), 4, axis)
        pose_bone.matrix = inverse_world @ desired
    bpy.context.view_layer.update()


def main() -> None:
    source_path, candidate_path = inputs()
    bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False)
    source_armature = bpy.data.objects.get("1_Rigify")
    if source_armature is None or source_armature.type != "ARMATURE":
        raise RuntimeError("Source is missing the 1_Rigify armature")
    source_objects = list(bpy.context.scene.objects)
    source_meshes = [
        obj for obj in skinned_meshes(source_objects, source_armature)
        if obj.name not in EXCLUDED_SOURCE_MESHES and not obj.name.startswith("WGT-")
    ]
    source_rest = {
        bone.name: source_armature.matrix_world @ bone.matrix_local
        for bone in source_armature.data.bones
    }
    if not source_meshes:
        raise RuntimeError("Source armature has no skinned character meshes")

    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path))
    imported = [obj for obj in bpy.data.objects if obj not in existing]
    candidate_armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    if len(candidate_armatures) != 1:
        raise RuntimeError(f"Expected one candidate armature, found {len(candidate_armatures)}")
    candidate_armature = candidate_armatures[0]
    candidate_meshes = skinned_meshes(imported, candidate_armature)
    if not candidate_meshes:
        raise RuntimeError("Candidate armature has no skinned character meshes")
    missing = sorted(set(candidate_armature.data.bones.keys()) - set(source_rest))
    if missing:
        raise RuntimeError(f"Candidate has bones missing from source: {', '.join(missing[:8])}")
    candidate_rest = {
        bone.name: candidate_armature.matrix_world @ bone.matrix_local
        for bone in candidate_armature.data.bones
    }

    print(f"Skinned meshes: source={len(source_meshes)}, candidate={len(candidate_meshes)}")
    print(f"Source meshes: {', '.join(sorted(obj.name for obj in source_meshes))}")
    print(f"Candidate meshes: {', '.join(sorted(obj.name for obj in candidate_meshes))}")
    candidate_by_name = {obj.name.removesuffix(".001"): obj for obj in candidate_meshes}
    for pose_name, rotations in POSES.items():
        source_rotations = dict(rotations)
        if pose_name == "head-roll":
            # Source facial DEF bones inherit through ORG-face/ORG-spine while
            # hair follows DEF-spine; the export repairs both under the head DEF.
            source_rotations["ORG-spine.006"] = rotations["DEF-spine.006"]
        configure_pose(source_armature, source_rest, source_rotations)
        configure_pose(candidate_armature, candidate_rest, rotations)
        bpy.context.view_layer.update()
        errors = []
        for source_mesh in source_meshes:
            candidate_mesh = candidate_by_name.get(source_mesh.name)
            if candidate_mesh is None:
                raise RuntimeError(f"Candidate is missing skinned mesh {source_mesh.name}")
            mesh_median, mesh_p95, mesh_maximum = symmetric_surface_error(
                evaluated_points([source_mesh]),
                evaluated_points([candidate_mesh]),
            )
            print(
                f"  {source_mesh.name}: median={mesh_median:.6f} "
                f"p95={mesh_p95:.6f} max={mesh_maximum:.6f}"
            )
            errors.append((mesh_maximum, source_mesh.name))
        maximum, mesh_name = max(errors)
        print(
            f"{pose_name}: PASS {len(errors)} corresponding skinned meshes; "
            f"maximum symmetric surface error={maximum:.6f} m on {mesh_name} "
            f"(limit {MAX_SURFACE_ERROR_M:.3f} m)"
        )
        if maximum > MAX_SURFACE_ERROR_M:
            raise RuntimeError(f"{pose_name} exceeds surface tolerance on {mesh_name}: {maximum:.6f} m")


if __name__ == "__main__":
    main()
