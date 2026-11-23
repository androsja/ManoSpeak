'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const {createHash} = require('crypto');
const schema = require('../../schemas/nonmanual-channel-intent-v2.schema.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const BLEND_WEIGHT_SUM_TOLERANCE = 1e-6;
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

/** Resolve composition to opaque intent references. Never emits values, poses, or frames. */
function compileNonManualChannelIntentV2(source) {
  if (!validateSchema(source)) {
    throw new RigCapabilityError('NONMANUAL.INVALID_INTENT_V2', 'Invalid non-manual channel intent v2', {
      errors: validateSchema.errors,
    });
  }
  const ids = new Set();
  const tracksByChannel = new Map();
  for (const track of source.tracks) {
    if (ids.has(track.id)) fail('NONMANUAL.DUPLICATE_ID', 'Track IDs must be unique', {trackId: track.id});
    ids.add(track.id);
    if (track.fromMs >= track.toMs || track.toMs > source.durationMs) {
      fail('NONMANUAL.INVALID_INTERVAL', 'Track interval must satisfy 0 <= fromMs < toMs <= durationMs', {
        trackId: track.id, fromMs: track.fromMs, toMs: track.toMs, durationMs: source.durationMs,
      });
    }
    const descriptor = source.channels[track.channel];
    if (!descriptor) fail('NONMANUAL.CHANNEL_UNDECLARED', 'Every used channel needs an explicit descriptor', {channel: track.channel});
    validateOperationDescriptor(track, descriptor);
    if (!tracksByChannel.has(track.channel)) tracksByChannel.set(track.channel, []);
    tracksByChannel.get(track.channel).push(track);
  }

  const resolutions = [];
  for (const channel of [...tracksByChannel.keys()].sort(compareText)) {
    const tracks = tracksByChannel.get(channel);
    const boundaries = [...new Set(tracks.flatMap(track => [track.fromMs, track.toMs]))].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const fromMs = boundaries[index];
      const toMs = boundaries[index + 1];
      const active = tracks.filter(track => track.fromMs <= fromMs && track.toMs >= toMs)
        .sort((a, b) => compareText(a.id, b.id));
      if (!active.length) continue;
      const modes = new Set(active.map(track => track.composition.mode));
      if (modes.size !== 1) {
        fail('NONMANUAL.MIXED_OPERATIONS', 'Overlapping cues on one channel must use one composition mode', {
          channel, fromMs, toMs, modes: [...modes].sort(compareText), trackIds: active.map(track => track.id),
        });
      }
      const mode = active[0].composition.mode;
      if (mode === 'exclusive') {
        if (active.length > 1) fail('NONMANUAL.CHANNEL_OVERLAP', 'Exclusive cues on one channel cannot overlap', {
          channel, fromMs, toMs, trackIds: active.map(track => track.id),
        });
        resolutions.push({channel, fromMs, toMs, mode, operandRefs: [active[0].intentRef]});
      } else if (mode === 'override') {
        const highest = Math.max(...active.map(track => track.composition.priority));
        const winners = active.filter(track => track.composition.priority === highest);
        if (winners.length !== 1) fail('NONMANUAL.OVERRIDE_PRIORITY_TIE', 'Overlapping highest-priority cues are ambiguous', {
          channel, fromMs, toMs, priority: highest, trackIds: winners.map(track => track.id),
        });
        resolutions.push({channel, fromMs, toMs, mode, priority: highest,
          winnerRef: winners[0].intentRef,
          shadowedRefs: active.filter(track => track !== winners[0]).map(track => track.intentRef).sort(compareText)});
      } else if (mode === 'additive') {
        resolutions.push({channel, fromMs, toMs, mode, unit: source.channels[channel].unit,
          neutral: structuredClone(source.channels[channel].neutral), operandRefs: active.map(track => track.intentRef).sort(compareText)});
      } else {
        const groups = new Set(active.map(track => track.composition.compatibilityGroupId));
        if (groups.size !== 1) fail('NONMANUAL.BLEND_GROUP_MISMATCH', 'All active blend cues must share one compatibility group', {
          channel, fromMs, toMs, groups: [...groups].sort(compareText),
        });
        const weights = active.map(track => track.composition.weight);
        if (!blendWeightsSumToOne(weights)) {
          fail('NONMANUAL.BLEND_WEIGHT_SUM', 'Active blend weights must sum to 1 within absolute tolerance 1e-6', {
            channel, fromMs, toMs, weightSum: weights.reduce((sum, weight) => sum + weight, 0),
            tolerance: BLEND_WEIGHT_SUM_TOLERANCE,
          });
        }
        resolutions.push({channel, fromMs, toMs, mode, compatibilityGroupId: [...groups][0],
          operands: active.map(track => ({intentRef: track.intentRef, weight: track.composition.weight}))});
      }
    }
  }
  resolutions.sort((a, b) => a.fromMs - b.fromMs || compareText(a.channel, b.channel) || a.toMs - b.toMs);
  const result = Object.freeze({schema: 'vozual.nonmanual-authoring-timeline', formatVersion: 2,
    source: Object.freeze({id: source.id, revision: source.revision}), durationMs: source.durationMs,
    execution: 'authoring-only-not-executable', resolutions: Object.freeze(resolutions.map(Object.freeze))});
  const canonicalJson = JSON.stringify(canonicalize(result));
  return Object.freeze({timeline: result, canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex')});
}

// Sum the canonical JSON decimals exactly, including weights written in scientific notation.
// Binary addition can round opposite sides of the inclusive boundary to the same number.
function blendWeightsSumToOne(weights) {
  let places = 6;
  let sum = 0n;
  for (const weight of weights) {
    const [mantissa, exponent = '0'] = weight.toString().split('e');
    const [integer, fraction = ''] = mantissa.split('.');
    const weightPlaces = fraction.length - Number(exponent);
    if (weightPlaces > places) {
      sum *= 10n ** BigInt(weightPlaces - places);
      places = weightPlaces;
    }
    sum += BigInt(integer + fraction) * 10n ** BigInt(places - weightPlaces);
  }
  const one = 10n ** BigInt(places);
  const tolerance = one / 1_000_000n;
  return sum >= one - tolerance && sum <= one + tolerance;
}

function validateOperationDescriptor(track, descriptor) {
  const {mode} = track.composition;
  if (!descriptor.supportedOperations.includes(mode)) {
    fail('NONMANUAL.OPERATION_UNSUPPORTED', 'Channel descriptor does not declare this operation', {
      channel: track.channel, mode,
    });
  }
  if ((descriptor.domain === 'target-reference' || descriptor.domain === 'categorical-action')
    && !['exclusive', 'override'].includes(mode)) {
    fail('NONMANUAL.DOMAIN_OPERATION', 'Target and categorical channels support only exclusive or override operations', {
      channel: track.channel, domain: descriptor.domain, mode,
    });
  }
  if (mode === 'additive') {
    const neutralValid = descriptor.domain === 'scalar'
      ? typeof descriptor.neutral === 'number' && Number.isFinite(descriptor.neutral)
      : descriptor.domain === 'vector' && Array.isArray(descriptor.neutral)
        && descriptor.neutral.length === 3 && descriptor.neutral.every(Number.isFinite);
    if (!['scalar', 'vector'].includes(descriptor.domain) || typeof descriptor.unit !== 'string'
      || !descriptor.unit.length || !neutralValid) {
      fail('NONMANUAL.ADDITIVE_DESCRIPTOR', 'Additive channels require a scalar/vector domain, unit, and domain-matched neutral value', {
        channel: track.channel, domain: descriptor.domain,
      });
    }
  }
  if (mode === 'blend') {
    if (!['scalar', 'vector'].includes(descriptor.domain)
      || !descriptor.compatibilityGroups?.includes(track.composition.compatibilityGroupId)) {
      fail('NONMANUAL.BLEND_DESCRIPTOR', 'Blend requires a scalar/vector channel and a declared compatibility group', {
        channel: track.channel, domain: descriptor.domain,
        compatibilityGroupId: track.composition.compatibilityGroupId,
      });
    }
  }
}

function fail(code, message, details) {
  throw new RigCapabilityError(code, message, details);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

module.exports = {compileNonManualChannelIntentV2, BLEND_WEIGHT_SUM_TOLERANCE};
