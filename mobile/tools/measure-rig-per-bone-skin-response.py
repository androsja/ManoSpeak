"""Measure isolated local-axis skin response on the exact rig candidate.

This reports geometric deformation of vertices carrying each digit bone's
weight. It does not classify anatomical DOFs or establish safe limits.

    blender --background --python-exit-code 1 --python this.py -- profile.json candidate.glb report.json
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    profile_path, candidate_path, output_path = map(Path, sys.argv[sys.argv.index("--") + 1:])
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    candidate_sha = sha256(candidate_path)
    if profile.get("sha256") != "c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d":
        raise RuntimeError("Unsupported rig profile revision")
    if profile.get("asset", {}).get("candidateSha256") != candidate_sha:
        raise RuntimeError("Candidate checksum differs from the profile binding")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "NUG_Base_Body"]
    if len(rigs) != 1 or len(bodies) != 1:
        raise RuntimeError("Expected exactly one armature and NUG_Base_Body mesh")
    rig, body = rigs[0], bodies[0]
    inventory = profile["descriptor"]["boneInventory"]["restAxesInventory"]["bones"]
    hand_frames = profile["descriptor"]["coordinateCalibration"]["hand"]
    group_indices = {group.name: group.index for group in body.vertex_groups}
    side_frames = {}
    for side, label in (("L", "left"), ("R", "right")):
        axes = hand_frames[label]["axes"]
        # glTF right-handed Y-up to Blender X-right/Y-depth/Z-up.
        side_frames[side] = {
            name: Vector((value[0], -value[2], value[1])).normalized()
            for name, value in axes.items()
        }

    def evaluated_points() -> list[Vector]:
        bpy.context.view_layer.update()
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            if len(mesh.vertices) != len(body.data.vertices):
                raise RuntimeError("Evaluated body topology changed during an isolated probe")
            return [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        finally:
            evaluated.to_mesh_clear()

    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    rest_points = evaluated_points()

    records = []
    for side in ("L", "R"):
        for digit in ("thumb", "f_index", "f_middle", "f_ring", "f_pinky"):
            for segment in ("01", "02", "03"):
                name = f"DEF-{digit}.{segment}.{side}"
                if name not in inventory or name not in rig.pose.bones or name not in group_indices:
                    raise RuntimeError(f"Missing profile bone, pose bone, or skin group: {name}")
                group_index = group_indices[name]
                weighted_vertices = []
                for vertex in body.data.vertices:
                    weight = next((entry.weight for entry in vertex.groups if entry.group == group_index), 0.0)
                    if weight > 0:
                        weighted_vertices.append((vertex.index, weight))
                if not weighted_vertices:
                    raise RuntimeError(f"No skin vertices are weighted to {name}")

                bone = rig.pose.bones[name]
                probe_points = {}
                for axis_index, axis in enumerate("xyz"):
                    for sign in (-1, 1):
                        for pose_bone in rig.pose.bones:
                            pose_bone.matrix_basis = Matrix.Identity(4)
                        bone.rotation_mode = "XYZ"
                        command = [0.0, 0.0, 0.0]
                        command[axis_index] = sign * math.radians(10)
                        bone.rotation_euler = command
                        points = evaluated_points()
                        total_weight = sum(weight for _, weight in weighted_vertices)
                        centroid = sum((points[index] * weight for index, weight in weighted_vertices), Vector()) / total_weight
                        moved = [
                            ((points[index] - rest_points[index]).length, weight)
                            for index, weight in weighted_vertices
                        ]
                        probe_points[f"{axis}{sign:+d}"] = {
                            "weightedCentroidBlender": centroid,
                            "maxWeightedVertexDisplacementM": max(value for value, _ in moved),
                            "rmsWeightedVertexDisplacementM": math.sqrt(
                                sum(weight * value * value for value, weight in moved) / total_weight
                            ),
                        }

                directions = {}
                frame = side_frames[side]
                for axis in "xyz":
                    plus = probe_points[f"{axis}+1"]
                    minus = probe_points[f"{axis}-1"]
                    delta = plus["weightedCentroidBlender"] - minus["weightedCentroidBlender"]
                    hand_response = [round(delta.dot(frame[key]) / (2 * math.radians(10)), 9) for key in "xyz"]
                    directions[axis] = {
                        "weightedCentroidResponseHandFrameMPerRadian": hand_response,
                        "centralResponseLengthMPerRadian": round(math.sqrt(sum(value * value for value in hand_response)), 9),
                        "minus10MaxVertexDisplacementM": round(minus["maxWeightedVertexDisplacementM"], 9),
                        "plus10MaxVertexDisplacementM": round(plus["maxWeightedVertexDisplacementM"], 9),
                        "minus10RmsVertexDisplacementM": round(minus["rmsWeightedVertexDisplacementM"], 9),
                        "plus10RmsVertexDisplacementM": round(plus["rmsWeightedVertexDisplacementM"], 9),
                    }
                records.append({
                    "bone": name,
                    "terminal": segment == "03",
                    "weightedVertexCount": len(weighted_vertices),
                    "directions": directions,
                })
                for pose_bone in rig.pose.bones:
                    pose_bone.matrix_basis = Matrix.Identity(4)
                bpy.context.view_layer.update()

    report = {
        "schema": "vozual.rig-per-bone-skin-response",
        "schemaVersion": 1,
        "profileSha256": profile["sha256"],
        "candidateSha256": candidate_sha,
        "blenderVersion": bpy.app.version_string,
        "probeDegrees": [-10, 10],
        "coordinateFrame": "profile-calibrated-rest-hand-frame",
        "method": "Isolated local Euler XYZ rotations; full rig reset for every sample; evaluate NUG_Base_Body vertices with positive weight for the probed bone; compare weighted vertex centroid and per-vertex displacement.",
        "records": records,
        "scope": "30 declared digit bones; same-hand bone-weighted NUG_Base_Body vertices; exact candidate only",
        "limitations": [
            "Geometric skin response does not identify anatomical meaning or safe joint limits.",
            "Only the probed bone is rotated; coupled joints, collisions and transitions are not tested.",
            "Vertices are grouped by positive weight for the probed bone; other meshes and garment surfaces are excluded.",
            "The +/-10 degree samples do not establish a continuous or permissible interval.",
        ],
    }
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "signedAxisProbes": len(records) * 6,
                      "candidateSha256": candidate_sha, "reportSha256": sha256(output_path)}, sort_keys=True))


if __name__ == "__main__":
    main()
