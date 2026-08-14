"""Render a ManoSpeak Blender animation as numbered PNG preview frames."""

from __future__ import annotations

from pathlib import Path
import sys

import bpy


output_dir = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
output_dir.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.studio_light = "paint.sl"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(output_dir / "frame_")
bpy.ops.render.render(animation=True)
