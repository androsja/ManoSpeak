'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const {createHash} = require('crypto');
const bindingsSchema = require('../../schemas/nonmanual-intent-channel-bindings-v1.schema.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const validateBindings = new Ajv2020({allErrors: true, strict: true}).compile(bindingsSchema);

/** Link documented LSC intent refs to semantic DSL channels, without body controls or motion. */
function composeDocumentaryNonManualIntentChannels(source, bindingProfile) {
  if (!validateBindings(bindingProfile)) {
    fail('NONMANUAL.INTENT_BINDINGS_INVALID', 'Invalid abstract intent-to-channel binding profile', {
      errors: validateBindings.errors,
    });
  }
  validateDocumentaryCases(source);
  const channelById = new Map();
  for (const channel of bindingProfile.channels) {
    if (channelById.has(channel.id)) fail('NONMANUAL.INTENT_CHANNEL_DUPLICATE', 'Semantic channel IDs must be unique', {channelId: channel.id});
    channelById.set(channel.id, channel);
  }
  const bindingByIntent = new Map();
  for (const binding of bindingProfile.bindings) {
    if (bindingByIntent.has(binding.intentRef)) fail('NONMANUAL.INTENT_BINDING_DUPLICATE', 'Intent references must have one channel binding', {intentRef: binding.intentRef});
    if (!channelById.has(binding.channelId)) fail('NONMANUAL.INTENT_CHANNEL_UNKNOWN', 'Intent binding points to an undeclared semantic channel', binding);
    bindingByIntent.set(binding.intentRef, binding.channelId);
  }

  const cases = source.cases.map(item => {
    if (item.contrast) {
      return {caseId: item.id, context: item.context, structure: 'contrast',
        variants: [...item.contrast].sort((a, b) => a.order - b.order).map(variant => ({
          variantId: variant.id, order: variant.order, semanticIntentRef: variant.semanticIntentRef,
          channelIntents: resolveIntentRefs(variant.abstractNonmanualIntentRefs, bindingByIntent, item.id, variant.id),
        }))};
    }
    return {caseId: item.id, context: item.context, structure: 'ordered-perspective-segments',
      segments: [...item.segments].sort((a, b) => a.order - b.order).map(segment => ({
        segmentId: segment.id, order: segment.order, perspectiveRef: segment.perspectiveRef,
        channelIntents: resolveIntentRefs(segment.abstractNonmanualIntentRefs ?? [], bindingByIntent, item.id, segment.id),
      }))};
  }).sort((a, b) => compareText(a.caseId, b.caseId));

  const output = Object.freeze({schema: 'vozual.nonmanual-intent-channel-composition', formatVersion: 1,
    source: {id: source.id, revision: source.revision},
    semanticLayer: 'abstract-nonmanual-intent',
    execution: 'authoring-only-not-executable',
    nonClaims: ['No articulator or rig-control mapping', 'No movement values or ranges',
      'No exact timing or regional variant', 'No sign-production or linguistic-validity approval'],
    cases: cases.map(item => Object.freeze(item))});
  const canonicalJson = JSON.stringify(canonicalize(output));
  return Object.freeze({composition: output, canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex')});
}

function validateDocumentaryCases(source) {
  if (!source || source.schema !== 'vozual.nonmanual-documentary-intent-cases'
    || source.schemaVersion !== 1 || source.execution !== 'authoring-only-not-executable'
    || !Array.isArray(source.cases) || !source.cases.length) {
    fail('NONMANUAL.DOCUMENTARY_SOURCE_INVALID', 'Version-1 non-executable documentary intent cases required');
  }
  const caseIds = new Set();
  for (const item of source.cases) {
    if (!isId(item.id) || caseIds.has(item.id)) fail('NONMANUAL.DOCUMENTARY_CASE_ID', 'Documentary case IDs must be valid and unique', {caseId: item.id});
    caseIds.add(item.id);
    if (typeof item.context !== 'string' || !item.context.length) fail('NONMANUAL.DOCUMENTARY_CONTEXT', 'Each case requires its authored context', {caseId: item.id});
    if (item.physicalChannelMapping !== 'unmapped' || item.timing !== 'relative-order-only') {
      fail('NONMANUAL.DOCUMENTARY_SCOPE', 'Documentary cases must remain unmapped and relative-order-only', {caseId: item.id});
    }
    const collection = Array.isArray(item.contrast) ? item.contrast : item.segments;
    if (!Array.isArray(collection) || !collection.length || (item.contrast && item.segments)) {
      fail('NONMANUAL.DOCUMENTARY_STRUCTURE', 'Each case must contain either contrast variants or ordered perspective segments', {caseId: item.id});
    }
    let priorOrder = 0;
    const itemIds = new Set();
    for (const entry of collection) {
      if (!isId(entry.id) || itemIds.has(entry.id) || !Number.isInteger(entry.order) || entry.order <= priorOrder) {
        fail('NONMANUAL.DOCUMENTARY_ORDER', 'Variant/segment IDs must be unique and order values strictly increasing', {caseId: item.id, id: entry.id, order: entry.order});
      }
      itemIds.add(entry.id);
      priorOrder = entry.order;
      if (item.contrast && !isId(entry.semanticIntentRef)) fail('NONMANUAL.SEMANTIC_INTENT_MISSING', 'Contrast variants require an opaque semantic intent reference', {caseId: item.id, variantId: entry.id});
      if (item.segments && !isId(entry.perspectiveRef)) fail('NONMANUAL.PERSPECTIVE_REF_MISSING', 'Perspective segments require an opaque perspective reference', {caseId: item.id, segmentId: entry.id});
      if (entry.abstractNonmanualIntentRefs !== undefined
        && (!Array.isArray(entry.abstractNonmanualIntentRefs) || !entry.abstractNonmanualIntentRefs.every(isId))) {
        fail('NONMANUAL.ABSTRACT_INTENT_REFS_INVALID', 'Abstract non-manual intent references must be an array of IDs', {caseId: item.id, entryId: entry.id});
      }
    }
  }
}

function resolveIntentRefs(intentRefs, bindingByIntent, caseId, entryId) {
  const result = [];
  const channels = new Set();
  for (const intentRef of intentRefs) {
    const channelId = bindingByIntent.get(intentRef);
    if (!channelId) fail('NONMANUAL.INTENT_CHANNEL_UNBOUND', 'Abstract non-manual intent has no semantic channel binding', {caseId, entryId, intentRef});
    if (channels.has(channelId)) fail('NONMANUAL.SEMANTIC_CHANNEL_COLLISION', 'Two cues in one contrast variant/segment target the same semantic channel', {caseId, entryId, channelId});
    channels.add(channelId);
    result.push({channelId, intentRef});
  }
  return result.sort((a, b) => compareText(a.channelId, b.channelId) || compareText(a.intentRef, b.intentRef));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function isId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9._-]*$/.test(value);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fail(code, message, details) {
  throw new RigCapabilityError(code, message, details);
}

module.exports = {composeDocumentaryNonManualIntentChannels};
