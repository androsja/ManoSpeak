jest.mock('../temporal-composition-intent-v1.cjs', () => ({
  serializeTemporalAuthoringTimeline: jest.fn(),
}));

const {compileSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const {serializeTemporalAuthoringTimeline} = require('../temporal-composition-intent-v1.cjs');
const spatialFixture = require('../../../schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

const bindingId = 'timeline.synthetic-guard-test';
const bindingRevision = 7;
const bindingDigest = 'a'.repeat(64);

function compileWithNormalizedSpan(fromMs, toMs, durationMs = 20) {
  const trackId = 'track.synthetic-guard-test';
  const segmentId = 'segment.synthetic-guard-test';
  const normalizedTimeline = {
    schema: 'vozual.temporal-authoring-timeline',
    formatVersion: 1,
    source: {id: bindingId, revision: bindingRevision},
    durationMs,
    execution: 'authoring-only-not-executable',
    timeline: [{
      trackId,
      segmentId,
      channel: 'manual.left',
      phase: 'stroke',
      iteration: 1,
      fromMs,
      toMs,
      intentRef: 'opaque.synthetic',
    }],
  };
  serializeTemporalAuthoringTimeline.mockReturnValue({
    json: JSON.stringify(normalizedTimeline),
    sha256: bindingDigest,
  });

  const draft = structuredClone(spatialFixture);
  draft.temporalTimelineBinding = {
    id: bindingId,
    revision: bindingRevision,
    sha256: bindingDigest,
  };
  draft.relations[0].temporalRefs = [{trackId, segmentId}];

  let trace;
  let thrown;
  try {
    trace = compileSpatialGrammarIntentV2(draft, profile, {});
  } catch (error) {
    thrown = error;
  }
  return {trace, thrown};
}

describe('spatial grammar v2 normalized temporal range defensive checks', () => {
  beforeEach(() => {
    serializeTemporalAuthoringTimeline.mockReset();
  });

  it.each([
    ['negative start', -1, 1, 20],
    ['zero-length span', 10, 10, 20],
    ['reversed span', 11, 10, 20],
    ['end beyond duration', 19, 21, 20],
  ])('rejects a synthetic normalized %s without returning a trace', (_caseName, fromMs, toMs, durationMs) => {
    const {trace, thrown} = compileWithNormalizedSpan(fromMs, toMs, durationMs);

    expect(trace).toBeUndefined();
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('SPATIAL.UNSAFE_TEMPORAL_RANGE');
    expect(serializeTemporalAuthoringTimeline).toHaveBeenCalledTimes(1);
  });
});
