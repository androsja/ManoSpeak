"""Emit a deterministic audit of image nodes used by mobile-export materials.

Run with Blender and pass an output path after ``--``:

    blender --background source.blend --python tools/audit-rig-materials.py -- material-audit.json

The audit is read-only. It follows links upstream from each Material Output
surface input and records image nodes that can affect an exported character
mesh. It does not judge visual fidelity or alter the source material graph.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


UNSUPPORTED_TRANSPARENCY_MESHES = {"NUG_Base_EyeONUGlusion", "NUG_Base_TearLine"}


def output_path() -> Path:
    try:
        index = sys.argv.index("--")
        path = Path(sys.argv[index + 1]).expanduser().resolve()
    except (IndexError, ValueError) as error:
        raise RuntimeError("Pass output JSON path after --") from error
    if path.suffix.lower() != ".json":
        raise RuntimeError("Material audit output must be JSON")
    return path


def mobile_character_meshes() -> list[bpy.types.Object]:
    return sorted(
        [
            item
            for item in bpy.context.scene.objects
            if item.type == "MESH"
            and len(item.data.polygons) > 0
            and item.name != "Sport_sneakers"
            and item.name not in UNSUPPORTED_TRANSPARENCY_MESHES
            and not item.name.startswith("WGT-")
        ],
        key=lambda item: item.name,
    )


def upstream_nodes(material: bpy.types.Material) -> set[bpy.types.Node]:
    if material.node_tree is None:
        return set()
    outputs = [node for node in material.node_tree.nodes if node.type == "OUTPUT_MATERIAL"]
    pending = [link.from_node for node in outputs for socket in node.inputs if socket.name == "Surface" for link in socket.links]
    visited: set[bpy.types.Node] = set()
    while pending:
        node = pending.pop()
        if node in visited:
            continue
        visited.add(node)
        pending.extend(link.from_node for socket in node.inputs for link in socket.links)
    return visited


def image_node_record(node: bpy.types.Node) -> dict[str, object]:
    image = node.image
    return {
        "node": node.name,
        "image": image.name if image else None,
        "dimensions": list(image.size) if image else None,
        "colorspace": image.colorspace_settings.name if image else None,
    }


def material_record(material: bpy.types.Material, meshes: list[str]) -> dict[str, object]:
    nodes = material.node_tree.nodes if material.node_tree else []
    reachable = upstream_nodes(material)
    return {
        "material": material.name,
        "meshes": sorted(meshes),
        "allImageNodes": sorted((image_node_record(node) for node in nodes if node.type == "TEX_IMAGE"), key=lambda item: item["node"]),
        "surfaceReachableImageNodes": sorted(
            (image_node_record(node) for node in reachable if node.type == "TEX_IMAGE"), key=lambda item: item["node"]
        ),
        "surfaceReachableGroupNodes": sorted(node.name for node in reachable if node.type == "GROUP"),
    }


def main() -> None:
    mesh_materials: dict[str, set[str]] = {}
    for mesh in mobile_character_meshes():
        for slot in mesh.material_slots:
            if slot.material is not None:
                mesh_materials.setdefault(slot.material.name, set()).add(mesh.name)
    records = [material_record(bpy.data.materials[name], list(meshes)) for name, meshes in sorted(mesh_materials.items())]
    output = {
        "schema": "vozual.rig-material-audit",
        "schemaVersion": 1,
        "meshCount": len(mobile_character_meshes()),
        "materialCount": len(records),
        "materials": records,
    }
    path = output_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    multi_image = [item["material"] for item in records if len(item["surfaceReachableImageNodes"]) > 1]
    print(f"Material audit: {len(records)} materials, {len(multi_image)} with multiple surface-reachable image nodes")
    print(f"Output: {path}")


if __name__ == "__main__":
    main()
