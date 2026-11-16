"""Compare coincident candidate seam vertices with source rest mesh vertices.

Run Blender with -- source.zip candidate.glb topology-report.json report.json.
"""
import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def body():
    matches = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name == 'NUG_Base_Body']
    if len(matches) != 1:
        raise RuntimeError('Expected one body mesh')
    return matches[0]


def main():
    source, candidate, topology, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
    source_sha = 'a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96'
    candidate_sha = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a'
    if sha(source) != source_sha or sha(candidate) != candidate_sha:
        raise RuntimeError('Input hash mismatch')
    audit = json.loads(topology.read_text())
    if audit['candidateSha256'] != candidate_sha:
        raise RuntimeError('Topology candidate mismatch')
    pairs = {}
    for record in audit['records']:
        for detail in record['overlapDetails']:
            key = tuple(detail['mixedVertices'] + detail['fullVertices'])
            pairs[key] = detail['labels']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    target = body()
    records = []
    for vertices, labels in sorted(pairs.items()):
        a, b = vertices[:3], vertices[3:]
        i, j = min(((i, j) for i in a for j in b),
            key=lambda ij: (target.matrix_world @ target.data.vertices[ij[0]].co - target.matrix_world @ target.data.vertices[ij[1]].co).length)
        p = target.matrix_world @ target.data.vertices[i].co
        q = target.matrix_world @ target.data.vertices[j].co
        groups = {g.index: g.name for g in target.vertex_groups}
        weights = lambda index: {groups[e.group]: round(e.weight, 8) for e in target.data.vertices[index].groups}
        records.append({'labels': labels, 'candidateVertices': [i, j], 'candidateDistanceM': round((p-q).length, 9),
            'candidateWeights': [weights(i), weights(j)], 'position': list(p)})
    with tempfile.TemporaryDirectory(prefix='vozual-split-seam-') as temp:
        with zipfile.ZipFile(source) as archive:
            members = [m for m in archive.infolist() if m.filename.lower().endswith('.blend')]
            if len(members) != 1:
                raise RuntimeError('Expected one blend')
            blend = Path(temp) / 'source.blend'
            with archive.open(members[0]) as src, blend.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    dst.write(chunk)
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False)
        original = body()
        tree = KDTree(len(original.data.vertices))
        for vertex in original.data.vertices:
            tree.insert(original.matrix_world @ vertex.co, vertex.index)
        tree.balance()
        for record in records:
            _, index, distance = tree.find(record.pop('position'))
            record['nearestSourceVertex'] = index
            record['nearestSourceDistanceM'] = round(distance, 9)
    report = {'schema': 'vozual.split-seam-source-audit', 'schemaVersion': 1,
        'sourceSha256': source_sha, 'candidateSha256': candidate_sha, 'topologyReportSha256': sha(topology),
        'blenderVersion': bpy.app.version_string, 'records': records,
        'limitations': ['Rest nearest source positions do not prove identical topology or posed parity',
            'Coincident vertices do not by themselves prove the complete triangle overlap is harmless']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'pairs; SHA-256', sha(output))


if __name__ == '__main__':
    main()
