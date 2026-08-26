"""Audit the VOZUAL character hand topology and skinning weights.

Run this script with Blender and pass either a source ``.blend`` or exported
``.glb`` file after ``--``. The report is read-only and never saves the scene.

    blender --background --python tools/audit-rigged-avatar-hands.py -- avatar.glb
"""

from __future__ import annotations

import statistics
import sys
from collections import Counter
from pathlib import Path

import bpy


SIDES = ("L", "R")
FINGER_NAMES = ("thumb", "f_index", "f_middle", "f_ring", "f_pinky")


def input_path() -> Path:
    try:
        separator = sys.argv.index("--")
        return Path(sys.argv[separator + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass a .blend or .glb path after --") from error


def load_scene(source: Path) -> None:
    if source.suffix.lower() == ".blend":
        if Path(bpy.data.filepath).resolve() == source:
            return
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))


def is_hand_group(name: str, side: str) -> bool:
    return name == f"DEF-hand.{side}" or any(
        name.startswith(f"DEF-{finger}.") and name.endswith(f".{side}")
        for finger in FINGER_NAMES
    )


def is_opposite_hand_group(name: str, side: str) -> bool:
    other_side = "R" if side == "L" else "L"
    return is_hand_group(name, other_side)


def audit_mesh(mesh: bpy.types.Object) -> None:
    group_names = {group.index: group.name for group in mesh.vertex_groups}
    print(f"MESH {mesh.name}: {len(mesh.data.vertices)} vertices, "
          f"{len(mesh.data.edges)} edges, {len(mesh.data.polygons)} faces")
    print(f"  modifiers: {[modifier.type for modifier in mesh.modifiers]}")
    print(f"  shape keys: {len(mesh.data.shape_keys.key_blocks) if mesh.data.shape_keys else 0}")

    for side in SIDES:
        indexes = {
            index for index, name in group_names.items() if is_hand_group(name, side)
        }
        weighted_vertices: list[int] = []
        weight_totals: list[float] = []
        influence_counts: list[int] = []
        cross_side_vertices: list[int] = []
        group_usage: Counter[str] = Counter()

        for vertex in mesh.data.vertices:
            hand_assignments = [
                assignment for assignment in vertex.groups
                if assignment.group in indexes and assignment.weight > 1e-5
            ]
            if not hand_assignments:
                continue
            weighted_vertices.append(vertex.index)
            weight_totals.append(sum(assignment.weight for assignment in vertex.groups))
            influence_counts.append(len(vertex.groups))
            for assignment in hand_assignments:
                group_usage[group_names[assignment.group]] += 1
            if any(
                is_opposite_hand_group(group_names[assignment.group], side)
                and assignment.weight > 1e-5
                for assignment in vertex.groups
            ):
                cross_side_vertices.append(vertex.index)

        if not weighted_vertices:
            continue
        coordinates = [mesh.data.vertices[index].co for index in weighted_vertices]
        extents = tuple(
            max(coordinate[axis] for coordinate in coordinates)
            - min(coordinate[axis] for coordinate in coordinates)
            for axis in range(3)
        )
        print(f"  HAND {side}: {len(weighted_vertices)} weighted vertices, "
              f"extent=({extents[0]:.4f}, {extents[1]:.4f}, {extents[2]:.4f})")
        print(f"    total weight min/median/max: "
              f"{min(weight_totals):.4f}/{statistics.median(weight_totals):.4f}/"
              f"{max(weight_totals):.4f}")
        print(f"    influences median/max: "
              f"{statistics.median(influence_counts):.1f}/{max(influence_counts)}")
        print(f"    opposite-side contamination: {len(cross_side_vertices)}")
        for name, count in sorted(group_usage.items()):
            print(f"    {name}: {count} vertices")


def main() -> None:
    source = input_path()
    load_scene(source)
    print(f"HAND AUDIT: {source}")
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    print(f"ARMATURES: {[(item.name, len(item.data.bones)) for item in armatures]}")
    for item in bpy.context.scene.objects:
        if item.type != "MESH" or not item.vertex_groups:
            continue
        if any(is_hand_group(group.name, side) for group in item.vertex_groups for side in SIDES):
            audit_mesh(item)


if __name__ == "__main__":
    main()
