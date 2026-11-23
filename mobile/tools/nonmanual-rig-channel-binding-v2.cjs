'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const crypto = require('crypto');
const schema = require('../../schemas/nonmanual-rig-channel-profile-v2.schema.json');
const {RigCapabilityError, canonicalJson, validateRigCapabilityProfile} = require('./rig-capability-profile.cjs');
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

/** Validate a review-only channel map against the exact checked rig/candidate identity. */
function validateNonManualRigChannelBindingsV2(timeline, channelProfile, rigProfile) {
  const entries = getTimelineEntries(timeline);
  if (!validateSchema(channelProfile)) {
    throw new RigCapabilityError('NONMANUAL.INVALID_RIG_CHANNEL_PROFILE', 'Invalid hash-bound non-manual rig channel profile v2', {
      errors: validateSchema.errors,
    });
  }
  const {sha256, ...unsignedChannelProfile} = channelProfile;
  const actualChannelProfileSha = crypto.createHash('sha256').update(canonicalJson(unsignedChannelProfile)).digest('hex');
  if (sha256 !== actualChannelProfileSha) {
    throw new RigCapabilityError('NONMANUAL.RIG_CHANNEL_PROFILE_HASH', 'Non-manual rig channel profile checksum does not match its content', {
      expected: sha256, actual: actualChannelProfileSha,
    });
  }
  validateRigCapabilityProfile(rigProfile);
  assertRigIdentity(channelProfile.rigProfile, rigProfile);

  const inventory = rigProfile.descriptor.boneInventory.restAxesInventory?.bones;
  const morphTargets = rigProfile.descriptor.morphTargets;
  const controls = new Map();
  for (const control of channelProfile.controls) {
    if (controls.has(control.id)) {
      throw new RigCapabilityError('NONMANUAL.DUPLICATE_RIG_CONTROL', 'Rig control IDs must be unique', {controlId: control.id});
    }
    if (control.type === 'bone' && (!inventory || !Object.hasOwn(inventory, control.id))) {
      throw new RigCapabilityError('NONMANUAL.RIG_CONTROL_MISSING', 'Bone control is absent from the candidate-bound rig inventory', {
        controlId: control.id, rigProfileId: rigProfile.id, candidateSha256: rigProfile.asset.candidateSha256,
        inventoryAvailable: Boolean(inventory),
      });
    }
    if (control.type === 'morphTarget' && (morphTargets.status !== 'measured' || !morphTargets.ids.includes(control.id))) {
      throw new RigCapabilityError('NONMANUAL.MORPH_TARGET_UNSUPPORTED', 'Morph target is not declared by the candidate-bound rig profile', {
        controlId: control.id, status: morphTargets.status, rigProfileId: rigProfile.id,
      });
    }
    controls.set(control.id, control);
  }

  const channels = [...new Set(entries.map(entry => entry.channel))].sort(compareText);
  const bindings = [];
  for (const channel of channels) {
    const binding = channelProfile.channels[channel];
    if (!binding) {
      throw new RigCapabilityError('NONMANUAL.RIG_BINDING_MISSING', 'Rig profile has no binding decision for an authored channel', {
        profileId: channelProfile.profileId, channel,
      });
    }
    if (binding.status === 'unsupported') {
      throw new RigCapabilityError('NONMANUAL.RIG_CHANNEL_UNSUPPORTED', 'Rig profile explicitly marks an authored channel unsupported', {
        profileId: channelProfile.profileId, channel, reason: binding.reason,
      });
    }
    const boundControls = binding.controlIds.map(controlId => controls.get(controlId));
    const missingControlId = binding.controlIds.find((controlId, index) => !boundControls[index]);
    if (missingControlId) {
      throw new RigCapabilityError('NONMANUAL.RIG_CONTROL_MISSING', 'Binding references a control absent from its candidate-bound inventory', {
        profileId: channelProfile.profileId, channel, controlId: missingControlId,
      });
    }
    bindings.push({channel, controlIds: boundControls.map(control => control.id),
      controlTypes: [...new Set(boundControls.map(control => control.type))].sort(compareText),
      review: {reviewerId: binding.reviewerId, evidenceRef: binding.reviewEvidenceRef}});
  }
  return Object.freeze({schema: 'vozual.nonmanual-rig-binding-review', formatVersion: 2,
    execution: 'authoring-only-not-executable',
    channelProfile: {id: channelProfile.profileId, revision: channelProfile.revision, sha256},
    rigProfile: {id: rigProfile.id, revision: rigProfile.revision, sha256: rigProfile.sha256,
      candidateSha256: rigProfile.asset.candidateSha256, candidateStatus: rigProfile.asset.candidateStatus},
    bindings: Object.freeze(bindings.map(Object.freeze))});
}

function getTimelineEntries(timeline) {
  const channels = schema.properties.channels.propertyNames.enum;
  if (!timeline || timeline.schema !== 'vozual.nonmanual-authoring-timeline'
    || timeline.execution !== 'authoring-only-not-executable') {
    throw new RigCapabilityError('NONMANUAL.INVALID_TIMELINE', 'Non-executable non-manual authoring timeline required');
  }
  const entries = timeline.formatVersion === 1 ? timeline.timeline
    : timeline.formatVersion === 2 ? timeline.resolutions : undefined;
  if (!Array.isArray(entries) || !entries.length || !entries.every(entry => channels.includes(entry?.channel))) {
    throw new RigCapabilityError('NONMANUAL.INVALID_TIMELINE', 'Expected authored channels for timeline v1 or v2');
  }
  return entries;
}

function assertRigIdentity(reference, rigProfile) {
  const matches = reference.id === rigProfile.id
    && reference.revision === rigProfile.revision
    && reference.sha256 === rigProfile.sha256
    && reference.candidateSha256 === rigProfile.asset.candidateSha256;
  if (!matches) {
    throw new RigCapabilityError('NONMANUAL.RIG_PROFILE_MISMATCH', 'Channel map is bound to a different rig profile or candidate', {
      expected: reference,
      actual: {id: rigProfile.id, revision: rigProfile.revision, sha256: rigProfile.sha256,
        candidateSha256: rigProfile.asset.candidateSha256},
    });
  }
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

module.exports = {validateNonManualRigChannelBindingsV2};
