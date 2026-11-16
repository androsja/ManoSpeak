"""Compare selected isolated collision observations in source and exported mesh.

Run Blender with -- source.zip candidate.glb report.json. Mesh topology differs;
overlap counts are not expected to match and are not anatomical safety bounds.
"""
import hashlib
import importlib.util
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils import Matrix


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_checker(candidate):
    path = Path(__file__).with_name('verify-rig-finger-intersections.py')
    spec = importlib.util.spec_from_file_location('finger_checker', path)
    checker = importlib.util.module_from_spec(spec)
    original = sys.argv
    try:
        sys.argv = [str(path), '--', str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = original
    return checker


def run(checker):
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one rig')
    rig, body = rigs[0], checker.candidate_body()
    if rig.animation_data:
        rig.animation_data.action = None
    for bone in rig.pose.bones:
        for constraint in bone.constraints:
            constraint.mute = True
    categories = checker.category_by_vertex(body)
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for digit, prefix, axis, angle in [('thumb', 'thumb', 0, 0.2),
                ('index', 'f_index', 2, -0.1), ('middle', 'f_middle', 0, 0.1)]:
            for bone in rig.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            bone = rig.pose.bones[f'DEF-{prefix}.01.{suffix}']
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = (0, 0, 0)
            bone.rotation_euler[axis] = angle
            bpy.context.view_layer.update()
            hits = checker.evaluate_intersections(body, categories, f'{side}-{digit}')
            records.append({'side': side, 'bone': bone.name, 'axis': 'xyz'[axis],
                'radians': angle, 'overlapCount': len(hits),
                'categories': sorted({label for label, _ in hits})})
    return records


def main():
    source, candidate, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
    if sha(source) != 'a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96' or sha(candidate) != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Input hash mismatch')
    checker = load_checker(candidate)
    with tempfile.TemporaryDirectory(prefix='vozual-source-collision-') as temp:
        with zipfile.ZipFile(source) as archive:
            members = [m for m in archive.infolist() if m.filename.lower().endswith('.blend')]
            if len(members) != 1:
                raise RuntimeError('Expected one blend file')
            blend = Path(temp) / 'source.blend'
            with archive.open(members[0]) as src, blend.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    dst.write(chunk)
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
        original = run(checker)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
        exported = run(checker)
        report = {'schema': 'vozual.rig-isolated-collision-parity', 'schemaVersion': 1,
            'sourceArchiveSha256': sha(source), 'sourceBlendSha256': sha(blend),
            'candidateSha256': sha(candidate), 'blenderVersion': bpy.app.version_string,
            'source': original, 'candidate': exported,
            'limitations': ['Source rig animation and constraints muted; rest-relative diagnostic only',
                'Different source/export tessellation and skin weights make triangle counts incomparable',
                'Dominant categories and same-hand non-adjacent BVH only; no continuous or anatomical guarantee']}
        output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
        print('Compared', len(original), 'isolated poses; SHA-256', sha(output))


if __name__ == '__main__':
    main()
