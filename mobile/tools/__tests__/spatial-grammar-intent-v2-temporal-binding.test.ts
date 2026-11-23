const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {compileSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const {serializeTemporalAuthoringTimeline} = require('../temporal-composition-intent-v1.cjs');
const spatialFixture = require('../../../schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
const temporalFixture = require('../../../schemas/fixtures/temporal-composition-intent-v1/multichannel-contours.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

const repoRoot = path.resolve(__dirname, '../../..');
const cliPath = path.resolve(__dirname, '../compile-spatial-authoring-intent.cjs');
const profilePath = path.join(repoRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json');
let tempDirectory;

function bindDraftToTimeline(references) {
  const temporal = serializeTemporalAuthoringTimeline(temporalFixture);
  const normalizedTimeline = JSON.parse(temporal.json);
  const draft = structuredClone(spatialFixture);
  draft.temporalTimelineBinding = {
    id: normalizedTimeline.source.id,
    revision: normalizedTimeline.source.revision,
    sha256: temporal.sha256,
  };
  draft.relations[0].temporalRefs = references ?? [{
    trackId: normalizedTimeline.timeline[0].trackId,
    segmentId: normalizedTimeline.timeline[0].segmentId,
  }];
  return {draft, temporalIntent: temporalFixture, normalizedTimeline};
}

function expectCode(action, code) {
  let thrown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(thrown.code).toBe(code);
}

function writeJson(name, value) {
  const filePath = path.join(tempDirectory, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function invokeCli(draftPath, temporalPath) {
  return spawnSync(process.execPath, [cliPath, '--draft', draftPath, '--profile', profilePath, '--timeline', temporalPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('spatial grammar v2 temporal occurrence binding', () => {
  beforeAll(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spatial-temporal-binding-'));
  });

  afterAll(() => {
    const cleanedPath = tempDirectory;
    if (cleanedPath) fs.rmSync(cleanedPath, {recursive: true, force: true});
    expect(cleanedPath).toBeDefined();
    expect(fs.existsSync(cleanedPath)).toBe(false);
  });

  it('resolves one relation to exact Task 5 segment occurrences and inherits half-open times', () => {
    const {draft, temporalIntent, normalizedTimeline} = bindDraftToTimeline();
    const trace = compileSpatialGrammarIntentV2(draft, profile, temporalIntent);
    const resolved = trace.relations.find(relation => relation.id === draft.relations[0].id).temporalRefs[0];
    const expected = normalizedTimeline.timeline.find(segment =>
      segment.trackId === draft.relations[0].temporalRefs[0].trackId &&
      segment.segmentId === draft.relations[0].temporalRefs[0].segmentId);

    expect(trace).toMatchObject({
      execution: 'authoring-only-not-executable',
      linguisticReviewStatus: 'unreviewed',
      temporalTimelineBinding: draft.temporalTimelineBinding,
    });
    expect(resolved).toMatchObject({
      trackId: expected.trackId,
      segmentId: expected.segmentId,
      channel: expected.channel,
      phase: expected.phase,
      iteration: expected.iteration,
      fromMs: expected.fromMs,
      toMs: expected.toMs,
      resolutionStatus: 'resolved-within-bound-timeline',
    });
    expect(resolved.fromMs).toBeLessThan(resolved.toMs);
  });

  it('supports several exact segment occurrences and sorts their resolved provenance deterministically', () => {
    const temporal = serializeTemporalAuthoringTimeline(temporalFixture);
    const normalizedTimeline = JSON.parse(temporal.json);
    const chosen = normalizedTimeline.timeline.slice(0, 2);
    const references = chosen.map(segment => ({trackId: segment.trackId, segmentId: segment.segmentId}));
    const {draft, temporalIntent} = bindDraftToTimeline(references.reverse());
    const trace = compileSpatialGrammarIntentV2(draft, profile, temporalIntent);
    const resolved = trace.relations.find(relation => relation.id === draft.relations[0].id).temporalRefs;
    expect(resolved.map(reference => reference.fromMs))
      .toEqual([...resolved.map(reference => reference.fromMs)].sort((a, b) => a - b));
    expect(resolved).toHaveLength(2);
  });

  it('rejects missing timeline input and mismatched exact timeline digests', () => {
    const {draft, temporalIntent} = bindDraftToTimeline();
    expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SPATIAL.TEMPORAL_TIMELINE_REQUIRED');

    const mismatched = structuredClone(draft);
    mismatched.temporalTimelineBinding.sha256 = '0'.repeat(64);
    expectCode(() => compileSpatialGrammarIntentV2(mismatched, profile, temporalIntent), 'SPATIAL.TEMPORAL_TIMELINE_BINDING');
  });

  it.each([
    ['id', 'timeline.other'],
    ['revision', 2],
  ])('rejects a timeline %s mismatch without returning a trace', (field, value) => {
    const {draft, temporalIntent} = bindDraftToTimeline();
    draft.temporalTimelineBinding[field] = value;

    let trace;
    let thrown;
    try {
      trace = compileSpatialGrammarIntentV2(draft, profile, temporalIntent);
    } catch (error) {
      thrown = error;
    }

    expect(trace).toBeUndefined();
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('SPATIAL.TEMPORAL_TIMELINE_BINDING');
  });

  it('rejects unknown, duplicate, and empty temporal occurrence references', () => {
    const {draft: unknown, temporalIntent} = bindDraftToTimeline([{trackId: 'track.missing', segmentId: 'segment.missing'}]);
    expectCode(() => compileSpatialGrammarIntentV2(unknown, profile, temporalIntent), 'SPATIAL.UNKNOWN_TEMPORAL_REFERENCE');

    const {draft: duplicate} = bindDraftToTimeline();
    duplicate.relations[0].temporalRefs.push({...duplicate.relations[0].temporalRefs[0]});
    expectCode(() => compileSpatialGrammarIntentV2(duplicate, profile, temporalIntent), 'SCHEMA.INVALID_SPATIAL_INTENT_V2');

    const {draft: empty} = bindDraftToTimeline([]);
    expectCode(() => compileSpatialGrammarIntentV2(empty, profile, temporalIntent), 'SCHEMA.INVALID_SPATIAL_INTENT_V2');
  });

  it('rejects unsafe timeline duration before resolving a relation trace', () => {
    const temporalIntent = structuredClone(temporalFixture);
    temporalIntent.durationMs = Number.MAX_SAFE_INTEGER + 1;
    temporalIntent.tracks = [{
      id: 'track.safe-boundary', channel: 'manual.left', startMs: 0,
      segments: [{id: 'segment.safe-boundary', phase: 'stroke', durationMs: Number.MAX_SAFE_INTEGER + 1, intentRef: 'opaque.stroke'}],
    }];
    const temporal = serializeTemporalAuthoringTimeline(temporalIntent);
    const normalizedTimeline = JSON.parse(temporal.json);
    const draft = structuredClone(spatialFixture);
    draft.temporalTimelineBinding = {
      id: normalizedTimeline.source.id,
      revision: normalizedTimeline.source.revision,
      sha256: temporal.sha256,
    };
    draft.relations[0].temporalRefs = [{trackId: 'track.safe-boundary', segmentId: 'segment.safe-boundary'}];
    expectCode(() => compileSpatialGrammarIntentV2(draft, profile, temporalIntent), 'SPATIAL.UNSAFE_TEMPORAL_RANGE');
  });

  it('routes an exact v2 temporal binding through the CLI and emits no stdout on a digest mismatch', () => {
    const {draft, temporalIntent} = bindDraftToTimeline();
    const draftPath = writeJson('bound-draft', draft);
    const timelinePath = writeJson('timeline', temporalIntent);
    const valid = invokeCli(draftPath, timelinePath);
    expect(valid.error).toBeUndefined();
    expect(valid.status).toBe(0);
    expect(valid.stderr).toBe('');
    const output = JSON.parse(valid.stdout);
    expect(output.relations.find(relation => relation.id === draft.relations[0].id).temporalRefs).toHaveLength(1);

    draft.temporalTimelineBinding.sha256 = '0'.repeat(64);
    const invalid = invokeCli(writeJson('mismatched-binding', draft), timelinePath);
    expect(invalid.error).toBeUndefined();
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toMatch(/SPATIAL\.TEMPORAL_TIMELINE_BINDING/);
    expect(invalid.stdout).toBe('');
  });

  it.each([
    ['id', 'timeline.other'],
    ['revision', 2],
  ])('fails closed in the CLI on a timeline %s mismatch', (field, value) => {
    const {draft, temporalIntent} = bindDraftToTimeline();
    draft.temporalTimelineBinding[field] = value;
    const draftPath = writeJson(`mismatched-${field}`, draft);
    const timelinePath = writeJson(`timeline-${field}`, temporalIntent);

    const result = invokeCli(draftPath, timelinePath);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SPATIAL\.TEMPORAL_TIMELINE_BINDING/);
    expect(result.stdout).toBe('');
  });
});
