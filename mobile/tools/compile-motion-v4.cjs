'use strict';

const crypto = require('crypto');
const {admitManualArticulatorExecution} = require('./manual-articulator-intent-v1.cjs');
const {validateMechanicalConformanceProbes} = require('./rig-mechanical-conformance.cjs');
const {assertMechanicalObservationEvidence} = require('./rig-mechanical-evidence.cjs');
const {evaluateFixedPointContacts, validateFixedPointContacts} = require('./v4-fixed-point-contact.cjs');
const {
  createAnchorPairEvaluator,
  createHandFrameNormalAlignmentEvaluator,
  createRelativeHandPoseEvaluator,
  validateAnchorPairContacts,
  validateAnchorPairProximities,
  validateRelativeHandPoses,
  validateHandFrameNormalAlignments,
} = require('./v4-anchor-pair-contact.cjs');
const {
  createBodySurfaceApproachEvaluator,
  validateBodySurfaceApproaches,
} = require('./v4-body-surface-approach.cjs');
const {createBodySurfaceProximityEvaluator, validateBodySurfaceProximities} = require('./v4-body-surface-proximity.cjs');
const {
  RigCapabilityError,
  assertReachableTarget,
  canonicalJson,
} = require('./rig-capability-profile.cjs');
const {
  assertV4CompiledRigBinding,
  bindRigForV4Compilation,
  rejectUnreviewedCapabilityRequests,
} = require('./v4-rig-compile-binding.cjs');

const COMPILER = Object.freeze({
  id: 'vozual-motion-v4',
  build: 'task3-rig-conformance-5',
});
const POINT_CONTACT_COMPILER = Object.freeze({...COMPILER, build: 'task7-fixed-point-contact-1'});
const ENDPOINT_POINT_CONTACT_COMPILER = Object.freeze({...COMPILER, build: 'task7-fixed-point-contact-2'});
const ANCHOR_PAIR_COMPILER = Object.freeze({...COMPILER, build: 'task7-anchor-pair-contact-1'});
const ANCHOR_PAIR_PHASE_COMPILER = Object.freeze({...COMPILER, build: 'task7-anchor-pair-phase-1'});
const ANCHOR_PAIR_PROXIMITY_COMPILER = Object.freeze({...COMPILER, build: 'task7-anchor-pair-proximity-1'});
const ENDPOINT_PROXIMITY_COMPILER = Object.freeze({...COMPILER, build: 'task7-calibrated-endpoint-proximity-1'});
const ANCHOR_PAIR_TRAJECTORY_COMPILER = Object.freeze({...COMPILER, build: 'task7-anchor-pair-trajectory-1'});
const RELATIVE_HAND_POSE_COMPILER = Object.freeze({...COMPILER, build: 'task7-relative-hand-pose-1'});
const HAND_FRAME_NORMAL_COMPILER = Object.freeze({...COMPILER, build: 'task7-hand-frame-normal-1'});
const BODY_SURFACE_APPROACH_COMPILER = Object.freeze({...COMPILER, build: 'task7-body-surface-approach-1'});
const BODY_SURFACE_PROXIMITY_COMPILER = Object.freeze({...COMPILER, build: 'task7-body-surface-proximity-1'});
const BODY_SURFACE_POLICY_COMPILER = Object.freeze({...COMPILER, build: 'task7-body-surface-proximity-2'});

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
  const allowedConstraints = [
    'reachabilityProbes', 'mechanicalPoseProbes', 'pointContacts', 'anchorPairContacts', 'anchorPairProximities',
    'relativeHandPoses', 'handFrameNormalAlignments', 'bodySurfaceApproaches', 'bodySurfaceProximities',
  ];
  const unknownConstraint = Object.keys(constraints).find(key => !allowedConstraints.includes(key));
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
  if (constraints.pointContacts !== undefined) validateFixedPointContacts(constraints.pointContacts);
  if (constraints.anchorPairContacts !== undefined) validateAnchorPairContacts(constraints.anchorPairContacts);
  if (constraints.anchorPairProximities !== undefined) validateAnchorPairProximities(constraints.anchorPairProximities);
  if (constraints.relativeHandPoses !== undefined) validateRelativeHandPoses(constraints.relativeHandPoses);
  if (constraints.handFrameNormalAlignments !== undefined) validateHandFrameNormalAlignments(constraints.handFrameNormalAlignments);
  if (constraints.bodySurfaceApproaches !== undefined) validateBodySurfaceApproaches(constraints.bodySurfaceApproaches);
  if (constraints.bodySurfaceProximities !== undefined) validateBodySurfaceProximities(constraints.bodySurfaceProximities);
  return source;
}

function compileV4RigConformanceRecipe(source, profile, candidateBytes, options = {}) {
  if (source?.schema === 'vozual.manual-articulator-intent') {
    // This boundary validates and rejects authoring intent; it cannot emit motion.
    admitManualArticulatorExecution(source, profile, candidateBytes);
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'Manual intent execution is not supported');
  }
  validateRigConformanceSource(source);
  const {pointContacts, anchorPairContacts, anchorPairProximities, relativeHandPoses, handFrameNormalAlignments,
    bodySurfaceApproaches, bodySurfaceProximities} = source.constraints;
  const hasAnchorPairs = anchorPairContacts !== undefined || anchorPairProximities !== undefined;
  const requiredCapabilities = [...new Set(source.linguisticIntent.requiredRigCapabilities)].sort();
  rejectUnreviewedCapabilityRequests(requiredCapabilities, profile);
  if ((source.constraints.mechanicalPoseProbes !== undefined || pointContacts !== undefined || hasAnchorPairs ||
      relativeHandPoses !== undefined || handFrameNormalAlignments !== undefined || bodySurfaceApproaches !== undefined ||
      bodySurfaceProximities !== undefined) &&
      !requiredCapabilities.includes('endpoint.pointAnchors')) {
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
  const pointContactDiagnostics = pointContacts === undefined ? undefined
    : evaluateFixedPointContacts(pointContacts, profile, candidateBytes, options);
  const evaluateAnchorPair = hasAnchorPairs ? createAnchorPairEvaluator(profile, candidateBytes, options) : undefined;
  const anchorPairDiagnostics = anchorPairContacts?.map(evaluateAnchorPair);
  const proximityDiagnostics = anchorPairProximities?.map(evaluateAnchorPair);
  const relativeHandPoseDiagnostics = relativeHandPoses?.map(
    createRelativeHandPoseEvaluator(profile, candidateBytes, options),
  );
  const handFrameNormalDiagnostics = handFrameNormalAlignments?.map(
    createHandFrameNormalAlignmentEvaluator(profile, candidateBytes, options),
  );
  const bodySurfaceApproachDiagnostics = bodySurfaceApproaches?.map(
    createBodySurfaceApproachEvaluator(profile, candidateBytes, options),
  );
  const hasSurfacePolicy = bodySurfaceProximities?.some(constraint => constraint.surfacePolicy);
  const bodySurfaceProximityDiagnostics = bodySurfaceProximities?.map(
    createBodySurfaceProximityEvaluator(profile, candidateBytes, options, hasSurfacePolicy),
  );
  let compilerBuild = COMPILER;
  if (pointContactDiagnostics) {
    compilerBuild = pointContactDiagnostics.some(diagnostic =>
      diagnostic.evaluationScope === 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence')
      ? ENDPOINT_POINT_CONTACT_COMPILER : POINT_CONTACT_COMPILER;
  }
  if (anchorPairDiagnostics) {
    compilerBuild = anchorPairDiagnostics.some(diagnostic => diagnostic.phase) ? ANCHOR_PAIR_PHASE_COMPILER : ANCHOR_PAIR_COMPILER;
  }
  if (proximityDiagnostics) compilerBuild = ANCHOR_PAIR_PROXIMITY_COMPILER;
  if (proximityDiagnostics?.some(diagnostic =>
    diagnostic.evaluationScope === 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence')) {
    compilerBuild = ENDPOINT_PROXIMITY_COMPILER;
  }
  if (anchorPairDiagnostics?.some(diagnostic => diagnostic.trajectoryId)) compilerBuild = ANCHOR_PAIR_TRAJECTORY_COMPILER;
  if (relativeHandPoseDiagnostics) compilerBuild = RELATIVE_HAND_POSE_COMPILER;
  if (handFrameNormalDiagnostics) compilerBuild = HAND_FRAME_NORMAL_COMPILER;
  if (bodySurfaceApproachDiagnostics) compilerBuild = BODY_SURFACE_APPROACH_COMPILER;
  if (bodySurfaceProximityDiagnostics) compilerBuild = hasSurfacePolicy ? BODY_SURFACE_POLICY_COMPILER : BODY_SURFACE_PROXIMITY_COMPILER;
  const artifact = {
    schema: 'vozual.runtime-execution-plan',
    formatVersion: 1,
    compiler: compilerBuild,
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
  if (pointContactDiagnostics) artifact.conformanceDiagnostics.pointContacts = pointContactDiagnostics;
  if (anchorPairDiagnostics) artifact.conformanceDiagnostics.anchorPairContacts = anchorPairDiagnostics;
  if (proximityDiagnostics) artifact.conformanceDiagnostics.anchorPairProximities = proximityDiagnostics;
  if (relativeHandPoseDiagnostics) artifact.conformanceDiagnostics.relativeHandPoses = relativeHandPoseDiagnostics;
  if (handFrameNormalDiagnostics) artifact.conformanceDiagnostics.handFrameNormalAlignments = handFrameNormalDiagnostics;
  if (bodySurfaceApproachDiagnostics) artifact.conformanceDiagnostics.bodySurfaceApproaches = bodySurfaceApproachDiagnostics;
  if (bodySurfaceProximityDiagnostics) artifact.conformanceDiagnostics.bodySurfaceProximities = bodySurfaceProximityDiagnostics;
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
