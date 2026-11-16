"""Measure scoped same-hand collisions in discrete multi-finger poses.

Run Blender with -- candidate.glb output.json. This is not a safe range.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def main():
    candidate, output = map(Path, (arg for arg in sys.argv[sys.argv.index('--') + 1:] if arg != '--transition'))
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Candidate checksum mismatch')
    checker_path = Path(__file__).with_name('verify-rig-finger-intersections.py')
    spec = importlib.util.spec_from_file_location('finger_checker', checker_path)
    checker = importlib.util.module_from_spec(spec)
    original = sys.argv
    try:
        sys.argv = [str(checker_path), '--', str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = original
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one armature')
    rig = rigs[0]
    body = checker.candidate_body()
    categories = checker.category_by_vertex(body)
    records = []
    transition = '--transition' in sys.argv
    poses = [(step / 10, 0.025 * step / 10) for step in range(11)] if transition else (
        (0.25, 0), (0.5, 0), (0.625, 0), (0.75, 0), (0.875, 0), (1.0, 0),
        (0.625, 0.1), (0.75, 0.1), (1.0, 0.1), (0.625, -0.1), (0.75, -0.1),
        (1.0, -0.1), (0.625, 0.025), (0.75, 0.025), (1.0, 0.025))
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for scale, spread in poses:
            for bone in rig.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            for digit in ('f_index', 'f_middle', 'f_ring', 'f_pinky'):
                for segment, angle in zip(('01', '02', '03'), (0.15, 0.20, 0.15)):
                    bone = rig.pose.bones[f'DEF-{digit}.{segment}.{suffix}']
                    bone.rotation_mode = 'XYZ'
                    bone.rotation_euler = (angle * scale, 0, 0)
                    if segment == '01' and digit in ('f_middle', 'f_ring'):
                        bone.rotation_euler.z = spread * (1 if digit == 'f_middle' else -1) * (1 if side == 'left' else -1)
            bpy.context.view_layer.update()
            collisions = {}
            for digit in ('index', 'middle', 'ring', 'pinky', 'thumb'):
                found = checker.evaluate_intersections(body, categories, f'{side}-{digit}')
                collisions[digit] = {'count': len(found), 'categories': sorted({label for label, _ in found})}
            record = {'side': side, 'scale': scale, 'proximalSpreadRadians': spread, 'collisions': collisions}
            if transition:
                triangle_count, seam_overlaps = checker.evaluate_hand_transition_intersections(
                    body, categories, checker.hand_weight_by_vertex(body, side), side)
                record['mixedHandBodySeam'] = {'triangleCount': triangle_count, 'overlapCount': len(seam_overlaps)}
            records.append(record)
    report = {'schema': 'vozual.rig-coupled-finger-audit', 'schemaVersion': 1,
              'candidateSha256': digest, 'blenderVersion': bpy.app.version_string,
              'baseRotationRadians': [0.15, 0.20, 0.15],
              'probeMode': 'sampled-linear-transition' if transition else 'discrete-poses', 'records': records,
              'limitations': ['Dominant-weight finger checks and optional mixed hand/body seam; non-adjacent BVH overlaps only',
                  'Thumb remains at rest; no inter-hand, garment, motion-path or whole-body check',
                  'Discrete samples are not safe intervals or approved signs']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'combined poses; SHA-256', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
