"""Bake diffuse colour for every mobile character material into UV images.

This is a diagnostic export experiment, not an approved production conversion:
it preserves base colour only and does not preserve the source normal, roughness,
metallic, transmission, or other specialized shader behavior.

Run with the purchased source blend open in Blender:

    blender --background Blender.blend --python tools/bake-rig-materials.py -- output.glb
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import bpy


def arguments() -> Path:
    try:
        output = Path(sys.argv[sys.argv.index("--") + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass output GLB path after --") from error
    if output.suffix.lower() != ".glb":
        raise RuntimeError("Expected GLB output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def exporter_module():
    exporter_path = Path(__file__).resolve().parent / "prepare-rigged-avatar.py"
    spec = importlib.util.spec_from_file_location("prepare_rigged_avatar", exporter_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load standard exporter from {exporter_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bake_used_materials(meshes: list[bpy.types.Object]) -> dict[str, bpy.types.Image]:
    materials = {
        slot.material.name: slot.material
        for obj in meshes
        for slot in obj.material_slots
        if slot.material is not None
    }
    if not materials:
        raise RuntimeError("Selected character has no materials")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    images: dict[str, bpy.types.Image] = {}
    for name, material in sorted(materials.items()):
        if material.node_tree is None:
            raise RuntimeError(f"Material {name} has no node tree")
        image = bpy.data.images.new(
            f"TASK3_FULL_BAKE_{name}", width=1024, height=1024, alpha=True
        )
        images[name] = image
        target = material.node_tree.nodes.new("ShaderNodeTexImage")
        target.name = "TASK3_FULL_BAKE_TARGET"
        target.image = image
        for node in material.node_tree.nodes:
            node.select = False
        target.select = True
        material.node_tree.nodes.active = target

    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.context.view_layer.update()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
        print(f"Baked mesh: {obj.name}")
    return images


def use_baked_base_colour(images: dict[str, bpy.types.Image]) -> None:
    for name, image in sorted(images.items()):
        material = bpy.data.materials[name]
        tree = material.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        if name.startswith("NUG_Cornea_"):
            material.surface_render_method = "DITHERED"
            principled.inputs["Alpha"].default_value = 0.35
        tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        image.pack()


def main() -> None:
    destination = arguments()
    prepare = exporter_module()
    selected = prepare.select_mobile_character()
    prepare.validate_export_meshes()
    prepare.remove_unused_color_attributes()
    prepare.preserve_deform_arm_hierarchy()
    meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.select_get()
    ]
    armature = bpy.data.objects.get("1_Rigify")
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError("The expected 1_Rigify armature was not found")

    images = bake_used_materials(meshes)
    use_baked_base_colour(images)
    prepare.resize_embedded_textures(1024)
    prepare.preserve_deform_arm_hierarchy()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
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
        export_jpeg_quality=90,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_yup=True,
    )
    print(f"Baked materials: {len(images)}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"Diagnostic GLB: {destination} ({destination.stat().st_size / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    main()
