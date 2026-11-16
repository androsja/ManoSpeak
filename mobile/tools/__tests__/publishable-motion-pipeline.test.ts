const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v1.json');
const {
  PublishableCompilationError,
  compilePublishableRecipe,
  selectCompilerForRecipe,
} = require('../publishable-motion-pipeline.cjs');

function hand(x = 0) {
  const finger = () => ({mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}});
  return {wrist: {positionM: [x, 0, 0], orientationQuat: [0, 0, 0, 1]}, joints: {thumb: {cmc: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, ip: {flexionDeg: 0}}, index: finger(), middle: finger(), ring: finger(), pinky: finger()}};
}

function recipe() {
  return {
    schema: 'vozual.motion-schema', schemaVersion: 3, kind: 'authored-kinematic-motion', id: 'fixture.publishable-v3', revision: 1,
    rig: {profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256, jointMapRevision: 1, landmarkMapRevision: 1}, units: {length: 'm', angle: 'deg', time: 'ms'},
    linguisticIntent: {language: 'lsc-CO', glossSequence: ['PRUEBA'], regionalVariant: 'Colombia', phases: [{id: 'stroke', role: 'stroke', fromMs: 0, toMs: 1000, nonManualIds: []}]},
    kinematicRealization: {durationMs: 1000, keyframes: [{id: 'start', timeMs: 0, hands: {left: hand(), right: hand()}}, {id: 'end', timeMs: 1000, hands: {left: hand(0.1), right: hand(0.1)}}], nonManuals: [], contacts: [], proximities: [], relativePoses: [], jointRelations: [], trajectories: [], transitions: [{id: 'start-end', fromKeyframeId: 'start', toKeyframeId: 'end', curve: 'linear', continuous: ['position'], maxSpeedMps: 1, maxAccelerationMps2: 2, maxJerkMps3: 4}]},
    provenance: {authorId: 'fixture', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', sourceSha256: 'b'.repeat(64)},
    linguisticReview: {status: 'approved', language: 'lsc-CO', reviewerId: 'reviewer-1', reviewedAt: '2026-11-02T01:00:00.000Z'},
  };
}

function errorCode(operation: () => unknown) {
  try { operation(); } catch (error) { return (error as typeof PublishableCompilationError).code; }
  return null;
}

describe('publishable motion compilation pipeline', () => {
  it('emits byte-identical, hashed plan, binary and report artifacts for the same approved v3 recipe', () => {
    const first = compilePublishableRecipe(recipe(), profile);
    const second = compilePublishableRecipe(recipe(), profile);
    expect(first.artifacts.executionPlan.sha256).toBe(second.artifacts.executionPlan.sha256);
    expect(first.artifacts.motionBinary.sha256).toBe(second.artifacts.motionBinary.sha256);
    expect(first.artifacts.validationReport.sha256).toBe(second.artifacts.validationReport.sha256);
    expect(first.artifacts.motionBinary.bytes.subarray(0, 4).toString('ascii')).toBe('VZKP');
    expect(first.report.observations.maxWristSpeedMps).toBeCloseTo(0.1);
  });

  it('blocks publication without an approved linguistic review', () => {
    const document = recipe();
    document.linguisticReview.status = 'draft';
    expect(errorCode(() => compilePublishableRecipe(document, profile))).toBe('SEMANTIC.LINGUISTIC_REVIEW');
  });

  it('blocks a required geometric relationship until its exact rig solver is registered', () => {
    const document = recipe();
    document.kinematicRealization.contacts.push({id: 'touch', fromMs: 100, toMs: 200, strength: 'required', a: 'hand.right.thumb.tip', b: 'hand.right.index.tip', maxSeparationM: 0.01});
    expect(errorCode(() => compilePublishableRecipe(document, profile))).toBe('KINEMATIC.UNSUPPORTED_REQUIRED_CONSTRAINT');
  });

  it('samples required joint relations and blocks a violated relation', () => {
    const document = recipe();
    document.kinematicRealization.jointRelations.push({id: 'impossible-curl', fromMs: 0, toMs: 1000, strength: 'required', lhs: 'hand.right.index.pip.flexionDeg', relation: 'gte', rhs: 10, toleranceDeg: 0});
    expect(errorCode(() => compilePublishableRecipe(document, profile))).toBe('KINEMATIC.JOINT_RELATION_VIOLATION');
  });

  it('blocks wrist movement faster than the authored transition limit', () => {
    const document = recipe();
    document.kinematicRealization.transitions[0].maxSpeedMps = 0.01;
    expect(errorCode(() => compilePublishableRecipe(document, profile))).toBe('KINEMATIC.WRIST_SPEED');
  });

  it('selects a legacy strategy but blocks v2 until a deterministic adapter is registered', () => {
    expect(selectCompilerForRecipe({schema: 'vozual.motion-schema', schemaVersion: 2, kind: 'authored-motion'})).toBe('v2');
    expect(errorCode(() => compilePublishableRecipe({schema: 'vozual.motion-schema', schemaVersion: 2, kind: 'authored-motion'}, profile))).toBe('STRUCTURE.V2');
  });
});
