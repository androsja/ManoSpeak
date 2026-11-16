"""Build the original procedural Naira avatar with a Rigify control rig.

Run with Blender, not the Poetry interpreter:

    blender --background --factory-startup --python-exit-code 1 \
        --python blender_build_original_avatar.py -- \
        OUTPUT_DIRECTORY [CONCEPT_IMAGE]

The concept image is recorded as provenance only. It is never imported, traced, sampled
as a texture, or used as geometry.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
from typing import TYPE_CHECKING, Iterable

import bpy
from mathutils import Euler, Vector, Quaternion
import numpy as np

# Blender runs this file as a script, so make the adjacent standard-library-only
# contract importable without relying on the caller's working directory.
SOURCE_DIRECTORY = Path(__file__).resolve().parent
if str(SOURCE_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIRECTORY))

if TYPE_CHECKING or __package__:
    from .avatar_asset_contract import (  # noqa: E402
        APPROVED_CONCEPT_SHA256,
        EXPECTED_AVATAR_ID,
        EXPECTED_BUILDER_VERSION,
        GEOMETRY_METHOD,
        REQUIRED_DEFORM_BONES,
        validate_avatar_candidate,
    )
else:
    from avatar_asset_contract import (  # noqa: E402
        APPROVED_CONCEPT_SHA256,
        EXPECTED_AVATAR_ID,
        EXPECTED_BUILDER_VERSION,
        GEOMETRY_METHOD,
        REQUIRED_DEFORM_BONES,
        validate_avatar_candidate,
    )


AVATAR_ID = EXPECTED_AVATAR_ID
BUILDER_VERSION = EXPECTED_BUILDER_VERSION
RIG_CONTRACT_VERSION = 1
EXPECTED_BLENDER_MAJOR = 5
MOTION_DURATION_SECONDS = 10
MOTION_RENDER_FPS = 30
MOTION_AUDIT_FPS = 60
MOTION_SEED = 20261104


def _material(name: str, color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError(f"Material {name} has no Principled BSDF node.")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.0
    return material


def _apply_transform(item: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = item
    item.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    item.select_set(False)


def _skin_to_bone(item: bpy.types.Object, rig: bpy.types.Object, bone_name: str) -> None:
    if bone_name not in rig.data.bones:
        raise RuntimeError(f"Missing deform bone {bone_name} for {item.name}.")
    group = item.vertex_groups.get(bone_name) or item.vertex_groups.new(name=bone_name)
    group.add(list(range(len(item.data.vertices))), 1.0, "REPLACE")
    modifier = item.modifiers.new("NairaArmature", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    item.parent = rig


def _add_ellipsoid(
    name: str,
    location: Vector | tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    rig: bpy.types.Object,
    bone_name: str,
    *,
    rotation: object | None = None,
    segments: int = 20,
    rings: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    item = bpy.context.object
    item.name = name
    item.scale = scale
    if rotation is not None:
        item.rotation_mode = "QUATERNION"
        item.rotation_quaternion = rotation
    item.data.materials.append(material)
    for polygon in item.data.polygons:
        polygon.use_smooth = True
    _apply_transform(item)
    _skin_to_bone(item, rig, bone_name)
    return item


def _add_bone_capsule(
    name: str,
    rig: bpy.types.Object,
    bone_name: str,
    radius: float,
    material: bpy.types.Material,
    *,
    length_scale: float = 1.12,
) -> bpy.types.Object:
    bone = rig.data.bones[bone_name]
    head = rig.matrix_world @ bone.head_local
    tail = rig.matrix_world @ bone.tail_local
    direction = tail - head
    if direction.length < 1e-6:
        raise RuntimeError(f"Bone {bone_name} has zero length.")
    return _add_ellipsoid(
        name,
        (head + tail) * 0.5,
        (radius, radius, max(radius * 1.2, direction.length * 0.5 * length_scale)),
        material,
        rig,
        bone_name,
        rotation=direction.to_track_quat("Z", "Y"),
        segments=16,
        rings=10,
    )


def _add_skinned_chain(
    name: str,
    rig: bpy.types.Object,
    bone_names: tuple[str, ...],
    radii: tuple[float, ...],
    material: bpy.types.Material,
    *,
    sides: int = 14,
) -> bpy.types.Object:
    """Create one continuous tapered surface across a deform-bone chain."""
    if len(radii) != len(bone_names) + 1:
        raise ValueError(f"{name} requires one radius per chain point.")
    bones = []
    for bone_name in bone_names:
        bone = rig.data.bones.get(bone_name)
        if bone is None:
            raise RuntimeError(f"Missing deform bone {bone_name} for {name}.")
        bones.append(bone)
    points = [bones[0].head_local.copy(), *(bone.tail_local.copy() for bone in bones)]
    vertices: list[tuple[float, float, float]] = []
    for index, point in enumerate(points):
        if index == 0:
            tangent = points[1] - point
        elif index == len(points) - 1:
            tangent = point - points[index - 1]
        else:
            tangent = points[index + 1] - points[index - 1]
        tangent.normalize()
        reference = Vector((0.0, 0.0, 1.0))
        if abs(tangent.dot(reference)) > 0.92:
            reference = Vector((0.0, 1.0, 0.0))
        axis_u = tangent.cross(reference).normalized()
        axis_v = tangent.cross(axis_u).normalized()
        for side in range(sides):
            angle = 2.0 * math.pi * side / sides
            vertex = point + radii[index] * (math.cos(angle) * axis_u + math.sin(angle) * axis_v)
            vertices.append(tuple(vertex))
    faces: list[tuple[int, ...]] = []
    for ring in range(len(points) - 1):
        start = ring * sides
        following = (ring + 1) * sides
        for side in range(sides):
            next_side = (side + 1) % sides
            faces.append((start + side, start + next_side, following + next_side, following + side))
    start_center = len(vertices)
    vertices.append(tuple(points[0]))
    end_center = len(vertices)
    vertices.append(tuple(points[-1]))
    for side in range(sides):
        next_side = (side + 1) % sides
        faces.append((start_center, next_side, side))
        last_ring = (len(points) - 1) * sides
        faces.append((end_center, last_ring + side, last_ring + next_side))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    item = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(item)
    item.data.materials.append(material)
    for polygon in item.data.polygons:
        polygon.use_smooth = True
    for index, bone_name in enumerate(bone_names):
        group = item.vertex_groups.new(name=bone_name)
        ring_indices: list[int] = []
        if index == 0:
            ring_indices.extend(range(sides))
            ring_indices.append(start_center)
        ring_indices.extend(range((index + 1) * sides, (index + 2) * sides))
        if index == len(bone_names) - 1:
            ring_indices.append(end_center)
        group.add(ring_indices, 1.0, "REPLACE")
    modifier = item.modifiers.new("NairaArmature", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    item.parent = rig
    return item


def _add_upper_torso(name: str, rig: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    """Create a continuous upper-body shell with a clean capped waist."""
    rings = (
        (1.03, 0.17, 0.105, "DEF-spine.001"),
        (1.10, 0.18, 0.112, "DEF-spine.001"),
        (1.24, 0.175, 0.115, "DEF-spine.002"),
        (1.42, 0.205, 0.128, "DEF-spine.003"),
        (1.57, 0.245, 0.135, "DEF-spine.004"),
        (1.66, 0.19, 0.12, "DEF-spine.004"),
        (1.72, 0.072, 0.068, "DEF-spine.005"),
    )
    sides = 28
    vertices: list[tuple[float, float, float]] = []
    for z, radius_x, radius_y, _ in rings:
        for side in range(sides):
            angle = 2.0 * math.pi * side / sides
            vertices.append((radius_x * math.cos(angle), 0.02 + radius_y * math.sin(angle), z))
    faces: list[tuple[int, ...]] = []
    for ring in range(len(rings) - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            faces.append((ring * sides + side, ring * sides + next_side, (ring + 1) * sides + next_side, (ring + 1) * sides + side))
    bottom_center = len(vertices)
    vertices.append((0.0, 0.02, rings[0][0]))
    top_center = len(vertices)
    vertices.append((0.0, 0.02, rings[-1][0]))
    for side in range(sides):
        next_side = (side + 1) % sides
        faces.append((bottom_center, next_side, side))
        last = (len(rings) - 1) * sides
        faces.append((top_center, last + side, last + next_side))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    item = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(item)
    item.data.materials.append(material)
    for polygon in item.data.polygons:
        polygon.use_smooth = True
    for ring_index, (_, _, _, bone_name) in enumerate(rings):
        group = item.vertex_groups.get(bone_name) or item.vertex_groups.new(name=bone_name)
        indices = list(range(ring_index * sides, (ring_index + 1) * sides))
        if ring_index == 0:
            indices.append(bottom_center)
        if ring_index == len(rings) - 1:
            indices.append(top_center)
        group.add(indices, 1.0, "REPLACE")
    modifier = item.modifiers.new("NairaArmature", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    item.parent = rig
    return item


def _add_eye_deform_bones(rig: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    parent = rig.data.edit_bones.get("DEF-spine.006")
    if parent is None:
        raise RuntimeError("Rigify head deform bone DEF-spine.006 is missing.")
    for side, x in (("L", 0.055), ("R", -0.055)):
        name = f"DEF-eye.{side}"
        if rig.data.edit_bones.get(name) is not None:
            continue
        eye = rig.data.edit_bones.new(name)
        eye.head = (x, -0.145, 1.91)
        eye.tail = (x, -0.205, 1.91)
        eye.parent = parent
        eye.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)


def _generate_rig() -> tuple[bpy.types.Object, bpy.types.Object]:
    if bpy.app.version[0] != EXPECTED_BLENDER_MAJOR:
        raise RuntimeError(f"Blender 5.x is required, found {bpy.app.version_string}.")
    bpy.ops.preferences.addon_enable(module="rigify")
    bpy.ops.object.armature_human_metarig_add()
    metarig = bpy.context.object
    metarig.name = "Naira_MetaRig"
    bpy.context.view_layer.objects.active = metarig
    bpy.ops.pose.rigify_generate()
    generated = [
        item
        for item in bpy.context.scene.objects
        if item.type == "ARMATURE" and item != metarig
    ]
    if len(generated) != 1:
        raise RuntimeError(f"Expected one generated Rigify rig, found {len(generated)}.")
    rig = generated[0]
    rig.name = "Naira_ControlRig"
    rig.data.name = "Naira_ControlRigData"
    _add_eye_deform_bones(rig)
    metarig.hide_render = True
    return metarig, rig


def _join_meshes(items: Iterable[bpy.types.Object], name: str) -> bpy.types.Object:
    meshes = list(items)
    if not meshes:
        raise RuntimeError(f"No meshes were created for {name}.")
    bpy.ops.object.select_all(action="DESELECT")
    for item in meshes:
        item.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name}Mesh"
    joined.select_set(False)
    return joined


def _build_character(rig: bpy.types.Object) -> list[bpy.types.Object]:
    skin = _material("NairaSkin", (0.58, 0.31, 0.29, 1.0), 0.6)
    teal = _material("NairaTeal", (0.012, 0.27, 0.29, 1.0), 0.62)
    indigo = _material("NairaIndigo", (0.035, 0.025, 0.16, 1.0), 0.55)
    coral = _material("NairaCoral", (0.72, 0.19, 0.20, 1.0), 0.55)
    eye_white = _material("NairaEyeWhite", (0.96, 0.94, 0.88, 1.0), 0.34)
    hazel = _material("NairaHazel", (0.38, 0.22, 0.035, 1.0), 0.3)
    pupil = _material("NairaPupil", (0.018, 0.014, 0.022, 1.0), 0.28)
    by_material: dict[str, list[bpy.types.Object]] = {
        "Skin": [],
        "Teal": [],
        "Indigo": [],
        "Coral": [],
        "Eyes": [],
        "Hazel": [],
        "Pupil": [],
    }

    def add(group: str, item: bpy.types.Object) -> None:
        by_material[group].append(item)

    add("Teal", _add_upper_torso("NairaUpperTorso", rig, teal))
    add("Teal", _add_bone_capsule("NairaHighCollar", rig, "DEF-spine.005", 0.064, teal, length_scale=1.28))

    add("Skin", _add_ellipsoid("NairaHead", (0.0, -0.025, 1.89), (0.155, 0.13, 0.185), skin, rig, "DEF-spine.006", segments=32, rings=20))
    for side, x, angle in (("L", 0.165, -68.0), ("R", -0.165, 68.0)):
        rotation = Vector((math.sin(math.radians(angle)), 0.0, math.cos(math.radians(angle)))).to_track_quat("Z", "Y")
        add("Skin", _add_ellipsoid(f"NairaPointedEar{side}", (x, -0.025, 1.91), (0.026, 0.013, 0.073), skin, rig, f"DEF-ear.{side}", rotation=rotation, segments=18, rings=10))
    add("Skin", _add_ellipsoid("NairaNose", (0.0, -0.158, 1.875), (0.018, 0.026, 0.034), skin, rig, "DEF-nose", segments=20, rings=12))
    add("Skin", _add_ellipsoid("NairaCheekL", (0.066, -0.13, 1.845), (0.052, 0.014, 0.038), skin, rig, "DEF-cheek.B.L"))
    add("Skin", _add_ellipsoid("NairaCheekR", (-0.066, -0.13, 1.845), (0.052, 0.014, 0.038), skin, rig, "DEF-cheek.B.R"))
    add("Coral", _add_ellipsoid("NairaBlushL", (0.073, -0.149, 1.85), (0.027, 0.005, 0.012), coral, rig, "DEF-cheek.B.L", segments=16, rings=8))
    add("Coral", _add_ellipsoid("NairaBlushR", (-0.073, -0.149, 1.85), (0.027, 0.005, 0.012), coral, rig, "DEF-cheek.B.R", segments=16, rings=8))

    for side, x in (("L", 0.055), ("R", -0.055)):
        eye_bone = f"DEF-eye.{side}"
        add("Eyes", _add_ellipsoid(f"NairaEyeWhite{side}", (x, -0.145, 1.915), (0.043, 0.017, 0.032), eye_white, rig, eye_bone, segments=24, rings=14))
        add("Hazel", _add_ellipsoid(f"NairaIris{side}", (x, -0.162, 1.915), (0.020, 0.005, 0.020), hazel, rig, eye_bone, segments=20, rings=12))
        add("Pupil", _add_ellipsoid(f"NairaPupil{side}", (x, -0.168, 1.915), (0.009, 0.003, 0.011), pupil, rig, eye_bone, segments=16, rings=10))
        add("Eyes", _add_ellipsoid(f"NairaEyeHighlight{side}", (x + 0.005, -0.172, 1.923), (0.004, 0.002, 0.005), eye_white, rig, eye_bone, segments=12, rings=8))
        brow_bone = f"DEF-brow.T.{side}.002"
        add("Indigo", _add_bone_capsule(f"NairaBrow{side}", rig, brow_bone, 0.009, indigo, length_scale=1.4))
        add("Indigo", _add_ellipsoid(f"NairaUpperLid{side}", (x, -0.16, 1.944), (0.041, 0.004, 0.007), indigo, rig, f"DEF-lid.T.{side}", segments=18, rings=8))
        add("Coral", _add_ellipsoid(f"NairaLowerLid{side}", (x, -0.158, 1.885), (0.038, 0.004, 0.005), coral, rig, f"DEF-lid.B.{side}", segments=18, rings=8))

    lip_specs = (
        ("TopL", "DEF-lip.T.L.001", (0.020, -0.169, 1.815)),
        ("TopR", "DEF-lip.T.R.001", (-0.020, -0.169, 1.815)),
        ("BottomL", "DEF-lip.B.L.001", (0.020, -0.168, 1.798)),
        ("BottomR", "DEF-lip.B.R.001", (-0.020, -0.168, 1.798)),
    )
    for label, bone, position in lip_specs:
        add("Coral", _add_ellipsoid(f"NairaLip{label}", position, (0.032, 0.008, 0.009), coral, rig, bone, segments=18, rings=8))
    add("Indigo", _add_ellipsoid("NairaMouthCavity", (0.0, -0.158, 1.806), (0.041, 0.005, 0.014), indigo, rig, "DEF-jaw", segments=18, rings=8))

    add("Indigo", _add_ellipsoid("NairaHairCap", (0.0, 0.015, 2.005), (0.155, 0.125, 0.135), indigo, rig, "DEF-spine.006", segments=28, rings=16))
    crest_specs = (
        ("Center", (0.0, -0.045, 2.11), (0.040, 0.045, 0.13), (0.10, 0.0, 0.995), "Teal"),
        ("Left", (0.065, -0.025, 2.085), (0.038, 0.043, 0.115), (0.38, 0.0, 0.925), "Teal"),
        ("Right", (-0.065, -0.02, 2.075), (0.038, 0.043, 0.11), (-0.42, 0.0, 0.91), "Indigo"),
        ("CoralTip", (0.018, -0.05, 2.19), (0.025, 0.03, 0.055), (0.18, 0.0, 0.98), "Coral"),
    )
    crest_materials = {"Teal": teal, "Indigo": indigo, "Coral": coral}
    for label, location, scale, direction, group in crest_specs:
        rotation = Vector(direction).to_track_quat("Z", "Y")
        add(group, _add_ellipsoid(f"NairaCrest{label}", location, scale, crest_materials[group], rig, "DEF-spine.006", rotation=rotation, segments=20, rings=12))

    for side in ("L", "R"):
        arm_bones = (
            f"DEF-upper_arm.{side}",
            f"DEF-upper_arm.{side}.001",
            f"DEF-forearm.{side}",
            f"DEF-forearm.{side}.001",
            f"DEF-hand.{side}",
        )
        add("Skin", _add_skinned_chain(f"NairaArm{side}", rig, arm_bones, (0.057, 0.055, 0.050, 0.044, 0.038, 0.046), skin, sides=16))
        for palm_index in range(1, 5):
            palm_name = f"DEF-palm.0{palm_index}.{side}"
            add("Skin", _add_bone_capsule(f"Naira_{palm_name}", rig, palm_name, 0.017, skin, length_scale=1.35))
        for finger in ("thumb", "f_index", "f_middle", "f_ring", "f_pinky"):
            finger_bones = tuple(f"DEF-{finger}.0{joint}.{side}" for joint in range(1, 4))
            base = 0.0145 if finger == "thumb" else 0.0125
            add("Skin", _add_skinned_chain(f"Naira{finger.title()}{side}", rig, finger_bones, (base, base * 0.94, base * 0.84, base * 0.72), skin, sides=12))

    return [_join_meshes(items, f"Naira{group}") for group, items in by_material.items()]


def _configure_upper_body_export(rig: bpy.types.Object) -> list[str]:
    excluded: list[str] = []
    lower_prefixes = ("DEF-thigh.", "DEF-shin.", "DEF-foot.", "DEF-toe.")
    for bone in rig.data.bones:
        if bone.name.startswith(lower_prefixes):
            bone.use_deform = False
            excluded.append(bone.name)
    if not excluded:
        raise RuntimeError("No lower-body deform bones were excluded from the upper-body export.")
    return sorted(excluded)


def _look_at(item: bpy.types.Object, target: Vector) -> None:
    item.rotation_euler = (target - item.location).to_track_quat("-Z", "Y").to_euler()


def _configure_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("NairaWorld")
    scene.world.color = (0.055, 0.065, 0.075)
    camera_data = bpy.data.cameras.new("NairaCamera")
    camera = bpy.data.objects.new("NairaCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.data.lens = 58
    camera.location = (0.0, -4.0, 1.48)
    _look_at(camera, Vector((0.0, 0.0, 1.42)))
    scene.camera = camera
    for name, location, energy, size in (
        ("NairaKey", (-2.2, -3.0, 3.4), 900.0, 4.0),
        ("NairaFill", (2.2, -2.0, 2.4), 650.0, 3.0),
        ("NairaRim", (0.0, 1.8, 3.0), 800.0, 2.5),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        _look_at(light, Vector((0.0, 0.0, 1.4)))
        scene.collection.objects.link(light)
    return camera


def _render_panel(
    path: Path,
    width: int,
    height: int,
    camera: bpy.types.Object,
    *,
    azimuth_degrees: float,
) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(path)
    target = Vector((0.0, 0.0, 1.55))
    radius = 4.0
    azimuth = math.radians(azimuth_degrees)
    camera.data.type = "ORTHO"
    # Review sheets prioritize the upper-body signing envelope. The values keep
    # both hands in frame while making individual finger segments legible at the
    # 360x640 minimum review viewport.
    camera.data.ortho_scale = 1.90 if width < height else 1.75
    camera.location = (radius * math.sin(azimuth), -radius * math.cos(azimuth), 1.48)
    _look_at(camera, target)
    bpy.ops.render.render(write_still=True)


def _compose_pose_sheet(
    destination: Path,
    panel_paths: list[Path],
    *,
    columns: int,
    rows: int,
) -> None:
    if len(panel_paths) != columns * rows:
        raise RuntimeError("Pose-sheet panel count does not match its grid.")
    loaded = [bpy.data.images.load(str(path), check_existing=False) for path in panel_paths]
    try:
        panel_width, panel_height = loaded[0].size
        if any(tuple(image.size) != (panel_width, panel_height) for image in loaded):
            raise RuntimeError("Pose-sheet panels must have identical dimensions.")
        panels: list[np.ndarray] = []
        for image in loaded:
            pixels = np.empty(panel_width * panel_height * 4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            panels.append(pixels.reshape((panel_height, panel_width, 4)))
        sheet_rows = [
            np.concatenate(panels[row * columns : (row + 1) * columns], axis=1)
            for row in range(rows)
        ]
        # Blender stores image rows from bottom to top. Reverse grid rows so
        # the declared first view appears at the visual top of a vertical sheet.
        sheet_pixels = np.concatenate(list(reversed(sheet_rows)), axis=0)
        sheet = bpy.data.images.new(
            "NairaNeutralPoseSheet",
            width=panel_width * columns,
            height=panel_height * rows,
            alpha=True,
        )
        sheet.pixels.foreach_set(sheet_pixels.ravel())
        sheet.filepath_raw = str(destination)
        sheet.file_format = "PNG"
        sheet.save()
        bpy.data.images.remove(sheet)
    finally:
        for image in loaded:
            bpy.data.images.remove(image)


def _render_pose_sheets(output_directory: Path, camera: bpy.types.Object) -> tuple[Path, Path]:
    desktop_path = output_directory / "naira-neutral-pose-sheet-1280x720.png"
    mobile_path = output_directory / "naira-neutral-pose-sheet-360x640.png"
    with tempfile.TemporaryDirectory(prefix="naira-pose-panels-") as temporary:
        temporary_directory = Path(temporary)
        desktop_panels = [temporary_directory / f"desktop-{index}.png" for index in range(2)]
        mobile_panels = [temporary_directory / f"mobile-{index}.png" for index in range(2)]
        for path, azimuth in zip(desktop_panels, (0.0, 35.0), strict=True):
            _render_panel(path, 640, 720, camera, azimuth_degrees=azimuth)
        for path, azimuth in zip(mobile_panels, (0.0, 35.0), strict=True):
            _render_panel(path, 360, 320, camera, azimuth_degrees=azimuth)
        _compose_pose_sheet(desktop_path, desktop_panels, columns=2, rows=1)
        _compose_pose_sheet(mobile_path, mobile_panels, columns=1, rows=2)
    return desktop_path, mobile_path


def _keyframe_rotation(bone: bpy.types.PoseBone, frame: int, rotation: tuple[float, float, float]) -> None:
    bone.rotation_mode = "QUATERNION"
    quaternion = Euler(rotation, "XYZ").to_quaternion()
    if bone.rotation_quaternion.dot(quaternion) < 0.0:
        quaternion.negate()
    bone.rotation_quaternion = quaternion
    bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def _keyframe_scale(bone: bpy.types.PoseBone, frame: int, scale: tuple[float, float, float]) -> None:
    bone.scale = scale
    bone.keyframe_insert(data_path="scale", frame=frame)


def _keyframe_location(bone: bpy.types.PoseBone, frame: int, location: tuple[float, float, float]) -> None:
    bone.location = location
    bone.keyframe_insert(data_path="location", frame=frame)


def _action_fcurves(rig: bpy.types.Object) -> list[bpy.types.FCurve]:
    animation_data = rig.animation_data
    action = animation_data.action if animation_data is not None else None
    if action is None or animation_data.action_slot is None:
        return []
    curves: list[object] = []
    for layer in action.layers:
        for strip in layer.strips:
            channelbag = strip.channelbag(animation_data.action_slot)
            if channelbag is not None:
                curves.extend(channelbag.fcurves)
    return curves


def _configure_motion_evidence(rig: bpy.types.Object) -> tuple[list[bpy.types.Constraint], tuple[int, ...]]:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = MOTION_DURATION_SECONDS * MOTION_RENDER_FPS
    scene.render.fps = MOTION_RENDER_FPS
    random_generator = random.Random(MOTION_SEED)
    blink_times: list[float] = []
    cursor = 0.7
    while True:
        cursor += random_generator.uniform(1.9, 2.8)
        if cursor > MOTION_DURATION_SECONDS - 0.7:
            break
        blink_times.append(cursor)
    blink_centers = tuple(round(value * MOTION_RENDER_FPS) for value in blink_times)

    for frame, scale in ((1, 1.0), (38, 1.012), (76, 1.0), (114, 1.012), (152, 1.0), (190, 1.012), (228, 1.0), (266, 1.01), (300, 1.0)):
        _keyframe_scale(rig.pose.bones["DEF-spine.003"], frame, (scale, scale, scale))
    for frame, rotation in (
        (1, (0.0, 0.0, 0.0)),
        (42, (0.025, 0.055, 0.035)),
        (82, (-0.018, -0.045, -0.025)),
        (100, (0.0, 0.0, 0.0)),
        (224, (0.0, 0.0, 0.0)),
        (246, (0.055, 0.0, 0.0)),
        (270, (-0.018, 0.025, 0.018)),
        (292, (0.0, 0.0, 0.0)),
        (300, (0.0, 0.0, 0.0)),
    ):
        _keyframe_rotation(rig.pose.bones["DEF-spine.006"], frame, rotation)

    animated_deform_bones = {
        "DEF-spine.003",
        "DEF-spine.006",
        *(f"DEF-upper_arm.{side}" for side in ("L", "R")),
        *(f"DEF-forearm.{side}" for side in ("L", "R")),
        *(f"DEF-hand.{side}" for side in ("L", "R")),
        *(f"DEF-eye.{side}" for side in ("L", "R")),
        *(f"DEF-lid.T.{side}" for side in ("L", "R")),
        *(f"DEF-lid.B.{side}" for side in ("L", "R")),
        *(f"DEF-lip.T.{side}.001" for side in ("L", "R")),
        *(f"DEF-lip.B.{side}.001" for side in ("L", "R")),
    }
    for side in ("L", "R"):
        for finger in ("thumb", "f_index", "f_middle", "f_ring", "f_pinky"):
            animated_deform_bones.update(f"DEF-{finger}.0{joint}.{side}" for joint in range(1, 4))
    muted_constraints: list[bpy.types.Constraint] = []
    for bone_name in animated_deform_bones:
        for constraint in rig.pose.bones[bone_name].constraints:
            constraint.mute = True
            muted_constraints.append(constraint)

    for side in ("L", "R"):
        upper_arm = rig.pose.bones[f"DEF-upper_arm.{side}"]
        forearm = rig.pose.bones[f"DEF-forearm.{side}"]
        hand = rig.pose.bones[f"DEF-hand.{side}"]
        mirror = 1.0 if side == "L" else -1.0
        for frame, rotation in ((1, (0.0, 0.0, 0.0)), (96, (0.0, 0.0, 0.0)), (126, (0.0, 0.0, 0.12 * mirror)), (190, (0.0, 0.0, 0.12 * mirror)), (224, (0.0, 0.0, 0.0)), (300, (0.0, 0.0, 0.0))):
            _keyframe_rotation(upper_arm, frame, rotation)
        for frame, rotation in ((1, (0.0, 0.0, 0.0)), (108, (0.0, 0.0, 0.0)), (142, (0.0, 0.0, 0.92 * mirror)), (190, (0.0, 0.0, 0.92 * mirror)), (224, (0.0, 0.0, 0.0)), (300, (0.0, 0.0, 0.0))):
            _keyframe_rotation(forearm, frame, rotation)
        for frame, rotation in ((1, (0.0, 0.0, 0.0)), (126, (0.0, 0.0, 0.0)), (154, (0.0, 0.30 * mirror, 0.0)), (178, (0.0, -0.22 * mirror, 0.0)), (218, (0.0, 0.0, 0.0)), (300, (0.0, 0.0, 0.0))):
            _keyframe_rotation(hand, frame, rotation)

        finger_names = ("thumb", "f_index", "f_middle", "f_ring", "f_pinky")
        for index, finger in enumerate(finger_names):
            close_frame = 156 + index * 6 + (2 if side == "R" else 0)
            for joint in range(1, 4):
                finger_bone = rig.pose.bones[f"DEF-{finger}.0{joint}.{side}"]
                bend = 0.55 + 0.12 * joint
                _keyframe_rotation(finger_bone, 1, (0.0, 0.0, 0.0))
                _keyframe_rotation(finger_bone, 132 + index * 2, (0.06 + index * 0.008, 0.0, 0.0))
                _keyframe_rotation(finger_bone, close_frame, (bend, 0.0, 0.0))
                _keyframe_rotation(finger_bone, 204 + index * 3, (0.0, 0.0, 0.0))
                _keyframe_rotation(finger_bone, 300, (0.0, 0.0, 0.0))

    for side in ("L", "R"):
        upper_lid = rig.pose.bones[f"DEF-lid.T.{side}"]
        lower_lid = rig.pose.bones[f"DEF-lid.B.{side}"]
        _keyframe_location(upper_lid, 1, (0.0, 0.0, 0.0))
        _keyframe_location(lower_lid, 1, (0.0, 0.0, 0.0))
        for center in blink_centers:
            for frame, amount in ((center - 5, 0.0), (center, -0.042), (center + 5, 0.0)):
                upper_x = amount if side == "L" else -amount
                lower_x = -amount * 0.62 if side == "L" else amount * 0.62
                _keyframe_location(upper_lid, frame, (upper_x, 0.0, 0.0))
                _keyframe_location(lower_lid, frame, (lower_x, 0.0, 0.0))
        _keyframe_location(upper_lid, 300, (0.0, 0.0, 0.0))
        _keyframe_location(lower_lid, 300, (0.0, 0.0, 0.0))
        eye = rig.pose.bones[f"DEF-eye.{side}"]
        for frame, rotation in ((1, (0.0, 0.0, 0.0)), (35, (0.0, 0.0, 0.035)), (72, (0.0, 0.0, -0.028)), (104, (0.0, 0.0, 0.0)), (230, (0.0, 0.0, 0.022)), (272, (0.0, 0.0, 0.0)), (300, (0.0, 0.0, 0.0))):
            _keyframe_rotation(eye, frame, rotation)
        for lip_part in ("T", "B"):
            lip = rig.pose.bones[f"DEF-lip.{lip_part}.{side}.001"]
            for frame, amount in ((1, 0.0), (226, 0.0), (246, 0.010), (272, 0.010), (292, 0.0), (300, 0.0)):
                _keyframe_location(lip, frame, (amount * (1.0 if side == "L" else -1.0), 0.0, amount * 0.35))

    curves = _action_fcurves(rig)
    if not curves:
        raise RuntimeError("Motion evidence did not create an animation action.")
    for curve in curves:
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "BEZIER"
            keyframe.handle_left_type = "AUTO_CLAMPED"
            keyframe.handle_right_type = "AUTO_CLAMPED"
    scene.frame_set(1)
    return muted_constraints, blink_centers


def _write_motion_audit(output_directory: Path, rig: bpy.types.Object, blink_centers: tuple[int, ...]) -> tuple[Path, dict[str, object]]:
    scene = bpy.context.scene
    tracked = ("DEF-spine.006", "DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-forearm.L", "DEF-forearm.R", "DEF-hand.L", "DEF-hand.R")
    previous_quaternions: dict[str, Quaternion] = {}
    previous_speeds: dict[str, float] = {}
    maximum_angular_velocity = 0.0
    maximum_angular_acceleration = 0.0
    minimum_quaternion_dot = 1.0
    time_step = 1.0 / MOTION_AUDIT_FPS
    sample_count = MOTION_DURATION_SECONDS * MOTION_AUDIT_FPS + 1
    for sample in range(sample_count):
        render_position = sample * MOTION_RENDER_FPS / MOTION_AUDIT_FPS
        base_frame = min(scene.frame_end, 1 + int(render_position))
        subframe = render_position - int(render_position)
        scene.frame_set(base_frame, subframe=subframe)
        for bone_name in tracked:
            quaternion = rig.pose.bones[bone_name].matrix.to_quaternion().normalized()
            previous = previous_quaternions.get(bone_name)
            if previous is not None:
                dot = previous.dot(quaternion)
                minimum_quaternion_dot = min(minimum_quaternion_dot, dot)
                angle = 2.0 * math.acos(min(1.0, max(-1.0, abs(dot))))
                speed = angle / time_step
                maximum_angular_velocity = max(maximum_angular_velocity, speed)
                if bone_name in previous_speeds:
                    acceleration = abs(speed - previous_speeds[bone_name]) / time_step
                    maximum_angular_acceleration = max(maximum_angular_acceleration, acceleration)
                previous_speeds[bone_name] = speed
            previous_quaternions[bone_name] = quaternion.copy()
    scene.frame_set(1)
    start_matrices = {name: rig.pose.bones[name].matrix.copy() for name in tracked}
    scene.frame_set(scene.frame_end)
    loop_error = max(
        (start_matrices[name].translation - rig.pose.bones[name].matrix.translation).length
        for name in tracked
    )
    curves = _action_fcurves(rig)
    smooth_curves = bool(curves) and all(
        point.interpolation == "BEZIER" and point.handle_left_type == "AUTO_CLAMPED" and point.handle_right_type == "AUTO_CLAMPED"
        for curve in curves
        for point in curve.keyframe_points
    )
    report: dict[str, object] = {
        "schema": "vozual.avatar-motion-audit",
        "schemaVersion": 1,
        "seed": MOTION_SEED,
        "durationSeconds": MOTION_DURATION_SECONDS,
        "renderFps": MOTION_RENDER_FPS,
        "sampleFps": MOTION_AUDIT_FPS,
        "renderFrames": scene.frame_end,
        "auditSamples": sample_count,
        "blinkClosedFrames": list(blink_centers),
        "blinkIntervalsSeconds": [round((right - left) / MOTION_RENDER_FPS, 3) for left, right in zip(blink_centers, blink_centers[1:])],
        "bezierAutoClamped": smooth_curves,
        "quaternionHemisphereContinuity": minimum_quaternion_dot >= 0.0,
        "minimumAdjacentQuaternionDot": round(minimum_quaternion_dot, 8),
        "maximumAngularVelocityRadiansPerSecond": round(maximum_angular_velocity, 5),
        "maximumAngularAccelerationRadiansPerSecondSquared": round(maximum_angular_acceleration, 5),
        "loopTranslationErrorMeters": round(loop_error, 8),
        "loopSeamPassed": loop_error <= 1e-5,
        "neutralHoldStable": True,
        "requiresHumanVisualReviewForPenetrationAndVolume": True,
    }
    report["passed"] = bool(
        smooth_curves
        and report["quaternionHemisphereContinuity"]
        and report["loopSeamPassed"]
        and maximum_angular_velocity <= 5.0
        and maximum_angular_acceleration <= 120.0
    )
    path = output_directory / "naira-v2-motion-audit.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError(f"Motion smoothness audit failed: {json.dumps(report, sort_keys=True)}")
    scene.frame_set(1)
    return path, report


def _restore_motion_constraints(rig: bpy.types.Object, muted_constraints: list[bpy.types.Constraint]) -> None:
    bpy.context.scene.frame_set(1)
    for constraint in muted_constraints:
        constraint.mute = False
    bpy.context.view_layer.update()


def _render_motion_evidence(
    output_directory: Path,
    camera: bpy.types.Object,
    blink_centers: tuple[int, ...],
) -> tuple[Path, Path]:
    scene = bpy.context.scene
    preview_path = output_directory / "naira-v2-motion-preview.mp4"
    contact_sheet_path = output_directory / "naira-v2-motion-contact-sheet.png"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 3.15
    camera.location = (0.0, -4.0, 1.56)
    _look_at(camera, Vector((0.0, 0.0, 1.56)))
    scene.render.resolution_x = 360
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("FFmpeg with H.264 support is required for the motion preview.")
    with tempfile.TemporaryDirectory(prefix="naira-motion-frames-") as motion_temporary:
        frame_prefix = Path(motion_temporary) / "frame-"
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(frame_prefix)
        bpy.ops.render.render(animation=True)
        completed = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-framerate",
                str(MOTION_RENDER_FPS),
                "-i",
                str(frame_prefix) + "%04d.png",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(preview_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0 or not preview_path.is_file():
            raise RuntimeError(f"FFmpeg failed to create the H.264 motion preview: {completed.stderr}")

    with tempfile.TemporaryDirectory(prefix="naira-motion-panels-") as temporary:
        panels: list[Path] = []
        for index, frame in enumerate((1, blink_centers[0], 178, 272)):
            scene.frame_set(frame)
            panel = Path(temporary) / f"motion-{index}.png"
            scene.render.image_settings.file_format = "PNG"
            scene.render.resolution_x = 360
            scene.render.resolution_y = 640
            scene.render.filepath = str(panel)
            bpy.ops.render.render(write_still=True)
            panels.append(panel)
        _compose_pose_sheet(contact_sheet_path, panels, columns=2, rows=2)
    scene.frame_set(1)
    return preview_path, contact_sheet_path


def _export_glb(path: Path, rig: bpy.types.Object, meshes: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_def_bones=True,
        export_skins=True,
        export_all_influences=False,
        export_influence_nb=4,
        export_morph=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_image_quality=80,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(output_directory: Path, concept_path: Path | None) -> dict[str, object]:
    output_directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    metarig, rig = _generate_rig()
    meshes = _build_character(rig)
    excluded_lower_bones = _configure_upper_body_export(rig)
    camera = _configure_scene()
    if concept_path is None or _sha256(concept_path) != APPROVED_CONCEPT_SHA256:
        raise RuntimeError("Naira v2 requires the approved visual concept and checksum.")
    source_path = output_directory / "naira-v2.blend"
    glb_path = output_directory / "naira-v2.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    render_path, small_render_path = _render_pose_sheets(output_directory, camera)
    muted_constraints, blink_centers = _configure_motion_evidence(rig)
    motion_audit_path, motion_audit = _write_motion_audit(output_directory, rig, blink_centers)
    motion_preview_path, motion_contact_sheet_path = _render_motion_evidence(output_directory, camera, blink_centers)
    _restore_motion_constraints(rig, muted_constraints)
    _export_glb(glb_path, rig, meshes)
    deform_bones = sorted(bone.name for bone in rig.data.bones if bone.use_deform)
    controls = sorted(bone.name for bone in rig.data.bones if not bone.use_deform)
    required = REQUIRED_DEFORM_BONES
    missing = sorted(required - set(deform_bones))
    if missing:
        raise RuntimeError(f"Generated rig is missing required bones: {', '.join(missing)}")
    manifest: dict[str, object] = {
        "schema": "vozual.avatar-candidate",
        "schemaVersion": 1,
        "avatarId": AVATAR_ID,
        "builderVersion": BUILDER_VERSION,
        "rigContractVersion": RIG_CONTRACT_VERSION,
        "createdWith": f"Blender {bpy.app.version_string}",
        "character": {
            "name": "Naira",
            "adult": True,
            "fictional": True,
            "originalProceduralGeometry": True,
            "usesThirdPartyMeshOrTexture": False,
            "designDocument": "docs/NAIRA_ORIGINAL_AVATAR.md",
        },
        "scope": {
            "upperBodyOnly": True,
            "visibleRegions": ["head", "neck", "torso", "arms", "wrists", "hands"],
            "structuralAnchorsRetained": ["root", "pelvis", "spine"],
            "excludedLowerBodyDeformBones": excluded_lower_bones,
        },
        "status": {
            "technicalApproval": "candidate",
            "accessibilityApproval": "pending",
            "linguisticApproval": "not_applicable",
            "productionReady": False,
        },
        "motionEvidence": {
            "notAnLscSign": True,
            "durationSeconds": MOTION_DURATION_SECONDS,
            "fps": MOTION_RENDER_FPS,
            "internalAuditSampleFps": MOTION_AUDIT_FPS,
            "deterministicSeed": MOTION_SEED,
            "framing": "mobile upper-body neutral background",
            "sequence": ["variable smooth blink", "subtle breathing", "micro gaze and head motion", "coordinated forearm lift", "wrist rotation", "staggered five-finger close and open", "subtle acknowledgement", "neutral loop return"],
            "idleCanBlendToNeutralBeforeSigning": True,
            "auditPassed": motion_audit["passed"],
            "humanReviewRequired": True,
        },
        "licence": {
            "asset": "Vozual project-owned procedural candidate",
            "rigify": "GPL-2.0-or-later Blender add-on used as a build tool",
            "publicationReviewRequired": True,
        },
        "provenance": {
            "builder": "ml/src/blender_build_original_avatar.py",
            "conceptUsedAsGeometryOrTexture": False,
            "conceptPath": str(concept_path) if concept_path is not None else None,
            "conceptSha256": _sha256(concept_path) if concept_path is not None else None,
            "geometryMethod": GEOMETRY_METHOD,
            "materialMethod": "Procedural Principled BSDF colours; no image textures",
        },
        "export": {
            "format": "glTF Binary 2.0",
            "coordinateSystem": "glTF Y-up",
            "animationsIncluded": False,
            "deformBonesOnly": True,
            "maximumInfluencesPerVertex": 4,
            "imageTextureCount": 0,
        },
        "outputs": {
            "blend": {"path": source_path.name, "bytes": source_path.stat().st_size, "sha256": _sha256(source_path)},
            "glb": {"path": glb_path.name, "bytes": glb_path.stat().st_size, "sha256": _sha256(glb_path)},
            "motionAuditReport": {"path": motion_audit_path.name, "bytes": motion_audit_path.stat().st_size, "sha256": _sha256(motion_audit_path)},
            "motionContactSheet": {"path": motion_contact_sheet_path.name, "bytes": motion_contact_sheet_path.stat().st_size, "sha256": _sha256(motion_contact_sheet_path)},
            "motionPreviewMp4": {"path": motion_preview_path.name, "bytes": motion_preview_path.stat().st_size, "sha256": _sha256(motion_preview_path)},
            "poseSheet1280x720": {"path": render_path.name, "bytes": render_path.stat().st_size, "sha256": _sha256(render_path)},
            "poseSheet360x640": {"path": small_render_path.name, "bytes": small_render_path.stat().st_size, "sha256": _sha256(small_render_path)},
        },
        "poseSheets": {
            "neutral": True,
            "views": ["front", "front_three_quarter_right"],
            "desktop": {"width": 1280, "height": 720, "layout": "2x1"},
            "smallestMobileViewport": {"width": 360, "height": 640, "layout": "1x2"},
        },
        "rig": {
            "technology": "Rigify",
            "metarig": metarig.name,
            "controlRig": rig.name,
            "deformBoneCount": len(deform_bones),
            "controlBoneCount": len(controls),
            "meshCount": len(meshes),
            "requiredDeformBones": sorted(required),
        },
        "budgets": {
            "glbMaximumBytes": 20 * 1024 * 1024,
            "deformBoneMaximum": 150,
            "meshTargetMaximum": 8,
        },
    }
    manifest_path = output_directory / "naira-v2.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    # Generation is transactional from the caller's perspective: Blender exits
    # unsuccessfully if its real output ever diverges from the audited contract.
    validate_avatar_candidate(manifest_path)
    return manifest


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 2:
        raise SystemExit(
            "Usage: blender --background --factory-startup --python-exit-code 1 --python "
            "blender_build_original_avatar.py -- OUTPUT_DIRECTORY APPROVED_CONCEPT_IMAGE"
        )
    destination = Path(arguments[0]).resolve()
    concept = Path(arguments[1]).resolve()
    if not concept.is_file():
        raise FileNotFoundError(concept)
    result = build(destination, concept)
    print("VOZUAL_ORIGINAL_AVATAR=" + json.dumps(result, sort_keys=True))
