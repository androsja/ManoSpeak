"""Measure candidate GLB rotation-channel and weighted-surface response.

This is a geometric/mechanical observation only. It does not assign anatomical
semantics, safe ranges, or reviewer approval.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    profile_path, candidate_path, output_path = map(Path, sys.argv[sys.argv.index("--") + 1:])
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    profile_sha = profile["sha256"]
    candidate_sha = sha256(candidate_path)
    if profile.get("asset", {}).get("candidateSha256") != candidate_sha:
        raise RuntimeError("Candidate checksum differs from profile binding")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"Expected one armature, found {len(rigs)}")
    rig = rigs[0]
    inventory = profile["descriptor"]["boneInventory"]["restAxesInventory"]["bones"]
    if set(inventory) != {bone.name for bone in rig.pose.bones}:
        raise RuntimeError("Profile deform-bone inventory differs from candidate armature")

    mesh_data = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        group_index_by_name = {group.name: group.index for group in obj.vertex_groups}
        weighted = {}
        for name in inventory:
            group_index = group_index_by_name.get(name)
            if group_index is None:
                continue
            indices = []
            for vertex in obj.data.vertices:
                if any(entry.group == group_index and entry.weight > 0 for entry in vertex.groups):
                    indices.append(vertex.index)
            if indices:
                weighted[name] = indices
        if weighted:
            mesh_data.append((obj, weighted))

    def reset() -> None:
        for pose_bone in rig.pose.bones:
            pose_bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

    def evaluated_points(obj, indices):
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            if len(mesh.vertices) != len(obj.data.vertices):
                raise RuntimeError(f"Evaluated topology changed for {obj.name}")
            matrix = evaluated.matrix_world
            return [matrix @ mesh.vertices[index].co for index in indices]
        finally:
            evaluated.to_mesh_clear()

    records = []
    for name in sorted(inventory):
        bone = rig.pose.bones[name]
        imported_rotation_mode = bone.rotation_mode
        touched_meshes = [(obj, weighted[name]) for obj, weighted in mesh_data if name in weighted]
        reset()
        rest_matrices = {obj.name: evaluated_points(obj, indices) for obj, indices in touched_meshes}
        rest_pose = bone.matrix.copy()
        axes = {}
        for axis_index, axis in enumerate("xyz"):
            signed = {}
            for sign in (-1, 1):
                reset()
                command = [0.0, 0.0, 0.0]
                command[axis_index] = sign * math.radians(10)
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = command
                bpy.context.view_layer.update()
                matrix_delta = max(abs(bone.matrix[r][c] - rest_pose[r][c]) for r in range(4) for c in range(4))
                mesh_results = {}
                for obj, indices in touched_meshes:
                    moved = evaluated_points(obj, indices)
                    base = rest_matrices[obj.name]
                    distances = [(current - original).length for current, original in zip(moved, base)]
                    mesh_results[obj.name] = {
                        "weightedVertexCount": len(indices),
                        "maxDisplacementM": round(max(distances, default=0.0), 9),
                        "rmsDisplacementM": round(math.sqrt(sum(value * value for value in distances) / max(len(distances), 1)), 9),
                    }
                signed[f"{sign:+d}"] = {
                    "poseMatrixMaxAbsDelta": round(matrix_delta, 12),
                    "surfaces": mesh_results,
                }
            axes[axis] = signed
        records.append({
            "bone": name,
            "parent": bone.parent.name if bone.parent else None,
            "rotationModeImported": imported_rotation_mode,
            "measuredRotationChannels": ["x", "y", "z"],
            "constraintCountInExportedArmature": len(bone.constraints),
            "weightedSurfaces": {obj.name: len(indices) for obj, indices in touched_meshes},
            "signed10DegreeProbes": axes,
        })
    report = {
        "schema": "vozual.task3-14.full-inventory-pose-channel-diagnostic",
        "schemaVersion": 1,
        "profileSha256": profile_sha,
        "candidateSha256": candidate_sha,
        "candidatePath": str(candidate_path),
        "blenderVersion": bpy.app.version_string,
        "inventoryCount": len(inventory),
        "probeDegrees": [-10, 10],
        "axisConvention": "isolated local Euler XYZ in imported glTF armature",
        "method": "For every profile deform bone, reset full armature, rotate one local Euler axis by +/-10 degrees, and measure pose-matrix and positively weighted vertex displacement on each imported mesh.",
        "records": records,
        "limitations": [
            "An imported rotation channel or measured skin displacement is not anatomical DOF evidence.",
            "The +/-10-degree samples do not define continuous or safe joint limits.",
            "Each bone is probed in isolation; coupled collision, path, interpenetration, and intended contact are not evaluated.",
            "Only surfaces weighted to each probed bone are measured; mesh response is not a semantic classification.",
            "No human rig or anatomical review is represented by this measurement.",
        ],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"inventoryCount": len(records), "signedAxisProbes": len(records) * 6,
                      "profileSha256": profile_sha, "candidateSha256": candidate_sha,
                      "reportSha256": sha256(output_path)}, sort_keys=True))


if __name__ == "__main__":
    main()
