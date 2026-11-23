'use strict';

const {Matrix4} = require('three');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const {calibrationError, createCalibratedAnchorResolver, finitePoint} = require('./v4-contact-geometry.cjs');
const {loadProfileBoundEndpointPoseEvidence} = require('./v4-anchor-pair-contact.cjs');

const CALIBRATED_ANCHOR = 'hand.index.tip.left';
const ENDPOINT_BONE = 'DEF-f_index.03.L';
const REST_POSE = 'neutral-rest';

function hasFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidContact(message, details) {
  throw new RigCapabilityError('SCHEMA.INVALID_POINT_CONTACT', message, details);
}

function validateFixedPointContacts(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    invalidContact('Point contacts must be a nonempty array');
  }
  const ids = new Set();
  for (const contact of contacts) {
    if (!hasFields(contact, ['id', 'anchorId', 'target', 'samples']) ||
        !validId(contact.id) || !validId(contact.anchorId)) {
      invalidContact('A point contact requires id, anchorId, target and samples');
    }
    const details = {constraintId: contact.id};
    if (ids.has(contact.id)) invalidContact('Point contact IDs must be unique', details);
    ids.add(contact.id);
    if (!hasFields(contact.target, ['frameId', 'positionM']) ||
        contact.target.frameId !== 'body' || !finitePoint(contact.target.positionM)) {
      invalidContact('The fixed target requires a finite position in the calibrated body frame', details);
    }
    if (!Array.isArray(contact.samples) || contact.samples.length === 0) {
      invalidContact('Point contact requires at least one pose sample', details);
    }
    let previousTime = -1;
    for (const sample of contact.samples) {
      if (!hasFields(sample, ['timeMs', 'poseId']) || !validId(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs <= previousTime) {
        invalidContact('Pose samples require strictly increasing nonnegative integer times and a pose ID', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function resolvePosePositions(profile, candidateBytes, options) {
  const pose = profile.descriptor.coordinateCalibration.endpointConformancePose;
  const resolve = createCalibratedAnchorResolver(profile, candidateBytes, options, {
    [CALIBRATED_ANCHOR]: ENDPOINT_BONE,
  });
  const rotations = new Map(Object.entries(pose.rotationCommandsRad)
    .map(([bone, radians]) => [bone, new Matrix4().makeRotationX(radians)]));
  return new Map([
    [REST_POSE, resolve(new Map()).get(CALIBRATED_ANCHOR)],
    [pose.id, resolve(rotations).get(CALIBRATED_ANCHOR)],
  ]);
}

function evaluateFixedPointContacts(contacts, profile, candidateBytes, options) {
  const {coordinateCalibration, coordinateFrames, endpointGeometry} = profile.descriptor;
  const pose = coordinateCalibration.endpointConformancePose;
  const thresholdM = profile.conformance.contactToleranceM;
  if (!Number.isFinite(thresholdM) || thresholdM <= 0 ||
      !coordinateFrames.some(frame => frame.id === 'body' && frame.status === 'validated') ||
      pose.anchorId !== CALIBRATED_ANCHOR || pose.id === REST_POSE) {
    calibrationError('A validated body frame, contact tolerance and calibrated endpoint pose are required');
  }
  const usesLegacyIndexPath = contact => contact.anchorId === CALIBRATED_ANCHOR &&
    contact.samples.every(sample => sample.poseId === REST_POSE || sample.poseId === pose.id);
  for (const contact of contacts) {
    const details = {constraintId: contact.id, anchorId: contact.anchorId};
    if (!endpointGeometry.anchors.includes(contact.anchorId)) {
      throw new RigCapabilityError('KINEMATIC.UNKNOWN_ANCHOR', 'Point contact references an unknown endpoint anchor', details);
    }
  }
  const hasLegacyIndexContact = contacts.some(usesLegacyIndexPath);
  const hasEndpointEvidenceContact = contacts.some(contact => !usesLegacyIndexPath(contact));
  const legacyPositions = hasLegacyIndexContact ? resolvePosePositions(profile, candidateBytes, options) : undefined;
  const endpointPoseEvidence = hasEndpointEvidenceContact
    ? loadProfileBoundEndpointPoseEvidence(profile, candidateBytes) : undefined;
  const measuredEndpointEvidence = endpointPoseEvidence && endpointPoseEvidence.measured;
  return contacts.map(contact => {
    const legacyPath = usesLegacyIndexPath(contact);
    const targetBodyPositionM = [...contact.target.positionM];
    let worstSample;
    for (const sample of contact.samples) {
      const endpointBodyPositionM = legacyPath
        ? legacyPositions.get(sample.poseId)
        : measuredEndpointEvidence.poses[sample.poseId]?.[contact.anchorId];
      if (!endpointBodyPositionM) {
        throw new RigCapabilityError('KINEMATIC.UNKNOWN_POSE', 'Point contact references an unsupported diagnostic pose',
          {constraintId: contact.id, anchorId: contact.anchorId, timeMs: sample.timeMs, poseId: sample.poseId});
      }
      const anchorBodyPositionM = [...endpointBodyPositionM];
      const distanceM = Math.hypot(...anchorBodyPositionM.map((value, axis) => value - targetBodyPositionM[axis]));
      if (!Number.isFinite(distanceM)) invalidContact('Point contact distance is not finite', {constraintId: contact.id});
      if (!worstSample || distanceM > worstSample.distanceM) {
        worstSample = {timeMs: sample.timeMs, poseId: sample.poseId, anchorBodyPositionM, distanceM};
      }
    }
    const diagnostic = {
      constraintId: contact.id, anchorId: contact.anchorId, frameId: 'body', targetBodyPositionM,
      thresholdM, sampleCount: contact.samples.length, worstSample,
    };
    if (!legacyPath) {
      diagnostic.evaluationScope = 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence';
      diagnostic.evidenceSha256 = endpointPoseEvidence.evidenceSha256;
      diagnostic.sourcePoseEvidenceSha256 = endpointPoseEvidence.sourcePoseEvidenceSha256;
      diagnostic.maximumMeasurementErrorM = measuredEndpointEvidence.maximumCrossCheckErrorM;
    }
    if (worstSample.distanceM > thresholdM) {
      throw new RigCapabilityError('KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        'A sampled point contact exceeds the calibrated tolerance', diagnostic);
    }
    return diagnostic;
  });
}

module.exports = {evaluateFixedPointContacts, validateFixedPointContacts};
