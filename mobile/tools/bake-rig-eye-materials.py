"""Bake source eye materials into UV textures and export an experimental GLB.

    blender --background source.blend --python tools/bake-rig-eye-materials.py -- output.glb

The source blend is used only in the current Blender process. This experiment
bakes color only; it does not certify transparency, normals, or appearance in
all lighting and poses.
"""

from __future__ import annotations

import sys
import importlib.util
from pathlib import Path

import bpy


EYE_MATERIALS = {"NUG_Eye_L", "NUG_Eye_R", "NUG_Cornea_L", "NUG_Cornea_R"}


def arguments() -> Path:
    try:
        output = Path(sys.argv[sys.argv.index("--") + 1]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass output GLB path after --") from error
    if output.suffix.lower() != ".glb":
        raise RuntimeError("Expected GLB output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def bake_eye_materials() -> list[str]:
    body = bpy.data.objects.get("NUG_Base_Eye")
    if body is None or body.type != "MESH" or not body.data.uv_layers:
        raise RuntimeError("NUG_Base_Eye mesh with UV coordinates is required")
    materials = [material for material in body.data.materials if material and material.name in EYE_MATERIALS]
    if {material.name for material in materials} != EYE_MATERIALS:
        raise RuntimeError("Expected all four eye/cornea source materials")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    # A modest diagnostic bake keeps iteration practical. The final export
    # path must choose resolution/quality only after visual review.
    scene.cycles.samples = 8
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    images = {}
    for material in materials:
        image = bpy.data.images.new(f"TASK3_Baked_{material.name}", width=512, height=512, alpha=False)
        images[material.name] = image
        tree = material.node_tree
        if tree is None:
            raise RuntimeError(f"Source material {material.name} has no node tree")
        node = tree.nodes.new("ShaderNodeTexImage")
        node.name = f"TASK3_BAKE_TARGET_{material.name}"
        node.image = image
        for other in tree.nodes:
            other.select = False
        node.select = True
        tree.nodes.active = node

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for item in bpy.context.view_layer.objects:
        item.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.context.view_layer.update()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})

    for material in materials:
        tree = material.node_tree
        image = images[material.name]
        tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        if material.name.startswith("NUG_Cornea_"):
            material.surface_render_method = "DITHERED"
            principled.inputs["Alpha"].default_value = 0.35
        tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        image.pack()
    return sorted(EYE_MATERIALS)


def main() -> None:
    destination = arguments()
    baked = bake_eye_materials()
    # Use the same in-memory mesh repairs, export selection and deform hierarchy
    # as the standard avatar exporter; only the eye material path differs.
    tools_dir = Path(__file__).resolve().parent
    exporter_path = tools_dir / "prepare-rigged-avatar.py"
    spec = importlib.util.spec_from_file_location("prepare_rigged_avatar", exporter_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load standard exporter from {exporter_path}")
    prepare_rigged_avatar = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare_rigged_avatar)

    selected = prepare_rigged_avatar.select_mobile_character()
    prepare_rigged_avatar.validate_export_meshes()
    prepare_rigged_avatar.remove_unused_color_attributes()
    prepare_rigged_avatar.resize_embedded_textures(256)
    prepare_rigged_avatar.preserve_deform_arm_hierarchy()
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
    print(f"Baked eye materials: {', '.join(baked)}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"Experimental baked GLB: {destination} ({destination.stat().st_size / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    main()
