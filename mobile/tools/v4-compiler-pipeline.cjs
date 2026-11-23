'use strict';

const crypto = require('crypto');
const {
  compileV4RigConformanceRecipe,
  validateRigConformanceSource,
} = require('./compile-motion-v4.cjs');
const {compileTemporalCompositionIntent} = require('./temporal-composition-intent-v1.cjs');
const {canonicalJson} = require('./rig-capability-profile.cjs');

const PIPELINE_VERSION = 'task9-diagnostic-pipeline-1';

class CompilerPipelineError extends Error {
  constructor(diagnostic) {
    super(diagnostic.message);
    this.name = 'CompilerPipelineError';
    this.diagnostics = Object.freeze([Object.freeze(diagnostic)]);
    this.code = diagnostic.code;
    this.pass = diagnostic.pass;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function diagnosticFrom(error, pass) {
  const code = typeof error?.code === 'string' ? error.code : 'COMPILER.PASS_FAILED';
  const diagnosticPass = code.startsWith('COMPATIBILITY.') ? 'compatibility'
    : code.startsWith('SCHEMA.') ? 'semantic-validation'
      : code.startsWith('KINEMATIC.') ? 'constraint-conformance' : pass;
  return {
    code,
    pass: diagnosticPass,
    message: error instanceof Error ? error.message : String(error),
    details: error?.details && typeof error.details === 'object' ? error.details : {},
  };
}

function parseSource(input) {
  let source;
  try {
    if (Buffer.isBuffer(input) || typeof input === 'string') {
      source = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } else {
      source = JSON.parse(canonicalJson(input));
    }
  } catch (error) {
    throw new CompilerPipelineError({
      code: 'COMPILER.PARSE_INVALID_SOURCE',
      pass: 'parse',
      message: `Source must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      details: {},
    });
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new CompilerPipelineError({
      code: 'COMPILER.PARSE_INVALID_SOURCE',
      pass: 'parse',
      message: 'Source JSON must contain an object at its root.',
      details: {},
    });
  }
  return source;
}

/**
 * Compile the currently supported, diagnostic-only v4 rig-conformance subset.
 * Motion graphs, executable sampling and signing remain fail-closed elsewhere.
 *
 * @param {string|Buffer|object} sourceInput canonical JSON bytes or a source object
 * @param {object} profile hash-bound rig profile
 * @param {Buffer} candidateBytes exact candidate asset bytes
 * @param {object} [options] underlying compiler options
 * @returns {Readonly<object>} immutable typed IR and deterministic artifacts
 */
function compileV4DiagnosticPipeline(sourceInput, profile, candidateBytes, options = {}) {
  const passes = [];
  let parsed;
  try {
    parsed = parseSource(sourceInput);
    passes.push({id: 'parse', status: 'complete'});
  } catch (error) {
    if (error instanceof CompilerPipelineError) throw error;
    throw new CompilerPipelineError(diagnosticFrom(error, 'parse'));
  }

  let validated;
  try {
    validated = validateRigConformanceSource(parsed);
    passes.push({id: 'semantic-validation', status: 'complete'});
  } catch (error) {
    throw new CompilerPipelineError(diagnosticFrom(error, 'semantic-validation'));
  }

  let normalized;
  let sourceBytes;
  try {
    sourceBytes = canonicalJson(validated);
    normalized = JSON.parse(sourceBytes);
    passes.push({id: 'normalization', status: 'complete'});
  } catch (error) {
    throw new CompilerPipelineError(diagnosticFrom(error, 'normalization'));
  }

  const graphNodes = normalized.temporalGraph.nodes;
  if (graphNodes.length !== 0) {
    throw new CompilerPipelineError({
      code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
      pass: 'expansion',
      message: 'Executable temporal graph expansion is not implemented in this Task 9 slice.',
      details: {requiredCapability: 'compiler.temporalGraph', nodeCount: graphNodes.length},
    });
  }
  passes.push({id: 'expansion', status: 'complete', expandedNodeCount: 0});

  let compiled;
  try {
    compiled = compileV4RigConformanceRecipe(normalized, profile, candidateBytes, options);
    passes.push({id: 'constraint-conformance', status: 'complete'});
  } catch (error) {
    throw new CompilerPipelineError(diagnosticFrom(error, 'constraint-conformance'));
  }

  const artifactBytes = compiled.bytes.toString('utf8');
  const artifactSha256 = sha256(compiled.bytes);
  const publicationCandidate = {
    schema: 'vozual.compiler-publication-candidate',
    formatVersion: 1,
    source: {
      schema: normalized.schema,
      schemaVersion: normalized.schemaVersion,
      id: normalized.id,
      revision: normalized.revision,
      sha256: sha256(Buffer.from(sourceBytes, 'utf8')),
    },
    compiler: {
      id: compiled.artifact.compiler.id,
      build: compiled.artifact.compiler.build,
      pipelineVersion: PIPELINE_VERSION,
    },
    compatibility: {
      runtimePlanSchema: compiled.artifact.schema,
      runtimePlanFormatVersion: compiled.artifact.formatVersion,
      rigProfileId: compiled.artifact.rig.profileId,
      rigProfileRevision: compiled.artifact.rig.profileRevision,
      rigProfileSha256: compiled.artifact.rig.profileSha256,
      candidateSha256: compiled.artifact.rig.candidateSha256,
      requiredCapabilities: [...compiled.artifact.rig.requiredCapabilities],
    },
    provenance: {
      sourceId: normalized.id,
      sourceRevision: normalized.revision,
      sourceSha256: sha256(Buffer.from(sourceBytes, 'utf8')),
      rigProfileSha256: compiled.artifact.rig.profileSha256,
      candidateSha256: compiled.artifact.rig.candidateSha256,
    },
    artifact: {
      sha256: artifactSha256,
      byteLength: compiled.bytes.length,
      contentAddressedKey: `sha256/${artifactSha256}.json`,
      executionDisposition: 'diagnostic-only-no-motion-emitted',
    },
    signing: {status: 'unsigned', required: true, authority: 'trusted-firebase-publisher'},
    publication: {status: 'not-published', sideEffects: false, releaseEligible: false},
  };
  const publicationCandidateCanonicalJson = canonicalJson(publicationCandidate);
  const publicationCandidateSha256 = sha256(Buffer.from(publicationCandidateCanonicalJson, 'utf8'));
  passes.push({id: 'sampling', status: 'skipped', reason: 'diagnostic-only output has zero frames'});
  passes.push({id: 'optimization', status: 'skipped', reason: 'no executable motion plan was produced'});
  passes.push({id: 'signing', status: 'deferred', reason: 'trusted publisher owns signing; no key or side effect is used'});
  passes.push({id: 'packaging', status: 'complete'});

  const report = {
    schema: 'vozual.compiler-validation-report',
    formatVersion: 1,
    pipelineVersion: PIPELINE_VERSION,
    compiler: compiled.artifact.compiler,
    source: {
      id: normalized.id,
      revision: normalized.revision,
      sha256: sha256(Buffer.from(sourceBytes, 'utf8')),
    },
    rig: {
      profileId: compiled.artifact.rig.profileId,
      profileRevision: compiled.artifact.rig.profileRevision,
      profileSha256: compiled.artifact.rig.profileSha256,
      candidateSha256: compiled.artifact.rig.candidateSha256,
    },
    passes,
    diagnostics: [],
    artifact: {
      sha256: artifactSha256,
      byteLength: compiled.bytes.length,
      frameCount: compiled.artifact.frames.length,
      executionDisposition: 'diagnostic-only-no-motion-emitted',
      signingDisposition: 'deferred-to-trusted-publisher',
    },
    publicationCandidateSha256,
  };

  const typedIR = deepFreeze({
    schema: 'vozual.compiler-ir',
    formatVersion: 1,
    pass: 'validated-diagnostic-source',
    source: normalized,
    sourceCanonicalJson: sourceBytes,
    sourceSha256: report.source.sha256,
    requiredRigCapabilities: [...new Set(normalized.linguisticIntent.requiredRigCapabilities)].sort(),
    constraints: normalized.constraints,
  });
  const frozenArtifact = deepFreeze(compiled.artifact);
  const frozenReport = deepFreeze(report);
  const frozenPublicationCandidate = deepFreeze(publicationCandidate);

  return Object.freeze({
    typedIR,
    artifact: frozenArtifact,
    artifactCanonicalJson: artifactBytes,
    artifactSha256,
    report: frozenReport,
    reportCanonicalJson: canonicalJson(frozenReport),
    reportSha256: sha256(Buffer.from(canonicalJson(frozenReport), 'utf8')),
    publicationCandidate: frozenPublicationCandidate,
    publicationCandidateCanonicalJson,
    publicationCandidateSha256,
  });
}

/**
 * Expand the existing Task 5 temporal-authoring contract into immutable IR.
 * This pass preserves opaque references and deliberately emits no motion.
 *
 * @param {string|Buffer|object} sourceInput temporal-composition-intent v1
 * @returns {Readonly<object>} immutable non-executable timeline IR and report
 */
function compileTemporalAuthoringIR(sourceInput) {
  const source = parseSource(sourceInput);
  const sourceCanonicalJson = canonicalJson(source);
  let timeline;
  try {
    timeline = compileTemporalCompositionIntent(source);
  } catch (error) {
    throw new CompilerPipelineError(diagnosticFrom(
      error,
      error?.code?.startsWith('SCHEMA.') ? 'semantic-validation' : 'expansion',
    ));
  }

  const sourceSha256 = sha256(Buffer.from(sourceCanonicalJson, 'utf8'));
  const ir = deepFreeze({
    schema: 'vozual.compiler-ir',
    formatVersion: 1,
    pass: 'expanded-temporal-authoring',
    source: {
      schema: source.schema,
      schemaVersion: source.schemaVersion,
      id: source.id,
      revision: source.revision,
      sha256: sourceSha256,
    },
    sourceCanonicalJson,
    sourceSha256,
    durationMs: timeline.durationMs,
    timeline: timeline.timeline,
    executionDisposition: 'authoring-only-not-executable',
  });
  const artifactCanonicalJson = canonicalJson(ir);
  const artifactSha256 = sha256(Buffer.from(artifactCanonicalJson, 'utf8'));
  const report = deepFreeze({
    schema: 'vozual.compiler-validation-report',
    formatVersion: 1,
    pipelineVersion: PIPELINE_VERSION,
    source: ir.source,
    passes: [
      {id: 'parse', status: 'complete'},
      {id: 'semantic-validation', status: 'complete'},
      {id: 'expansion', status: 'complete', expandedNodeCount: timeline.timeline.length},
      {id: 'compatibility', status: 'skipped', reason: 'authoring timeline contains opaque intent references'},
      {id: 'constraint-conformance', status: 'skipped', reason: 'no physical values or executable motion are produced'},
      {id: 'sampling', status: 'skipped', reason: 'authoring timeline is not sampled into motion frames'},
      {id: 'optimization', status: 'skipped', reason: 'no executable motion plan was produced'},
      {id: 'signing', status: 'deferred', reason: 'authoring-only IR is not a publishable artifact'},
      {id: 'packaging', status: 'complete'},
    ],
    diagnostics: [],
    artifact: {
      sha256: artifactSha256,
      byteLength: Buffer.byteLength(artifactCanonicalJson, 'utf8'),
      expandedNodeCount: timeline.timeline.length,
      executionDisposition: 'authoring-only-not-executable',
      signingDisposition: 'not-applicable-to-authoring-only-ir',
    },
  });
  const reportCanonicalJson = canonicalJson(report);
  return Object.freeze({
    typedIR: ir,
    artifactCanonicalJson,
    artifactSha256,
    report,
    reportCanonicalJson,
    reportSha256: sha256(Buffer.from(reportCanonicalJson, 'utf8')),
  });
}

module.exports = {
  CompilerPipelineError,
  PIPELINE_VERSION,
  compileV4DiagnosticPipeline,
  compileTemporalAuthoringIR,
};
