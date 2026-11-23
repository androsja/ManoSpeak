const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

const repositoryRoot = path.resolve(__dirname, '../../..');
const schema = require('../../../schemas/manual-articulator-intent-v1.schema.json');
const fixture = require('../../../schemas/fixtures/manual-articulator-intent-v1/asymmetric-draft.json');
const ajv = new Ajv2020({allErrors: true, strict: true});
const validate = ajv.compile(schema);

describe('v4 independent-hand authoring intent schema', () => {
  it('represents distinct left/right roles, handshape references, and event timing without joint angles', () => {
    expect(validate(fixture)).toBe(true);
    expect(fixture.hands.left).not.toEqual(fixture.hands.right);
    expect(fixture.hands.left.role).toBe('non-dominant-active');
    expect(fixture.hands.right.role).toBe('dominant');
    expect(fixture.execution).toBe('authoring-only-not-executable');
    expect(JSON.stringify(schema)).not.toContain('flexionDeg');
    expect(JSON.stringify(schema)).not.toContain('jointLimits');
  });

  it('rejects missing hand tracks and numeric joint-angle payloads', () => {
    const missingHand = structuredClone(fixture);
    delete missingHand.hands.right;
    expect(validate(missingHand)).toBe(false);

    const inventedAngles = structuredClone(fixture);
    inventedAngles.hands.left.jointAnglesDeg = {thumb: {cmc: 15}};
    expect(validate(inventedAngles)).toBe(false);
  });

  it('rejects an executable status or reviewer claim in this draft-only schema', () => {
    const promoted = structuredClone(fixture);
    promoted.execution = 'executable';
    expect(validate(promoted)).toBe(false);

    const reviewed = structuredClone(fixture);
    reviewed.review = {status: 'approved', reviewerId: 'unknown', reviewedAt: '2026-11-17T00:00:00Z'};
    expect(validate(reviewed)).toBe(false);
  });

  it('keeps the profile-bound fixture synchronized with the current exact profile and candidate', () => {
    const profile = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json'), 'utf8'));
    expect(fixture.rigBinding.profileId).toBe(profile.id);
    expect(fixture.rigBinding.profileRevision).toBe(profile.revision);
    expect(fixture.rigBinding.profileSha256).toBe(profile.sha256);
    expect(fixture.rigBinding.candidateSha256).toBe(profile.asset.candidateSha256);
  });
});

describe('manual intent validation boundary', () => {
  const {validateManualArticulatorIntent, admitManualArticulatorExecution} = require('../manual-articulator-intent-v1.cjs');
  const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
  const candidateBytes = fs.readFileSync(path.join(repositoryRoot, '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

  it('validates the draft but never admits it for execution', () => {
    expect(validateManualArticulatorIntent(fixture, profile)).toBe(fixture);
    expect(() => admitManualArticulatorExecution(fixture, profile, candidateBytes)).toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const empty = structuredClone(fixture);
    empty.requiredRigCapabilities = [];
    expect(() => admitManualArticulatorExecution(empty, profile, candidateBytes)).toThrow(/execution is not supported/);
    expect(() => admitManualArticulatorExecution(empty, profile, Buffer.from('wrong'))).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects inverted or out-of-duration times and duplicate event IDs', () => {
    for (const mutate of [
      value => { value.hands.left.events[0].fromMs = 1201; },
      value => { value.hands.left.events[0].toMs = 1201; },
      value => { value.hands.right.events[0].id = value.hands.left.events[0].id; },
      value => { value.hands.left.events[0].toMs = value.hands.left.events[0].fromMs; },
    ]) {
      const value = structuredClone(fixture);
      mutate(value);
      expect(() => validateManualArticulatorIntent(value, profile)).toThrow();
    }
  });

  it('allows cross-hand and cross-channel overlaps and adjacent same-channel intervals', () => {
    const value = structuredClone(fixture);
    value.hands.left.events.push({id: 'left-trajectory', channel: 'trajectory', fromMs: 100, toMs: 900, intentRef: 'fixture.left-trajectory'});
    value.hands.left.events.push({id: 'left-shape-next', channel: 'handshape', fromMs: 1200, toMs: 1201, intentRef: 'fixture.left-shape-next'});
    value.durationMs = 1300;
    value.hands.right.events[1].toMs = 1300;
    expect(() => validateManualArticulatorIntent(value, profile)).not.toThrow();
  });

  it('rejects overlapping events within the same hand and channel', () => {
    const value = structuredClone(fixture);
    value.hands.right.events.push({id: 'right-shape-overlap', channel: 'handshape', fromMs: 800, toMs: 1100, intentRef: 'fixture.right-shape-next'});
    expect(() => validateManualArticulatorIntent(value, profile)).toThrow(/must not overlap/);
  });

  it('rejects mismatched binding and a modified profile', () => {
    const value = structuredClone(fixture);
    value.rigBinding.profileSha256 = '0'.repeat(64);
    expect(() => validateManualArticulatorIntent(value, profile)).toThrow();
    const modified = structuredClone(profile);
    modified.revision++;
    expect(() => validateManualArticulatorIntent(fixture, modified)).toThrow();
  });
});

describe('manual channel rejection diagnostics', () => {
  const {compileV4RigConformanceRecipe} = require('../compile-motion-v4.cjs');
  const {profileSha256} = require('../rig-capability-profile.cjs');
  const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
  const bytes = fs.readFileSync(path.join(repositoryRoot, '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

  it.each(['empty', 'claimed'])('reports every side/channel despite %s capability declarations', mode => {
    const source = structuredClone(fixture);
    const candidateProfile = structuredClone(profile);
    source.hands.left.events.push({id: 'left-orientation', channel: 'orientation', fromMs: 0, toMs: 100, intentRef: 'fixture.orientation'});
    source.hands.right.events.push({id: 'right-contact', channel: 'contact-intent', fromMs: 0, toMs: 100, intentRef: 'fixture.contact'});
    if (mode === 'empty') source.requiredRigCapabilities = [];
    else {
      for (const capability of source.requiredRigCapabilities) candidateProfile.capabilities[capability] = 'structurally_verified';
      candidateProfile.sha256 = profileSha256(candidateProfile);
      source.rigBinding.profileSha256 = candidateProfile.sha256;
    }
    const before = JSON.stringify({source, candidateProfile});
    let caught;
    try { compileV4RigConformanceRecipe(source, candidateProfile, bytes); } catch (error) { caught = error; }
    expect(caught).toMatchObject({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', details: {
      profileSha256: candidateProfile.sha256, candidateSha256: candidateProfile.asset.candidateSha256,
      unsupportedDeclaredCapabilities: [],
      unsupportedEvents: ['left', 'right'].flatMap(side => source.hands[side].events.map(event => ({side, eventId: event.id, channel: event.channel, intentRef: event.intentRef, reason: 'no-reviewed-execution-mapping'}))),
    }});
    expect(JSON.stringify({source, candidateProfile})).toBe(before);
  });
});
