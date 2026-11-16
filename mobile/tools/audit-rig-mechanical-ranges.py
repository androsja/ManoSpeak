"""Measure a conservative discrete local-X collision envelope for finger probes.

This is a mechanical collision audit. It does not infer anatomical DOFs, does
not authorize continuous interpolation, and does not test arbitrary combined
poses. The tested samples use the existing Task 3 local-X probe proportions.

    blender --background --python-exit-code 1 \
      --python tools/audit-rig-mechanical-ranges.py -- candidate.glb report.json
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


BASE_ROTATIONS = (0.15, 0.20, 0.15)
SCALES = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0)
FINGERS = (
    "left-index", "left-middle", "left-ring", "left-pinky",
    "right-index", "right-middle", "right-ring", "right-pinky",
    "left-thumb", "right-thumb",
)


def inputs() -> tuple[Path, Path]:
    try:
        values = sys.argv[sys.argv.index("--") + 1:]
        candidate, report = values[:2]
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass candidate.glb and report.json after --") from error
    return Path(candidate).expanduser().resolve(strict=True), Path(report).expanduser().resolve()


def load_checker(candidate: Path):
    path = Path(__file__).with_name("verify-rig-finger-intersections.py")
    spec = importlib.util.spec_from_file_location("task3_finger_checker", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    original_argv = sys.argv
    sys.argv = [str(path), "--", str(candidate)]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = original_argv
    return module


def set_probe(checker, armature: bpy.types.Object, finger: str, scale: float) -> None:
    prefix = checker.FINGER_PREFIXES[finger]
    suffix = checker.LEFT_SUFFIX if finger.startswith("left-") else checker.RIGHT_SUFFIX
    segments = sorted(
        (bone for bone in armature.pose.bones
         if bone.name.startswith(prefix) and bone.name.endswith(suffix)),
        key=lambda bone: bone.name,
    )
    if len(segments) != 3:
        raise RuntimeError(f"Expected three segments for {finger}, found {len(segments)}")
    for bone, angle in zip(segments, BASE_ROTATIONS):
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (angle * scale, 0.0, 0.0)
    bpy.context.view_layer.update()


def reset(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def main() -> None:
    candidate, report_path = inputs()
    checker = load_checker(candidate)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate))
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    armature = armatures[0]
    body = checker.candidate_body()
    categories = checker.category_by_vertex(body)
    results = []
    for finger in FINGERS:
        samples = []
        for scale in SCALES:
            reset(armature)
            set_probe(checker, armature, finger, scale)
            collisions = checker.evaluate_intersections(body, categories, finger)
            samples.append({
                "scale": scale,
                "rotationRadians": [round(angle * scale, 6) for angle in BASE_ROTATIONS],
                "collisionCount": len(collisions),
                "collisionLabels": sorted({label for label, _ in collisions}),
            })
        reset(armature)
        passing = [sample for sample in samples if sample["collisionCount"] == 0]
        contiguous_prefix = []
        for sample in samples:
            if sample["collisionCount"]:
                break
            contiguous_prefix.append(sample["scale"])
        results.append({
            "finger": finger,
            "samples": samples,
            "passingScales": [sample["scale"] for sample in passing],
            "contiguousPassingPrefixScales": contiguous_prefix,
            "allSamplesPass": len(passing) == len(samples),
        })
    report = {
        "schema": "vozual.task3.mechanical-local-x-range-audit",
        "schemaVersion": 1,
        "candidateSha256": __import__("hashlib").sha256(candidate.read_bytes()).hexdigest(),
        "blender": bpy.app.version_string,
        "baseRotationRadians": list(BASE_ROTATIONS),
        "scales": list(SCALES),
        "resetBetweenSamples": True,
        "results": results,
        "scope": [
            "NUG_Base_Body evaluated skin mesh",
            "same-hand palm and other-digit non-adjacent BVH intersections",
            "individual local-X samples only",
        ],
        "limitations": [
            "mechanical collision envelope only; not anatomical DOF or safe joint limits",
            "no combined multi-finger, wrist, arm, garment, inter-hand, or arbitrary-pose coverage",
            "passing samples do not authorize interpolation between samples",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for result in results:
        print(result["finger"], "passingScales=", result["passingScales"])


if __name__ == "__main__":
    main()
