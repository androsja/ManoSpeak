"""Export the licensed VOZUAL character as an Android-ready GLB.

Run with Blender, not the system Python:

    blender --background <source.blend> --python tools/prepare-rigged-avatar.py -- <output.glb>

The purchased source file is never modified. Only renderable meshes and the
deformation skeleton are exported; cameras, lights, Rigify controls and lower
body footwear are intentionally omitted from the mobile asset.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


def arguments() -> tuple[Path, int, bool, bool, bool, float]:
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1 :]
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass the output GLB path after --") from error
    parser = argparse.ArgumentParser(description="Export an Android-ready VOZUAL GLB")
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--max-texture-size",
        type=int,
        default=1024,
        choices=(256, 512, 1024),
        help="Maximum width or height for each embedded texture.",
    )
    parser.add_argument(
        "--strip-textures",
        action="store_true",
        help="Export material colours without image textures for renderer profiling.",
    )
    parser.add_argument(
        "--base-colour-textures-only",
        action="store_true",
        help="Retain only diffuse image nodes for a mobile material-profile experiment.",
    )
    parser.add_argument(
        "--eye-diffuse-material-experiment",
        action="store_true",
        help="Rebuild eye/cornea materials from their side-specific diffuse maps for a non-binding experiment.",
    )
    parser.add_argument(
        "--eye-cornea-alpha",
        type=float,
        default=0.35,
        help="Cornea alpha for the eye-only material experiment (0 to 1).",
    )
    parsed = parser.parse_args(values)
    requested = parsed.output.expanduser().resolve()
    requested.parent.mkdir(parents=True, exist_ok=True)
    texture_modes = sum((parsed.strip_textures, parsed.base_colour_textures_only, parsed.eye_diffuse_material_experiment))
    if texture_modes > 1:
        parser.error("Texture experiment flags cannot be combined")
    if not 0.0 <= parsed.eye_cornea_alpha <= 1.0:
        parser.error("--eye-cornea-alpha must be between 0 and 1")
    return (
        requested,
        parsed.max_texture_size,
        parsed.strip_textures,
        parsed.base_colour_textures_only,
        parsed.eye_diffuse_material_experiment,
        parsed.eye_cornea_alpha,
    )


def select_mobile_character() -> list[str]:
    # Some Rigify widget objects are stored outside the visible scene and are
    # still followed by the glTF dependency graph. Remove them only from this
    # in-memory export copy so they cannot cover the avatar at runtime.
    for item in list(bpy.data.objects):
        if item.name.startswith("WGT-") or item.name in {"Cube", "Icosphere"}:
            bpy.data.objects.remove(item, do_unlink=True)
    view_layer = bpy.context.scene.view_layers[0]
    for item in list(view_layer.objects):
        if item is None:
            continue
        item.select_set(False, view_layer=view_layer)
    selected: list[str] = []
    unsupported_transparency_meshes = {
        # Character Creator relies on Blender-only shaders for these two
        # overlays. In glTF they become opaque gray shells in front of the
        # real textured eyes, so the mobile character must use the underlying
        # eye and cornea geometry directly.
        "NUG_Base_EyeONUGlusion",
        "NUG_Base_TearLine",
    }
    for item in bpy.context.scene.objects:
        is_armature = item.type == "ARMATURE" and item.name == "1_Rigify"
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
            # Rigify controller widgets are Blender editor aids, not character
            # geometry. Clear their references so the exporter cannot pull a
            # large cube/icosphere into the Android scene.
            for pose_bone in item.pose.bones:
                pose_bone.custom_shape = None
    selected_names = set(selected)
    # The glTF exporter may follow stale Rigify object references even when
    # those helpers are not selected. The source file is only an in-memory
    # export copy, so remove every remaining non-character object explicitly.
    for item in list(bpy.data.objects):
        if item.name not in selected_names:
            bpy.data.objects.remove(item, do_unlink=True)
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


def validate_export_meshes() -> list[str]:
    """Repair invalid mesh data in the in-memory export copy only."""
    repaired: list[str] = []
    for item in bpy.context.scene.objects:
        if item.type != "MESH" or not item.select_get():
            continue
        if item.data.validate(clean_customdata=False):
            item.data.update()
            repaired.append(item.name)
    return repaired


def remove_unused_color_attributes() -> int:
    """Remove only mesh color attributes not referenced by any exported material."""
    referenced: set[str] = set()
    for material in bpy.data.materials:
        if not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type == "VERTEX_COLOR" and node.layer_name:
                referenced.add(node.layer_name)
            elif node.type == "ATTRIBUTE" and node.attribute_name:
                referenced.add(node.attribute_name)
    removed = 0
    for item in bpy.context.scene.objects:
        if item.type != "MESH" or not item.select_get():
            continue
        for attribute in list(item.data.color_attributes):
            if attribute.name in referenced:
                continue
            item.data.color_attributes.remove(attribute)
            removed += 1
        item.data.update()
    return removed


def strip_image_textures() -> int:
    removed = 0
    for material in bpy.data.materials:
        if not material.use_nodes or not material.node_tree:
            continue
        nodes = material.node_tree.nodes
        for node in list(nodes):
            if node.type != "TEX_IMAGE":
                continue
            nodes.remove(node)
            removed += 1
    return removed


def retain_base_colour_textures() -> int:
    removed = 0
    for material in bpy.data.materials:
        if not material.use_nodes or not material.node_tree:
            continue
        nodes = material.node_tree.nodes
        for node in list(nodes):
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            if "diffuse" in node.image.name.lower():
                continue
            nodes.remove(node)
            removed += 1
    return removed


def rebuild_eye_diffuse_materials(cornea_alpha: float = 0.35) -> list[str]:
    rebuilt: list[str] = []
    for material in bpy.data.materials:
        if material.name not in {"NUG_Cornea_L", "NUG_Cornea_R", "NUG_Eye_L", "NUG_Eye_R"} or not material.node_tree:
            continue
        maps = sorted(
            [node.image for node in material.node_tree.nodes
             if node.type == "TEX_IMAGE" and node.image and "DIFFUSE" in f"{node.name} {node.image.name}".upper()],
            key=lambda image: image.name,
        )
        if len(maps) != 1:
            raise RuntimeError(f"Expected exactly one diffuse map for {material.name}, found {len(maps)}")
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = maps[0]
        links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        if material.name.startswith("NUG_Cornea_"):
            material.surface_render_method = "DITHERED"
            principled.inputs["Alpha"].default_value = cornea_alpha
        rebuilt.append(material.name)
    return rebuilt


def preserve_deform_arm_hierarchy() -> None:
    """Make the exported deform chain self-contained without saving the source rig.

    Rigify's DEF arm and facial bones are parented through ORG/control bones.
    Those intermediates are deliberately excluded by ``export_def_bones``;
    without explicit DEF parents, the glTF exporter promotes shoulders and
    facial articulators to roots. The in-memory reparenting retains rest
    transforms while keeping the exported runtime hierarchy connected.
    """
    armature = bpy.data.objects.get("1_Rigify")
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError("The expected Rigify armature was not found")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones
    spine = bones.get("DEF-spine.003")
    head = bones.get("DEF-spine.006")
    if spine is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("DEF-spine.003 is required for exported arm hierarchy")
    if head is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("DEF-spine.006 is required for exported facial hierarchy")
    face_prefixes = (
        "DEF-brow.",
        "DEF-cheek.",
        "DEF-forehead.",
        "DEF-temple.",
        "DEF-ear.",
        "DEF-jaw",
        "DEF-chin",
        "DEF-tongue",
        "DEF-eye.",
        "DEF-lid.",
        "DEF-lip.",
        "DEF-nose",
        "DEF-teeth.",
    )
    repaired_face = 0
    for bone in bones:
        if bone.name.startswith(face_prefixes):
            bone.parent = head
            bone.use_connect = False
            repaired_face += 1
    if repaired_face == 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("No facial deform bones were found for export")
    for side in ("L", "R"):
        names = (
            f"DEF-shoulder.{side}",
            f"DEF-upper_arm.{side}",
            f"DEF-upper_arm.{side}.001",
            f"DEF-forearm.{side}",
            f"DEF-forearm.{side}.001",
            f"DEF-hand.{side}",
        )
        chain = [bones.get(name) for name in names]
        missing = [name for name, bone in zip(names, chain) if bone is None]
        if missing:
            raise RuntimeError(f"Missing exported deform arm bones: {', '.join(missing)}")
        chain[0].parent = spine
        for parent, child in zip(chain, chain[1:]):
            child.parent = parent
        for bone in chain:
            bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"Facial deform bones parented to DEF-spine.006: {repaired_face}")


def main() -> None:
    destination, maximum_texture_size, strip_textures, base_colour_textures_only, eye_diffuse_material_experiment, eye_cornea_alpha = arguments()
    selected = select_mobile_character()
    repaired_meshes = validate_export_meshes()
    removed_color_attributes = remove_unused_color_attributes()
    resized = resize_embedded_textures(maximum_texture_size)
    removed_textures = (
        strip_image_textures()
        if strip_textures
        else retain_base_colour_textures()
        if base_colour_textures_only
        else 0
    )
    rebuilt_eye_materials = rebuild_eye_diffuse_materials(eye_cornea_alpha) if eye_diffuse_material_experiment else []
    if "1_Rigify" not in selected:
        raise RuntimeError("The expected Rigify armature was not found")
    preserve_deform_arm_hierarchy()

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_def_bones=True,
        export_armature_object_remove=False,
        export_animations=False,
        # This source contains hundreds of unused Character Creator shape
        # keys. VOZUAL drives the supplied facial deform bones instead, so
        # shipping those duplicate vertex targets would add tens of MB.
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
    size_mb = destination.stat().st_size / (1024 * 1024)
    print(f"VOZUAL mobile avatar: {destination}")
    print(f"Selected objects: {', '.join(selected)}")
    print(f"Validated meshes: {', '.join(repaired_meshes) if repaired_meshes else 'none'}")
    print(f"Removed unused color attributes: {removed_color_attributes}")
    print(f"Maximum texture size: {maximum_texture_size}px")
    print(f"Resized textures: {resized}")
    print(f"Stripped texture nodes: {removed_textures}")
    print(f"Eye material experiment: {', '.join(rebuilt_eye_materials) if rebuilt_eye_materials else 'none'}")
    if eye_diffuse_material_experiment:
        print(f"Eye cornea alpha: {eye_cornea_alpha:.3f}")
    print(f"GLB size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
