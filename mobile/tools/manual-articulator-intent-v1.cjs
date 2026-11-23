'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../../schemas/manual-articulator-intent-v1.schema.json');
const {RigCapabilityError, validateRigCapabilityProfile, verifyCandidateAsset} = require('./rig-capability-profile.cjs');
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

// This validates authoring data and does not authorize execution.
function validateManualArticulatorIntent(intent, profile) {
  if (!validateSchema(intent)) throw new RigCapabilityError('SCHEMA.INVALID_MANUAL_INTENT', 'Invalid manual intent', {errors: validateSchema.errors});
  validateRigCapabilityProfile(profile);
  const binding = intent.rigBinding;
  if (binding.profileId !== profile.id || binding.profileRevision !== profile.revision ||
      binding.profileSha256 !== profile.sha256 || binding.candidateSha256 !== profile.asset.candidateSha256) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Manual intent does not bind the exact validated profile and candidate');
  }
  const ids = new Set();
  for (const side of ['left', 'right']) {
    const eventsByChannel = new Map();
    for (const event of intent.hands[side].events) {
      if (event.fromMs >= event.toMs || event.toMs > intent.durationMs || ids.has(event.id)) {
        throw new RigCapabilityError('SCHEMA.INVALID_MANUAL_INTENT', 'Event timing or identifier is invalid', {side, eventId: event.id});
      }
      ids.add(event.id);
      const channelEvents = eventsByChannel.get(event.channel) || [];
      if (channelEvents.some(previous => event.fromMs < previous.toMs && previous.fromMs < event.toMs)) {
        throw new RigCapabilityError('SCHEMA.INVALID_MANUAL_INTENT', 'Events on the same hand and channel must not overlap', {side, eventId: event.id, channel: event.channel});
      }
      channelEvents.push(event);
      eventsByChannel.set(event.channel, channelEvents);
    }
  }
  return intent;
}

// No manual channel has reviewed execution admission in this compiler.
function admitManualArticulatorExecution(intent, profile, candidateBytes) {
  validateManualArticulatorIntent(intent, profile);
  verifyCandidateAsset(profile, candidateBytes);
  const unsupportedDeclaredCapabilities = intent.requiredRigCapabilities.filter(capability =>
    !Object.hasOwn(profile.capabilities, capability) || profile.capabilities[capability] !== 'structurally_verified').sort();
  // Report every event independently of author-declared capabilities. This is
  // an unsupported-channel inventory, not an anatomical capability mapping.
  const unsupportedEvents = ['left', 'right'].flatMap(side =>
    intent.hands[side].events.map(event => ({
      side, eventId: event.id, channel: event.channel, intentRef: event.intentRef,
      reason: 'no-reviewed-execution-mapping',
    })));
  throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'Manual intent execution is not supported', {
    requiredCapability: 'compiler.manualArticulatorExecution',
    profileId: profile.id, profileRevision: profile.revision,
    profileSha256: profile.sha256, candidateSha256: profile.asset.candidateSha256,
    unsupportedDeclaredCapabilities, unsupportedEvents,
  });
}

module.exports = {validateManualArticulatorIntent, admitManualArticulatorExecution};
