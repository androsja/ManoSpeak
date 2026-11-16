"""Probe isolated digit bone rotations against same-hand skin triangles.

Run in Blender with -- candidate.glb report.json. Discrete geometry samples do
not define anatomical joint limits, continuous ranges, or coupled safety.
"""
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def main():
    arguments = sys.argv[sys.argv.index('--') + 1:]
    dense = '--dense' in arguments
    angle_argument = next((arg for arg in arguments if arg.startswith('--angles=')), None)
    positional = [arg for arg in arguments if arg != '--dense' and not arg.startswith('--angles=')]
    if len(positional) != 2:
        raise RuntimeError('Usage: candidate.glb output.json [--dense | --angles=-10,10]')
    candidate, output = map(Path, positional)
    if dense and angle_argument:
        raise RuntimeError('Choose either --dense or --angles')
    degree_angles = None
    if angle_argument:
        try:
            degree_angles = tuple(float(value) for value in angle_argument.split('=', 1)[1].split(','))
        except ValueError as error:
            raise RuntimeError('--angles must be comma-separated finite degrees') from error
        if not degree_angles or any(not math.isfinite(value) or abs(value) > 180 for value in degree_angles):
            raise RuntimeError('--angles must contain finite degrees in [-180,180]')
        if len(set(degree_angles)) != len(degree_angles):
            raise RuntimeError('--angles must not contain duplicates')
    asset_sha = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if asset_sha != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Unexpected candidate')
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
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one armature')
    rig, body = rigs[0], checker.candidate_body()
    categories = checker.category_by_vertex(body)
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for digit in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            prefix = 'thumb' if digit == 'thumb' else 'f_' + digit
            for segment in ('01', '02', '03'):
                name = f'DEF-{prefix}.{segment}.{suffix}'
                for axis in range(3):
                    if degree_angles is not None:
                        angles = tuple(math.radians(value) for value in degree_angles)
                    else:
                        angles = tuple(round(step * 0.025, 6) for step in range(-8, 9)) if dense else (-0.2, -0.1, 0.1, 0.2)
                    for angle in angles:
                        for pose_bone in rig.pose.bones:
                            pose_bone.matrix_basis = Matrix.Identity(4)
                        bone = rig.pose.bones[name]
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = (0, 0, 0)
                        bone.rotation_euler[axis] = angle
                        bpy.context.view_layer.update()
                        hits = checker.evaluate_intersections(body, categories, f'{side}-{digit}')
                        records.append({'bone': name, 'axis': 'xyz'[axis], 'radians': angle,
                            'overlapCount': len(hits), 'categories': sorted({label for label, _ in hits})})
    sampling = (f'exact signed degree samples {degree_angles}' if degree_angles is not None else
        '17 points from -0.2 to 0.2 rad, step 0.025' if dense else 'four signed samples')
    report = {'schema': 'vozual.rig-per-bone-probes', 'schemaVersion': 1,
        'candidateSha256': asset_sha, 'blenderVersion': bpy.app.version_string,
        'records': records, 'scope': 'one isolated local rotation, rest of armature reset',
        'sampling': sampling,
        'limitations': ['Dominant-weight same-hand non-adjacent triangles only',
            'No combined joints, continuous paths, mixed-weight, garment or inter-hand coverage',
            'Passing samples do not establish anatomical or collision-free limits']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'isolated samples; SHA-256', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
