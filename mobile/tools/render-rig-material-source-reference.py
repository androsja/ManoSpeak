"""Render a deterministic source-Blender material reference for Task 3.

Run with the licensed source blend open:

    blender --background source.blend --python tools/render-rig-material-source-reference.py -- reference.png

This changes only the temporary Blender session. Its camera and lights match
``render-rigged-avatar-hand-pose.py`` with the ``open`` pose so the source
reference can be compared to an exported GLB render.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, str]:
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1 :]
        output = Path(values[0]).expanduser().resolve()
    except (ValueError, IndexError) as error:
        raise RuntimeError("Pass output PNG path after --") from error
    if output.suffix.lower() != ".png":
        raise RuntimeError("Reference render output must be PNG")
    view = values[1] if len(values) == 2 else "hand"
    if len(values) > 2 or view not in {"hand", "upper-body"}:
        raise RuntimeError("Optional view must be hand or upper-body")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output, view


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_reference_scene(output: Path, view: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    # Match Blender's factory scene used by the imported-GLB renderer. The
    # source blend uses Filmic/High Contrast with exposure, which otherwise
    # makes a pixel comparison measure color management rather than materials.
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    for item in scene.objects:
        if item.type in {"CAMERA", "LIGHT"}:
            item.hide_render = True
    scene.world = bpy.data.worlds.new("Task3MaterialReferenceWorld")
    scene.world.color = (0.035, 0.055, 0.085)

    camera_data = bpy.data.cameras.new("Task3MaterialReferenceCamera")
    camera = bpy.data.objects.new("Task3MaterialReferenceCamera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    if view == "hand":
        camera_data.ortho_scale = 0.28
        camera.location = (0.65, -0.52, 1.14)
        target = Vector((0.65, 0.05, 1.14))
    else:
        camera_data.ortho_scale = 1.7
        camera.location = (0.0, -3.0, 1.35)
        target = Vector((0.0, 0.05, 1.25))
    point_camera(camera, target)
    scene.camera = camera

    for name, energy, size, location in (
        ("Task3MaterialReferenceKey", 420, 2.0, (0.65, -1.0, 1.55) if view == "hand" else (1.8, -2.0, 2.5)),
        ("Task3MaterialReferenceFill", 180, 1.5, (0.25, -0.45, 1.0) if view == "hand" else (-1.8, -1.8, 1.2)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = location
        point_camera(light, target)


def main() -> None:
    armature = bpy.data.objects.get("1_Rigify")
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError("The expected 1_Rigify source armature was not found")
    armature.data.pose_position = "REST"
    bpy.context.view_layer.update()
    output, view = arguments()
    configure_reference_scene(output, view)
    bpy.ops.render.render(write_still=True)
    print(f"VOZUAL source material reference: {output}")


if __name__ == "__main__":
    main()
