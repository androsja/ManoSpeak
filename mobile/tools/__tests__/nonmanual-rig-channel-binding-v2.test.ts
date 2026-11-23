const crypto = require('crypto');
const rigProfile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {canonicalJson} = require('../rig-capability-profile.cjs');
const {validateNonManualRigChannelBindingsV2} = require('../nonmanual-rig-channel-binding-v2.cjs');

function timeline(channel = 'jaw.open') {
  return {schema: 'vozual.nonmanual-authoring-timeline', formatVersion: 2,
    execution: 'authoring-only-not-executable', source: {id: 'fixture.task8', revision: 1},
    durationMs: 500, resolutions: [{channel, fromMs: 0, toMs: 500, mode: 'exclusive', operandRefs: ['intent.jaw-open']}]};
}

function channelProfile(overrides: Record<string, unknown> = {}) {
  const value: any = {schema: 'vozual.nonmanual-rig-channel-profile', schemaVersion: 2,
    profileId: 'fixture.nonmanual-rig', revision: 1,
    rigProfile: {id: rigProfile.id, revision: rigProfile.revision, sha256: rigProfile.sha256,
      candidateSha256: rigProfile.asset.candidateSha256},
    controls: [{id: 'DEF-jaw', type: 'bone'}],
    channels: {'jaw.open': {status: 'supported', controlIds: ['DEF-jaw'],
      reviewerId: 'reviewer.fixture-only', reviewEvidenceRef: 'evidence.fixture-only'}},
    ...overrides};
  const {sha256: _oldSha, ...unsigned} = value;
  value.sha256 = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  return value;
}

describe('candidate-bound non-manual rig channel binding v2', () => {
  it('validates a review-only profile against exact rig and candidate hashes without producing executable data', () => {
    const result = validateNonManualRigChannelBindingsV2(timeline(), channelProfile(), rigProfile);
    expect(result).toMatchObject({execution: 'authoring-only-not-executable', formatVersion: 2,
      rigProfile: {id: 'vozual-rig-1', revision: 8, sha256: rigProfile.sha256,
        candidateSha256: rigProfile.asset.candidateSha256, candidateStatus: 'temporary-uncertified'},
      bindings: [{channel: 'jaw.open', controlIds: ['DEF-jaw'], controlTypes: ['bone']}]});
    expect(result).not.toHaveProperty('frames');
    expect(result).not.toHaveProperty('poses');
  });

  it('supports one abstract channel bound to a reviewed group of candidate controls', () => {
    const profile = channelProfile({controls: [
      {id: 'DEF-jaw', type: 'bone'}, {id: 'DEF-jaw.L', type: 'bone'},
    ], channels: {'jaw.open': {status: 'supported', controlIds: ['DEF-jaw', 'DEF-jaw.L'],
      reviewerId: 'reviewer.fixture-only', reviewEvidenceRef: 'evidence.fixture-only'}}});
    const result = validateNonManualRigChannelBindingsV2(timeline(), profile, rigProfile);
    expect(result.bindings).toEqual([{channel: 'jaw.open', controlIds: ['DEF-jaw', 'DEF-jaw.L'],
      controlTypes: ['bone'], review: {reviewerId: 'reviewer.fixture-only', evidenceRef: 'evidence.fixture-only'}}]);
  });

  it('rejects a different rig revision, profile digest, or candidate even if the map hash is recomputed', () => {
    const reference = channelProfile().rigProfile;
    const wrongRevision = channelProfile({rigProfile: {...reference, revision: 7}});
    const wrongProfileHash = channelProfile({rigProfile: {...reference, sha256: 'a'.repeat(64)}});
    const wrongCandidate = channelProfile({rigProfile: {...reference, candidateSha256: 'b'.repeat(64)}});
    for (const value of [wrongRevision, wrongProfileHash, wrongCandidate]) {
      expect(() => validateNonManualRigChannelBindingsV2(timeline(), value, rigProfile))
        .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_PROFILE_MISMATCH'}));
    }
  });

  it('rejects modified channel maps whose content hash was not refreshed', () => {
    const value = channelProfile();
    value.channels['jaw.open'].reviewEvidenceRef = 'evidence.changed';
    expect(() => validateNonManualRigChannelBindingsV2(timeline(), value, rigProfile))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CHANNEL_PROFILE_HASH'}));
  });

  it('rejects controls outside the candidate-bound inventory and morph targets the rig marks unsupported', () => {
    const missingBone = channelProfile({controls: [{id: 'DEF-does-not-exist', type: 'bone'}],
      channels: {'jaw.open': {status: 'supported', controlIds: ['DEF-does-not-exist'],
        reviewerId: 'reviewer.fixture-only', reviewEvidenceRef: 'evidence.fixture-only'}}});
    expect(() => validateNonManualRigChannelBindingsV2(timeline(), missingBone, rigProfile))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CONTROL_MISSING'}));

    const morph = channelProfile({controls: [{id: 'morph.smile', type: 'morphTarget'}],
      channels: {'jaw.open': {status: 'supported', controlIds: ['morph.smile'],
        reviewerId: 'reviewer.fixture-only', reviewEvidenceRef: 'evidence.fixture-only'}}});
    expect(() => validateNonManualRigChannelBindingsV2(timeline(), morph, rigProfile))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.MORPH_TARGET_UNSUPPORTED'}));
  });

  it('rejects explicit unsupported decisions and preserves legacy timeline authoring compatibility', () => {
    const unsupported = channelProfile({channels: {'jaw.open': {status: 'unsupported', reason: 'No reviewed mapping'}}});
    expect(() => validateNonManualRigChannelBindingsV2(timeline(), unsupported, rigProfile))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.RIG_CHANNEL_UNSUPPORTED'}));

    const legacy = {schema: 'vozual.nonmanual-authoring-timeline', formatVersion: 1,
      execution: 'authoring-only-not-executable', source: {id: 'fixture.legacy', revision: 1},
      durationMs: 500, timeline: [{channel: 'jaw.open', fromMs: 0, toMs: 500, intentRef: 'intent.jaw'}]};
    expect(validateNonManualRigChannelBindingsV2(legacy, channelProfile(), rigProfile).bindings)
      .toHaveLength(1);
  });
});
