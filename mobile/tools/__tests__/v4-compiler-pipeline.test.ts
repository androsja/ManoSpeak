const fs = require('fs');
const path = require('path');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {CompilerPipelineError, compileV4DiagnosticPipeline, compileTemporalAuthoringIR} = require('../v4-compiler-pipeline.cjs');
const temporalComposition = require('../../../schemas/fixtures/temporal-composition-intent-v1/multichannel-contours.json');
const expectedTemporalTimeline = require('../../../schemas/fixtures/temporal-composition-intent-v1/multichannel-contours.expected.json');

const repositoryRoot = path.resolve(__dirname, '../../..');
const candidateBytes = fs.readFileSync(path.join(repositoryRoot,
  '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

function fixture() {
  return {
    schema: 'vozual.motion-source',
    schemaVersion: 4,
    purpose: 'rig-conformance',
    id: 'task9-diagnostic-pipeline-fixture',
    revision: 1,
    linguisticIntent: {requiredRigCapabilities: ['arm.parentHierarchy']},
    temporalGraph: {nodes: []},
    constraints: {reachabilityProbes: []},
    rigRealizationOverrides: {},
    provenanceAndReview: {technicalConformanceOnly: true},
  };
}

describe('v4 diagnostic compiler pipeline', () => {
  it('builds an immutable IR and byte-identical artifact/report from equivalent source inputs', () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const fromObject = compileV4DiagnosticPipeline(source, profile, candidateBytes, {evidenceRoot: repositoryRoot});
    const fromJson = compileV4DiagnosticPipeline(JSON.stringify(source), profile, candidateBytes, {evidenceRoot: repositoryRoot});

    expect(fromObject.artifactCanonicalJson).toBe(fromJson.artifactCanonicalJson);
    expect(fromObject.reportCanonicalJson).toBe(fromJson.reportCanonicalJson);
    expect(fromObject.publicationCandidateCanonicalJson).toBe(fromJson.publicationCandidateCanonicalJson);
    expect(fromObject.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fromObject.reportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fromObject.publicationCandidateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fromObject.typedIR.sourceSha256).toBe(fromObject.report.source.sha256);
    expect(Object.isFrozen(fromObject.typedIR)).toBe(true);
    expect(Object.isFrozen(fromObject.typedIR.source)).toBe(true);
    expect(Object.isFrozen(fromObject.typedIR.constraints)).toBe(true);
    expect(Object.isFrozen(fromObject.artifact)).toBe(true);
    expect(Object.isFrozen(fromObject.publicationCandidate)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    expect(fromObject.report.passes).toEqual(expect.arrayContaining([
      {id: 'parse', status: 'complete'},
      {id: 'semantic-validation', status: 'complete'},
      {id: 'normalization', status: 'complete'},
      {id: 'expansion', status: 'complete', expandedNodeCount: 0},
      {id: 'sampling', status: 'skipped', reason: 'diagnostic-only output has zero frames'},
      {id: 'signing', status: 'deferred', reason: 'trusted publisher owns signing; no key or side effect is used'},
    ]));
    expect(fromObject.report.artifact).toMatchObject({
      frameCount: 0,
      executionDisposition: 'diagnostic-only-no-motion-emitted',
      signingDisposition: 'deferred-to-trusted-publisher',
    });
    expect(fromObject.publicationCandidate).toMatchObject({
      schema: 'vozual.compiler-publication-candidate',
      artifact: {
        sha256: fromObject.artifactSha256,
        contentAddressedKey: `sha256/${fromObject.artifactSha256}.json`,
      },
      signing: {status: 'unsigned', required: true, authority: 'trusted-firebase-publisher'},
      publication: {status: 'not-published', sideEffects: false, releaseEligible: false},
    });
  });

  it('returns a pass-specific diagnostic for malformed JSON', () => {
    expect(() => compileV4DiagnosticPipeline('{not-json', profile, candidateBytes, {evidenceRoot: repositoryRoot}))
      .toThrow(expect.objectContaining({
        name: 'CompilerPipelineError',
        code: 'COMPILER.PARSE_INVALID_SOURCE',
        pass: 'parse',
      }));
  });

  it('rejects executable temporal graphs with the existing fail-closed compiler diagnostic', () => {
    const source = fixture();
    source.temporalGraph.nodes.push({id: 'unsupported-motion', kind: 'sequence'});

    try {
      compileV4DiagnosticPipeline(source, profile, candidateBytes, {evidenceRoot: repositoryRoot});
      throw new Error('Expected unsupported motion graph to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerPipelineError);
      expect(error.code).toBe('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY');
      expect(error.pass).toBe('semantic-validation');
      expect(error.diagnostics[0].details).toMatchObject({requiredCapability: 'compiler.temporalGraph'});
    }
  });

  it('rejects an unrecognized source schema during semantic validation', () => {
    const source = fixture();
    source.schemaVersion = 99;

    expect(() => compileV4DiagnosticPipeline(source, profile, candidateBytes, {evidenceRoot: repositoryRoot}))
      .toThrow(expect.objectContaining({
        name: 'CompilerPipelineError',
        code: 'SCHEMA.UNSUPPORTED_VERSION',
        pass: 'semantic-validation',
      }));
  });

  it('labels a candidate/profile mismatch as a compatibility-pass diagnostic', () => {
    expect(() => compileV4DiagnosticPipeline(fixture(), profile, Buffer.from('not the bound candidate'), {evidenceRoot: repositoryRoot}))
      .toThrow(expect.objectContaining({
        name: 'CompilerPipelineError',
        code: 'COMPATIBILITY.RIG_PROFILE',
        pass: 'compatibility',
      }));
  });

  it('expands the approved Task 5 temporal fixture into immutable, deterministic non-executable IR', () => {
    const source = structuredClone(temporalComposition);
    const before = JSON.stringify(source);
    const first = compileTemporalAuthoringIR(source);
    const second = compileTemporalAuthoringIR(JSON.stringify(source));

    expect(first.artifactCanonicalJson).toBe(second.artifactCanonicalJson);
    expect(first.reportCanonicalJson).toBe(second.reportCanonicalJson);
    expect(first.typedIR.timeline).toEqual(expectedTemporalTimeline.timeline);
    expect(first.typedIR.executionDisposition).toBe('authoring-only-not-executable');
    expect(Object.isFrozen(first.typedIR)).toBe(true);
    expect(Object.isFrozen(first.typedIR.timeline)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    expect(first.report.passes).toEqual(expect.arrayContaining([
      {id: 'expansion', status: 'complete', expandedNodeCount: expectedTemporalTimeline.timeline.length},
      {id: 'sampling', status: 'skipped', reason: 'authoring timeline is not sampled into motion frames'},
      {id: 'signing', status: 'deferred', reason: 'authoring-only IR is not a publishable artifact'},
    ]));
  });

  it('returns a deterministic expansion diagnostic for invalid phase references', () => {
    const source = structuredClone(temporalComposition);
    const phaseRef = source.tracks[0].segments[1].phaseRef;
    const nonManual = source.tracks.find(track => track.id === 'nonmanual-primary');
    nonManual.segments[0].phase = 'hold';

    expect(() => compileTemporalAuthoringIR(source)).toThrow(expect.objectContaining({
      name: 'CompilerPipelineError',
      code: 'TEMPORAL.INVALID_PHASE_REFERENCE',
      pass: 'expansion',
    }));
    expect(phaseRef).toBe('phase.main');
  });
});
