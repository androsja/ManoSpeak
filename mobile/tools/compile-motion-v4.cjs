'use strict';

const crypto = require('crypto');
const {validateMechanicalConformanceProbes} = require('./rig-mechanical-conformance.cjs');
const {assertMechanicalObservationEvidence} = require('./rig-mechanical-evidence.cjs');
const {
  RigCapabilityError,
  assertReachableTarget,
  canonicalJson,
} = require('./rig-capability-profile.cjs');
const {
  assertV4CompiledRigBinding,
  bindRigForV4Compilation,
} = require('./v4-rig-compile-binding.cjs');

const COMPILER = Object.freeze({
  id: 'vozual-motion-v4',
  build: 'task3-rig-conformance-5',
});

function sha256Canonical(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', `${name} must be an object`);
  }
  return value;
}

function validateRigConformanceSource(source) {
  requireObject(source, 'V4 source');
  if (source.schema !== 'vozual.motion-source' || source.schemaVersion !== 4 || source.purpose !== 'rig-conformance') {
    throw new RigCapabilityError(
      'SCHEMA.UNSUPPORTED_VERSION',
      'The Task 3 compiler accepts only vozual.motion-source v4 rig-conformance recipes',
    );
  }
  const linguisticIntent = requireObject(source.linguisticIntent, 'linguisticIntent');
  const temporalGraph = requireObject(source.temporalGraph, 'temporalGraph');
  const constraints = requireObject(source.constraints, 'constraints');
  requireObject(source.rigRealizationOverrides, 'rigRealizationOverrides');
  if (Object.keys(source.rigRealizationOverrides).length) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
      'Rig realization overrides require motion compilation support',
      {requiredCapability: 'compiler.rigRealizationOverrides'});
  }
  const unknownConstraint = Object.keys(constraints).find(key =>
    !['reachabilityProbes', 'mechanicalPoseProbes'].includes(key));
  if (unknownConstraint) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
      `Unsupported rig-conformance constraint: ${unknownConstraint}`,
      {requiredCapability: `constraints.${unknownConstraint}`});
  }
  requireObject(source.provenanceAndReview, 'provenanceAndReview');
  if (typeof source.id !== 'string' || !source.id || !Number.isInteger(source.revision) || source.revision < 1) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'A stable source id and positive revision are required');
  }
  if (!Array.isArray(linguisticIntent.requiredRigCapabilities) ||
      linguisticIntent.requiredRigCapabilities.some(value => typeof value !== 'string' || !value)) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'requiredRigCapabilities must be an array of capability IDs');
  }
  if (!Array.isArray(temporalGraph.nodes)) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'temporalGraph.nodes must be an array');
  }
  if (temporalGraph.nodes.length) {
    throw new RigCapabilityError(
      'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
      'Task 3 compiles rig conformance only; motion graph nodes require the later v4 compiler tasks',
      {requiredCapability: 'compiler.temporalGraph'},
    );
  }
  if (constraints.reachabilityProbes !== undefined &&
      (!Array.isArray(constraints.reachabilityProbes) || constraints.reachabilityProbes.some(probe =>
        !probe || !['left', 'right'].includes(probe.side) || !Number.isFinite(probe.targetDistanceM)))) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'Reachability probes require a side and finite targetDistanceM');
  }
  return source;
}

function compileV4RigConformanceRecipe(source, profile, candidateBytes, options = {}) {
  validateRigConformanceSource(source);
  const requiredCapabilities = [...new Set(source.linguisticIntent.requiredRigCapabilities)].sort();
  if (source.constraints.mechanicalPoseProbes !== undefined && !requiredCapabilities.includes('endpoint.pointAnchors')) {
    requiredCapabilities.push('endpoint.pointAnchors');
    requiredCapabilities.sort();
  }
  const mechanicalObservation = assertMechanicalObservationEvidence(profile, candidateBytes, options);
  const binding = bindRigForV4Compilation(profile, candidateBytes, requiredCapabilities, mechanicalObservation);
  const mechanicalProbes = source.constraints.mechanicalPoseProbes === undefined ? undefined
    : validateMechanicalConformanceProbes(profile, source.constraints.mechanicalPoseProbes);
  for (const probe of source.constraints.reachabilityProbes || []) {
    assertReachableTarget(profile, probe.targetDistanceM, probe.side);
  }
  const artifact = {
    schema: 'vozual.runtime-execution-plan',
    formatVersion: 1,
    compiler: COMPILER,
    source: {
      id: source.id,
      revision: source.revision,
      sha256: sha256Canonical(source),
    },
    rig: binding,
    initialization: {
      neutralReferencePoseId: profile.asset.neutralReferencePoseId,
      referenceFrameSource: 'profile-neutral-rest',
    },
    durationMs: 0,
    sampleRateHz: 30,
    frames: [],
  };
  artifact.conformanceDiagnostics = {
    mechanicalObservation: {
      manifestSha256: mechanicalObservation.manifestSha256,
      reportRawSha256: mechanicalObservation.reportRawSha256,
      reportProjectionSha256: mechanicalObservation.reportProjectionSha256,
      candidateSha256: mechanicalObservation.candidateSha256,
      restAxesInventorySha256: mechanicalObservation.restAxesInventorySha256,
      claim: mechanicalObservation.claim,
      disposition: 'provenance-only-no-executable-authorization',
      boneCount: mechanicalObservation.boneCount,
      signedAxisSampleCount: mechanicalObservation.signedAxisSampleCount,
      samplesWithWeightedDisplacement: mechanicalObservation.samplesWithWeightedDisplacement,
    },
  };
  if (mechanicalProbes) artifact.conformanceDiagnostics.mechanicalProbes = mechanicalProbes;
  assertV4CompiledRigBinding(artifact, binding);
  const bytes = Buffer.from(canonicalJson(artifact));
  return Object.freeze({
    artifact: Object.freeze(artifact),
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}

module.exports = {
  COMPILER,
  compileV4RigConformanceRecipe,
  sha256Canonical,
  validateRigConformanceSource,
};
