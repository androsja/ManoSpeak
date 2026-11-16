"""Probe overlaps involving triangles spanning multiple finger categories.

Run in Blender with -- candidate.glb report.json. Mixed-category triangles
include ordinary skin transition geometry; overlaps require manual interpretation.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree


def main():
    candidate, output = map(Path, (arg for arg in sys.argv[sys.argv.index('--') + 1:] if arg != '--corrected-transition'))
    corrected = '--corrected-transition' in sys.argv
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Candidate checksum mismatch')
    path = Path(__file__).with_name('verify-rig-finger-intersections.py')
    spec = importlib.util.spec_from_file_location('finger_checker', path)
    checker = importlib.util.module_from_spec(spec)
    old = sys.argv
    try:
        sys.argv = [str(path), '--', str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = old
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    body = checker.candidate_body()
    categories = checker.category_by_vertex(body)
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for thumb_scale in (tuple(step / 10 for step in range(11)) if corrected else (-1, 0, 0.75, 1.0)):
            for bone in rig.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            if thumb_scale >= 0:
                for digit in ('f_index', 'f_middle', 'f_ring', 'f_pinky'):
                    for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                        bone = rig.pose.bones[f'DEF-{digit}.{segment}.{suffix}']
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = (flex * thumb_scale if corrected else flex, 0, 0)
                        if segment == '01' and digit in ('f_middle', 'f_ring'):
                            bone.rotation_euler.z = 0.025 * (thumb_scale if corrected else 1) * (1 if digit == 'f_middle' else -1) * (1 if side == 'left' else -1)
                for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                    bone = rig.pose.bones[f'DEF-thumb.{segment}.{suffix}']
                    bone.rotation_mode = 'XYZ'
                    bone.rotation_euler = (flex * thumb_scale, 0, 0)
                    if corrected and segment == '01':
                        bone.rotation_euler.z = (0.2 if side == 'left' else -0.1) * thumb_scale
            bpy.context.view_layer.update()
            evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            try:
                mesh.calc_loop_triangles()
                points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
                triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
                fingers = {f'{side}-{digit}' for digit in ('thumb', 'index', 'middle', 'ring', 'pinky')}
                mixed = [t for t in triangles if len({categories[i] for i in t} & fingers) >= 2]
                full = [t for t in triangles if len({categories[i] for i in t}) == 1 and categories[t[0]] in fingers]
                if not mixed or not full:
                    raise RuntimeError('Expected finger and mixed-category triangles')
                pairs = BVHTree.FromPolygons(points, mixed, all_triangles=True).overlap(
                    BVHTree.FromPolygons(points, full, all_triangles=True))
                overlap_pairs = [(a, b) for a, b in pairs if not set(mixed[a]).intersection(full[b])]
                labels = {}
                adjacency = [set() for _ in mesh.vertices]
                for edge in mesh.edges:
                    a, b = edge.vertices
                    adjacency[a].add(b)
                    adjacency[b].add(a)
                details = []
                for a, b in overlap_pairs:
                    key = checker.triangle_categories(mixed[a], categories) + ' / ' + checker.triangle_categories(full[b], categories)
                    labels[key] = labels.get(key, 0) + 1
                    def shrunken_triangle(triangle, fraction):
                        center = sum((points[i] for i in triangle), start=points[triangle[0]] * 0) / 3
                        return [points[i].lerp(center, fraction) for i in triangle]
                    interior = {}
                    for shrink in (0.0001, 0.001, 0.01):
                        first = BVHTree.FromPolygons(shrunken_triangle(mixed[a], shrink), [(0, 1, 2)], all_triangles=True)
                        second = BVHTree.FromPolygons(shrunken_triangle(full[b], shrink), [(0, 1, 2)], all_triangles=True)
                        interior[str(shrink)] = bool(first.overlap(second))
                    frontier, visited = set(mixed[a]), set(mixed[a])
                    distance = None
                    for step in range(1, 7):
                        frontier = set().union(*(adjacency[v] for v in frontier)) - visited
                        visited.update(frontier)
                        if frontier.intersection(full[b]):
                            distance = step
                            break
                    details.append({'labels': key, 'mixedVertices': list(mixed[a]),
                        'fullVertices': list(full[b]), 'nearestTopologyEdgesWithinSix': distance,
                        'minimumVertexDistanceM': round(min((points[i] - points[j]).length
                            for i in mixed[a] for j in full[b]), 9), 'shrunkenTrianglesOverlap': interior})
                record = {'side': side, 'thumbScale': thumb_scale, 'mixedTriangles': len(mixed),
                    'fullFingerTriangles': len(full), 'nonAdjacentOverlaps': len(overlap_pairs),
                    'overlapLabels': labels, 'overlapDetails': details}
                if corrected:
                    count, hits = checker.evaluate_hand_transition_intersections(
                        body, categories, checker.hand_weight_by_vertex(body, side), side)
                    record['mixedHandBodySeam'] = {'triangleCount': count, 'overlapCount': len(hits)}
                    body_hits = checker.evaluate_hand_body_intersections(body, categories, side)
                    record['handToNonHandSkinOverlaps'] = len(body_hits)
                records.append(record)
            finally:
                evaluated.to_mesh_clear()
    report = {'schema': 'vozual.rig-mixed-finger-surface-audit', 'schemaVersion': 1,
        'candidateSha256': digest, 'blenderVersion': bpy.app.version_string,
        'scope': 'sampled corrected thumb transition' if corrected else 'discrete finger poses', 'records': records,
        'limitations': ['Dominant vertex categories only; mixed skin can be normal topology',
            'Counts include non-shared but nearby surface triangles; no anatomical classification',
            'No continuous path, clothing, inter-hand, or full-body evaluation']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'poses; SHA-256', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
