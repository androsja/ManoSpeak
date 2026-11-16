"""Check discrete compiler diagnostic configurations on the exact GLB in Blender.

    blender --background --python-exit-code 1 --python tools/verify-rig-mechanical-conformance.py -- candidate.glb contract.json report.json

This checks rest-relative local rotations and reset repeatability. Endpoint and
intersection evidence must be supplied by their separate measured verifiers.
"""

import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def main():
    asset, contract_path, report_path = (
        Path(value).expanduser().resolve() for value in sys.argv[sys.argv.index("--") + 1:]
    )
    contract = json.loads(contract_path.read_text())
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    if digest != contract["candidateSha256"]:
        raise RuntimeError("Candidate hash differs from mechanical contract")
    if contract["representation"] != "rest-relative-local-euler-XYZ-radians":
        raise RuntimeError("Unsupported rotation representation")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError("Expected exactly one armature")
    rig = rigs[0]
    records = []
    for config in contract["configurations"]:
        matrices = []
        for _ in range(2):
            # Deliberately dirty all bone rotations before the full reset.
            for bone in rig.pose.bones:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = (0.11, -0.07, 0.03)
            bpy.context.view_layer.update()
            for bone in rig.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            for name, angles in config["rotationCommandsRad"].items():
                rig.pose.bones[name].rotation_euler = angles
            bpy.context.view_layer.update()
            for bone in rig.pose.bones:
                expected = config["rotationCommandsRad"].get(bone.name, [0, 0, 0])
                if max(abs(a - b) for a, b in zip(bone.rotation_euler, expected)) > 1e-7:
                    raise RuntimeError(f"Unexpected local rotation: {bone.name}")
            matrices.append([
                [float(value) for row in bone.matrix for value in row]
                for bone in rig.pose.bones
            ])
        error = max(abs(a - b) for left, right in zip(*matrices) for a, b in zip(left, right))
        if error > 1e-7:
            raise RuntimeError("Mechanical probe depends on previous pose")
        records.append({"id": config["id"], "bonesChecked": len(rig.pose.bones),
                        "replayMaximumMatrixComponentError": error})
    report = {"schema": "vozual.rig-mechanical-conformance-result", "schemaVersion": 1,
              "candidateSha256": digest, "profileSha256": contract["profileSha256"],
              "contractFileSha256": hashlib.sha256(contract_path.read_bytes()).hexdigest(),
              "blender": bpy.app.version_string, "configurations": records,
              "scope": "discrete local-rotation/reset diagnostics only; no anatomical or continuous-range claim"}
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("PASS: discrete local-rotation configurations and full-bone reset", records)


if __name__ == "__main__":
    main()
