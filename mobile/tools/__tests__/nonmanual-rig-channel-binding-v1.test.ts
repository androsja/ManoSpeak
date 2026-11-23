const {compileNonManualChannelIntent} = require('../nonmanual-channel-intent-v1.cjs');
const {compileNonManualChannelIntentV2} = require('../nonmanual-channel-intent-v2.cjs');
const {validateNonManualRigChannelBindings} = require('../nonmanual-rig-channel-binding-v1.cjs');

function timeline(channel = 'head.yaw') {
  return compileNonManualChannelIntent({schema: 'vozual.nonmanual-channel-intent', schemaVersion: 1,
    id: 'fixture.task8.binding', revision: 1, durationMs: 500,
    execution: 'authoring-only-not-executable',
    tracks: [{id: 'cue', channel, fromMs: 0, toMs: 500, intentRef: 'intent.head.turn', composition: 'exclusive-per-channel'}],
  }).timeline;
}

function profile(binding: unknown, controlId = 'DEF-head') {
  return {schema: 'vozual.nonmanual-rig-channel-profile', schemaVersion: 1, profileId: 'fixture-rig', revision: 1,
    controls: [{id: controlId, type: 'bone'}], channels: binding === undefined ? {} : {'head.yaw': binding}};
}

describe('non-manual rig channel binding validation', () => {
  it('requires explicit reviewer/evidence metadata and returns only a non-executable binding review', () => {
    const result = validateNonManualRigChannelBindings(timeline(), profile({status: 'supported', controlId: 'DEF-head',
      reviewerId: 'reviewer.rig', reviewEvidenceRef: 'evidence.head-yaw'}));
    expect(result.execution).toBe('authoring-only-not-executable');
    expect(result.bindings).toEqual([{channel: 'head.yaw', controlId: 'DEF-head', controlType: 'bone',
      review: {reviewerId: 'reviewer.rig', evidenceRef: 'evidence.head-yaw'}}]);
    expect(result).not.toHaveProperty('frames');
  });

  it('fails closed when the channel is missing, explicitly unsupported, or points to an absent rig control', () => {
    expect(() => validateNonManualRigChannelBindings(timeline(), profile(undefined)))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_BINDING_MISSING'}));
    expect(() => validateNonManualRigChannelBindings(timeline(), profile({status: 'unsupported', reason: 'No reviewed head mapping'})))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CHANNEL_UNSUPPORTED'}));
    expect(() => validateNonManualRigChannelBindings(timeline(), profile({status: 'supported', controlId: 'DEF-absent',
      reviewerId: 'reviewer.rig', reviewEvidenceRef: 'evidence.head-yaw'})))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CONTROL_MISSING'}));
  });

  it('audits v2 resolutions through the same missing, unsupported, and reviewed control decisions', () => {
    const channel = 'head.yaw';
    const compiled = compileNonManualChannelIntentV2({schema: 'vozual.nonmanual-channel-intent', schemaVersion: 2,
      id: 'fixture.task8.binding', revision: 1, durationMs: 500, execution: 'authoring-only-not-executable',
      channels: {[channel]: {domain: 'scalar', supportedOperations: ['override']}},
      tracks: [{id: 'cue', channel, fromMs: 0, toMs: 500, intentRef: 'intent.head.turn',
        composition: {mode: 'override', priority: 70}}]}).timeline;
    const audit = (binding: unknown) => validateNonManualRigChannelBindings(compiled, profile(binding));
    expect(() => audit(undefined)).toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_BINDING_MISSING'}));
    expect(() => audit({status: 'unsupported', reason: 'No reviewed yaw control'}))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CHANNEL_UNSUPPORTED'}));
    const reviewed = {status: 'supported', controlId: 'DEF-head', reviewerId: 'reviewer.rig', reviewEvidenceRef: 'evidence.yaw'};
    expect(audit(reviewed)).toEqual(validateNonManualRigChannelBindings(timeline(), profile(reviewed)));
    for (const invalid of [{...compiled, formatVersion: 3}, {...compiled, resolutions: []}]) {
      expect(() => validateNonManualRigChannelBindings(invalid, profile(reviewed)))
        .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_TIMELINE'}));
    }
  });

  it('rejects a binding profile without review references or an executable timeline', () => {
    expect(() => validateNonManualRigChannelBindings(timeline(), profile({status: 'supported', controlId: 'DEF-head'})))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_RIG_CHANNEL_PROFILE'}));
    expect(() => validateNonManualRigChannelBindings({...timeline(), execution: 'executable'}, profile({status: 'unsupported', reason: 'none'})))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_TIMELINE'}));
  });
});
