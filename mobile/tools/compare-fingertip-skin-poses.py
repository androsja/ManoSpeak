"""Compare source/export fingertip-region skin under identical transferred bone poses.

Run Blender with -- source.zip candidate.glb proxy-report.json output.json.
Rest nearest vertices are geometric correspondences, not anatomical landmarks.
"""
import hashlib
import json
import math
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree

SOURCE_SHA = 'a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96'
CANDIDATE_SHA = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rig_and_body():
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name == 'NUG_Base_Body']
    if len(rigs) != 1 or len(bodies) != 1:
        raise RuntimeError('Expected one rig and body')
    return rigs[0], bodies[0]


def points(body):
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(body.data.vertices):
            raise RuntimeError('Evaluated topology differs from original mesh')
        return [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def main():
    archive_path, candidate_path, proxy_path, report_path = map(Path, sys.argv[sys.argv.index('--') + 1:])
    if sha(archive_path) != SOURCE_SHA or sha(candidate_path) != CANDIDATE_SHA:
        raise RuntimeError('Source or candidate checksum mismatch')
    proxy = json.loads(proxy_path.read_text())
    if proxy['candidateSha256'] != CANDIDATE_SHA or len(proxy['records']) != 10:
        raise RuntimeError('Wrong proxy report')
    with tempfile.TemporaryDirectory(prefix='vozual-posed-skin-') as temporary:
        with zipfile.ZipFile(archive_path) as archive:
            blends = [entry for entry in archive.infolist() if entry.filename.lower().endswith('.blend')]
            if len(blends) != 1:
                raise RuntimeError('Expected one source blend')
            blend = Path(temporary) / 'source.blend'
            with archive.open(blends[0]) as src, blend.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    dst.write(chunk)
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
        source_rig, source_body = rig_and_body()
        source_rest = points(source_body)
        samples = []
        for item in proxy['records']:
            bone = source_rig.pose.bones[item['bone']]
            for axis in (0, 2):
                for degrees in (-10, 10):
                    # Reload source for each pose to avoid animation/constraint state leakage.
                    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
                    source_rig, source_body = rig_and_body()
                    bone = source_rig.pose.bones[item['bone']]
                    for constraint in bone.constraints:
                        constraint.mute = True
                    bone.rotation_mode = 'XYZ'
                    bone.rotation_euler[axis] += math.radians(degrees)
                    bpy.context.view_layer.update()
                    matrices = {b.name: (source_rig.matrix_world @ b.matrix).copy() for b in source_rig.pose.bones}
                    samples.append({'bone': item['bone'], 'axis': 'xz'[axis // 2], 'degrees': degrees,
                                    'matrices': matrices, 'points': points(source_body)})
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(candidate_path.resolve()))
        target_rig, target_body = rig_and_body()
        target_rest = points(target_body)
        tree = KDTree(len(source_rest))
        for index, point in enumerate(source_rest):
            tree.insert(point, index)
        tree.balance()
        correspondence = {}
        for item in proxy['records']:
            vertex = item['proxyVertexIndex']
            _, index, distance = tree.find(target_rest[vertex])
            correspondence[item['bone']] = (vertex, index, distance)
        def depth(bone):
            n = 0
            while bone.parent:
                n += 1
                bone = bone.parent
            return n
        records = []
        for sample in samples:
            for bone in sorted(target_rig.pose.bones, key=depth):
                if bone.name in sample['matrices']:
                    bone.matrix = target_rig.matrix_world.inverted() @ sample['matrices'][bone.name]
                    bpy.context.view_layer.update()
            errors = [max(abs((target_rig.matrix_world @ bone.matrix)[i][j] - sample['matrices'][bone.name][i][j])
                          for i in range(4) for j in range(4)) for bone in target_rig.pose.bones if bone.name in sample['matrices']]
            if not errors or max(errors) > 0.0001:
                raise RuntimeError('Pose transfer matrix mismatch')
            target_points = points(target_body)
            target_index, source_index, rest_distance = correspondence[sample['bone']]
            distance = (sample['points'][source_index] - target_points[target_index]).length
            records.append({'bone': sample['bone'], 'axis': sample['axis'], 'degrees': sample['degrees'],
                'sourceVertexIndex': source_index, 'targetVertexIndex': target_index,
                'restDistanceM': round(rest_distance, 9), 'posedDistanceM': round(distance, 9),
                'maxBoneMatrixComponentError': round(max(errors), 9)})
        report = {'schema': 'vozual.fingertip-skin-pose-parity', 'schemaVersion': 1,
            'sourceArchiveSha256': SOURCE_SHA, 'sourceBlendSha256': sha(blend),
            'candidateSha256': CANDIDATE_SHA, 'proxyReportSha256': sha(proxy_path),
            'blenderVersion': bpy.app.version_string, 'records': records,
            'limitations': ['Nearest rest vertices are geometric proxies, not proven matching topology or fingertip landmarks',
                'Only isolated terminal-bone +/-10-degree X/Z source poses',
                'No anatomical direction, collision, coupled motion, or acceptance tolerance established']}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
        print('Measured', len(records), 'source/export poses; report SHA-256', sha(report_path))


if __name__ == '__main__':
    main()
