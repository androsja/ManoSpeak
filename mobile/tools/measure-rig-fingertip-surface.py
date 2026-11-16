"""Compare imported terminal bone tails with digit-weighted skin vertices in rest pose.

Run with Blender: --python tools/measure-rig-fingertip-surface.py -- candidate.glb expected-sha256 report.json
The furthest dominant-weight vertex is a reproducible proxy, not a certified fingertip.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy


def main():
    asset, expected, destination = sys.argv[sys.argv.index('--') + 1:]
    asset = Path(asset)
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    if digest != expected:
        raise RuntimeError('Candidate hash mismatch')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name == 'NUG_Base_Body']
    if len(rigs) != 1 or len(meshes) != 1:
        raise RuntimeError('Expected one armature and one body mesh')
    rig, body = rigs[0], meshes[0]
    group_names = {group.index: group.name for group in body.vertex_groups}
    records = []
    for side in ('L', 'R'):
        for digit in ('thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'):
            name = f'DEF-{digit}.03.{side}'
            bone = rig.data.bones[name]
            head = rig.matrix_world @ bone.head_local
            tail = rig.matrix_world @ bone.tail_local
            direction = (tail - head).normalized()
            candidates = []
            for vertex in body.data.vertices:
                weights = [(entry.weight, group_names.get(entry.group, '')) for entry in vertex.groups]
                if not weights or max(weights)[1] != name:
                    continue
                point = body.matrix_world @ vertex.co
                candidates.append(((point - head).dot(direction), vertex.index, point))
            if not candidates:
                raise RuntimeError(f'No dominant vertices for {name}')
            projection, index, point = max(candidates, key=lambda entry: (entry[0], -entry[1]))
            records.append({'bone': name, 'dominantVertexCount': len(candidates),
                            'proxyVertexIndex': index, 'proxyAxialDistanceM': round(projection, 9),
                            'importedBoneLengthM': round((tail - head).length, 9),
                            'tailToProxyDistanceM': round((point - tail).length, 9)})
    report = {'schema': 'vozual.rig-fingertip-surface-audit', 'schemaVersion': 1,
              'candidateSha256': digest, 'blenderVersion': bpy.app.version_string,
              'records': records, 'scope': 'rest-pose dominant-terminal-bone body vertices',
              'limitations': ['Furthest axial vertex is a proxy, not a reviewed fingertip landmark',
                              'No posed deformation, collision or anatomical limits tested']}
    Path(destination).write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'digits; SHA-256', hashlib.sha256(Path(destination).read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
