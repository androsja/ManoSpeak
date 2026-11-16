"""Measure scoped collisions for exact two-command digit-rig probes.

Run in Blender with -- candidate.glb report.json. Probes are isolated
two-command snapshots at +/-10 degrees; they do not define safe intervals,
anatomical limits, arbitrary combinations, or collision-free paths.
"""
from __future__ import annotations

import hashlib
import importlib.util
import itertools
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


CANDIDATE_SHA = "748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a"


def load_checker(candidate: Path):
    path = Path(__file__).with_name("verify-rig-finger-intersections.py")
    spec = importlib.util.spec_from_file_location("coupled_finger_checker", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the scoped collision verifier")
    checker = importlib.util.module_from_spec(spec)
    original = sys.argv
    try:
        sys.argv = [str(path), "--", str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = original
    return checker


def main() -> None:
    candidate, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != CANDIDATE_SHA:
        raise RuntimeError("Unexpected candidate hash")
    checker = load_checker(candidate)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError("Expected exactly one armature")
    rig, body = rigs[0], checker.candidate_body()
    categories = checker.category_by_vertex(body)
    records = []

    def evaluate(side: str, digit: str, commands: list[tuple[str, int, int]], family: str) -> None:
        for pose_bone in rig.pose.bones:
            pose_bone.matrix_basis = Matrix.Identity(4)
        for bone_name, axis, sign in commands:
            bone = rig.pose.bones.get(bone_name)
            if bone is None:
                raise RuntimeError(f"Missing probe bone: {bone_name}")
            bone.rotation_mode = "XYZ"
            values = [0.0, 0.0, 0.0]
            values[axis] = sign * math.radians(10)
            bone.rotation_euler = values
        bpy.context.view_layer.update()
        hits = checker.evaluate_intersections(body, categories, f"{side}-{digit}")
        records.append({
            "family": family,
            "side": side,
            "digit": digit,
            "commands": [
                {"bone": name, "axis": "xyz"[axis], "degrees": sign * 10}
                for name, axis, sign in commands
            ],
            "overlapCount": len(hits),
            "categories": sorted({label for label, _ in hits}),
        })

    for side, suffix in (("left", "L"), ("right", "R")):
        for digit in ("thumb", "index", "middle", "ring", "pinky"):
            prefix = "thumb" if digit == "thumb" else f"f_{digit}"
            bones = [f"DEF-{prefix}.{segment}.{suffix}" for segment in ("01", "02", "03")]
            # Two axes of the same bone, with all four signed combinations.
            for name in bones:
                for first_axis, second_axis in itertools.combinations(range(3), 2):
                    for first_sign, second_sign in itertools.product((-1, 1), repeat=2):
                        evaluate(side, digit, [(name, first_axis, first_sign),
                            (name, second_axis, second_sign)], "same-bone-axis-pair")
            # The same local axis on two adjacent segments, with all signs.
            for first_bone, second_bone in zip(bones, bones[1:]):
                for axis in range(3):
                    for first_sign, second_sign in itertools.product((-1, 1), repeat=2):
                        evaluate(side, digit, [(first_bone, axis, first_sign),
                            (second_bone, axis, second_sign)], "adjacent-segment-same-axis")

    report = {
        "schema": "vozual.rig-coupled-collision-probes",
        "schemaVersion": 1,
        "candidateSha256": digest,
        "blenderVersion": bpy.app.version_string,
        "probeDegrees": [-10, 10],
        "records": records,
        "scope": "two-command isolated snapshots; same-hand dominant-weight non-adjacent BVH collision checks",
        "sampling": "All two-axis sign combinations within one bone; all same-axis sign combinations across adjacent segments; one digit chain at a time.",
        "limitations": [
            "Discrete two-command snapshots do not establish continuous paths, arbitrary coupling, or safe joint limits.",
            "Collision scope excludes mixed-weight transition triangles, garments, separate meshes, inter-hand contact, and non-digit body contact.",
            "No anatomical or LSC semantic classification is performed.",
        ],
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "candidateSha256": digest,
        "reportSha256": hashlib.sha256(output.read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == "__main__":
    main()
