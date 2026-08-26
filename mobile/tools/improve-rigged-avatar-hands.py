"""Create a VOZUAL mobile avatar with denser, smoother hand deformation.

The licensed source ``.blend`` must already be open when this script runs:

    blender --background source.blend \
      --python tools/improve-rigged-avatar-hands.py -- output.glb

Only the body mesh topology around both hands and the interpolation between
adjacent finger bones are changed. The source file, skeleton, materials and
all non-hand vertices remain untouched.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


BODY_NAME = "NUG_Base_Body"
ARMATURE_NAME = "1_Rigify"
SIDES = ("L", "R")
FINGERS = ("thumb", "f_index", "f_middle", "f_ring", "f_pinky")
SMOOTH_FACTOR = 0.14
SMOOTH_ITERATIONS = 2
LONG_FINGER_VOLUME_SCALE = 1.1
THUMB_VOLUME_SCALE = 1.06


def output_path() -> Path:
    try:
        separator = sys.argv.index("--")
        requested = Path(sys.argv[separator + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass the output GLB path after --") from error
    requested.parent.mkdir(parents=True, exist_ok=True)
    return requested


def finger_group_names(side: str, finger: str) -> tuple[str, ...]:
    return tuple(f"DEF-{finger}.{joint:02d}.{side}" for joint in range(1, 4))


def remove_shape_keys(mesh: bpy.types.Object) -> None:
    """Discard unused morph targets in this in-memory mobile export copy."""
    if not mesh.data.shape_keys:
        return
    for key_block in list(mesh.data.shape_keys.key_blocks)[::-1]:
        mesh.shape_key_remove(key_block)


def vertex_weights(
    mesh: bpy.types.Object,
    group_indexes: set[int],
) -> dict[int, dict[int, float]]:
    result: dict[int, dict[int, float]] = {}
    for vertex in mesh.data.vertices:
        weights = {
            assignment.group: assignment.weight
            for assignment in vertex.groups
            if assignment.group in group_indexes and assignment.weight > 1e-6
        }
        if weights:
            result[vertex.index] = weights
    return result


def hand_vertex_indexes(mesh: bpy.types.Object) -> set[int]:
    names = {
        f"DEF-hand.{side}"
        for side in SIDES
    }
    names.update(
        name
        for side in SIDES
        for finger in FINGERS
        for name in finger_group_names(side, finger)
    )
    indexes = {
        mesh.vertex_groups[name].index
        for name in names
        if mesh.vertex_groups.get(name) is not None
    }
    return set(vertex_weights(mesh, indexes))


def subdivide_hands(mesh: bpy.types.Object) -> tuple[int, int, int]:
    """Add one topology level only to faces wholly inside the hand region."""
    hand_vertices = hand_vertex_indexes(mesh)
    before_vertices = len(mesh.data.vertices)
    before_faces = len(mesh.data.polygons)

    editable = bmesh.new()
    editable.from_mesh(mesh.data)
    editable.verts.ensure_lookup_table()
    selected_faces = [
        face
        for face in editable.faces
        if all(vertex.index in hand_vertices for vertex in face.verts)
    ]
    selected_edges = {edge for face in selected_faces for edge in face.edges}
    bmesh.ops.subdivide_edges(
        editable,
        edges=list(selected_edges),
        cuts=1,
        use_grid_fill=True,
        smooth=0.0,
    )
    editable.to_mesh(mesh.data)
    editable.free()
    mesh.data.update()

    subdivided_hand_vertices = hand_vertex_indexes(mesh)
    for polygon in mesh.data.polygons:
        if all(vertex_index in subdivided_hand_vertices for vertex_index in polygon.vertices):
            polygon.use_smooth = True
    return (
        len(selected_faces),
        len(mesh.data.vertices) - before_vertices,
        len(mesh.data.polygons) - before_faces,
    )


def mesh_adjacency(mesh: bpy.types.Object) -> dict[int, set[int]]:
    adjacency: dict[int, set[int]] = defaultdict(set)
    for edge in mesh.data.edges:
        first, second = edge.vertices
        adjacency[first].add(second)
        adjacency[second].add(first)
    return adjacency


def smooth_finger_weights(mesh: bpy.types.Object) -> int:
    """Soften bone transitions without spreading influence to another finger."""
    adjacency = mesh_adjacency(mesh)
    changed_vertices: set[int] = set()

    for side in SIDES:
        for finger in FINGERS:
            names = finger_group_names(side, finger)
            groups = [mesh.vertex_groups.get(name) for name in names]
            if any(group is None for group in groups):
                raise RuntimeError(f"Missing finger groups for {finger}.{side}")
            indexes = {group.index for group in groups if group is not None}
            weights = vertex_weights(mesh, indexes)
            region = set(weights)
            if not region:
                continue

            for _ in range(SMOOTH_ITERATIONS):
                next_weights: dict[int, dict[int, float]] = {}
                for vertex_index in region:
                    current = weights.get(vertex_index, {})
                    chain_total = sum(current.values())
                    if chain_total <= 1e-6:
                        continue
                    neighbors = adjacency[vertex_index] & region
                    if not neighbors:
                        continue
                    blended: dict[int, float] = {}
                    for group_index in indexes:
                        own = current.get(group_index, 0.0)
                        neighbor_mean = sum(
                            weights.get(neighbor, {}).get(group_index, 0.0)
                            for neighbor in neighbors
                        ) / len(neighbors)
                        blended[group_index] = (
                            own * (1.0 - SMOOTH_FACTOR)
                            + neighbor_mean * SMOOTH_FACTOR
                        )
                    blended_total = sum(blended.values())
                    if blended_total <= 1e-6:
                        continue
                    scale = chain_total / blended_total
                    next_weights[vertex_index] = {
                        group_index: weight * scale
                        for group_index, weight in blended.items()
                    }
                weights.update(next_weights)

            for vertex_index, assignments in weights.items():
                for group_index, weight in assignments.items():
                    mesh.vertex_groups[group_index].add(
                        [vertex_index],
                        max(0.0, min(1.0, weight)),
                        "REPLACE",
                    )
                changed_vertices.add(vertex_index)

    return len(changed_vertices)


def project_onto_bone(
    point: Vector,
    head: Vector,
    tail: Vector,
) -> Vector:
    """Return the closest point on a rest-pose deform bone segment."""
    axis = tail - head
    squared_length = axis.length_squared
    if squared_length <= 1e-12:
        return head.copy()
    amount = max(0.0, min(1.0, (point - head).dot(axis) / squared_length))
    return head + axis * amount


def add_finger_volume(
    mesh: bpy.types.Object,
    armature: bpy.types.Object,
) -> int:
    """Thicken fingers radially without changing bones or fingertip reach.

    The source character has complete finger topology, but its stylized fingers
    become visually narrow in strongly curled sign-language poses. Expanding
    vertices away from the weighted rest-bone centerlines adds a small amount
    of skin volume while preserving every bone length, wrist seam and skinning
    assignment used by the mobile retargeter.
    """
    mesh_from_armature = mesh.matrix_world.inverted() @ armature.matrix_world
    changed_vertices: set[int] = set()

    for side in SIDES:
        for finger in FINGERS:
            groups = [
                mesh.vertex_groups.get(name)
                for name in finger_group_names(side, finger)
            ]
            if any(group is None for group in groups):
                raise RuntimeError(f"Missing finger groups for {finger}.{side}")

            bone_centers: dict[int, tuple[Vector, Vector]] = {}
            for group in groups:
                if group is None:
                    continue
                bone = armature.data.bones.get(group.name)
                if bone is None:
                    raise RuntimeError(f"Missing deform bone {group.name}")
                bone_centers[group.index] = (
                    mesh_from_armature @ bone.head_local,
                    mesh_from_armature @ bone.tail_local,
                )

            scale = (
                THUMB_VOLUME_SCALE
                if finger == "thumb"
                else LONG_FINGER_VOLUME_SCALE
            )
            for vertex in mesh.data.vertices:
                assignments = [
                    assignment
                    for assignment in vertex.groups
                    if assignment.group in bone_centers and assignment.weight > 1e-5
                ]
                finger_weight = sum(assignment.weight for assignment in assignments)
                if finger_weight <= 1e-5:
                    continue

                center = Vector((0.0, 0.0, 0.0))
                for assignment in assignments:
                    head, tail = bone_centers[assignment.group]
                    center += project_onto_bone(vertex.co, head, tail) * assignment.weight
                center /= finger_weight

                radial = vertex.co - center
                volume_strength = min(1.0, finger_weight)
                vertex.co = center + radial * (
                    1.0 + (scale - 1.0) * volume_strength
                )
                changed_vertices.add(vertex.index)

    mesh.data.update()
    return len(changed_vertices)


def select_mobile_character() -> list[str]:
    for item in list(bpy.data.objects):
        if item.name.startswith("WGT-") or item.name in {"Cube", "Icosphere"}:
            bpy.data.objects.remove(item, do_unlink=True)
    view_layer = bpy.context.scene.view_layers[0]
    for item in view_layer.objects:
        item.select_set(False, view_layer=view_layer)
    selected: list[str] = []
    unsupported_transparency_meshes = {
        "NUG_Base_EyeONUGlusion",
        "NUG_Base_TearLine",
    }
    for item in bpy.context.scene.objects:
        is_armature = item.type == "ARMATURE" and item.name == ARMATURE_NAME
        is_character_mesh = (
            item.type == "MESH"
            and len(item.data.polygons) > 0
            and item.name != "Sport_sneakers"
            and item.name not in unsupported_transparency_meshes
            and not item.name.startswith("WGT-")
        )
        if not (is_armature or is_character_mesh):
            continue
        item.hide_viewport = False
        item.hide_render = False
        item.select_set(True, view_layer=view_layer)
        selected.append(item.name)
        if is_armature:
            view_layer.objects.active = item
            item.data.pose_position = "REST"
            for pose_bone in item.pose.bones:
                pose_bone.custom_shape = None
    return selected


def resize_embedded_textures(maximum_dimension: int = 1024) -> int:
    resized = 0
    for image in bpy.data.images:
        width, height = image.size
        if width <= 0 or height <= 0 or max(width, height) <= maximum_dimension:
            continue
        scale = maximum_dimension / max(width, height)
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
        resized += 1
    return resized


def export_glb(destination: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_def_bones=True,
        export_armature_object_remove=False,
        export_animations=False,
        export_morph=False,
        export_morph_animation=False,
        export_skins=True,
        export_all_influences=False,
        export_influence_nb=4,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=82,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_yup=True,
    )


def main() -> None:
    destination = output_path()
    body = bpy.data.objects.get(BODY_NAME)
    if body is None or body.type != "MESH":
        raise RuntimeError(f"The expected body mesh {BODY_NAME} was not found")

    remove_shape_keys(body)
    selected_faces, added_vertices, added_faces = subdivide_hands(body)
    smoothed_vertices = smooth_finger_weights(body)
    armature = bpy.data.objects.get(ARMATURE_NAME)
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(f"The expected armature {ARMATURE_NAME} was not found")
    volume_vertices = add_finger_volume(body, armature)
    selected = select_mobile_character()
    resized = resize_embedded_textures()
    export_glb(destination)

    size_mb = destination.stat().st_size / (1024 * 1024)
    print(f"VOZUAL improved avatar: {destination}")
    print(f"Subdivided hand faces: {selected_faces}")
    print(f"Added hand vertices/faces: {added_vertices}/{added_faces}")
    print(f"Smoothed finger-weight vertices: {smoothed_vertices}")
    print(f"Finger-volume vertices: {volume_vertices}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"Resized textures: {resized}")
    print(f"GLB size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
