"""Compare original Blender and imported GLB terminal bone endpoints.

Usage: blender --background --python-exit-code 1 --python this.py -- source.zip candidate.glb report.json
The comparison concerns rest bones, not skin landmarks or anatomical correctness.
"""
import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy


SOURCE_SHA = 'a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96'
CANDIDATE_SHA = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot():
    rigs = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected exactly one armature')
    rig = rigs[0]
    result = {}
    for side in ('L', 'R'):
        for digit in ('thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'):
            name = f'DEF-{digit}.03.{side}'
            bone = rig.data.bones[name]
            result[name] = (rig.matrix_world @ bone.head_local, rig.matrix_world @ bone.tail_local)
    return result


def main():
    archive_path, candidate_path, report_path = map(Path, sys.argv[sys.argv.index('--') + 1:])
    if digest(archive_path) != SOURCE_SHA or digest(candidate_path) != CANDIDATE_SHA:
        raise RuntimeError('Source or candidate hash mismatch')
    with tempfile.TemporaryDirectory(prefix='vozual-fingertip-source-') as temporary:
        with zipfile.ZipFile(archive_path) as archive:
            blends = [item for item in archive.infolist() if item.filename.lower().endswith('.blend')]
            if len(blends) != 1:
                raise RuntimeError('Expected exactly one source blend')
            blend = Path(temporary) / 'source.blend'
            with archive.open(blends[0]) as source, blend.open('wb') as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
        blend_sha = digest(blend)
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
        source = snapshot()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(candidate_path.resolve()))
        target = snapshot()
        records = []
        for name in sorted(source):
            source_head, source_tail = source[name]
            target_head, target_tail = target[name]
            records.append({'bone': name, 'headErrorM': round((source_head - target_head).length, 9),
                'tailErrorM': round((source_tail - target_tail).length, 9),
                'sourceLengthM': round((source_tail - source_head).length, 9),
                'importedLengthM': round((target_tail - target_head).length, 9)})
        report = {'schema': 'vozual.rig-fingertip-rest-parity', 'schemaVersion': 1,
            'sourceArchiveSha256': SOURCE_SHA, 'sourceBlendSha256': blend_sha,
            'candidateSha256': CANDIDATE_SHA, 'blenderVersion': bpy.app.version_string,
            'records': records, 'scope': 'terminal bone head and tail in rest-pose world coordinates',
            'limitations': ['Imported glTF bone tails may be synthesized',
                'No skin vertex correspondence, posed motion, collision, or anatomical review']}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
        print('Compared', len(records), 'terminal bones; report SHA-256', digest(report_path))


if __name__ == '__main__':
    main()
