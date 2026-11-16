"""Probe thumb local axes against a fixed four-finger diagnostic configuration.

Run in Blender with -- candidate.glb report.json. Samples are not anatomical limits.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def main():
    candidate, output = map(Path, (arg for arg in sys.argv[sys.argv.index('--') + 1:] if arg not in ('--distal', '--thumb-z-sweep', '--thumb-transition')))
    transition = '--thumb-transition' in sys.argv
    sweep = '--thumb-z-sweep' in sys.argv
    distal = '--distal' in sys.argv or sweep or transition
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Candidate checksum mismatch')
    path = Path(__file__).with_name('verify-rig-finger-intersections.py')
    spec = importlib.util.spec_from_file_location('finger_checker', path)
    checker = importlib.util.module_from_spec(spec)
    old = sys.argv
    try:
        sys.argv = [str(path), '--', str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = old
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one rig')
    rig, body = rigs[0], checker.candidate_body()
    categories = checker.category_by_vertex(body)
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for axis in ((0,) if distal else (0, 1, 2)):
            for angle in ((tuple(step / 10 for step in range(11))) if transition else (-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2) if sweep else (0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0) if distal else (-0.1, -0.05, 0, 0.05, 0.1)):
                for bone in rig.pose.bones:
                    bone.matrix_basis = Matrix.Identity(4)
                for digit in ('f_index', 'f_middle', 'f_ring', 'f_pinky'):
                    for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                        bone = rig.pose.bones[f'DEF-{digit}.{segment}.{suffix}']
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = (flex * angle if transition else flex, 0, 0)
                        if segment == '01' and digit in ('f_middle', 'f_ring'):
                            bone.rotation_euler.z = 0.025 * (angle if transition else 1) * (1 if digit == 'f_middle' else -1) * (1 if side == 'left' else -1)
                for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                    thumb = rig.pose.bones[f'DEF-thumb.{segment}.{suffix}']
                    thumb.rotation_mode = 'XYZ'
                    thumb.rotation_euler = (0, 0, 0)
                    if transition:
                        thumb.rotation_euler.x = flex * angle
                        if segment == '01':
                            thumb.rotation_euler.z = (0.2 if side == 'left' else -0.1) * angle
                    elif sweep:
                        thumb.rotation_euler.x = flex
                        if segment == '01':
                            thumb.rotation_euler.z = angle
                    elif distal:
                        thumb.rotation_euler.x = flex * angle
                    elif segment == '01':
                        thumb.rotation_euler[axis] = angle
                bpy.context.view_layer.update()
                collisions = {}
                for digit in ('thumb', 'index', 'middle', 'ring', 'pinky'):
                    hits = checker.evaluate_intersections(body, categories, f'{side}-{digit}')
                    collisions[digit] = {'overlapCount': len(hits),
                        'categories': sorted({label for label, _ in hits})}
                records.append({'side': side, 'axis': 'xyz'[axis],
                    'phase' if transition else 'proximalZRadians' if sweep else 'scale' if distal else 'angleRadians': angle,
                    'collisions': collisions})
    report = {'schema': 'vozual.rig-thumb-coupling-audit', 'schemaVersion': 1,
        'candidateSha256': digest, 'blenderVersion': bpy.app.version_string, 'records': records,
        'scope': '11 sampled linear phases with side-specific thumb Z correction' if transition else 'three-segment thumb X curl with proximal Z sweep' if sweep else 'three-segment thumb local X scaled rotations' if distal else 'proximal thumb isolated local rotations with fixed flexed four-finger pose',
        'limitations': ['Dominant-weight same-hand triangles and non-adjacent BVH overlaps only',
            'No arbitrary thumb poses, trajectory, inter-hand, garment or mixed-finger triangles',
            'Discrete geometric samples do not establish anatomical axes or safe limits']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'samples; SHA-256', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
