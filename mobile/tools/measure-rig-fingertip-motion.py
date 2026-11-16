"""Measure fixed skin-proxy and imported bone-tail response to isolated rotations.

Run in Blender with: -- candidate.glb proxy-report.json output.json
This is a bounded geometric probe, not a sign or joint-limit validation.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def main():
    asset_path, proxy_path, output_path = map(Path, sys.argv[sys.argv.index('--') + 1:])
    proxy = json.loads(proxy_path.read_text())
    asset_digest = hashlib.sha256(asset_path.read_bytes()).hexdigest()
    if proxy.get('schema') != 'vozual.rig-fingertip-surface-audit' or proxy['candidateSha256'] != asset_digest:
        raise RuntimeError('Proxy report and candidate do not match')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset_path.resolve()))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name == 'NUG_Base_Body']
    if len(rigs) != 1 or len(bodies) != 1 or len(proxy['records']) != 10:
        raise RuntimeError('Expected one rig, one body, and ten proxy records')
    rig, body = rigs[0], bodies[0]

    def sample(bone, vertex_index):
        bpy.context.view_layer.update()
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            if len(mesh.vertices) != len(body.data.vertices):
                raise RuntimeError('Evaluated topology differs from proxy source')
            return rig.matrix_world @ bone.tail, evaluated.matrix_world @ mesh.vertices[vertex_index].co
        finally:
            evaluated.to_mesh_clear()

    records = []
    for record in proxy['records']:
        bone = rig.pose.bones[record['bone']]
        index = record['proxyVertexIndex']
        if not isinstance(index, int) or not 0 <= index < len(body.data.vertices):
            raise RuntimeError('Invalid proxy vertex')
        for pose_bone in rig.pose.bones:
            pose_bone.matrix_basis = Matrix.Identity(4)
        rest_tail, rest_skin = sample(bone, index)
        probes = []
        for axis in (0, 2):
            for sign in (-1, 1):
                bone.rotation_mode = 'XYZ'
                bone.rotation_euler = (0, 0, 0)
                bone.rotation_euler[axis] = sign * math.radians(10)
                posed_tail, posed_skin = sample(bone, index)
                tail_delta = posed_tail - rest_tail
                skin_delta = posed_skin - rest_skin
                probes.append({'axis': 'xz'[axis // 2], 'degrees': sign * 10,
                    'tailDisplacementM': round(tail_delta.length, 9),
                    'skinDisplacementM': round(skin_delta.length, 9),
                    'displacementDifferenceM': round((tail_delta - skin_delta).length, 9),
                    'tailToSkinDistanceM': round((posed_tail - posed_skin).length, 9)})
        bone.matrix_basis = Matrix.Identity(4)
        records.append({'bone': bone.name, 'proxyVertexIndex': index,
                        'restTailToSkinM': round((rest_tail - rest_skin).length, 9), 'probes': probes})
    report = {'schema': 'vozual.rig-fingertip-motion-audit', 'schemaVersion': 1,
              'candidateSha256': asset_digest, 'proxyReportSha256': hashlib.sha256(proxy_path.read_bytes()).hexdigest(),
              'blenderVersion': bpy.app.version_string, 'records': records,
              'scope': 'isolated terminal bone local X/Z +/-10 degrees; fixed dominant-weight skin vertex',
              'limitations': ['Skin vertex is a proxy, not an approved fingertip',
                  'No collision, source-export comparison, anatomical limits, or coupled poses tested']}
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'digits, 40 probes; SHA-256', hashlib.sha256(output_path.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
