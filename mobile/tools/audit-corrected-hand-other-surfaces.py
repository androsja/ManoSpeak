"""Check sampled corrected hand poses against the opposite hand and other GLB meshes.

Run with Blender -- candidate.glb report.json. Arms stay at rest; this does not
test contacts, general reach, all mixed vertices or continuous motion.
"""
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree


def main():
    candidate, output = map(Path, (arg for arg in sys.argv[sys.argv.index('--') + 1:] if arg not in ('--mixed', '--bilateral', '--posed-arms')))
    posed_arms = '--posed-arms' in sys.argv
    bilateral = '--bilateral' in sys.argv or posed_arms
    mixed = '--mixed' in sys.argv or bilateral
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a':
        raise RuntimeError('Candidate hash mismatch')
    checker_path = Path(__file__).with_name('verify-rig-finger-intersections.py')
    spec = importlib.util.spec_from_file_location('finger_checker', checker_path)
    checker = importlib.util.module_from_spec(spec)
    previous = sys.argv
    try:
        sys.argv = [str(checker_path), '--', str(candidate)]
        spec.loader.exec_module(checker)
    finally:
        sys.argv = previous
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(candidate.resolve()))
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one rig')
    rig, body = rigs[0], checker.candidate_body()
    others = sorted((o for o in bpy.context.scene.objects if o.type == 'MESH' and o != body), key=lambda o: o.name)
    if not others:
        raise RuntimeError('Expected additional candidate meshes')
    categories = checker.category_by_vertex(body)
    records = []
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        opposite = 'right' if side == 'left' else 'left'
        for step in range(11):
            phase = step / 10
            for bone in rig.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            if posed_arms:
                for name, angle, axis in [('DEF-upper_arm.L', 22, 0), ('DEF-forearm.L', -18, 1),
                                           ('DEF-upper_arm.R', -22, 0), ('DEF-forearm.R', 18, 1)]:
                    bone = rig.pose.bones[name]
                    bone.rotation_mode = 'XYZ'
                    bone.rotation_euler = (0, 0, 0)
                    bone.rotation_euler[axis] = math.radians(angle)
            active_sides = [('left', 'L'), ('right', 'R')] if bilateral else [(side, suffix)]
            for active_side, active_suffix in active_sides:
                for digit in ('f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb'):
                    for segment, flex in zip(('01', '02', '03'), (0.15, 0.2, 0.15)):
                        bone = rig.pose.bones[f'DEF-{digit}.{segment}.{active_suffix}']
                        bone.rotation_mode = 'XYZ'
                        bone.rotation_euler = (flex * phase, 0, 0)
                        if segment == '01' and digit in ('f_middle', 'f_ring'):
                            bone.rotation_euler.z = 0.025 * phase * (1 if digit == 'f_middle' else -1) * (1 if active_side == 'left' else -1)
                        if segment == '01' and digit == 'thumb':
                            bone.rotation_euler.z = (0.2 if active_side == 'left' else -0.1) * phase
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            evaluated = body.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                if len(mesh.vertices) != len(categories):
                    raise RuntimeError('Body topology mismatch')
                positions = [evaluated.matrix_world @ v.co for v in mesh.vertices]
                hand_triangles = checker.triangles_for_hand(mesh, categories, side)
                opposite_triangles = checker.triangles_for_hand(mesh, categories, opposite)
                if mixed:
                    hand_triangles = [tuple(t.vertices) for t in mesh.loop_triangles
                        if any((categories[i] or '').startswith(side + '-') for i in t.vertices)]
                    opposite_triangles = [tuple(t.vertices) for t in mesh.loop_triangles
                        if any((categories[i] or '').startswith(opposite + '-') for i in t.vertices)]
                hand_tree = BVHTree.FromPolygons(positions, hand_triangles, all_triangles=True)
                opposite_tree = BVHTree.FromPolygons(positions, opposite_triangles, all_triangles=True)
                other_counts = {}
                for obj in others:
                    other_eval = obj.evaluated_get(depsgraph)
                    other_mesh = other_eval.to_mesh()
                    try:
                        other_mesh.calc_loop_triangles()
                        other_points = [other_eval.matrix_world @ v.co for v in other_mesh.vertices]
                        triangles = [tuple(t.vertices) for t in other_mesh.loop_triangles]
                        if not triangles:
                            raise RuntimeError(f'Empty mesh {obj.name}')
                        tree = BVHTree.FromPolygons(other_points, triangles, all_triangles=True)
                        other_counts[obj.name] = len(hand_tree.overlap(tree))
                    finally:
                        other_eval.to_mesh_clear()
                record = {'side': side, 'phase': phase,
                    'oppositeHandOverlaps': len(hand_tree.overlap(opposite_tree)),
                    'otherMeshOverlaps': other_counts}
                if posed_arms:
                    record['nonHandSkinOverlaps'] = len(checker.evaluate_hand_body_intersections(body, categories, side))
                records.append(record)
            finally:
                evaluated.to_mesh_clear()
    report = {'schema': 'vozual.corrected-hand-other-surface-audit', 'schemaVersion': 1,
        'candidateSha256': digest, 'blenderVersion': bpy.app.version_string, 'records': records,
        'scope': ('both hands posed simultaneously; fixed bilateral deformation-parity arm rotations; ' if posed_arms else 'both hands posed simultaneously; arms at rest; ' if bilateral else 'one hand posed at a time with arms and opposite hand at rest; ') + ('any hand-dominant vertex' if mixed else 'dominant-hand triangles'),
        'limitations': [('Mixed triangles selected by dominant vertex classification only' if mixed else 'No mixed hand triangles included in inter-mesh checks'),
            ('No independent hand trajectories, arbitrary arm positions, continuous collision or anatomical validation' if bilateral else 'No simultaneous hand motion, arbitrary arm positions, continuous collision or anatomical validation'),
            'BVH triangle overlap does not assess clearance or minimum distance']}
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('Measured', len(records), 'poses against', len(others), 'meshes; SHA-256', hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
