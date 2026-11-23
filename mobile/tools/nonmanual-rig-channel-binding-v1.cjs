'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../../schemas/nonmanual-rig-channel-profile-v1.schema.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

/** Check abstract channel bindings without resolving controls into transforms or frames. */
function validateNonManualRigChannelBindings(timeline, profile) {
  if (!timeline || timeline.schema !== 'vozual.nonmanual-authoring-timeline'
    || timeline.execution !== 'authoring-only-not-executable') {
    throw new RigCapabilityError('NONMANUAL.INVALID_TIMELINE', 'Non-executable non-manual authoring timeline required');
  }
  const entries = timeline.formatVersion === 1 ? timeline.timeline
    : timeline.formatVersion === 2 ? timeline.resolutions : undefined;
  if (!Array.isArray(entries) || !entries.length || !entries.every(entry =>
    schema.properties.channels.propertyNames.enum.includes(entry?.channel))) {
    throw new RigCapabilityError('NONMANUAL.INVALID_TIMELINE', 'Expected authored channels for this timeline version');
  }
  if (!validateSchema(profile)) {
    throw new RigCapabilityError('NONMANUAL.INVALID_RIG_CHANNEL_PROFILE', 'Invalid non-manual rig channel profile', {
      errors: validateSchema.errors,
    });
  }
  const controls = new Map();
  for (const control of profile.controls) {
    if (controls.has(control.id)) {
      throw new RigCapabilityError('NONMANUAL.DUPLICATE_RIG_CONTROL', 'Rig control IDs must be unique', {controlId: control.id});
    }
    controls.set(control.id, control);
  }
  const channels = [...new Set(entries.map(item => item.channel))].sort(compareText);
  const bindings = [];
  for (const channel of channels) {
    const binding = profile.channels[channel];
    if (!binding) {
      throw new RigCapabilityError('NONMANUAL.RIG_BINDING_MISSING', 'Rig profile has no binding decision for an authored channel', {
        profileId: profile.profileId, channel,
      });
    }
    if (binding.status === 'unsupported') {
      throw new RigCapabilityError('NONMANUAL.RIG_CHANNEL_UNSUPPORTED', 'Rig profile explicitly marks an authored channel unsupported', {
        profileId: profile.profileId, channel, reason: binding.reason,
      });
    }
    const control = controls.get(binding.controlId);
    if (!control) {
      throw new RigCapabilityError('NONMANUAL.RIG_CONTROL_MISSING', 'Binding references a control absent from the rig profile inventory', {
        profileId: profile.profileId, channel, controlId: binding.controlId,
      });
    }
    bindings.push({channel, controlId: control.id, controlType: control.type,
      review: {reviewerId: binding.reviewerId, evidenceRef: binding.reviewEvidenceRef}});
  }
  return Object.freeze({schema: 'vozual.nonmanual-rig-binding-review', formatVersion: 1,
    execution: 'authoring-only-not-executable', profile: {id: profile.profileId, revision: profile.revision},
    bindings: Object.freeze(bindings.map(Object.freeze))});
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

module.exports = {validateNonManualRigChannelBindings};
