'use strict';

const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {Vector3} = require('three');
const {
  calibrationError,
  createCalibratedAnchorResolver,
  quaternionPoseRotations,
} = require('./v4-contact-geometry.cjs');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const EVIDENCE_PATH = path.join(__dirname, '../../schemas/rig-profiles/vozual-rig-1.body-surface-approach-evidence.v1.json');
const EVIDENCE_SHA256 = 'e3c7d0eb52cb9bad7e834754cccab5f3fa8c53ad2c3a8b5d9df15da9b550d334';
const MEASUREMENT_MATCH_M = 0.000001;
const DIRECTION_MATCH = 0.000001;
const BODY_SURFACE_FIELDS = [
  'id', 'anchorId', 'surfaceId', 'frameId', 'maxDistanceM', 'minApproachNormalDot', 'samples',
];
const ROOT_ANCHOR_ID = 'hand.index.segment.01.left';
const TIP_ANCHOR_ID = 'hand.index.tip.left';
const SURFACE_ID = 'torso-dominant-v1';
const POSE_ID = 'left-index-torso-normal-approach-z';
const DIGITS = ['index', 'middle', 'pinky', 'ring', 'thumb'];

function nonemptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactFields(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function invalidConstraint(message, details) {
  throw new RigCapabilityError('SCHEMA.INVALID_BODY_SURFACE_APPROACH', message, details);
}

function validateBodySurfaceApproaches(constraints) {
  if (!Array.isArray(constraints) || !constraints.length) {
    invalidConstraint('Body surface approaches must be a nonempty array');
  }
  const used = new Set();
  for (const constraint of constraints) {
    if (!exactFields(constraint, BODY_SURFACE_FIELDS) || !nonemptyId(constraint.id)) {
      invalidConstraint('A body surface approach requires its ID, anchor, surface, frame, limits and samples');
    }
    const {id, anchorId, surfaceId, frameId, maxDistanceM, minApproachNormalDot, samples} = constraint;
    const details = {constraintId: id};
    if (used.has(id)) invalidConstraint('Body surface approach IDs must be unique within the family', details);
    used.add(id);
    if (anchorId !== TIP_ANCHOR_ID || surfaceId !== SURFACE_ID || frameId !== 'body') {
      invalidConstraint('This measured slice supports the left index tip, torso-dominant surface and calibrated body frame', details);
    }
    if (!Number.isFinite(maxDistanceM) || maxDistanceM < 0 ||
        !Number.isFinite(minApproachNormalDot) || minApproachNormalDot < 0 || minApproachNormalDot > 1) {
      invalidConstraint('Approach limits must be finite, nonnegative distance and a normal dot from 0 to 1', details);
    }
    if (!Array.isArray(samples) || !samples.length) {
      invalidConstraint('A body surface approach requires at least one measured pose sample', details);
    }
    let previousTime = -1;
    for (const sample of samples) {
      if (!exactFields(sample, ['timeMs', 'poseId']) || !nonemptyId(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs < 0 || sample.timeMs <= previousTime) {
        invalidConstraint('Samples require a pose ID and increasing nonnegative integer times', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function noPositiveOverlap(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(noPositiveOverlap);
}

function loadEvidence(profile, candidateBytes) {
  let bytes;
  try {
    bytes = readFileSync(EVIDENCE_PATH);
  } catch {
    calibrationError('Body surface approach evidence is unavailable');
  }
  const evidenceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (evidenceSha256 !== EVIDENCE_SHA256) calibrationError('Body surface approach evidence checksum mismatch');
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    calibrationError('Body surface approach evidence is not valid JSON');
  }
  const {coordinateCalibration, coordinateFrames} = profile.descriptor;
  const calibrationFrame = coordinateFrames.find(frame => frame.id === 'body' && frame.status === 'validated');
  if (evidence.schema !== 'vozual.rig-body-surface-approach-evidence' || evidence.schemaVersion !== 1 ||
      evidence.profileSha256 !== profile.sha256 || evidence.candidateSha256 !== profile.asset.candidateSha256 ||
      createHash('sha256').update(candidateBytes).digest('hex') !== evidence.candidateSha256 ||
      evidence.coordinateCalibrationSha256 !== coordinateCalibration.measurementSha256 ||
      evidence.frameId !== 'body' || !calibrationFrame || evidence.surface?.id !== SURFACE_ID ||
      evidence.surface.triangleCount !== 9933 || !finitePoint(evidence.surface.pointBodyM) ||
      !finitePoint(evidence.surface.triangleNormalBody) || !Number.isFinite(evidence.surface.distanceM) ||
      evidence.pose?.id !== POSE_ID || evidence.pose.rotationConvention !== 'WXYZ' ||
      evidence.pose.rootAnchor?.id !== ROOT_ANCHOR_ID || evidence.pose.tipAnchor?.id !== TIP_ANCHOR_ID ||
      !finitePoint(evidence.pose.rootAnchor.pointBodyM) || !finitePoint(evidence.pose.tipAnchor.pointBodyM) ||
      !finitePoint(evidence.pose.rootToTipDirectionBody) || !Number.isFinite(evidence.pose.approachNormalDot) ||
      !evidence.measurementSource?.byteIdenticalRepeat ||
      evidence.measurementSource.artifactSha256 !== evidence.measurementSource.repeatArtifactSha256) {
    calibrationError('Body surface approach evidence does not match the bound rig profile and calibration');
  }
  const normalLength = Math.hypot(...evidence.surface.triangleNormalBody);
  const directionLength = Math.hypot(...evidence.pose.rootToTipDirectionBody);
  if (Math.abs(normalLength - 1) > 0.0001 || Math.abs(directionLength - 1) > 0.0001 ||
      !Number.isFinite(profile.conformance.contactToleranceM) ||
      evidence.surface.distanceM > profile.conformance.contactToleranceM) {
    calibrationError('Body surface approach evidence has invalid vectors or exceeds the calibrated tolerance');
  }
  const commands = evidence.pose.rotationCommandsWxyz;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands) || !Object.keys(commands).length ||
      Object.entries(commands).some(([bone, q]) => !nonemptyId(bone) || !Array.isArray(q) || q.length !== 4 ||
        !q.every(Number.isFinite) || Math.abs(Math.hypot(...q) - 1) > 0.0001)) {
    calibrationError('Body surface approach evidence has invalid rotation commands');
  }
  const collision = evidence.collision;
  const scopedKeys = ['left-otherBody', 'left-right', 'right-otherBody'];
  const expectedDigits = DIGITS.map(digit => `left-${digit}`);
  const sameHand = collision?.sameHandOverlapCounts?.left;
  const replay = evidence.pose.replay;
  const replayErrors = replay?.errors;
  if (!collision || !exactFields(collision.scopedHandBodyOverlapCounts, scopedKeys) ||
      !scopedKeys.every(key => collision.scopedHandBodyOverlapCounts[key] === 0) ||
      !exactFields(sameHand, expectedDigits) || !noPositiveOverlap(sameHand) ||
      collision.handToTorsoOverlapCountExcludingSharedVertices !== 0 || collision.handToAllNonHandOverlapCount !== 0 ||
      replay?.matchesWithin1Micrometer !== true || replay.handToTorsoOverlapCount !== 0 ||
      !exactFields(replay.scopedCollisionCounts, scopedKeys) ||
      !scopedKeys.every(key => replay.scopedCollisionCounts[key] === 0) ||
      !replayErrors || !['anchorPositionM', 'surfacePointM', 'gapM'].every(key =>
        Number.isFinite(replayErrors[key]) && replayErrors[key] <= MEASUREMENT_MATCH_M)) {
    calibrationError('Body surface approach collision or replay measurements are not clear');
  }
  return {evidence, evidenceSha256};
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function createBodySurfaceApproachEvaluator(profile, candidateBytes, options) {
  const {evidence, evidenceSha256} = loadEvidence(profile, candidateBytes);
  const anchors = {
    [ROOT_ANCHOR_ID]: 'DEF-f_index.01.L',
    [TIP_ANCHOR_ID]: 'DEF-f_index.03.L',
  };
  const resolve = createCalibratedAnchorResolver(profile, candidateBytes, options, anchors);
  const rotations = quaternionPoseRotations(evidence.pose.rotationCommandsWxyz);
  const positions = resolve(rotations);
  const root = positions.get(ROOT_ANCHOR_ID);
  const tip = positions.get(TIP_ANCHOR_ID);
  if (distance(root, evidence.pose.rootAnchor.pointBodyM) > MEASUREMENT_MATCH_M ||
      distance(tip, evidence.pose.tipAnchor.pointBodyM) > MEASUREMENT_MATCH_M) {
    calibrationError('Reconstructed index anchors do not match the measured torso approach pose');
  }
  const fingerVector = new Vector3().fromArray(tip).sub(new Vector3().fromArray(root));
  if (fingerVector.lengthSq() === 0) calibrationError('The measured index axis has zero length');
  const fingerDirection = fingerVector.normalize();
  const measuredDirection = new Vector3().fromArray(evidence.pose.rootToTipDirectionBody).normalize();
  if (fingerDirection.distanceTo(measuredDirection) > DIRECTION_MATCH) {
    calibrationError('Reconstructed index axis does not match the measured hand pose');
  }
  const surfacePoint = new Vector3().fromArray(evidence.surface.pointBodyM);
  const surfaceNormal = new Vector3().fromArray(evidence.surface.triangleNormalBody).normalize();
  const gapM = distance(tip, surfacePoint.toArray());
  const approachNormalDot = -fingerDirection.dot(surfaceNormal);
  if (Math.abs(gapM - evidence.surface.distanceM) > MEASUREMENT_MATCH_M ||
      Math.abs(approachNormalDot - evidence.pose.approachNormalDot) > DIRECTION_MATCH) {
    calibrationError('Reconstructed torso surface gap or normal approach does not match the measurements');
  }
  const contactToleranceM = profile.conformance.contactToleranceM;

  return constraint => {
    const identity = {constraintId: constraint.id, anchorId: constraint.anchorId,
      surfaceId: constraint.surfaceId, frameId: constraint.frameId};
    if (constraint.maxDistanceM > contactToleranceM) {
      invalidConstraint('Body surface approach distance cannot exceed the measured rig contact tolerance', identity);
    }
    const samples = constraint.samples.map(({timeMs, poseId}) => {
      if (poseId !== evidence.pose.id) {
        throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_APPROACH_EVIDENCE_UNAVAILABLE',
          'No measured pose exists for this body surface approach sample', {...identity, timeMs, poseId});
      }
      return {
        timeMs,
        poseId,
        rootPositionBodyM: [...root],
        anchorPositionBodyM: [...tip],
        surfacePointBodyM: [...surfacePoint.toArray()],
        surfaceNormalBody: [...surfaceNormal.toArray()],
        distanceM: gapM,
        approachNormalDot,
        collisionCounts: {...evidence.collision.scopedHandBodyOverlapCounts},
        measurementSourceSha256: evidence.measurementSource.artifactSha256,
      };
    });
    const worstSample = samples.reduce((worst, sample) =>
      !worst || sample.distanceM > worst.distanceM ? sample : worst, undefined);
    const diagnostic = {
      ...identity,
      sampleCount: samples.length,
      maxDistanceM: constraint.maxDistanceM,
      minApproachNormalDot: constraint.minApproachNormalDot,
      contactToleranceM,
      evidenceSha256,
      collisionEvidenceScope: 'single-measured-pose-torso-dominant-mask',
      bodySurfaceMask: evidence.surface.mask,
      worstSample,
    };
    if (worstSample.distanceM > constraint.maxDistanceM) {
      throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_APPROACH_OUTSIDE_RANGE',
        'A sampled fingertip is farther from the measured body surface than allowed', diagnostic);
    }
    if (worstSample.approachNormalDot < constraint.minApproachNormalDot) {
      throw new RigCapabilityError('KINEMATIC.BODY_SURFACE_APPROACH_MISALIGNED',
        'A sampled index axis does not approach the body surface along its measured outward normal', diagnostic);
    }
    return diagnostic;
  };
}

module.exports = {
  createBodySurfaceApproachEvaluator,
  validateBodySurfaceApproaches,
};
