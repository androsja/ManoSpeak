"""Measure ten bone-tail endpoints in the fixed neutral body frame.

Run Blender with -- candidate.glb build3-contract.json report.json.
These values are observations, not validated human fingertip locations.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    asset, contract_path, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
    candidate_sha = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a'
    profile_sha = 'c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d'
    if sha(asset) != candidate_sha or sha(contract_path) != '091c9eaa518bf9077b502f330c3e4b0b854d474d173964eb59db47cfc913b8e3':
        raise RuntimeError('Asset or contract checksum mismatch')
    contract = json.loads(contract_path.read_text())
    if contract['candidateSha256'] != candidate_sha or contract['profileSha256'] != profile_sha:
        raise RuntimeError('Contract binding mismatch')
    module_path = Path(__file__).with_name('measure-rig-coordinate-contract.py')
    spec = importlib.util.spec_from_file_location('coordinate_measurement', module_path)
    coordinate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(coordinate)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset.resolve()))
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one armature')
    rig = rigs[0]
    head = lambda name: coordinate.world_head(rig, name)
    body = coordinate.orthonormal_frame((head('DEF-upper_arm.L') + head('DEF-upper_arm.R')) / 2,
        head('DEF-upper_arm.L') - head('DEF-upper_arm.R'),
        head('DEF-spine.006') - head('DEF-spine.003'))
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        pose_id = f'corrected-hand-diagnostic-{side}-v1'
        configurations = [pose for pose in contract['configurations'] if pose['id'] == pose_id]
        if len(configurations) != 1:
            raise RuntimeError(f'Missing unique pose {pose_id}')
        for bone in rig.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
        for name, rotation in configurations[0]['rotationCommandsRad'].items():
            bone = rig.pose.bones[name]
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = rotation
        bpy.context.view_layer.update()
        for digit in ('thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'):
            bone = rig.pose.bones[f'DEF-{digit}.03.{suffix}']
            point = rig.matrix_world @ bone.tail
            records.append({'poseId': pose_id, 'bone': bone.name,
                'bodyPositionM': coordinate.body_coordinates(point, body)})
    report = {'schema': 'vozual.corrected-hand-endpoint-observations', 'schemaVersion': 1,
        'profileSha256': profile_sha, 'candidateSha256': candidate_sha,
        'contractFileSha256': sha(contract_path), 'blenderVersion': bpy.app.version_string,
        'referenceFrame': 'neutral-rest-body-frame', 'records': records,
        'limitations': ['Bone tail observations, not certified skin landmarks',
            'No tolerance, anatomical approval, continuous path or solver reachability established']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'endpoints; SHA-256', sha(output))


if __name__ == '__main__':
    main()
