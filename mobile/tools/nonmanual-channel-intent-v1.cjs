'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const {createHash} = require('crypto');
const schema = require('../../schemas/nonmanual-channel-intent-v1.schema.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

/** Compose abstract non-manual cues. This returns authoring references, never poses or frames. */
function compileNonManualChannelIntent(source) {
  if (!validateSchema(source)) {
    throw new RigCapabilityError('NONMANUAL.INVALID_INTENT', 'Invalid non-manual channel intent', {
      errors: validateSchema.errors,
    });
  }
  const ids = new Set();
  const timeline = [];
  for (const track of source.tracks) {
    if (ids.has(track.id)) {
      throw new RigCapabilityError('NONMANUAL.DUPLICATE_ID', 'Track IDs must be unique', {trackId: track.id});
    }
    ids.add(track.id);
    if (track.fromMs >= track.toMs || track.toMs > source.durationMs) {
      throw new RigCapabilityError('NONMANUAL.INVALID_INTERVAL', 'Track interval must satisfy 0 <= fromMs < toMs <= durationMs', {
        trackId: track.id, fromMs: track.fromMs, toMs: track.toMs, durationMs: source.durationMs,
      });
    }
    timeline.push({trackId: track.id, channel: track.channel, fromMs: track.fromMs, toMs: track.toMs,
      intentRef: track.intentRef, composition: 'exclusive-per-channel'});
  }
  const byChannel = [...timeline].sort((a, b) => compareText(a.channel, b.channel)
    || a.fromMs - b.fromMs || a.toMs - b.toMs || compareText(a.trackId, b.trackId));
  for (let index = 1; index < byChannel.length; index += 1) {
    const previous = byChannel[index - 1];
    const current = byChannel[index];
    if (current.channel === previous.channel && current.fromMs < previous.toMs) {
      throw new RigCapabilityError('NONMANUAL.CHANNEL_OVERLAP', 'Overlapping cues on one channel require an explicit supported composition policy', {
        channel: current.channel, previousTrackId: previous.trackId, trackId: current.trackId,
      });
    }
  }
  timeline.sort((a, b) => a.fromMs - b.fromMs || compareText(a.channel, b.channel) || compareText(a.trackId, b.trackId));
  const result = Object.freeze({schema: 'vozual.nonmanual-authoring-timeline', formatVersion: 1,
    source: Object.freeze({id: source.id, revision: source.revision}), durationMs: source.durationMs,
    execution: 'authoring-only-not-executable', combinationPolicy: 'independent-channels-exclusive-within-channel',
    timeline: Object.freeze(timeline.map(item => Object.freeze(item)))});
  const json = JSON.stringify(canonicalize(result));
  return Object.freeze({timeline: result, canonicalJson: json,
    sha256: createHash('sha256').update(json, 'utf8').digest('hex')});
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

module.exports = {compileNonManualChannelIntent};
