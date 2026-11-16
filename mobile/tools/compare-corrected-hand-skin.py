"""Compare source/export skin proxies under a corrected sampled hand path.

Run Blender with -- source.zip candidate.glb proxy-report.json output.json.
This is bounded technical parity, not linguistic or anatomical validation.
"""
import hashlib
import json
import math
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.kdtree import KDTree


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def objects():
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    bodies = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name == 'NUG_Base_Body']
    if len(rigs) != 1 or len(bodies) != 1:
        raise RuntimeError('Expected one armature and body')
    return rigs[0], bodies[0]


def points(body):
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(body.data.vertices):
            raise RuntimeError('Evaluated topology changed')
        return [evaluated.matrix_world @ v.co for v in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def main():
    archive_path, asset_path, proxy_path, output_path = map(Path, sys.argv[sys.argv.index('--') + 1:])
    source_sha = 'a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96'
    asset_sha = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a'
    proxy = json.loads(proxy_path.read_text())
    if sha(archive_path) != source_sha or sha(asset_path) != asset_sha or proxy['candidateSha256'] != asset_sha:
        raise RuntimeError('Input hashes do not match')
    with tempfile.TemporaryDirectory(prefix='vozual-hand-parity-') as temp:
        with zipfile.ZipFile(archive_path) as archive:
            blends = [m for m in archive.infolist() if m.filename.lower().endswith('.blend')]
            if len(blends) != 1:
                raise RuntimeError('Expected one source blend')
            blend = Path(temp) / 'source.blend'
            with archive.open(blends[0]) as src, blend.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    dst.write(chunk)
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
        source_rig, source_body = objects()
        # Disable source-only rig controls and start from declared neutral rest.
        for bone in source_rig.pose.bones:
            for constraint in bone.constraints:
                constraint.mute = True
            bone.matrix_basis = Matrix.Identity(4)
        if source_rig.animation_data:
            source_rig.animation_data.action = None
        bpy.context.view_layer.update()
        source_rest = points(source_body)
        samples = []
        for side, suffix in [('left', 'L'), ('right', 'R')]:
            for step in range(11):
                for bone in source_rig.pose.bones:
                    bone.matrix_basis = Matrix.Identity(4)
                phase = step / 10
                for digit in ('f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb'):
                    for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                        bone = source_rig.pose.bones[f'DEF-{digit}.{segment}.{suffix}']
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = (flex * phase, 0, 0)
                        if segment == '01' and digit in ('f_middle', 'f_ring'):
                            bone.rotation_euler.z = 0.025 * phase * (1 if digit == 'f_middle' else -1) * (1 if side == 'left' else -1)
                        if segment == '01' and digit == 'thumb':
                            bone.rotation_euler.z = (0.2 if side == 'left' else -0.1) * phase
                bpy.context.view_layer.update()
                samples.append({'side': side, 'phase': phase,
                    'matrices': {b.name: (source_rig.matrix_world @ b.matrix).copy() for b in source_rig.pose.bones},
                    'points': points(source_body)})
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(asset_path.resolve()))
        target_rig, target_body = objects()
        target_rest = points(target_body)
        tree = KDTree(len(source_rest))
        for index, point in enumerate(source_rest):
            tree.insert(point, index)
        tree.balance()
        matches = []
        for item in proxy['records']:
            target_index = item['proxyVertexIndex']
            _, source_index, distance = tree.find(target_rest[target_index])
            matches.append((item['bone'], target_index, source_index, distance))
        def depth(bone):
            result = 0
            while bone.parent:
                result += 1
                bone = bone.parent
            return result
        records = []
        for sample in samples:
            for bone in sorted(target_rig.pose.bones, key=depth):
                if bone.name in sample['matrices']:
                    bone.matrix = target_rig.matrix_world.inverted() @ sample['matrices'][bone.name]
                    bpy.context.view_layer.update()
            errors = [max(abs((target_rig.matrix_world @ b.matrix)[i][j] - sample['matrices'][b.name][i][j])
                          for i in range(4) for j in range(4)) for b in target_rig.pose.bones if b.name in sample['matrices']]
            if not errors or max(errors) > 0.0001:
                raise RuntimeError('Pose transfer failed')
            candidate_points = points(target_body)
            for bone_name, target_index, source_index, rest_distance in matches:
                if not bone_name.endswith('.L' if sample['side'] == 'left' else '.R'):
                    continue
                records.append({'side': sample['side'], 'phase': sample['phase'], 'bone': bone_name,
                    'restDistanceM': round(rest_distance, 9),
                    'posedDistanceM': round((candidate_points[target_index] - sample['points'][source_index]).length, 9),
                    'maxBoneMatrixComponentError': round(max(errors), 9)})
        report = {'schema': 'vozual.corrected-hand-skin-parity', 'schemaVersion': 1,
            'sourceArchiveSha256': source_sha, 'sourceBlendSha256': sha(blend), 'candidateSha256': asset_sha,
            'proxyReportSha256': sha(proxy_path), 'blenderVersion': bpy.app.version_string, 'records': records,
            'scope': 'corrected candidate path, 11 sampled phases per hand, 5 rest-nearest proxy pairs per hand',
            'limitations': ['Source rig constraints muted and animation removed; pose is diagnostic',
                'Nearest rest vertices are proxies, not independently certified fingertip landmarks',
                'No continuous motion, collision, linguistic or anatomical validation']}
        output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
        print('Measured', len(records), 'skin proxy observations; SHA-256', sha(output_path))


if __name__ == '__main__':
    main()
