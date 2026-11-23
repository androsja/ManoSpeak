const fs = require('node:fs');
const path = require('node:path');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const measured = require('../../../schemas/rig-profiles/vozual-rig-1.body-surface-proximity-evidence.v1.json');
const fixture = require('../../../schemas/fixtures/rig-conformance-v4/body-surface-proximity.json');
const {compileV4RigConformanceRecipe} = require('../compile-motion-v4.cjs');
const {evaluateSurfacePolicy, validateBodySurfaceProximities} = require('../v4-body-surface-proximity.cjs');
const evidenceRoot = path.resolve(__dirname, '../../..');
const candidate = fs.readFileSync(path.join(evidenceRoot,
  '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

function compile(source: any) {
  return compileV4RigConformanceRecipe(source, profile, candidate, {evidenceRoot});
}

function withSurfacePolicy() {
  const source = structuredClone(fixture.source);
  for (const constraint of source.constraints.bodySurfaceProximities) {
    constraint.surfacePolicy = {minApproachNormalDot: -1, collisionPriority: 'required'};
  }
  return source;
}

describe('measured body-surface proximity', () => {
  it('reconstructs both tips at all three poses, with deterministic zero-frame output', () => {
    const source = structuredClone(fixture.source);
    const before = JSON.stringify(source);
    const result = compile(source);
    expect(result.bytes.equals(compile(source).bytes)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.artifact.frames).toEqual([]);
    expect(result.artifact.compiler.build).toBe('task7-body-surface-proximity-1');
    expect(result.artifact.rig.requiredCapabilities).toEqual(['endpoint.pointAnchors']);
    for (const diagnostic of result.artifact.conformanceDiagnostics.bodySurfaceProximities) {
      expect(diagnostic).toMatchObject({sampleCount: 3, collisionEvaluation: 'not-performed',
        evaluationScope: 'measured-discrete-index-to-torso-unsigned-distance'});
      for (const sample of diagnostic.samples) {
        const pose = measured.measurements.find((m: any) => m.poseId === sample.poseId);
        const tip = pose.indexTips.find((t: any) => t.anchorId === diagnostic.anchorId);
        expect(Math.abs(sample.distanceM - tip.unsignedDistanceM)).toBeLessThan(0.000001);
        expect(sample.surfaceTriangleIndex).toBe(tip.triangleIndex);
        expect(sample.surfacePointBodyM).toEqual(tip.nearestSurfacePointBodyM);
        expect(sample.surfaceNormalBody).toEqual(tip.nearestSurfaceNormalBody);
        expect(sample.violationM).toBe(0);
      }
    }
  });

  it.each([
    [0.3, 0.7, 'bilateral-index-approach'],
    [0, 0.3, 'neutral-rest'],
    [0.6, 0.61, 'bilateral-index-approach'],
  ])('rejects range [%s,%s] at the worst violating sample', (min, max, poseId) => {
    const source = structuredClone(fixture.source);
    Object.assign(source.constraints.bodySurfaceProximities[0], {minDistanceM: min, maxDistanceM: max});
    expect(() => compile(source)).toThrow(expect.objectContaining({
      code: 'KINEMATIC.BODY_SURFACE_PROXIMITY_OUTSIDE_RANGE',
      details: expect.objectContaining({worstSample: expect.objectContaining({poseId})}),
    }));
  });

  it('rejects a middle sample with no measured pose instead of interpolating it', () => {
    const source = structuredClone(fixture.source);
    source.constraints.bodySurfaceProximities[0].samples[1].poseId = 'unmeasured-transition';
    expect(() => compile(source)).toThrow(expect.objectContaining({
      code: 'KINEMATIC.BODY_SURFACE_PROXIMITY_EVIDENCE_UNAVAILABLE',
      details: expect.objectContaining({poseId: 'unmeasured-transition', timeMs: 100}),
    }));
  });

  it.each([
    {minDistanceM: -1}, {maxDistanceM: Infinity}, {minDistanceM: NaN},
    {minDistanceM: 1, maxDistanceM: 0.5}, {frameId: 'world'},
    {surfaceId: 'head'}, {anchorId: 'hand.middle.tip.left'}, {anchorId: ['hand.index.tip.left']},
    {priority: 'preferred'}, {samples: []}, {surfacePolicy: null},
    {surfacePolicy: {minApproachNormalDot: -1.1, collisionPriority: 'preferred'}},
    {surfacePolicy: {minApproachNormalDot: 0, collisionPriority: 'optional'}},
    {samples: [{timeMs: 0, poseId: 'neutral-rest'}, {timeMs: 0, poseId: 'neutral-rest'}]},
    {samples: [{timeMs: 0.5, poseId: 'neutral-rest'}]},
    {samples: [{timeMs: -1, poseId: 'neutral-rest'}]},
    {samples: [{timeMs: 0, poseId: 'neutral-rest', fraction: 0.5}]},
  ])('rejects unsupported or malformed constraint %j', patch => {
    const source = structuredClone(fixture.source);
    Object.assign(source.constraints.bodySurfaceProximities[0], patch);
    expect(() => compile(source)).toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_BODY_SURFACE_PROXIMITY'}));
  });

  it('rejects empty families and duplicate IDs', () => {
    expect(() => validateBodySurfaceProximities([])).toThrow();
    const source = structuredClone(fixture.source);
    source.constraints.bodySurfaceProximities[1].id = source.constraints.bodySurfaceProximities[0].id;
    expect(() => compile(source)).toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_BODY_SURFACE_PROXIMITY'}));
  });

  it('rejects modified evidence bytes even when the JSON remains valid', () => {
    const realRead = fs.readFileSync;
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file: any, ...args: any[]) => {
      if (String(file).endsWith('vozual-rig-1.body-surface-proximity-evidence.v1.json')) {
        return Buffer.from(JSON.stringify({...measured, frameId: 'world'}));
      }
      return realRead(file, ...args);
    });
    try {
      jest.isolateModules(() => {
        const compiler = require('../compile-motion-v4.cjs');
        expect(() => compiler.compileV4RigConformanceRecipe(withSurfacePolicy(), profile, candidate, {evidenceRoot}))
          .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE',
            message: expect.stringContaining('Body surface proximity evidence checksum mismatch')}));
      });
    } finally { spy.mockRestore(); }
  });

  it('evaluates each index against its own nearest triangle and the same-side hand overlap record', () => {
    const {artifact} = compile(withSurfacePolicy());
    expect(artifact.compiler.build).toBe('task7-body-surface-proximity-2');
    expect(artifact.frames).toEqual([]);
    const diagnostics = artifact.conformanceDiagnostics.bodySurfaceProximities;
    const expectedDots = [[-0.978656, -0.218612, -0.978656], [-0.993518, -0.143300, -0.992124]];
    diagnostics.forEach((diagnostic: any, side: number) => {
      expect(diagnostic.surfacePolicy.collisionSatisfied).toBe(true);
      expect(diagnostic.collisionEvaluation).toBe('sampled-same-side-hand-to-torso-excluding-shared-vertices');
      diagnostic.samples.forEach((sample: any, pose: number) => {
        expect(sample.approachNormalDot).toBeCloseTo(expectedDots[side][pose], 5);
        expect(sample.handToTorsoOverlapCount).toBe(0);
      });
    });
  });

  it('enforces alignment even when collision priority is preferred and identifies the worst pose', () => {
    const source = withSurfacePolicy();
    const [left, right] = source.constraints.bodySurfaceProximities;
    delete left.surfacePolicy;
    right.surfacePolicy = {minApproachNormalDot: 0, collisionPriority: 'preferred'};
    expect(() => compile(source)).toThrow(expect.objectContaining({
      code: 'KINEMATIC.BODY_SURFACE_NORMAL_OUTSIDE_RANGE',
      details: expect.objectContaining({surfacePolicy: expect.objectContaining({
        worstAlignment: expect.objectContaining({poseId: 'neutral-rest', timeMs: 0}),
      })}),
    }));
    right.surfacePolicy.minApproachNormalDot = -1;
    const result = compile(source).artifact.conformanceDiagnostics.bodySurfaceProximities;
    expect(result[0].collisionEvaluation).toBe('not-performed');
    expect(result[0].samples[0]).not.toHaveProperty('approachNormalDot');
    right.samples[1].poseId = 'unmeasured';
    expect(() => compile(source)).toThrow(expect.objectContaining({code: 'KINEMATIC.BODY_SURFACE_PROXIMITY_EVIDENCE_UNAVAILABLE'}));
  });

  it('treats a synthetic nonzero intersection as a required failure or a preferred violation', () => {
    const sample = {poseId: 'synthetic-overlap', timeMs: 5, approachNormalDot: 0.8, handToTorsoOverlapCount: 2};
    const diagnostic = {samples: [{...sample, timeMs: 0, handToTorsoOverlapCount: 0}, sample]};
    const policy = {minApproachNormalDot: 0.8, collisionPriority: 'preferred'};
    expect(evaluateSurfacePolicy(policy, diagnostic).surfacePolicy).toMatchObject({
      worstOverlap: sample, collisionSatisfied: false,
    });
    expect(() => evaluateSurfacePolicy({...policy, collisionPriority: 'required'}, diagnostic))
      .toThrow(expect.objectContaining({code: 'KINEMATIC.BODY_SURFACE_OVERLAP'}));
  });

  it('cannot use proximity to bypass a failing body-surface approach constraint', () => {
    const source = structuredClone(fixture.source);
    const approach = structuredClone(require('../../../schemas/fixtures/rig-conformance-v4/body-surface-approach.json'));
    source.constraints.bodySurfaceApproaches = approach.source.constraints.bodySurfaceApproaches;
    source.constraints.bodySurfaceApproaches[0].maxDistanceM = 0.001;
    expect(() => compile(source)).toThrow(expect.objectContaining({code: 'KINEMATIC.BODY_SURFACE_APPROACH_OUTSIDE_RANGE'}));
  });
});

export {};
