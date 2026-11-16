"""Measure isolated signed bone-tail responses in rest-pose hand frames.

Usage: blender --background --python-exit-code 1 --python this.py -- profile.json candidate.glb report.json
Imported glTF terminal tails may be synthesized by Blender; they are not skin endpoints.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def main():
    profile_path, candidate_path, output_path = map(Path, sys.argv[sys.argv.index('--') + 1:])
    profile = json.loads(profile_path.read_text())
    digest = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
    if digest != profile['asset']['candidateSha256']:
        raise RuntimeError('Candidate checksum mismatch')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one armature')
    rig = rigs[0]
    inventory = profile['descriptor']['boneInventory']['restAxesInventory']['bones']
    frames = profile['descriptor']['coordinateCalibration']['hand']
    records = []
    for side, label in [('L', 'left'), ('R', 'right')]:
        axes = frames[label]['axes']
        # glTF (x,y,z) -> Blender world (x,-z,y).
        frame = {name: Vector((v[0], -v[2], v[1])).normalized() for name, v in axes.items()}
        for digit in ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky']:
            for segment in ['01', '02', '03']:
                name = f'DEF-{digit}.{segment}.{side}'
                if name not in inventory or name not in rig.pose.bones:
                    raise RuntimeError(f'Missing declared bone {name}')
                bone = rig.pose.bones[name]
                for pose_bone in rig.pose.bones:
                    pose_bone.matrix_basis = Matrix.Identity(4)
                bpy.context.view_layer.update()
                rest = rig.matrix_world @ bone.tail
                measurements = {}
                for axis_index, axis in enumerate('xyz'):
                    for sign in [-1, 1]:
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = [0, 0, 0]
                        bone.rotation_euler[axis_index] = sign * math.radians(10)
                        bpy.context.view_layer.update()
                        delta = (rig.matrix_world @ bone.tail) - rest
                        measurements[f'{axis}{sign:+d}'] = {
                            'deltaHandFrameM': [round(delta.dot(frame[k]), 9) for k in 'xyz'],
                            'distanceM': round(delta.length, 9),
                        }
                bone.matrix_basis = Matrix.Identity(4)
                records.append({'bone': name, 'terminal': segment == '03',
                    'endpoint': 'imported-bone-tail-not-verified-skin-tip', 'probes': measurements})
    report = {'schema': 'vozual.rig-palm-axis-probes', 'schemaVersion': 1,
        'profileDeclaredSha256': profile['sha256'], 'candidateSha256': digest,
        'blenderVersion': bpy.app.version_string, 'probeDegrees': 10, 'bones': records,
        'scope': 'isolated local Euler probes, fixed calibrated rest hand frames',
        'limitations': ['Profile checksum must be separately validated with repository canonical verifier',
            'Imported bone tails are not independently validated skin endpoints',
            'No anatomical labels, joint limits, collision checks, or combined poses inferred']}
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured bones:', len(records), 'report SHA-256:', hashlib.sha256(output_path.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
