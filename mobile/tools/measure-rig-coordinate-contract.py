"""Measure Task 3 rest-frame calibration and a non-neutral endpoint pose.

Run with Blender:

    blender --background --python-exit-code 1 --python tools/measure-rig-coordinate-contract.py -- avatar.glb

The report is JSON in glTF right-handed Y-up metres. It is a measurement tool,
not a solver and not evidence of linguistic approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def arguments() -> tuple[Path, Path | None, Path | None]:
    try:
        index = sys.argv.index("--")
    except ValueError as error:
        raise RuntimeError("Pass a candidate .glb after --") from error
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--output", type=Path)
    parsed = parser.parse_args(sys.argv[index + 1:])
    candidate = parsed.candidate.expanduser().resolve(strict=True)
    if candidate.suffix.lower() != ".glb":
        raise RuntimeError("Expected a .glb candidate")
    profile = parsed.profile.expanduser().resolve(strict=True) if parsed.profile else None
    output = parsed.output.expanduser().resolve() if parsed.output else None
    return candidate, profile, output


def vector_values(value: Vector, precision: int = 9) -> list[float]:
    return [round(component, precision) for component in value]


def quaternion_values(value: object, precision: int = 9) -> list[float]:
    return [round(value.x, precision), round(value.y, precision), round(value.z, precision), round(value.w, precision)]


def gltf_vector(value: Vector) -> Vector:
    """Convert Blender X-right/Y-depth/Z-up coordinates to glTF X/Y-up/Z-forward."""
    return Vector((value.x, value.z, -value.y))


def require_bone(armature: bpy.types.Object, name: str) -> bpy.types.Bone:
    bone = armature.data.bones.get(name)
    if bone is None:
        raise RuntimeError(f"Candidate is missing required bone {name}")
    return bone


def world_head(armature: bpy.types.Object, name: str) -> Vector:
    return armature.matrix_world @ require_bone(armature, name).head_local


def world_tail(armature: bpy.types.Object, name: str) -> Vector:
    return armature.matrix_world @ require_bone(armature, name).tail_local


def orthonormal_frame(origin: Vector, x_hint: Vector, y_hint: Vector) -> tuple[Vector, Vector, Vector, Vector]:
    x_axis = x_hint.normalized()
    z_axis = x_axis.cross(y_hint).normalized()
    y_axis = z_axis.cross(x_axis).normalized()
    if min(x_axis.length, y_axis.length, z_axis.length) < 0.999999:
        raise RuntimeError("Could not construct an orthonormal frame")
    return origin, x_axis, y_axis, z_axis


def frame_report(origin: Vector, x_axis: Vector, y_axis: Vector, z_axis: Vector) -> dict[str, object]:
    return {
        "originM": vector_values(gltf_vector(origin)),
        "axes": {
            "x": vector_values(gltf_vector(x_axis)),
            "y": vector_values(gltf_vector(y_axis)),
            "z": vector_values(gltf_vector(z_axis)),
        },
    }


def body_coordinates(point: Vector, body_frame: tuple[Vector, Vector, Vector, Vector]) -> list[float]:
    origin, x_axis, y_axis, z_axis = body_frame
    relative = point - origin
    return vector_values(Vector((relative.dot(x_axis), relative.dot(y_axis), relative.dot(z_axis))))


def hand_frame(armature: bpy.types.Object, side: str) -> tuple[Vector, Vector, Vector, Vector]:
    wrist = world_head(armature, f"DEF-hand.{side}")
    middle_tip = world_tail(armature, f"DEF-f_middle.03.{side}")
    index = world_head(armature, f"DEF-f_index.01.{side}")
    pinky = world_head(armature, f"DEF-f_pinky.01.{side}")
    return orthonormal_frame(wrist, index - pinky, middle_tip - wrist)


def anchor_report(armature: bpy.types.Object, body_frame: tuple[Vector, Vector, Vector, Vector]) -> list[dict[str, object]]:
    anchors: list[tuple[str, str, Vector]] = [
        ("face.brow", "region-center", (world_head(armature, "DEF-brow.B.L") + world_head(armature, "DEF-brow.B.R")) / 2),
        ("face.eye.left", "point", world_head(armature, "DEF-eye.L")),
        ("face.eye.right", "point", world_head(armature, "DEF-eye.R")),
        ("face.ear.left", "point", world_head(armature, "DEF-ear.L")),
        ("face.ear.right", "point", world_head(armature, "DEF-ear.R")),
        ("face.cheek.left", "point", world_head(armature, "DEF-cheek.B.L")),
        ("face.cheek.right", "point", world_head(armature, "DEF-cheek.B.R")),
        ("face.nose", "point", world_head(armature, "DEF-nose")),
        ("face.jaw", "point", world_head(armature, "DEF-jaw")),
        ("face.chin", "point", world_head(armature, "DEF-chin")),
        ("neck", "point", world_head(armature, "DEF-spine.006")),
        ("torso.upper", "point", world_head(armature, "DEF-spine.003")),
        ("torso.lower", "point", world_head(armature, "DEF-pelvis")),
    ]
    for side, label in (("L", "left"), ("R", "right")):
        anchors.extend([
            (f"arm.shoulder.{label}", "point", world_head(armature, f"DEF-upper_arm.{side}")),
            (f"arm.elbow.{label}", "point", world_head(armature, f"DEF-forearm.{side}")),
            (f"arm.wrist.{label}", "point", world_head(armature, f"DEF-hand.{side}")),
            (f"hand.palm.{label}", "point", world_head(armature, f"DEF-hand.{side}")),
        ])
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            for segment in ("01", "02", "03"):
                anchors.append((
                    f"hand.{finger}.segment.{segment}.{label}",
                    "point",
                    world_head(armature, f"DEF-{finger if finger == 'thumb' else 'f_' + finger}.{segment}.{side}"),
                ))
            anchors.append((
                f"hand.{finger}.tip.{label}",
                "point",
                world_tail(armature, f"DEF-{finger if finger == 'thumb' else 'f_' + finger}.03.{side}"),
            ))
    return [
        {"id": anchor_id, "kind": kind, "bodyPositionM": body_coordinates(position, body_frame)}
        for anchor_id, kind, position in anchors
    ]


def endpoint_pose_report(armature: bpy.types.Object, body_frame: tuple[Vector, Vector, Vector, Vector]) -> dict[str, object]:
    rotations = {
        "DEF-f_index.01.L": 0.15,
        "DEF-f_index.02.L": 0.20,
        "DEF-f_index.03.L": 0.15,
    }
    for name, radians in rotations.items():
        pose_bone = armature.pose.bones.get(name)
        if pose_bone is None:
            raise RuntimeError(f"Candidate is missing conformance pose bone {name}")
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler.x = radians
    bpy.context.view_layer.update()
    tip = armature.matrix_world @ armature.data.bones["DEF-f_index.03.L"].tail_local
    # A tail is not transformed by the bone's pose matrix; use the evaluated
    # pose bone endpoint to measure the animated target.
    tip = armature.matrix_world @ armature.pose.bones["DEF-f_index.03.L"].tail
    _, x_axis, y_axis, z_axis = body_frame
    basis = Matrix(((x_axis.x, y_axis.x, z_axis.x), (x_axis.y, y_axis.y, z_axis.y), (x_axis.z, y_axis.z, z_axis.z)))
    pose_rotation = (armature.matrix_world.to_3x3() @ armature.pose.bones["DEF-f_index.03.L"].matrix.to_3x3())
    relative_rotation = basis.transposed() @ pose_rotation
    return {
        "id": "left-index-curl-v1",
        "anchorId": "hand.index.tip.left",
        "rotationCommandsRad": rotations,
        "targetBodyPositionM": body_coordinates(tip, body_frame),
        "targetBodyOrientationQuat": quaternion_values(relative_rotation.to_quaternion()),
    }


def maximum_vector_error(actual: list[float], expected: list[float]) -> float:
    if len(actual) != len(expected):
        raise RuntimeError("Coordinate calibration vector length mismatch")
    return max(abs(first - second) for first, second in zip(actual, expected))


def quaternion_angle_degrees(actual: list[float], expected: list[float]) -> float:
    if len(actual) != 4 or len(expected) != 4:
        raise RuntimeError("Endpoint orientation must be a quaternion")
    first = Vector(actual)
    second = Vector(expected)
    dot = min(1.0, abs(first.dot(second)))
    return __import__("math").degrees(2 * __import__("math").acos(dot))


def verify_profile_calibration(profile: dict[str, object], report: dict[str, object], measurement_sha256: str) -> None:
    calibration = profile.get("descriptor", {}).get("coordinateCalibration", {})
    expected_hash = calibration.get("measurementSha256")
    if expected_hash != measurement_sha256:
        raise RuntimeError(
            f"Coordinate calibration hash mismatch: expected {expected_hash}, actual {measurement_sha256}"
        )
    for frame_id in ("body", "torso", "head"):
        actual = report[frame_id]
        expected = calibration.get(frame_id, {})
        errors = [
            maximum_vector_error(actual["originM"], expected.get("originM", [])),
            maximum_vector_error(actual["axes"]["x"], expected.get("axes", {}).get("x", [])),
            maximum_vector_error(actual["axes"]["y"], expected.get("axes", {}).get("y", [])),
            maximum_vector_error(actual["axes"]["z"], expected.get("axes", {}).get("z", [])),
        ]
        if max(errors) > 1e-4:
            raise RuntimeError(f"{frame_id} frame exceeds calibration tolerance: {max(errors):.9f} m")
    for side in ("left", "right"):
        actual = report["hand"][side]
        expected = calibration.get("hand", {}).get(side, {})
        errors = [
            maximum_vector_error(actual["originM"], expected.get("originM", [])),
            maximum_vector_error(actual["axes"]["x"], expected.get("axes", {}).get("x", [])),
            maximum_vector_error(actual["axes"]["y"], expected.get("axes", {}).get("y", [])),
            maximum_vector_error(actual["axes"]["z"], expected.get("axes", {}).get("z", [])),
        ]
        if max(errors) > 1e-4:
            raise RuntimeError(f"{side} hand frame exceeds calibration tolerance: {max(errors):.9f} m")
    actual_pose = report["endpointConformancePose"]
    expected_pose = calibration.get("endpointConformancePose", {})
    position_error = (Vector(actual_pose["targetBodyPositionM"]) - Vector(expected_pose.get("targetBodyPositionM", []))).length
    orientation_error = quaternion_angle_degrees(
        actual_pose["targetBodyOrientationQuat"], expected_pose.get("targetBodyOrientationQuat", []),
    )
    position_tolerance = expected_pose.get("positionToleranceM")
    orientation_tolerance = expected_pose.get("orientationToleranceDeg")
    if not isinstance(position_tolerance, (int, float)) or not isinstance(orientation_tolerance, (int, float)):
        raise RuntimeError("Endpoint conformance tolerances are required")
    if position_error > position_tolerance or orientation_error > orientation_tolerance:
        raise RuntimeError(
            f"Endpoint conformance failed: position={position_error:.9f} m, orientation={orientation_error:.6f} deg"
        )
    print(
        "PASS: endpoint conformance "
        f"position={position_error:.9f} m/{position_tolerance:.6f} m, "
        f"orientation={orientation_error:.6f} deg/{orientation_tolerance:.6f} deg"
    )


def main() -> None:
    candidate, profile_path, output = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate))
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    armature = armatures[0]
    body = orthonormal_frame(
        (world_head(armature, "DEF-upper_arm.L") + world_head(armature, "DEF-upper_arm.R")) / 2,
        world_head(armature, "DEF-upper_arm.L") - world_head(armature, "DEF-upper_arm.R"),
        world_head(armature, "DEF-spine.006") - world_head(armature, "DEF-spine.003"),
    )
    torso = orthonormal_frame(
        world_head(armature, "DEF-spine.003"), body[1], body[2],
    )
    head = orthonormal_frame(
        world_head(armature, "DEF-spine.006"),
        world_head(armature, "DEF-eye.L") - world_head(armature, "DEF-eye.R"),
        (world_head(armature, "DEF-forehead.L") + world_head(armature, "DEF-forehead.R")) / 2 - world_head(armature, "DEF-chin"),
    )
    report = {
        "coordinateSystem": "gltf-right-handed-y-up",
        "body": frame_report(*body),
        "torso": frame_report(*torso),
        "head": frame_report(*head),
        "hand": {"left": frame_report(*hand_frame(armature, "L")), "right": frame_report(*hand_frame(armature, "R"))},
        "anchors": anchor_report(armature, body),
        "endpointConformancePose": endpoint_pose_report(armature, body),
    }
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    measurement_sha256 = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    if profile_path:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        verify_profile_calibration(profile, report, measurement_sha256)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    print(f"PASS: coordinate calibration SHA-256 {measurement_sha256}")


if __name__ == "__main__":
    main()
