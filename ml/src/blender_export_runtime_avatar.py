"""Export authored Blender signs as skeletal clips in one runtime GLB."""

from __future__ import annotations

from pathlib import Path
import sys
import tempfile

import bpy


def action_curves(action: bpy.types.Action) -> list[bpy.types.FCurve]:
    """Return curves from both legacy and Blender 5 layered actions."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for channel_bag in strip.channelbags
        for curve in channel_bag.fcurves
    ]


def active_armature() -> bpy.types.Object:
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}.")
    return armatures[0]


def bake_clip(
    source_path: Path,
    frame_start: int,
    frame_end: int,
    clip_name: str,
    library_path: Path,
) -> None:
    """Bake constraint-driven motion into portable pose-bone keyframes."""
    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    armature = active_armature()
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.context.scene.frame_start = frame_start
    bpy.context.scene.frame_end = frame_end
    bpy.context.scene.frame_set(frame_start)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=frame_start,
        frame_end=frame_end,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        # The authored action contains the anatomical pose for the whole body,
        # while external constraints add the signing-arm motion. Replacing the
        # current action before sampling drops the first half and bakes the
        # unaffected arm in the rig's T-pose. Bake onto the current action so
        # both sources are evaluated together into portable bone transforms.
        use_current_action=True,
        clean_curves=True,
        bake_types={"POSE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    source_bake = armature.animation_data.action
    if source_bake is None:
        raise RuntimeError(f"Blender did not create the {clip_name} baked action.")

    # Authoring rigs mix Euler and quaternion rotation modes. A Blender scene
    # can evaluate that correctly, but glTF stores one rotation representation
    # per animated node. When clips authored with different modes are merged,
    # the exporter can silently discard the Euler-driven anatomical pose and
    # leave those limbs in the bind T-pose. Resample the already constraint-
    # baked matrices into one quaternion-only action before writing the clip.
    samples: dict[int, dict[str, tuple[object, object, object]]] = {}
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        samples[frame] = {
            bone.name: bone.matrix_basis.decompose() for bone in armature.pose.bones
        }

    armature.animation_data.action = None
    normalized = bpy.data.actions.new(clip_name)
    armature.animation_data.action = normalized
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
    for frame, frame_samples in samples.items():
        for bone in armature.pose.bones:
            location, rotation, scale = frame_samples[bone.name]
            bone.location = location
            bone.rotation_quaternion = rotation
            bone.scale = scale
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
            bone.keyframe_insert("scale", frame=frame, group=bone.name)
    for curve in action_curves(normalized):
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    bpy.data.actions.remove(source_bake)
    normalized.use_fake_user = True
    bpy.data.libraries.write(str(library_path), {normalized}, fake_user=True)


def make_idle(source: bpy.types.Action) -> bpy.types.Action:
    """Create a stable two-frame idle from the authored opening pose."""
    idle = source.copy()
    idle.name = "IDLE"
    for curve in action_curves(idle):
        value = curve.evaluate(1.0)
        while curve.keyframe_points:
            curve.keyframe_points.remove(curve.keyframe_points[-1], fast=True)
        curve.keyframe_points.insert(1.0, value)
        curve.keyframe_points.insert(2.0, value)
    return idle


def load_action(library_path: Path, clip_name: str) -> bpy.types.Action:
    with bpy.data.libraries.load(str(library_path), link=False) as (available, loaded):
        if clip_name not in available.actions:
            raise RuntimeError(f"{clip_name} was not found in {library_path}.")
        loaded.actions = [clip_name]
    action = loaded.actions[0]
    if action is None:
        raise RuntimeError(f"Could not load {clip_name} from {library_path}.")
    action.use_fake_user = True
    return action


def export_avatar(
    base_path: Path,
    hello_path: Path,
    thanks_path: Path,
    output_path: Path,
) -> None:
    with tempfile.TemporaryDirectory(prefix="vozual-skeletal-export-") as temp_dir:
        temp = Path(temp_dir)
        hello_library = temp / "hello_action.blend"
        thanks_library = temp / "thanks_action.blend"
        bake_clip(hello_path, 1, 33, "HOLA", hello_library)
        # Frames 42-53 are the authoring-only forced return to rest.
        bake_clip(thanks_path, 1, 41, "GRACIAS", thanks_library)

        bpy.ops.wm.open_mainfile(filepath=str(base_path))
        armature = active_armature()
        for item in bpy.data.objects:
            if item != armature and item.animation_data is not None:
                item.animation_data_clear()
            if item.type == "MESH" and item.data.shape_keys is not None:
                item.data.shape_keys.animation_data_clear()
        for bone in armature.pose.bones:
            for constraint in list(bone.constraints):
                bone.constraints.remove(constraint)
            bone.rotation_mode = "QUATERNION"
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)

        hello = load_action(hello_library, "HOLA")
        thanks = load_action(thanks_library, "GRACIAS")
        idle = make_idle(thanks)
        armature.animation_data_create()
        armature.animation_data.action = idle

        # Export only the skinned character. The authoring scene also contains
        # hidden calibration primitives (a cube and an icosphere); glTF exports
        # those unless selection is explicit, and they obscure the avatar on
        # mobile even though Blender excludes them from rendered previews.
        bpy.ops.object.select_all(action="DESELECT")
        armature.select_set(True)
        for child in armature.children_recursive:
            child.select_set(True)
        bpy.context.view_layer.objects.active = armature

        # The source character contains desktop-grade 4K textures. A signer is
        # shown at phone-screen size, so 1K preserves visible detail while
        # keeping startup time and APK size practical.
        for image in bpy.data.images:
            width, height = image.size
            longest = max(width, height)
            if longest > 1024:
                scale = 1024.0 / longest
                image.scale(max(1, round(width * scale)), max(1, round(height * scale)))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=str(output_path),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_merge_animation="ACTION",
            export_anim_single_armature=True,
            export_bake_animation=True,
            export_frame_range=True,
            export_frame_step=1,
            export_def_bones=True,
            export_skins=True,
            export_morph=True,
            export_lights=False,
            export_cameras=False,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_image_quality=72,
        )
        print(f"RUNTIME_AVATAR={output_path}")


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 4:
        raise SystemExit(
            "Usage: blender --background --python blender_export_runtime_avatar.py -- "
            "BASE.blend HOLA.blend GRACIAS.blend OUTPUT.glb"
        )
    export_avatar(*(Path(value).resolve() for value in arguments))
