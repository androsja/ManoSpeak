'use strict';

const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {calibrationError, quaternionPoseRotations} = require('./v4-contact-geometry.cjs');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const EVIDENCE_PATH = path.join(__dirname, '../../schemas/rig-profiles/vozual-rig-1.anchor-pair-trajectories.v1.json');
const EVIDENCE_SHA256 = '927bcb0663f1c2e791f556d1790465ecbc05b794ff05523dfc94a1d75f8410d6';

function createAnchorPairTrajectorySampler(endpointEvidence, resolve) {
  let bytes;
  try {
    bytes = readFileSync(EVIDENCE_PATH);
  } catch {
    calibrationError('Anchor pair trajectory evidence is unavailable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== EVIDENCE_SHA256) {
    calibrationError('Anchor pair trajectory evidence checksum mismatch');
  }
  const evidence = JSON.parse(bytes.toString('utf8'));
  const pair = endpointEvidence.pairs.find(row => row.anchorIds.length === evidence.anchorIds.length &&
    row.anchorIds.every((id, index) => id === evidence.anchorIds[index]));
  const commands = endpointEvidence.poses[evidence.endpointPoseId];
  if (!commands || !pair || !Object.hasOwn(pair.observations, evidence.endpointPoseId) ||
      evidence.candidateSha256 !== endpointEvidence.candidateSha256 ||
      evidence.profileSha256 !== endpointEvidence.profileSha256 ||
      evidence.coordinateCalibrationSha256 !== endpointEvidence.coordinateCalibrationSha256 ||
      evidence.frameId !== endpointEvidence.frameId || evidence.contactToleranceM !== endpointEvidence.thresholdM ||
      evidence.endpointMeasurementSha256 !== pair.measurementSha256) {
    calibrationError('Trajectory evidence does not match the calibrated anchor pair and endpoint pose');
  }

  const measuredPositions = new Map();
  return (constraint, anchorPair) => {
    const {id, fromMs, toMs} = constraint.trajectory;
    if (pair !== anchorPair || !Object.hasOwn(evidence.trajectories, id)) {
      throw new RigCapabilityError('KINEMATIC.ANCHOR_PAIR_TRAJECTORY_UNAVAILABLE',
        'No measured trajectory for this anchor pair and trajectory ID',
        {constraintId: constraint.id, anchorIds: constraint.anchorIds, trajectoryId: id});
    }
    const {samples, boneWindows, measurementSha256} = evidence.trajectories[id];
    if (!measuredPositions.has(id)) {
      measuredPositions.set(id, samples.map(({fraction, bodyPositionsM, overlapCounts}) => ({
        trajectoryFraction: fraction,
        positions: resolve(quaternionPoseRotations(commands, fraction, boneWindows)),
        expectedBodyPositionsM: bodyPositionsM,
        overlapCounts,
        measurementSha256,
      })));
    }
    const measurements = measuredPositions.get(id);
    const releasing = constraint.phase === 'release';
    const ordered = releasing ? [...measurements].reverse() : measurements;
    return {
      trajectoryEvidenceSha256: EVIDENCE_SHA256,
      samples: ordered.map(sample => {
        const progress = releasing ? 1 - sample.trajectoryFraction : sample.trajectoryFraction;
        return {...sample, timeMs: fromMs + progress * (toMs - fromMs)};
      }),
    };
  };
}

module.exports = {createAnchorPairTrajectorySampler};
