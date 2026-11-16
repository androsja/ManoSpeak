"""Measure exported deform-bone rest bases from a Blender source file or ZIP.

The report records geometric rest axes in glTF right-handed Y-up coordinates.
It does not label axes as anatomical flexion/extension axes or infer safe limits.

    blender --background --python-exit-code 1 --python tools/audit-rig-local-axes.py -- source.zip report.json
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, Path]:
    try:
        separator = sys.argv.index("--")
        source = Path(sys.argv[separator + 1]).expanduser().resolve(strict=True)
        output = Path(sys.argv[separator + 2]).expanduser().resolve()
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass a source .blend or .zip and output JSON after --") from error
    if source.suffix.lower() not in {".blend", ".zip"} or output.suffix.lower() != ".json":
        raise RuntimeError("Expected source .blend/.zip and output .json")
    return source, output


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def gltf_axis(armature: bpy.types.Object, axis: Vector) -> list[float]:
    world_axis = (armature.matrix_world.to_3x3() @ axis).normalized()
    return [round(world_axis.x, 9), round(world_axis.z, 9), round(-world_axis.y, 9)]


def main() -> None:
    source, output = arguments()
    output.parent.mkdir(parents=True, exist_ok=True)
    archive_sha = sha256(source)
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    if source.suffix.lower() == ".zip":
        temp_dir = tempfile.TemporaryDirectory(prefix="vozual-rig-axis-audit-")
        with zipfile.ZipFile(source) as archive:
            blend_paths = [name for name in archive.namelist() if name.lower().endswith(".blend")]
            if len(blend_paths) != 1:
                raise RuntimeError(f"Expected exactly one Blender file in source ZIP, found {len(blend_paths)}")
            blend_path = Path(archive.extract(blend_paths[0], temp_dir.name))
    else:
        blend_path = source

    try:
        blend_sha = sha256(blend_path)
        bpy.ops.wm.open_mainfile(filepath=str(blend_path))
        armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
        if len(armatures) != 1:
            raise RuntimeError(f"Expected one source armature, found {len(armatures)}")
        armature = armatures[0]
        bones = sorted((bone for bone in armature.data.bones if bone.use_deform), key=lambda bone: bone.name)
        if not bones:
            raise RuntimeError("Source armature has no deform bones")

        records = []
        max_orthogonality_error = 0.0
        min_handedness = 1.0
        for bone in bones:
            world_head = armature.matrix_world @ bone.head_local
            world_tail = armature.matrix_world @ bone.tail_local
            x_axis = gltf_axis(armature, bone.x_axis)
            y_axis = gltf_axis(armature, bone.y_axis)
            z_axis = gltf_axis(armature, bone.z_axis)
            vectors = [Vector(value) for value in (x_axis, y_axis, z_axis)]
            orthogonality_error = max(
                abs(vectors[0].dot(vectors[1])),
                abs(vectors[0].dot(vectors[2])),
                abs(vectors[1].dot(vectors[2])),
            )
            handedness = vectors[0].dot(vectors[1].cross(vectors[2]))
            max_orthogonality_error = max(max_orthogonality_error, orthogonality_error)
            min_handedness = min(min_handedness, handedness)
            records.append({
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "lengthM": round((world_tail - world_head).length, 9),
                "axesGltf": {"x": x_axis, "y": y_axis, "z": z_axis},
                "orthogonalityError": round(orthogonality_error, 9),
                "handednessDeterminant": round(handedness, 9),
            })

        report = {
            "schema": "vozual.rig-local-rest-axes-audit",
            "schemaVersion": 1,
            "source": {
                "file": source.name,
                "sha256": archive_sha,
                "blendMember": blend_path.name if source.suffix.lower() == ".zip" else None,
                "blendSha256": blend_sha,
                "armature": armature.name,
            },
            "coordinateSystem": "gltf-right-handed-y-up",
            "axisSemantics": "Measured deform-bone rest basis; not anatomical joint axes or safe motion limits.",
            "boneCount": len(records),
            "maxOrthogonalityError": round(max_orthogonality_error, 9),
            "minimumHandednessDeterminant": round(min_handedness, 9),
            "anatomicalDegreesOfFreedom": "unsupported",
            "anatomicalJointLimits": "unsupported",
            "bones": records,
        }
        if max_orthogonality_error > 1e-5 or min_handedness < 0.99999:
            raise RuntimeError(
                f"Invalid measured rest bases: orthogonality={max_orthogonality_error}, handedness={min_handedness}"
            )
        output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(output), "sha256": sha256(output), "boneCount": len(records),
                          "maxOrthogonalityError": report["maxOrthogonalityError"],
                          "minimumHandednessDeterminant": report["minimumHandednessDeterminant"]}, sort_keys=True))
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()


if __name__ == "__main__":
    main()
