'use strict';

const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {Quaternion, Vector3} = require('three');
const {
  calibrationError,
  createCalibratedAnchorResolver,
  createCalibratedHandFrameResolver,
  quaternionPoseRotations,
} = require('./v4-contact-geometry.cjs');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const {createAnchorPairTrajectorySampler} = require('./v4-anchor-pair-trajectory.cjs');

const EVIDENCE_PATH = path.join(__dirname, '../../schemas/rig-profiles/vozual-rig-1.anchor-pair-evidence.v1.json');
const EVIDENCE_SHA256 = '33988e842cb0f1e9a6d21c84246272e5c3bcde81283a351bc28084404a5ba35f';
const ENDPOINT_POSE_EVIDENCE_PATH = path.join(__dirname, '../../schemas/rig-profiles/vozual-rig-1.endpoint-pose-evidence.v1.json');
const ENDPOINT_POSE_EVIDENCE_SHA256 = '8fa25424a4b7e7a2ea594dc07f31502c643a55e7d4ea3ab7c28d2b2f9de7f4d4';
const MEASUREMENT_MATCH_M = 0.000001;
const PAIR_FIELDS = ['id', 'anchorIds', 'frameId', 'samples'];
const PROXIMITY_FIELDS = [...PAIR_FIELDS, 'minDistanceM', 'maxDistanceM'];
const TRAJECTORY_FIELDS = ['id', 'anchorIds', 'frameId', 'phase', 'trajectory'];
const CONTACT_PHASES = ['approach', 'hold', 'release'];
const RELATIVE_HAND_POSE_FIELDS = [
  'id', 'anchorIds', 'frameId', 'targetRelativePositionM', 'targetRelativeOrientationWxyz',
  'positionToleranceM', 'orientationToleranceDeg', 'samples',
];
const HAND_FRAME_NORMAL_FIELDS = ['id', 'anchorId', 'frameId', 'targetNormalBody', 'minDot', 'samples'];

function nonemptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactFields(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validateAnchorPairConstraints(constraints, proximity) {
  function invalidInput(message, details) {
    const code = proximity ? 'SCHEMA.INVALID_ANCHOR_PAIR_PROXIMITY' : 'SCHEMA.INVALID_ANCHOR_PAIR_CONTACT';
    throw new RigCapabilityError(code, message, details);
  }

  if (!Array.isArray(constraints) || !constraints.length) invalidInput('Anchor pair constraints must be a nonempty array');
  const used = new Set();
  for (const constraint of constraints) {
    const hasPhase = !proximity && constraint != null && Object.hasOwn(constraint, 'phase');
    const hasTrajectory = !proximity && constraint != null && Object.hasOwn(constraint, 'trajectory');
    const fields = proximity ? PROXIMITY_FIELDS
      : hasTrajectory ? TRAJECTORY_FIELDS : hasPhase ? [...PAIR_FIELDS, 'phase'] : PAIR_FIELDS;
    if (!exactFields(constraint, fields) || !nonemptyId(constraint.id)) {
      invalidInput(proximity
        ? 'An anchor pair proximity requires id, anchorIds, frameId, samples, minDistanceM and maxDistanceM'
        : 'An anchor pair contact requires id, anchorIds, frameId and samples or a phased trajectory');
    }
    const {id, anchorIds, frameId, samples, phase, trajectory, minDistanceM, maxDistanceM} = constraint;
    const details = {constraintId: id};
    if (used.has(id)) invalidInput('Anchor pair constraint IDs must be unique within the same family', details);
    used.add(id);
    if (!Array.isArray(anchorIds) || anchorIds.length !== 2 ||
        ![...anchorIds].every(nonemptyId) || anchorIds[0] === anchorIds[1]) {
      invalidInput('An anchor pair requires two distinct anchor IDs', details);
    }
    if (frameId !== 'body') invalidInput('The anchor pair requires the calibrated body frame', details);
    if (hasTrajectory) {
      if (!['approach', 'release'].includes(phase) || !exactFields(trajectory, ['id', 'fromMs', 'toMs']) ||
          !nonemptyId(trajectory.id) || !Number.isSafeInteger(trajectory.fromMs) || trajectory.fromMs < 0 ||
          !Number.isSafeInteger(trajectory.toMs) || trajectory.toMs <= trajectory.fromMs) {
        invalidInput('A trajectory requires approach or release, an ID and an increasing time interval', details);
      }
      continue;
    }
    if (!Array.isArray(samples) || !samples.length) {
      invalidInput('The anchor pair requires at least one pose sample', details);
    }
    if (proximity && (!Number.isFinite(minDistanceM) || !Number.isFinite(maxDistanceM) ||
        minDistanceM < 0 || maxDistanceM < minDistanceM)) {
      invalidInput('Proximity requires finite distances with 0 <= minDistanceM <= maxDistanceM', details);
    }
    if (hasPhase && (!CONTACT_PHASES.includes(phase) || samples.length < 2)) {
      invalidInput('A contact phase requires approach, hold or release and at least two pose samples', details);
    }
    let previousTime = -1;
    for (const sample of samples) {
      if (!exactFields(sample, ['timeMs', 'poseId']) || !nonemptyId(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs <= previousTime) {
        invalidInput('Pose samples require strictly increasing nonnegative integer times and a pose ID', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function validateAnchorPairContacts(contacts) {
  validateAnchorPairConstraints(contacts, false);
}

function validateAnchorPairProximities(proximities) {
  validateAnchorPairConstraints(proximities, true);
}

function validateRelativeHandPoses(constraints) {
  function invalidInput(message, details) {
    throw new RigCapabilityError('SCHEMA.INVALID_RELATIVE_HAND_POSE', message, details);
  }

  if (!Array.isArray(constraints) || !constraints.length) invalidInput('Relative hand poses must be a nonempty array');
  const used = new Set();
  for (const constraint of constraints) {
    if (!exactFields(constraint, RELATIVE_HAND_POSE_FIELDS) || !nonemptyId(constraint.id)) {
      invalidInput('A relative hand pose requires its ID, anchors, target transform, tolerances and samples');
    }
    const {id, anchorIds, frameId, targetRelativePositionM, targetRelativeOrientationWxyz,
      positionToleranceM, orientationToleranceDeg, samples} = constraint;
    const details = {constraintId: id};
    if (used.has(id)) invalidInput('Relative hand pose IDs must be unique within the family', details);
    used.add(id);
    if (!Array.isArray(anchorIds) || anchorIds.length !== 2 ||
        !['hand.palm.left', 'hand.palm.right'].includes(anchorIds[0]) ||
        !['hand.palm.left', 'hand.palm.right'].includes(anchorIds[1]) || anchorIds[0] === anchorIds[1]) {
      invalidInput('A relative hand pose requires the left and right calibrated palm frames in a declared order', details);
    }
    if (frameId !== 'first-anchor' || !Array.isArray(targetRelativePositionM) ||
        targetRelativePositionM.length !== 3 || !targetRelativePositionM.every(Number.isFinite) ||
        !Array.isArray(targetRelativeOrientationWxyz) || targetRelativeOrientationWxyz.length !== 4 ||
        !targetRelativeOrientationWxyz.every(Number.isFinite)) {
      invalidInput('The target transform must use the first calibrated hand frame and finite position and WXYZ quaternion', details);
    }
    const quaternionNorm = Math.hypot(...targetRelativeOrientationWxyz);
    if (Math.abs(quaternionNorm - 1) > 0.0001 || !Number.isFinite(positionToleranceM) || positionToleranceM < 0 ||
        !Number.isFinite(orientationToleranceDeg) || orientationToleranceDeg < 0 || orientationToleranceDeg > 180) {
      invalidInput('Relative pose tolerances must be finite and the target quaternion normalized', details);
    }
    if (!Array.isArray(samples) || !samples.length) invalidInput('A relative hand pose requires at least one measured pose sample', details);
    let previousTime = -1;
    for (const sample of samples) {
      if (!exactFields(sample, ['timeMs', 'poseId']) || !nonemptyId(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs <= previousTime) {
        invalidInput('Relative pose samples require increasing integer times and a measured pose ID', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function validateHandFrameNormalAlignments(constraints) {
  function invalidInput(message, details) {
    throw new RigCapabilityError('SCHEMA.INVALID_HAND_FRAME_NORMAL_ALIGNMENT', message, details);
  }

  if (!Array.isArray(constraints) || !constraints.length) invalidInput('Hand-frame normal alignments must be a nonempty array');
  const used = new Set();
  for (const constraint of constraints) {
    if (!exactFields(constraint, HAND_FRAME_NORMAL_FIELDS) || !nonemptyId(constraint.id)) {
      invalidInput('A hand-frame normal alignment requires its ID, palm anchor, target, threshold and samples');
    }
    const {id, anchorId, frameId, targetNormalBody, minDot, samples} = constraint;
    const details = {constraintId: id};
    if (used.has(id)) invalidInput('Hand-frame normal alignment IDs must be unique within the family', details);
    used.add(id);
    if (!['hand.palm.left', 'hand.palm.right'].includes(anchorId) || frameId !== 'body' ||
        !Array.isArray(targetNormalBody) || targetNormalBody.length !== 3 || !targetNormalBody.every(Number.isFinite)) {
      invalidInput('A hand-frame normal requires a calibrated palm anchor and finite body-frame direction', details);
    }
    const normalLength = Math.hypot(...targetNormalBody);
    if (Math.abs(normalLength - 1) > 0.0001 || !Number.isFinite(minDot) || minDot < -1 || minDot > 1) {
      invalidInput('The target direction must be unit length and minDot must be between -1 and 1', details);
    }
    if (!Array.isArray(samples) || !samples.length) invalidInput('A hand-frame normal requires at least one measured pose sample', details);
    let previousTime = -1;
    for (const sample of samples) {
      if (!exactFields(sample, ['timeMs', 'poseId']) || !nonemptyId(sample.poseId) ||
          !Number.isSafeInteger(sample.timeMs) || sample.timeMs <= previousTime) {
        invalidInput('Normal alignment samples require increasing integer times and a measured pose ID', details);
      }
      previousTime = sample.timeMs;
    }
  }
}

function loadEvidence(profile) {
  let bytes;
  try {
    bytes = fs.readFileSync(EVIDENCE_PATH);
  } catch {
    calibrationError('Anchor pair evidence is unavailable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== EVIDENCE_SHA256) {
    calibrationError('Anchor pair evidence checksum mismatch');
  }
  const evidence = JSON.parse(bytes.toString('utf8'));
  const {coordinateCalibration, coordinateFrames, endpointGeometry} = profile.descriptor;
  if (evidence.profileSha256 !== profile.sha256 || evidence.candidateSha256 !== profile.asset.candidateSha256 ||
      evidence.coordinateCalibrationSha256 !== coordinateCalibration.measurementSha256 ||
      evidence.thresholdM !== profile.conformance.contactToleranceM ||
      !coordinateFrames.some(frame => frame.id === evidence.frameId && frame.status === 'validated') ||
      Object.keys(evidence.anchors).some(id => !endpointGeometry.anchors.includes(id))) {
    calibrationError('Anchor pair evidence does not match the calibrated profile and candidate');
  }
  return evidence;
}

function distanceM(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function endpointBoneForProximity(anchorId, profile) {
  if (!profile.descriptor.endpointGeometry.anchors.includes(anchorId)) return undefined;
  const match = /^hand\.(palm|thumb|index|middle|ring|pinky)(?:\.tip)?\.(left|right)$/.exec(anchorId);
  if (!match) return undefined;
  const [, part, side] = match;
  const suffix = side === 'left' ? 'L' : 'R';
  if (part === 'palm') return `DEF-hand.${suffix}`;
  const finger = part === 'thumb' ? 'thumb' : `f_${part}`;
  return `DEF-${finger}.03.${suffix}`;
}

function loadEndpointPoseEvidence(profile, candidateBytes, evidence) {
  let bytes;
  try {
    bytes = fs.readFileSync(ENDPOINT_POSE_EVIDENCE_PATH);
  } catch {
    calibrationError('Calibrated endpoint pose evidence is unavailable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== ENDPOINT_POSE_EVIDENCE_SHA256) {
    calibrationError('Calibrated endpoint pose evidence checksum mismatch');
  }
  const measured = JSON.parse(bytes.toString('utf8'));
  const endpointIds = profile.descriptor.endpointGeometry.anchors;
  if (measured.schema !== 'vozual.rig-calibrated-endpoint-pose-measurements' || measured.schemaVersion !== 1 ||
      measured.candidateSha256 !== createHash('sha256').update(candidateBytes).digest('hex') ||
      measured.candidateSha256 !== profile.asset.candidateSha256 || measured.profileSha256 !== profile.sha256 ||
      measured.coordinateCalibrationSha256 !== profile.descriptor.coordinateCalibration.measurementSha256 ||
      measured.sourcePoseEvidenceSha256 !== EVIDENCE_SHA256 ||
      !measured.endpointBoneMap || Object.keys(measured.endpointBoneMap).length !== endpointIds.length ||
      !endpointIds.every(id => measured.endpointBoneMap[id] === endpointBoneForProximity(id, profile)) ||
      !measured.poses || Object.keys(measured.poses).some(poseId => !Object.hasOwn(evidence.poses, poseId)) ||
      !Object.keys(evidence.poses).every(poseId => Object.hasOwn(measured.poses, poseId)) ||
      !Number.isFinite(measured.maximumCrossCheckErrorM) || measured.maximumCrossCheckErrorM > MEASUREMENT_MATCH_M ||
      !Array.isArray(measured.crossChecks) || !measured.crossChecks.length ||
      measured.crossChecks.some(row => !Number.isFinite(row.errorM) || row.errorM > MEASUREMENT_MATCH_M)) {
    calibrationError('Calibrated endpoint pose evidence does not match the bound rig and pose inventory');
  }
  for (const [poseId, positions] of Object.entries(measured.poses)) {
    if (!positions || Object.keys(positions).length !== endpointIds.length || endpointIds.some(id =>
      !Array.isArray(positions[id]) || positions[id].length !== 3 || !positions[id].every(Number.isFinite))) {
      calibrationError(`Calibrated endpoint pose evidence is incomplete for ${poseId}`);
    }
  }
  return measured;
}

function loadProfileBoundEndpointPoseEvidence(profile, candidateBytes) {
  const measured = loadEndpointPoseEvidence(profile, candidateBytes, loadEvidence(profile));
  return {
    measured,
    evidenceSha256: ENDPOINT_POSE_EVIDENCE_SHA256,
    sourcePoseEvidenceSha256: measured.sourcePoseEvidenceSha256,
  };
}

function validateMeasuredEndpointProximity(constraint, profile, candidateBytes, evidence, identity) {
  const {anchorIds, minDistanceM, maxDistanceM} = constraint;
  const anchorBones = Object.fromEntries(anchorIds.map(id => [id, endpointBoneForProximity(id, profile)]));
  if (Object.values(anchorBones).some(bone => !bone)) {
    throw new RigCapabilityError('KINEMATIC.UNKNOWN_ANCHOR',
      'Rest-only proximity requires two declared calibrated hand endpoints', identity);
  }
  const measuredEvidence = loadEndpointPoseEvidence(profile, candidateBytes, evidence);
  const samples = constraint.samples.map(({timeMs, poseId}) => {
    const measured = measuredEvidence.poses[poseId];
    if (!measured) {
      throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
        'No calibrated endpoint pose evidence exists for this proximity sample', {...identity, timeMs, poseId});
    }
    const anchorBodyPositionsM = anchorIds.map(id => [...measured[id]]);
    return {
      timeMs, poseId, anchorBodyPositionsM, distanceM: distanceM(...anchorBodyPositionsM),
      measuredEndpointPositionsBodyM: anchorIds.map(id => [...measured[id]]),
      maximumMeasurementErrorM: measuredEvidence.maximumCrossCheckErrorM,
    };
  });
  let worstSample;
  let worstScore = -Infinity;
  for (const sample of samples) {
    const score = Math.max(minDistanceM - sample.distanceM, sample.distanceM - maxDistanceM);
    if (score > worstScore) {
      worstScore = score;
      worstSample = sample;
    }
  }
  const diagnostic = {
    ...identity,
    frameId: 'body',
    sampleCount: samples.length,
    minDistanceM,
    maxDistanceM,
    worstMarginM: -worstScore,
    worstSample,
    evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
    evidenceSha256: ENDPOINT_POSE_EVIDENCE_SHA256,
    sourcePoseEvidenceSha256: measuredEvidence.sourcePoseEvidenceSha256,
  };
  if (worstScore > 0) {
    throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_OUTSIDE_PROXIMITY',
      'A calibrated neutral-rest endpoint pair is outside the required proximity range', diagnostic);
  }
  return diagnostic;
}

function validateContactDistances(diagnostic, samples) {
  const {phase, thresholdM, worstSample} = diagnostic;
  if (phase === undefined || phase === 'hold') {
    if (worstSample.distanceM > thresholdM) {
      throw new RigCapabilityError('KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        'A sampled anchor pair exceeds the calibrated tolerance', diagnostic);
    }
    return;
  }

  const approaching = phase === 'approach';
  const {startSample, endSample} = diagnostic;
  const contactSample = approaching ? endSample : startSample;
  const separatedSample = approaching ? startSample : endSample;
  if (contactSample.distanceM > thresholdM || separatedSample.distanceM <= thresholdM) {
    throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_PHASE_BOUNDARY',
      `Sampled ${phase} must ${approaching ? 'enter' : 'leave'} the calibrated contact tolerance`,
      {...diagnostic, contactSample, separatedSample});
  }

  let worstReversal;
  for (let index = 1; index < samples.length; index++) {
    const fromSample = samples[index - 1];
    const toSample = samples[index];
    const deltaM = toSample.distanceM - fromSample.distanceM;
    const reversalM = approaching ? deltaM : -deltaM;
    if (reversalM > (worstReversal?.reversalM ?? 0)) {
      worstReversal = {fromSample, toSample, reversalM};
    }
  }
  if (worstReversal) {
    throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_PHASE_REVERSAL',
      `Sampled ${phase} reverses the required distance trend`, {...diagnostic, worstReversal});
  }
}

function createAnchorPairEvaluator(profile, candidateBytes, options) {
  const evidence = loadEvidence(profile);
  const resolve = createCalibratedAnchorResolver(profile, candidateBytes, options, evidence.anchors);
  const poses = new Map();
  let sampleTrajectory;
  return constraint => {
    const anchorIds = [...constraint.anchorIds];
    const {minDistanceM, maxDistanceM} = constraint;
    const proximity = Object.hasOwn(constraint, 'minDistanceM');
    const identity = {constraintId: constraint.id, anchorIds};
    for (const anchorId of anchorIds) {
      if (!profile.descriptor.endpointGeometry.anchors.includes(anchorId)) {
        throw new RigCapabilityError('KINEMATIC.UNKNOWN_ANCHOR', 'Anchor pair references an unknown endpoint',
          {...identity, anchorId});
      }
    }
    const pair = evidence.pairs.find(row => anchorIds.every(id => row.anchorIds.includes(id)));
    let trajectory;
    if (Object.hasOwn(constraint, 'trajectory')) {
      sampleTrajectory ??= createAnchorPairTrajectorySampler(evidence, resolve);
      trajectory = sampleTrajectory(constraint, pair);
    }
    const measuredSamples = trajectory?.samples ?? constraint.samples.map(({timeMs, poseId}) => {
      const observation = pair && Object.hasOwn(pair.observations, poseId) ? pair.observations[poseId] : undefined;
      if (!observation) {
        if (proximity) {
          return undefined;
        }
        throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
          'No measured overlap evidence for this anchor pair and pose', {...identity, timeMs, poseId});
      }
      if (!poses.has(poseId)) {
        poses.set(poseId, resolve(quaternionPoseRotations(evidence.poses[poseId])));
      }
      return {timeMs, poseId, positions: poses.get(poseId), ...observation, measurementSha256: pair.measurementSha256};
    });

    if (proximity && measuredSamples.some(sample => sample === undefined)) {
      if (!measuredSamples.every(sample => sample === undefined)) {
        throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
          'A proximity constraint cannot mix pair-scoped overlap samples with endpoint-only samples', identity);
      }
      return validateMeasuredEndpointProximity(constraint, profile, candidateBytes, evidence, identity);
    }

    const samples = [];
    let worstSample;
    let worstScore = -Infinity;
    let collisionSample;
    let collisionCount = 0;
    for (const measured of measuredSamples) {
      const {timeMs, positions, expectedBodyPositionsM, overlapCounts, measurementSha256, ...location} = measured;
      for (const [index, id] of pair.anchorIds.entries()) {
        if (distanceM(positions.get(id), expectedBodyPositionsM[index]) > MEASUREMENT_MATCH_M) {
          calibrationError(`Reconstructed anchor ${id} does not match the measurement for ${constraint.id} at ${timeMs} ms`);
        }
      }
      const anchorBodyPositionsM = anchorIds.map(id => [...positions.get(id)]);
      const sample = {
        timeMs, ...location, anchorBodyPositionsM, distanceM: distanceM(...anchorBodyPositionsM),
        overlapCounts: {...overlapCounts}, measurementSha256,
      };
      samples.push(sample);
      const score = proximity ? Math.max(minDistanceM - sample.distanceM, sample.distanceM - maxDistanceM) : sample.distanceM;
      if (score > worstScore) {
        worstScore = score;
        worstSample = sample;
      }
      const count = Object.values(overlapCounts).reduce((total, overlaps) => total + overlaps, 0);
      if (count > collisionCount && (!collisionSample || trajectory)) {
        collisionCount = count;
        collisionSample = sample;
      }
    }
    const diagnostic = {...identity, frameId: evidence.frameId, sampleCount: samples.length,
      evidenceSha256: EVIDENCE_SHA256, worstSample};
    if (proximity) {
      Object.assign(diagnostic, {minDistanceM, maxDistanceM, worstMarginM: -worstScore});
      if (worstScore > 0) {
        throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_OUTSIDE_PROXIMITY',
          'A sampled anchor pair is outside the required proximity range', diagnostic);
      }
    } else {
      diagnostic.thresholdM = evidence.thresholdM;
      if (Object.hasOwn(constraint, 'phase')) {
        Object.assign(diagnostic, {phase: constraint.phase, startSample: samples[0], endSample: samples.at(-1)});
      }
      if (trajectory) {
        diagnostic.trajectoryId = constraint.trajectory.id;
        diagnostic.trajectoryEvidenceSha256 = trajectory.trajectoryEvidenceSha256;
      }
      validateContactDistances(diagnostic, samples);
    }
    if (collisionSample) {
      throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_SCOPED_OVERLAP',
        'Measured scoped overlaps reject an anchor pair sample', {...diagnostic, collisionSample});
    }
    return {...diagnostic, collisionEvidenceScope: evidence.scope};
  };
}

function createRelativeHandPoseEvaluator(profile, candidateBytes, options) {
  const evidence = loadEvidence(profile);
  const resolveFrames = createCalibratedHandFrameResolver(profile, candidateBytes, options);
  const framesByPose = new Map();
  return constraint => {
    const [firstId, secondId] = constraint.anchorIds;
    const identity = {constraintId: constraint.id, anchorIds: [...constraint.anchorIds], frameId: constraint.frameId};
    const targetPosition = new Vector3().fromArray(constraint.targetRelativePositionM);
    const targetOrientation = new Quaternion(
      constraint.targetRelativeOrientationWxyz[1], constraint.targetRelativeOrientationWxyz[2],
      constraint.targetRelativeOrientationWxyz[3], constraint.targetRelativeOrientationWxyz[0],
    ).normalize();
    const samples = constraint.samples.map(({timeMs, poseId}) => {
      if (!Object.hasOwn(evidence.poses, poseId)) {
        throw new RigCapabilityError('KINEMATIC.RELATIVE_HAND_POSE_EVIDENCE_UNAVAILABLE',
          'No calibrated hand pose is available for this sample', {...identity, timeMs, poseId});
      }
      if (!framesByPose.has(poseId)) {
        framesByPose.set(poseId, resolveFrames(quaternionPoseRotations(evidence.poses[poseId])));
      }
      const frames = framesByPose.get(poseId);
      const first = frames.get(firstId);
      const second = frames.get(secondId);
      if (!first || !second) calibrationError('Calibrated left and right hand frames are required');
      const firstOrientation = new Quaternion(first.orientationWxyz[1], first.orientationWxyz[2],
        first.orientationWxyz[3], first.orientationWxyz[0]).normalize();
      const secondOrientation = new Quaternion(second.orientationWxyz[1], second.orientationWxyz[2],
        second.orientationWxyz[3], second.orientationWxyz[0]).normalize();
      const relativePosition = new Vector3().fromArray(second.positionM)
        .sub(new Vector3().fromArray(first.positionM)).applyQuaternion(firstOrientation.clone().invert());
      const relativeOrientation = firstOrientation.clone().invert().multiply(secondOrientation).normalize();
      const actualPosition = relativePosition.toArray();
      const actualOrientationWxyz = [relativeOrientation.w, relativeOrientation.x, relativeOrientation.y, relativeOrientation.z];
      const positionErrorM = relativePosition.distanceTo(targetPosition);
      const orientationDot = Math.min(1, Math.abs(relativeOrientation.dot(targetOrientation)));
      const orientationErrorDeg = 2 * Math.acos(orientationDot) * (180 / Math.PI);
      return {
        timeMs,
        poseId,
        relativePositionM: actualPosition,
        relativeOrientationWxyz: actualOrientationWxyz,
        positionErrorM,
        positionToleranceM: constraint.positionToleranceM,
        orientationErrorDeg,
        orientationToleranceDeg: constraint.orientationToleranceDeg,
      };
    });
    const worstSample = samples.reduce((worst, sample) => {
      const score = Math.max(
        sample.positionErrorM / Math.max(constraint.positionToleranceM, 1e-9),
        sample.orientationErrorDeg / Math.max(constraint.orientationToleranceDeg, 1e-9),
      );
      return !worst || score > worst.score ? {sample, score} : worst;
    }, undefined)?.sample;
    const diagnostic = {...identity, sampleCount: samples.length, evidenceSha256: EVIDENCE_SHA256,
      tolerances: {positionM: constraint.positionToleranceM, orientationDeg: constraint.orientationToleranceDeg}, worstSample};
    if (samples.some(sample => sample.positionErrorM > constraint.positionToleranceM ||
        sample.orientationErrorDeg > constraint.orientationToleranceDeg)) {
      throw new RigCapabilityError('KINEMATIC.RELATIVE_HAND_POSE_OUTSIDE_TOLERANCE',
        'A calibrated hand-pair transform is outside its required position or orientation tolerance', diagnostic);
    }
    return diagnostic;
  };
}

function createHandFrameNormalAlignmentEvaluator(profile, candidateBytes, options) {
  const evidence = loadEvidence(profile);
  const resolveFrames = createCalibratedHandFrameResolver(profile, candidateBytes, options);
  const framesByPose = new Map();
  return constraint => {
    const identity = {constraintId: constraint.id, anchorId: constraint.anchorId, frameId: constraint.frameId};
    const target = new Vector3().fromArray(constraint.targetNormalBody).normalize();
    const samples = constraint.samples.map(({timeMs, poseId}) => {
      if (!Object.hasOwn(evidence.poses, poseId)) {
        throw new RigCapabilityError('KINEMATIC.HAND_FRAME_NORMAL_EVIDENCE_UNAVAILABLE',
          'No calibrated hand pose is available for this normal sample', {...identity, timeMs, poseId});
      }
      if (!framesByPose.has(poseId)) {
        framesByPose.set(poseId, resolveFrames(quaternionPoseRotations(evidence.poses[poseId])));
      }
      const hand = framesByPose.get(poseId).get(constraint.anchorId);
      if (!hand) calibrationError('Calibrated palm frame is unavailable');
      const orientation = new Quaternion(hand.orientationWxyz[1], hand.orientationWxyz[2],
        hand.orientationWxyz[3], hand.orientationWxyz[0]).normalize();
      const normalBody = new Vector3(0, 0, 1).applyQuaternion(orientation).normalize();
      const alignmentDot = Math.min(1, Math.max(-1, normalBody.dot(target)));
      return {timeMs, poseId, normalBody: normalBody.toArray(), targetNormalBody: target.toArray(), alignmentDot};
    });
    const worstSample = samples.reduce((worst, sample) => !worst || sample.alignmentDot < worst.alignmentDot ? sample : worst,
      undefined);
    const diagnostic = {...identity, sampleCount: samples.length, minDot: constraint.minDot,
      evidenceSha256: EVIDENCE_SHA256, worstSample};
    if (worstSample.alignmentDot < constraint.minDot) {
      throw new RigCapabilityError('KINEMATIC.HAND_FRAME_NORMAL_MISALIGNED',
        'A calibrated hand-frame Z axis is below the required alignment', diagnostic);
    }
    return diagnostic;
  };
}

module.exports = {
  createAnchorPairEvaluator,
  createHandFrameNormalAlignmentEvaluator,
  createRelativeHandPoseEvaluator,
  loadProfileBoundEndpointPoseEvidence,
  validateAnchorPairContacts,
  validateAnchorPairProximities,
  validateHandFrameNormalAlignments,
  validateRelativeHandPoses,
};
