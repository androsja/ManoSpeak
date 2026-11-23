"""Fail-closed material metadata filter for Blender evaluated meshes."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class MaterialFilterResult:
    retained_vertex_ids: tuple[int, ...]
    retained_face_count: int
    excluded_face_count: int
    excluded_only_vertex_count: int


def retained_vertices_for_materials(
    polygons: Iterable[object],
    object_slot_names: Sequence[str | None],
    mesh_material_names: Sequence[str | None],
    vertex_count: int,
    excluded_material_names: frozenset[str],
) -> MaterialFilterResult:
    """Resolve evaluated face material metadata before callers read coordinates.

    Every used material index must exist in both evaluated slot tables, and both
    names must agree. Invalid indices, missing names, and invalid vertex IDs fail
    closed. The function never reads a vertex coordinate or tessellates a face.
    """
    if not isinstance(vertex_count, int) or isinstance(vertex_count, bool) or vertex_count < 0:
        raise ValueError(f"invalid vertex count: {vertex_count!r}")

    retained_faces: list[tuple[int, ...]] = []
    excluded_faces: list[tuple[int, ...]] = []
    for polygon_index, polygon in enumerate(polygons):
        material_index = getattr(polygon, "material_index", None)
        if (
            not isinstance(material_index, int)
            or isinstance(material_index, bool)
            or material_index < 0
            or material_index >= len(object_slot_names)
            or material_index >= len(mesh_material_names)
        ):
            raise ValueError(f"invalid evaluated material index at polygon {polygon_index}: {material_index!r}")

        object_name = object_slot_names[material_index]
        mesh_name = mesh_material_names[material_index]
        if not isinstance(object_name, str) or not object_name or not isinstance(mesh_name, str) or not mesh_name:
            raise ValueError(f"missing evaluated material name at polygon {polygon_index}")
        if object_name != mesh_name:
            raise ValueError(
                f"evaluated material table mismatch at polygon {polygon_index}: "
                f"object={object_name!r}, mesh={mesh_name!r}"
            )

        raw_vertex_ids = getattr(polygon, "vertices", None)
        if raw_vertex_ids is None:
            raise ValueError(f"missing vertex IDs at polygon {polygon_index}")
        vertex_ids = tuple(raw_vertex_ids)
        if len(vertex_ids) < 3 or any(
            not isinstance(vertex_id, int)
            or isinstance(vertex_id, bool)
            or vertex_id < 0
            or vertex_id >= vertex_count
            for vertex_id in vertex_ids
        ):
            raise ValueError(f"invalid vertex IDs at polygon {polygon_index}")

        if object_name in excluded_material_names:
            excluded_faces.append(vertex_ids)
        else:
            retained_faces.append(vertex_ids)

    retained_ids = {vertex_id for face in retained_faces for vertex_id in face}
    excluded_ids = {vertex_id for face in excluded_faces for vertex_id in face}
    return MaterialFilterResult(
        retained_vertex_ids=tuple(sorted(retained_ids)),
        retained_face_count=len(retained_faces),
        excluded_face_count=len(excluded_faces),
        excluded_only_vertex_count=len(excluded_ids - retained_ids),
    )
