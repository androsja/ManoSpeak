const fs = require('fs');
const path = require('path');
const {compileTemporalCompositionIntent, sampleAuthoringProgress, serializeTemporalAuthoringTimeline} = require('../temporal-composition-intent-v1.cjs');
const goldenSource = require('../../../schemas/fixtures/temporal-composition-intent-v1/multichannel-contours.json');

const source = {
  schema: 'vozual.temporal-composition-intent', schemaVersion: 1,
  id: 'fixture.bilateral-sequence', revision: 1, durationMs: 1000,
  tracks: [
    {id: 'left-track', channel: 'manual.left', startMs: 0, segments: [
      {id: 'left-prepare', phase: 'preparation', durationMs: 200, intentRef: 'opaque.left.prepare'},
      {id: 'left-stroke', phase: 'stroke', phaseRef: 'phase.shared-stroke', durationMs: 300, intentRef: 'opaque.left.stroke'},
    ]},
    {id: 'right-track', channel: 'manual.right', startMs: 100, segments: [
      {id: 'right-stroke', phase: 'stroke', durationMs: 400, intentRef: 'opaque.right.stroke'},
      {id: 'right-hold', phase: 'hold', durationMs: 200, intentRef: 'opaque.right.hold'},
    ]},
  ],
  execution: 'authoring-only-not-executable',
};

const contourCases = [
  ['line', {start: [0, 0, 0], end: [0.2, 0.1, 0]}],
  ['arc', {center: [0, 0, 0], radiusM: 0.1, startAngleRad: 0, sweepRad: 1.2}],
  ['circle', {center: [0, 0, 0], radiusM: 0.1, startAngleRad: 0}],
  ['ellipse', {center: [0, 0, 0], majorRadiusM: 0.2, minorRadiusM: 0.1, startAngleRad: 0}],
  ['spiral', {center: [0, 0, 0], startRadiusM: 0.02, endRadiusM: 0.12, turns: 2, startAngleRad: 0}],
  ['zigzag', {start: [0, 0, 0], end: [0.3, 0, 0], amplitudeM: 0.04, cycles: 3}],
  ['seven-shape', {points: [[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0], [0.3, 0, 0], [0.4, 0, 0], [0.5, 0, 0], [0.6, 0, 0]]}],
  ['spline', {controlPoints: [[0, 0, 0], [0.1, 0.1, 0], [0.2, 0.1, 0], [0.3, 0, 0]]}],
];

function makeContour(kind, parameters, overrides = {}) {
  return {kind, coordinateFrameRef: 'frame.body', unit: 'm', plane: 'xy', direction: 'forward', parameters, ...overrides};
}

describe('temporal composition authoring timeline', () => {
  it('expands sequential segments and parallel tracks deterministically', () => {
    const a = compileTemporalCompositionIntent(source);
    const b = compileTemporalCompositionIntent(structuredClone(source));
    expect(a).toEqual(b);
    expect(a.execution).toBe('authoring-only-not-executable');
    expect(a.timeline).toEqual([
      {trackId: 'left-track', channel: 'manual.left', segmentId: 'left-prepare', phase: 'preparation', timingProfile: 'linear', iteration: 1, fromMs: 0, toMs: 200, intentRef: 'opaque.left.prepare'},
      {trackId: 'right-track', channel: 'manual.right', segmentId: 'right-stroke', phase: 'stroke', timingProfile: 'linear', iteration: 1, fromMs: 100, toMs: 500, intentRef: 'opaque.right.stroke'},
      {trackId: 'left-track', channel: 'manual.left', segmentId: 'left-stroke', phase: 'stroke', phaseRef: 'phase.shared-stroke', timingProfile: 'linear', iteration: 1, fromMs: 200, toMs: 500, intentRef: 'opaque.left.stroke'},
      {trackId: 'right-track', channel: 'manual.right', segmentId: 'right-hold', phase: 'hold', timingProfile: 'linear', iteration: 1, fromMs: 500, toMs: 700, intentRef: 'opaque.right.hold'},
    ]);
  });

  it('expands repetitions into exact adjacent intervals with stable occurrence IDs', () => {
    const repeated = structuredClone(source);
    repeated.durationMs = 800;
    repeated.tracks[0].segments = [{id: 'left-pulse', phase: 'stroke', durationMs: 100, repeatCount: 3, intentRef: 'opaque.left.pulse'}];
    repeated.tracks[1].segments = [{id: 'right-hold', phase: 'hold', durationMs: 100, intentRef: 'opaque.right.hold'}];
    const result = compileTemporalCompositionIntent(repeated);
    expect(result.timeline.filter(x => x.trackId === 'left-track')).toEqual([
      {trackId: 'left-track', channel: 'manual.left', segmentId: 'left-pulse.repeat-0001', phase: 'stroke', timingProfile: 'linear', iteration: 1, fromMs: 0, toMs: 100, intentRef: 'opaque.left.pulse'},
      {trackId: 'left-track', channel: 'manual.left', segmentId: 'left-pulse.repeat-0002', phase: 'stroke', timingProfile: 'linear', iteration: 2, fromMs: 100, toMs: 200, intentRef: 'opaque.left.pulse'},
      {trackId: 'left-track', channel: 'manual.left', segmentId: 'left-pulse.repeat-0003', phase: 'stroke', timingProfile: 'linear', iteration: 3, fromMs: 200, toMs: 300, intentRef: 'opaque.left.pulse'},
    ]);
    expect(result.execution).toBe('authoring-only-not-executable');
  });

  it('rejects duplicate track or segment IDs and timelines beyond duration', () => {
    const duplicateTrack = structuredClone(source);
    duplicateTrack.tracks[1].id = duplicateTrack.tracks[0].id;
    expect(() => compileTemporalCompositionIntent(duplicateTrack)).toThrow(/Track IDs must be unique/);

    const duplicateSegment = structuredClone(source);
    duplicateSegment.tracks[1].segments[0].id = duplicateSegment.tracks[0].segments[0].id;
    expect(() => compileTemporalCompositionIntent(duplicateSegment)).toThrow(/Segment IDs must be globally unique/);

    const overflow = structuredClone(source);
    overflow.durationMs = 600;
    expect(() => compileTemporalCompositionIntent(overflow)).toThrow(/exceeds composition duration/);
  });

  it('allows preparation, repeated stroke and hold cycles, then final retraction', () => {
    const phased = structuredClone(source);
    phased.durationMs = 1200;
    phased.tracks[0].segments = [
      {id: 'prep', phase: 'preparation', durationMs: 100, intentRef: 'opaque.prep'},
      {id: 'stroke-a', phase: 'stroke', durationMs: 100, intentRef: 'opaque.stroke-a'},
      {id: 'hold-a', phase: 'hold', durationMs: 50, intentRef: 'opaque.hold-a'},
      {id: 'stroke-b', phase: 'stroke', durationMs: 100, intentRef: 'opaque.stroke-b'},
      {id: 'retract', phase: 'retraction', durationMs: 100, intentRef: 'opaque.retract'},
    ];
    const timeline = compileTemporalCompositionIntent(phased).timeline.filter(x => x.trackId === 'left-track');
    expect(timeline.map(x => x.phase)).toEqual(['preparation', 'stroke', 'hold', 'stroke', 'retraction']);
    expect(timeline.slice(1).every((item, index) => timeline[index].toMs === item.fromMs)).toBe(true);
  });

  it('rejects preparation after movement and any phase after retraction', () => {
    const latePreparation = structuredClone(source);
    latePreparation.tracks[0].segments = [
      {id: 'stroke-first', phase: 'stroke', durationMs: 100, intentRef: 'opaque.stroke'},
      {id: 'prep-late', phase: 'preparation', durationMs: 100, intentRef: 'opaque.prep'},
    ];
    expect(() => compileTemporalCompositionIntent(latePreparation)).toThrow(/Preparation must precede/);

    const afterRetraction = structuredClone(source);
    afterRetraction.tracks[0].segments = [
      {id: 'retract-first', phase: 'retraction', durationMs: 100, intentRef: 'opaque.retract'},
      {id: 'stroke-late', phase: 'stroke', durationMs: 100, intentRef: 'opaque.stroke'},
    ];
    expect(() => compileTemporalCompositionIntent(afterRetraction)).toThrow(/Retraction must be the final phase/);

    const holdBeforeStroke = structuredClone(source);
    holdBeforeStroke.tracks[0].segments = [
      {id: 'hold-first', phase: 'hold', durationMs: 100, intentRef: 'opaque.hold'},
      {id: 'stroke-late', phase: 'stroke', durationMs: 100, intentRef: 'opaque.stroke'},
    ];
    expect(() => compileTemporalCompositionIntent(holdBeforeStroke)).toThrow(/Hold must follow a stroke/);
  });

  it('preserves an opaque phase reference without treating it as synchronized timing', () => {
    const result = compileTemporalCompositionIntent(source);
    const leftStroke = result.timeline.find(x => x.segmentId === 'left-stroke');
    expect(leftStroke.phaseRef).toBe('phase.shared-stroke');
    expect(leftStroke.fromMs).toBe(200);
    expect(result.execution).toBe('authoring-only-not-executable');
  });

  it('requires a shared phase reference to keep one phase label', () => {
    const mismatchedReference = structuredClone(source);
    mismatchedReference.tracks[1].segments[1].phaseRef = 'phase.shared-stroke';
    expect(() => compileTemporalCompositionIntent(mismatchedReference)).toThrow(/must use one phase label/);
  });

  it('uses linear timing by default and preserves exact segment endpoints', () => {
    const result = compileTemporalCompositionIntent(source);
    const leftStroke = result.timeline.find(x => x.segmentId === 'left-stroke');
    expect(leftStroke.timingProfile).toBe('linear');
    for (const profile of ['linear', 'ease-in', 'ease-out', 'ease-in-out']) {
      expect(sampleAuthoringProgress(profile, 200, 200, 500)).toBe(0);
      expect(sampleAuthoringProgress(profile, 500, 200, 500)).toBe(1);
    }
  });

  it('evaluates named scalar timing profiles deterministically', () => {
    expect(sampleAuthoringProgress('linear', 250, 0, 1000)).toBe(0.25);
    expect(sampleAuthoringProgress('ease-in', 500, 0, 1000)).toBe(0.25);
    expect(sampleAuthoringProgress('ease-out', 500, 0, 1000)).toBe(0.75);
    expect(sampleAuthoringProgress('ease-in-out', 500, 0, 1000)).toBe(0.5);
  });

  it('rejects unsupported timing profiles and samples outside the segment', () => {
    expect(() => sampleAuthoringProgress('spring', 500, 0, 1000)).toThrow(/Unsupported timing profile/);
    expect(() => sampleAuthoringProgress('linear', -1, 0, 1000)).toThrow(/Time sample must lie/);
    expect(() => sampleAuthoringProgress('linear', 0, 5, 5)).toThrow(/Time sample must lie/);

    const unknownProfile = structuredClone(source);
    unknownProfile.tracks[0].segments[0].timingProfile = 'spring';
    expect(() => compileTemporalCompositionIntent(unknownProfile)).toThrow();
  });

  it.each(contourCases)('preserves typed %s contour intent without sampling it', (kind, parameters) => {
    const withContour = structuredClone(source);
    withContour.tracks[0].segments[1].contour = makeContour(kind, parameters, {direction: 'reverse'});
    const result = compileTemporalCompositionIntent(withContour);
    const item = result.timeline.find(x => x.segmentId === 'left-stroke');
    expect(item.contour).toEqual(makeContour(kind, parameters, {direction: 'reverse'}));
    expect(Object.isFrozen(item.contour)).toBe(true);
    expect(Object.isFrozen(item.contour.parameters)).toBe(true);
    expect(result.execution).toBe('authoring-only-not-executable');
  });

  it.each(['xy', 'xz', 'yz'])('accepts line coordinates on the declared %s plane', plane => {
    const withContour = structuredClone(source);
    const points = plane === 'xy' ? [[0, 0, 0], [0.2, 0.1, 0]]
      : plane === 'xz' ? [[0, 0, 0], [0.2, 0, 0.1]] : [[0, 0, 0], [0, 0.2, 0.1]];
    withContour.tracks[0].segments[1].contour = makeContour('line', {start: points[0], end: points[1]}, {plane});
    expect(() => compileTemporalCompositionIntent(withContour)).not.toThrow();
  });

  it('rejects malformed contour domains, plane coordinates, and phase placement', () => {
    const invalid = [
      makeContour('line', {start: [0, 0, 0], end: [0, 0, 0]}),
      makeContour('line', {start: [0, 0, 0.01], end: [0.2, 0, 0]}),
      makeContour('ellipse', {center: [0, 0, 0], majorRadiusM: 0.1, minorRadiusM: 0.2, startAngleRad: 0}),
      makeContour('spiral', {center: [0, 0, 0], startRadiusM: 0.1, endRadiusM: 0.1, turns: 2, startAngleRad: 0}),
      makeContour('arc', {center: [0, 0, 0], radiusM: 0.1, startAngleRad: 0, sweepRad: 2 * Math.PI}),
      makeContour('zigzag', {start: [0, 0, 0], end: [0.3, 0, 0], amplitudeM: 0.04, cycles: 0}),
      makeContour('seven-shape', {points: [[0, 0, 0], [0.1, 0, 0], [0.1, 0, 0], [0.3, 0, 0], [0.4, 0, 0], [0.5, 0, 0], [0.6, 0, 0]]}),
      makeContour('spline', {controlPoints: [[0, 0, 0], [0.1, 0.1, 0], [0.2, 0.1, 0], [0.3, 0, 0], [0.4, 0, 0]]}),
      makeContour('circle', {center: [0, 0, 0], radiusM: 0.1, startAngleRad: 0}, {unit: 'cm'}),
      makeContour('line', {start: [Infinity, 0, 0], end: [0.2, 0, 0]}),
    ];
    for (const contour of invalid) {
      const withContour = structuredClone(source);
      withContour.tracks[0].segments[1].contour = contour;
      expect(() => compileTemporalCompositionIntent(withContour)).toThrow();
    }

    const holdContour = structuredClone(source);
    holdContour.tracks[1].segments[1].contour = makeContour('circle', {center: [0, 0, 0], radiusM: 0.1, startAngleRad: 0});
    expect(() => compileTemporalCompositionIntent(holdContour)).toThrow(/hold phase cannot carry/);
  });

  it('requires contour kind and parameter shape to match', () => {
    const mismatch = structuredClone(source);
    mismatch.tracks[0].segments[1].contour = makeContour('circle', {start: [0, 0, 0], end: [0.2, 0, 0]});
    expect(() => compileTemporalCompositionIntent(mismatch)).toThrow(/kind and parameter shape do not match/);
  });

  it.each(['oscillation', 'vibration', 'brush'])('preserves %s parameters and derives cycles per occurrence', kind => {
    const repeated = structuredClone(source);
    repeated.durationMs = 2500;
    repeated.tracks[0].segments[1].durationMs = 1000;
    repeated.tracks[0].segments[1].repeatCount = 2;
    repeated.tracks[0].segments[1].repeatedMovement = {
      kind, amplitudeM: 0.05, rateHz: 2, accent: 0.6, phaseOffsetRad: 1.2,
      maxAccelerationMPerS2: 4, maxJerkMPerS3: 20,
    };
    const result = compileTemporalCompositionIntent(repeated);
    const occurrences = result.timeline.filter(x => x.trackId === 'left-track' && x.segmentId.startsWith('left-stroke'));
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(x => x.repeatedMovement.cycleCountPerOccurrence)).toEqual([2, 2]);
    expect(occurrences[0].repeatedMovement).toMatchObject({kind, amplitudeM: 0.05, rateHz: 2, accent: 0.6, phaseOffsetRad: 1.2});
    expect(Object.isFrozen(occurrences[0].repeatedMovement)).toBe(true);
    expect(result.execution).toBe('authoring-only-not-executable');
  });

  it('defaults repeated movement accent and phase offset without changing segment repetition', () => {
    const repeated = structuredClone(source);
    repeated.durationMs = 2000;
    repeated.tracks[0].segments[1].durationMs = 500;
    repeated.tracks[0].segments[1].repeatCount = 3;
    repeated.tracks[0].segments[1].repeatedMovement = {kind: 'oscillation', amplitudeM: 0.02, rateHz: 2};
    const result = compileTemporalCompositionIntent(repeated);
    const occurrences = result.timeline.filter(x => x.trackId === 'left-track' && x.segmentId.startsWith('left-stroke'));
    expect(occurrences.map(x => x.repeatedMovement.cycleCountPerOccurrence)).toEqual([1, 1, 1]);
    expect(occurrences[0].repeatedMovement).toMatchObject({accent: 0, phaseOffsetRad: 0});
  });

  it('rejects repeated movement outside bounded parameter and duration domains', () => {
    const invalid = [
      {kind: 'oscillation', amplitudeM: 0, rateHz: 2},
      {kind: 'vibration', amplitudeM: 1.01, rateHz: 2},
      {kind: 'brush', amplitudeM: 0.05, rateHz: 101},
      {kind: 'oscillation', amplitudeM: 0.05, rateHz: 2, accent: 1.1},
      {kind: 'oscillation', amplitudeM: 0.05, rateHz: 2, phaseOffsetRad: 2 * Math.PI},
      {kind: 'oscillation', amplitudeM: 0.05, rateHz: 2, maxAccelerationMPerS2: -1},
      {kind: 'oscillation', amplitudeM: 0.05, rateHz: Infinity},
    ];
    for (const repeatedMovement of invalid) {
      const invalidSource = structuredClone(source);
      invalidSource.tracks[0].segments[1].repeatedMovement = repeatedMovement;
      expect(() => compileTemporalCompositionIntent(invalidSource)).toThrow();
    }

    const excessiveCycles = structuredClone(source);
    excessiveCycles.durationMs = 11000;
    excessiveCycles.tracks[0].segments[1].durationMs = 10001;
    excessiveCycles.tracks[0].segments[1].repeatedMovement = {kind: 'oscillation', amplitudeM: 0.05, rateHz: 100};
    expect(() => compileTemporalCompositionIntent(excessiveCycles)).toThrow(/derived cycles per occurrence/);
  });

  it('rejects repeated movement on a hold phase', () => {
    const holdMovement = structuredClone(source);
    holdMovement.tracks[1].segments[1].repeatedMovement = {kind: 'vibration', amplitudeM: 0.01, rateHz: 5};
    expect(() => compileTemporalCompositionIntent(holdMovement)).toThrow(/hold phase cannot carry repeated movement/);
  });

  it('composes both hands and nonmanual tracks concurrently with stable ordering', () => {
    const multiChannel = structuredClone(source);
    multiChannel.tracks[0].startMs = 0;
    multiChannel.tracks[1].startMs = 100;
    multiChannel.tracks.push({id: 'nonmanual-track', channel: 'nonmanual', startMs: 100, segments: [
      {id: 'face-cue', phase: 'stroke', durationMs: 500, intentRef: 'opaque.nonmanual.cue'},
    ]});
    const ordered = compileTemporalCompositionIntent(multiChannel);
    const permuted = structuredClone(multiChannel);
    permuted.tracks.reverse();
    expect(compileTemporalCompositionIntent(permuted)).toEqual(ordered);
    expect(ordered.timeline.filter(item => item.fromMs === 100).map(item => item.trackId)).toEqual(['nonmanual-track', 'right-track']);
    expect(ordered.execution).toBe('authoring-only-not-executable');
  });

  it('rejects overlapping tracks on the same manual hand but allows adjacent intervals', () => {
    const overlapping = structuredClone(source);
    overlapping.tracks.push({id: 'left-overlay', channel: 'manual.left', startMs: 100, segments: [
      {id: 'left-overlay-stroke', phase: 'stroke', durationMs: 100, intentRef: 'opaque.left.overlay'},
    ]});
    expect(() => compileTemporalCompositionIntent(overlapping)).toThrow(/same hand channel cannot overlap/);

    const adjacent = structuredClone(source);
    adjacent.tracks.push({id: 'left-adjacent', channel: 'manual.left', startMs: 500, segments: [
      {id: 'left-adjacent-stroke', phase: 'stroke', durationMs: 100, intentRef: 'opaque.left.adjacent'},
    ]});
    expect(() => compileTemporalCompositionIntent(adjacent)).not.toThrow();
  });

  it('matches the canonical multichannel contour golden artifact', () => {
    const actual = serializeTemporalAuthoringTimeline(goldenSource);
    const expected = fs.readFileSync(path.join(__dirname, '../../../schemas/fixtures/temporal-composition-intent-v1/multichannel-contours.expected.json'), 'utf8').trim();
    expect(actual.json).toBe(expected);
    expect(actual.sha256).toBe('d244c48cbeb00f7dcf1e1b6683da038a1223c17780cdcabe0619a6469ce98ac6');
    const kinds = [...new Set(compileTemporalCompositionIntent(goldenSource).timeline.flatMap(item => item.contour ? [item.contour.kind] : []))].sort();
    expect(kinds).toEqual(['arc', 'circle', 'ellipse', 'line', 'seven-shape', 'spiral', 'spline', 'zigzag']);
  });

  it('keeps canonical bytes and hash stable across key and track order', () => {
    const reverseObjectKeys = value => {
      if (Array.isArray(value)) return value.map(reverseObjectKeys);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
      }
      return value;
    };
    const reordered = reverseObjectKeys(goldenSource);
    reordered.tracks.reverse();
    expect(serializeTemporalAuthoringTimeline(reordered)).toEqual(serializeTemporalAuthoringTimeline(goldenSource));
  });

  it('preserves half-open timing invariants over a deterministic composition matrix', () => {
    for (const count of [1, 2, 3, 7, 16, 32, 100]) {
      const generated = structuredClone(source);
      generated.durationMs = count * 7;
      generated.tracks = [{id: 'generated-track', channel: 'manual.left', startMs: 0, segments: [
        {id: 'generated-stroke', phase: 'stroke', durationMs: 7, repeatCount: count, intentRef: 'opaque.generated'},
      ]}];
      const timeline = compileTemporalCompositionIntent(generated).timeline;
      expect(timeline).toHaveLength(count);
      for (let index = 0; index < timeline.length; index += 1) {
        expect(timeline[index].fromMs).toBe(index * 7);
        expect(timeline[index].toMs).toBe((index + 1) * 7);
        expect(timeline[index].fromMs).toBeLessThan(timeline[index].toMs);
        expect(timeline[index].toMs).toBeLessThanOrEqual(generated.durationMs);
      }
    }
  });

  it('preserves contour units, plane, direction and geometry across a deterministic variant matrix', () => {
    for (const [kind, parameters] of contourCases) {
      for (const direction of ['forward', 'reverse']) {
        const variant = structuredClone(source);
        variant.tracks[0].segments[1].contour = makeContour(kind, parameters, {direction, plane: 'xy'});
        const result = compileTemporalCompositionIntent(variant);
        const item = result.timeline.find(entry => entry.segmentId === 'left-stroke');
        expect(item.contour).toMatchObject({kind, unit: 'm', plane: 'xy', direction, parameters});
        expect(serializeTemporalAuthoringTimeline(variant)).toEqual(serializeTemporalAuthoringTimeline(structuredClone(variant)));
      }
    }
  });

  it('rejects executable promotion and unknown fields', () => {
    const promoted = structuredClone(source);
    promoted.execution = 'executable';
    expect(() => compileTemporalCompositionIntent(promoted)).toThrow();
    const motion = structuredClone(source);
    motion.tracks[0].segments[0].jointAnglesDeg = {finger: 20};
    expect(() => compileTemporalCompositionIntent(motion)).toThrow();
    const unsupportedOperator = structuredClone(source);
    unsupportedOperator.tracks[0].segments[1].operator = 'mirror';
    expect(() => compileTemporalCompositionIntent(unsupportedOperator)).toThrow();
  });
});
