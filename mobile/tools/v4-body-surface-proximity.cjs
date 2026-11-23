'use strict';

const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {Vector3} = require('three');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const {calibrationError, createCalibratedAnchorResolver, quaternionPoseRotations} = require('./v4-contact-geometry.cjs');

// Exact bytes of the previously verified multi-pose Blender measurement output.
const EVIDENCE_PATH = path.join(__dirname, '../../schemas/rig-profiles/vozual-rig-1.body-surface-proximity-evidence.v1.json');
const EVIDENCE_SHA256 = '895d9d616fdfd934c2b295948a284e76b37fb06d6520facd289be6edb79159c2';
const SURFACE_ID = 'torso-dominant-v1';
const ANCHORS = {'hand.index.tip.left': 'DEF-f_index.03.L', 'hand.index.tip.right': 'DEF-f_index.03.R'};
const INDEX_ROOTS = {'hand.index.segment.01.left': 'DEF-f_index.01.L', 'hand.index.segment.01.right': 'DEF-f_index.01.R'};
const FIELDS = ['id', 'anchorId', 'surfaceId', 'frameId', 'minDistanceM', 'maxDistanceM', 'samples'];
const MATCH_M = 0.000001;

function exactFields(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalid(message, details) {
  throw new RigCapabilityError('SCHEMA.INVALID_BODY_SURFACE_PROXIMITY', message, details);
}

function validateBodySurfaceProximities(constraints) {
  if (!Array.isArray(constraints) || !constraints.length) invalid('Body surface proximities must be a nonempty array');
  const ids = new Set();
  for (const constraint of constraints) {
    const fields = constraint && Object.hasOwn(constraint, 'surfacePolicy') ? [...FIELDS, 'surfacePolicy'] : FIELDS;
    if (!exactFields(constraint, fields) || !nonempty(constraint.id)) invalid('A body surface proximity requires its identity, bounds and samples');
    const {id, anchorId, surfaceId, frameId, minDistanceM, maxDistanceM, samples} = constraint;
    const details = {constraintId: id};
    if (Object.hasOwn(constraint, 'surfacePolicy')) {
      const policy = constraint.surfacePolicy;
      if (!exactFields(policy, ['minApproachNormalDot', 'collisionPriority']) ||
          !Number.isFinite(policy.minApproachNormalDot) || Math.abs(policy.minApproachNormalDot) > 1 ||
          !['required', 'preferred'].includes(policy.collisionPriority)) {
        invalid('Surface policy requires a minimum dot in [-1, 1] and a required or preferred collision priority', details);
      }
    }
    if (ids.has(id)) invalid('Body surface proximity IDs must be unique within the family', details);
    ids.add(id);
    if (!nonempty(anchorId) || !Object.hasOwn(ANCHORS, anchorId) || surfaceId !== SURFACE_ID || frameId !== 'body') {
      invalid('Only measured index tips and the torso-dominant mask in the body frame are supported', details);
    }
    if (!Number.isFinite(minDistanceM) || !Number.isFinite(maxDistanceM) || minDistanceM < 0 || maxDistanceM < minDistanceM) {
      invalid('Proximity requires a finite nonnegative ordered distance range', details);
    }
    if (!Array.isArray(samples) || !samples.length) invalid('Proximity requires measured pose samples', details);
    let previousTime = -1;
    for (const sample of samples) {
      if (!exactFields(sample, ['timeMs', 'poseId']) || !nonempty(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs < 0 || sample.timeMs <= previousTime) {
        invalid('Samples require pose IDs and strictly increasing nonnegative integer times', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function loadEvidence(profile, candidateBytes) {
  let bytes;
  try { bytes = readFileSync(EVIDENCE_PATH); } catch { calibrationError('Body surface proximity evidence is unavailable'); }
  if (createHash('sha256').update(bytes).digest('hex') !== EVIDENCE_SHA256) {
    calibrationError('Body surface proximity evidence checksum mismatch');
  }
  const evidence = JSON.parse(bytes.toString('utf8'));
  const binding = evidence.bindings;
  if (evidence.schema !== 'vozual.task7.multi-pose-body-surface-measurements' || evidence.schemaVersion !== 1 ||
      binding.profileSha256 !== profile.sha256 || binding.candidateSha256 !== profile.asset.candidateSha256 ||
      createHash('sha256').update(candidateBytes).digest('hex') !== binding.candidateSha256 ||
      binding.coordinateCalibrationSha256 !== profile.descriptor.coordinateCalibration.measurementSha256 ||
      !profile.descriptor.coordinateFrames.some(frame => frame.id === 'body' && frame.status === 'validated') ||
      evidence.frameId !== 'body' || evidence.rotationConvention !== 'rest-relative-local-quaternion-wxyz') {
    calibrationError('Body surface proximity measurements do not match the bound rig and calibration');
  }
  return evidence;
}

function evaluateSurfacePolicy(policy, diagnostic) {
  if (diagnostic.samples.some(sample => !Number.isFinite(sample.approachNormalDot) ||
      !Number.isSafeInteger(sample.handToTorsoOverlapCount) || sample.handToTorsoOverlapCount < 0)) {
    calibrationError('A surface policy requires a finite alignment and a recorded overlap count at every sample');
  }
  const worstAlignment = diagnostic.samples.reduce((a, b) => b.approachNormalDot < a.approachNormalDot ? b : a);
  const worstOverlap = diagnostic.samples.reduce((a, b) => b.handToTorsoOverlapCount > a.handToTorsoOverlapCount ? b : a);
  const hasOverlap = worstOverlap.handToTorsoOverlapCount > 0;
  const result = {...diagnostic,
    evaluationScope: 'measured-discrete-index-to-torso-distance-alignment-and-hand-overlap',
    collisionEvaluation: 'sampled-same-side-hand-to-torso-excluding-shared-vertices',
    surfacePolicy: {...policy, worstAlignment, worstOverlap,
      collisionSatisfied: !hasOverlap},
  };
  if (worstAlignment.approachNormalDot < policy.minApproachNormalDot) {
    throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_NORMAL_OUTSIDE_RANGE',
      'A sampled index axis misses the required alignment with the inward triangle normal', result);
  }
  if (hasOverlap && policy.collisionPriority === 'required') {
    throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_OVERLAP',
      'The recorded hand and torso surfaces intersect at a required sample', result);
  }
  return result;
}

function createBodySurfaceProximityEvaluator(profile, candidateBytes, options, includePolicy = false) {
  const evidence = loadEvidence(profile, candidateBytes);
  const bones = includePolicy ? {...ANCHORS, ...INDEX_ROOTS} : ANCHORS;
  const resolve = createCalibratedAnchorResolver(profile, candidateBytes, options, bones);
  const poses = new Map(evidence.measurements.map(measurement => {
    const endpoints = resolve(quaternionPoseRotations(measurement.poseCommandsWxyz));
    const samples = new Map(measurement.indexTips.map(tip => {
      const reconstructed = endpoints.get(tip.anchorId);
      const distanceM = distance(reconstructed, tip.nearestSurfacePointBodyM);
      if (distance(reconstructed, tip.endpointBodyM) > MATCH_M ||
          Math.abs(distanceM - tip.unsignedDistanceM) > MATCH_M ||
          Math.abs(Math.hypot(...tip.nearestSurfaceNormalBody) - 1) > 0.0001) {
        calibrationError('Reconstructed body surface proximity differs from the pinned measurements');
      }
      const geometry = {
        anchorPositionBodyM: reconstructed,
        surfacePointBodyM: tip.nearestSurfacePointBodyM,
        surfaceNormalBody: tip.nearestSurfaceNormalBody,
        surfaceTriangleIndex: tip.triangleIndex,
        distanceM,
      };
      let policySample;
      if (includePolicy) {
        const side = tip.anchorId === 'hand.index.tip.left' ? 'left' : 'right';
        const root = endpoints.get(`hand.index.segment.01.${side}`);
        const axis = new Vector3().fromArray(reconstructed).sub(new Vector3().fromArray(root));
        if (!axis.lengthSq()) calibrationError('The reconstructed index axis has zero length');
        const normal = new Vector3().fromArray(tip.nearestSurfaceNormalBody).normalize();
        const alignment = -axis.normalize().dot(normal);
        policySample = {
          indexRootBodyM: root,
          approachNormalDot: Math.max(-1, Math.min(1, alignment)),
          handToTorsoOverlapCount: measurement.handToTorsoSurface[side].overlapCountExcludingSharedVertices,
        };
      }
      return [tip.anchorId, {geometry, policySample}];
    }));
    return [measurement.poseId, samples];
  }));
  return constraint => {
    const identity = {constraintId: constraint.id, anchorId: constraint.anchorId,
      surfaceId: constraint.surfaceId, frameId: constraint.frameId};
    const samples = constraint.samples.map(({timeMs, poseId}) => {
      const sample = poses.get(poseId)?.get(constraint.anchorId);
      if (!sample) {
        throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_PROXIMITY_EVIDENCE_UNAVAILABLE',
          'No measured surface sample exists for this endpoint and pose', {...identity, timeMs, poseId});
      }
      const {geometry, policySample} = sample;
      const violationM = Math.max(constraint.minDistanceM - geometry.distanceM, geometry.distanceM - constraint.maxDistanceM, 0);
      return {...geometry, ...(constraint.surfacePolicy && policySample), timeMs, poseId, violationM};
    });
    // Select by violation of either bound, not by largest distance alone.
    const worstSample = samples.reduce((worst, sample) => !worst || sample.violationM > worst.violationM ? sample : worst, undefined);
    const diagnostic = {
      ...identity,
      minDistanceM: constraint.minDistanceM,
      maxDistanceM: constraint.maxDistanceM,
      sampleCount: samples.length,
      evaluationScope: 'measured-discrete-index-to-torso-unsigned-distance',
      collisionEvaluation: 'not-performed',
      evidenceSha256: EVIDENCE_SHA256,
      bodySurfaceMask: evidence.bodySurfaceMask,
      limits: [...evidence.limits],
      samples,
      worstSample,
    };
    const result = constraint.surfacePolicy ? evaluateSurfacePolicy(constraint.surfacePolicy, diagnostic) : diagnostic;
    if (worstSample.violationM > 0) {
      throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_PROXIMITY_OUTSIDE_RANGE',
        'A sampled index-to-torso distance is outside the requested range', result);
    }
    return result;
  };
}

module.exports = {createBodySurfaceProximityEvaluator, evaluateSurfacePolicy, validateBodySurfaceProximities};
