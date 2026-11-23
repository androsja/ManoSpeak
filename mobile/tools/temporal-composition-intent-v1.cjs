'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const {createHash} = require('crypto');
const schema = require('../../schemas/temporal-composition-intent-v1.schema.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);
const CONTOUR_PARAMETER_KEYS = Object.freeze({
  line: ['end', 'start'],
  arc: ['center', 'radiusM', 'startAngleRad', 'sweepRad'],
  circle: ['center', 'radiusM', 'startAngleRad'],
  ellipse: ['center', 'majorRadiusM', 'minorRadiusM', 'startAngleRad'],
  spiral: ['center', 'endRadiusM', 'startAngleRad', 'startRadiusM', 'turns'],
  zigzag: ['amplitudeM', 'cycles', 'end', 'start'],
  'seven-shape': ['points'],
  spline: ['controlPoints'],
});

/** Expand track-local sequences onto a shared authoring timeline. Never emits motion commands. */
function compileTemporalCompositionIntent(source) {
  if (!validateSchema(source)) {
    throw new RigCapabilityError('SCHEMA.INVALID_TEMPORAL_INTENT', 'Invalid temporal composition intent', {errors: validateSchema.errors});
  }
  validatePhaseReferences(source.tracks);
  validateContours(source.tracks);
  const trackIds = new Set();
  const segmentIds = new Set();
  const timeline = [];
  for (const track of source.tracks) {
    if (trackIds.has(track.id)) throw new RigCapabilityError('SCHEMA.INVALID_TEMPORAL_INTENT', 'Track IDs must be unique', {trackId: track.id});
    trackIds.add(track.id);
    validateTrackPhases(track);
      validateRepeatedMovement(track);
    let cursor = track.startMs;
    for (const segment of track.segments) {
      if (segmentIds.has(segment.id)) throw new RigCapabilityError('SCHEMA.INVALID_TEMPORAL_INTENT', 'Segment IDs must be globally unique', {segmentId: segment.id});
      segmentIds.add(segment.id);
      const repeatCount = segment.repeatCount ?? 1;
      for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
        const toMs = cursor + segment.durationMs;
        if (toMs > source.durationMs) throw new RigCapabilityError('SCHEMA.INVALID_TEMPORAL_INTENT', 'Track exceeds composition duration', {trackId: track.id, segmentId: segment.id, iteration, toMs, durationMs: source.durationMs});
        timeline.push({trackId: track.id, channel: track.channel,
          segmentId: repeatCount === 1 ? segment.id : `${segment.id}.repeat-${String(iteration).padStart(4, '0')}`,
          phase: segment.phase, ...(segment.phaseRef ? {phaseRef: segment.phaseRef} : {}),
          timingProfile: segment.timingProfile ?? 'linear',
          iteration, fromMs: cursor, toMs, intentRef: segment.intentRef,
          ...(segment.contour ? {contour: deepFreeze(structuredClone(segment.contour))} : {}),
          ...(segment.repeatedMovement ? {repeatedMovement: deepFreeze(normalizeRepeatedMovement(segment.repeatedMovement, segment.durationMs))} : {})});
        cursor = toMs;
      }
    }
  }
  timeline.sort((a, b) => a.fromMs - b.fromMs || compareText(a.trackId, b.trackId) || compareText(a.segmentId, b.segmentId));
  validateManualChannelOverlaps(timeline);
  return Object.freeze({schema: 'vozual.temporal-authoring-timeline', formatVersion: 1,
    source: {id: source.id, revision: source.revision}, durationMs: source.durationMs,
    execution: 'authoring-only-not-executable', timeline: Object.freeze(timeline.map(Object.freeze))});
}

/** Serialize the non-executable authoring timeline with canonical object-key order and a content hash. */
function serializeTemporalAuthoringTimeline(source) {
  const timeline = compileTemporalCompositionIntent(source);
  const json = JSON.stringify(canonicalize(timeline));
  return Object.freeze({json, sha256: createHash('sha256').update(json, 'utf8').digest('hex')});
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

/** Return normalized authoring progress; this does not sample or emit a pose. */
function sampleAuthoringProgress(profile, elapsedMs, fromMs, toMs) {
  if (!['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(profile)) {
    throw new RigCapabilityError('TEMPORAL.INVALID_TIMING_PROFILE', 'Unsupported timing profile', {profile});
  }
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(fromMs) || !Number.isFinite(toMs)
    || !Number.isInteger(fromMs) || !Number.isInteger(toMs) || toMs <= fromMs
    || elapsedMs < fromMs || elapsedMs > toMs) {
    throw new RigCapabilityError('TEMPORAL.INVALID_TIME_SAMPLE', 'Time sample must lie within a positive segment including its terminal endpoint', {
      elapsedMs, fromMs, toMs,
    });
  }
  if (elapsedMs === fromMs) return 0;
  if (elapsedMs === toMs) return 1;
  const u = (elapsedMs - fromMs) / (toMs - fromMs);
  if (profile === 'ease-in') return u * u;
  if (profile === 'ease-out') return 1 - ((1 - u) * (1 - u));
  if (profile === 'ease-in-out') return (3 * u * u) - (2 * u * u * u);
  return u;
}

/** A phase reference groups authored segments by phase label, but never aligns their times. */
function validatePhaseReferences(tracks) {
  const phasesByReference = new Map();
  for (const track of tracks) {
    for (const segment of track.segments) {
      if (!segment.phaseRef) continue;
      const priorPhase = phasesByReference.get(segment.phaseRef);
      if (priorPhase && priorPhase !== segment.phase) {
        throw new RigCapabilityError('TEMPORAL.INVALID_PHASE_REFERENCE', 'A phase reference must use one phase label', {
          phaseRef: segment.phaseRef, priorPhase, phase: segment.phase, trackId: track.id, segmentId: segment.id,
        });
      }
      phasesByReference.set(segment.phaseRef, segment.phase);
    }
  }
}

/** Validate typed geometric authoring parameters without generating path samples. */
function validateContours(tracks) {
  for (const track of tracks) {
    for (const segment of track.segments) {
      const contour = segment.contour;
      if (!contour) continue;
      assertFiniteNumbers(contour, track.id, segment.id);
      if (segment.phase === 'hold') {
        throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'A hold phase cannot carry a movement contour', {
          trackId: track.id, segmentId: segment.id,
        });
      }
      const expectedKeys = CONTOUR_PARAMETER_KEYS[contour.kind];
      const actualKeys = Object.keys(contour.parameters).sort();
      if (!expectedKeys || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Contour kind and parameter shape do not match', {
          trackId: track.id, segmentId: segment.id, kind: contour.kind, actualKeys,
        });
      }
      const parameters = contour.parameters;
      const coordinateIndexes = contour.plane === 'xy' ? [0, 1, 2]
        : contour.plane === 'xz' ? [0, 2, 1] : [1, 2, 0];
      const normalIndex = coordinateIndexes[2];
      const assertInPlane = (point, name) => {
        if (point[normalIndex] !== 0) {
          throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Contour point must lie on its declared plane', {
            trackId: track.id, segmentId: segment.id, kind: contour.kind, point: name, plane: contour.plane,
          });
        }
      };
      const assertDistinct = (a, b, name) => {
        if (a.every((value, index) => value === b[index])) {
          throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Contour endpoints must be distinct', {
            trackId: track.id, segmentId: segment.id, kind: contour.kind, points: name,
          });
        }
      };
      const {kind} = contour;
      if (kind === 'line' || kind === 'zigzag') {
        assertInPlane(parameters.start, 'start');
        assertInPlane(parameters.end, 'end');
        assertDistinct(parameters.start, parameters.end, 'start/end');
      } else if (kind === 'arc' || kind === 'circle' || kind === 'ellipse' || kind === 'spiral') {
        assertInPlane(parameters.center, 'center');
        if (kind === 'ellipse' && parameters.majorRadiusM < parameters.minorRadiusM) {
          throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Ellipse major radius must be at least its minor radius', {
            trackId: track.id, segmentId: segment.id,
          });
        }
        if (kind === 'spiral' && parameters.startRadiusM === parameters.endRadiusM) {
          throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Spiral start and end radii must differ', {
            trackId: track.id, segmentId: segment.id,
          });
        }
      } else {
        const points = kind === 'seven-shape' ? parameters.points : parameters.controlPoints;
        points.forEach((point, index) => assertInPlane(point, `points[${index}]`));
        if (kind === 'seven-shape') {
          for (let index = 1; index < points.length; index += 1) {
            assertDistinct(points[index - 1], points[index], `${index - 1}/${index}`);
          }
        } else if ((points.length - 1) % 3 !== 0) {
          throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Cubic spline control point count must equal 3n + 1', {
            trackId: track.id, segmentId: segment.id, count: points.length,
          });
        }
      }
    }
  }
}

function assertFiniteNumbers(value, trackId, segmentId) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RigCapabilityError('TEMPORAL.INVALID_CONTOUR', 'Contour numeric values must be finite', {trackId, segmentId, value});
  }
  if (Array.isArray(value)) {
    value.forEach(item => assertFiniteNumbers(item, trackId, segmentId));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => assertFiniteNumbers(item, trackId, segmentId));
  }
}

/** Bound repeated-movement metadata without interpreting it as a physical trajectory. */
function validateRepeatedMovement(track) {
  for (const segment of track.segments) {
    const repeated = segment.repeatedMovement;
    if (!repeated) continue;
    assertFiniteNumbers(repeated, track.id, segment.id);
    if (segment.phase === 'hold') {
      throw new RigCapabilityError('TEMPORAL.INVALID_REPEATED_MOVEMENT', 'A hold phase cannot carry repeated movement parameters', {
        trackId: track.id, segmentId: segment.id,
      });
    }
    const cyclesPerOccurrence = repeated.rateHz * segment.durationMs / 1000;
    if (!Number.isFinite(cyclesPerOccurrence) || cyclesPerOccurrence <= 0 || cyclesPerOccurrence > 1000) {
      throw new RigCapabilityError('TEMPORAL.INVALID_REPEATED_MOVEMENT', 'Repeated movement must remain within (0, 1,000] derived cycles per occurrence', {
        trackId: track.id, segmentId: segment.id, cyclesPerOccurrence,
      });
    }
  }
}

function normalizeRepeatedMovement(repeated, durationMs) {
  return {
    ...repeated,
    accent: repeated.accent ?? 0,
    phaseOffsetRad: repeated.phaseOffsetRad ?? 0,
    cycleCountPerOccurrence: repeated.rateHz * durationMs / 1000,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Manual tracks for one hand cannot overlap; different hands and nonmanual tracks may. */
function validateManualChannelOverlaps(timeline) {
  const lastByChannel = new Map();
  for (const item of timeline) {
    if (item.channel !== 'manual.left' && item.channel !== 'manual.right') continue;
    const previous = lastByChannel.get(item.channel);
    if (previous && item.fromMs < previous.toMs) {
      throw new RigCapabilityError('TEMPORAL.CHANNEL_OVERLAP', 'Manual segments on the same hand channel cannot overlap', {
        channel: item.channel, previousSegmentId: previous.segmentId, segmentId: item.segmentId,
        previousToMs: previous.toMs, fromMs: item.fromMs,
      });
    }
    lastByChannel.set(item.channel, item);
  }
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Phase labels constrain authoring order only; they do not define sign semantics or playback. */
function validateTrackPhases(track) {
  let hasStarted = false;
  let strokeSeen = false;
  const containsStroke = track.segments.some(segment => segment.phase === 'stroke');
  let retractionSeen = false;
  for (const segment of track.segments) {
    if (retractionSeen) {
      throw new RigCapabilityError('TEMPORAL.INVALID_PHASE_ORDER', 'Retraction must be the final phase on a track', {
        trackId: track.id, segmentId: segment.id, phase: segment.phase,
      });
    }
    if (segment.phase === 'preparation' && hasStarted) {
      throw new RigCapabilityError('TEMPORAL.INVALID_PHASE_ORDER', 'Preparation must precede stroke, hold, and retraction phases', {
        trackId: track.id, segmentId: segment.id, phase: segment.phase,
      });
    }
    if (segment.phase === 'hold' && containsStroke && !strokeSeen) {
      throw new RigCapabilityError('TEMPORAL.INVALID_PHASE_ORDER', 'Hold must follow a stroke on a track that contains a stroke', {
        trackId: track.id, segmentId: segment.id, phase: segment.phase,
      });
    }
    if (segment.phase !== 'preparation') hasStarted = true;
    if (segment.phase === 'stroke') strokeSeen = true;
    if (segment.phase === 'retraction') retractionSeen = true;
  }
}

module.exports = {compileTemporalCompositionIntent, sampleAuthoringProgress, serializeTemporalAuthoringTimeline};
