'use strict';

const crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../../schemas/motion-schema-v3.schema.json');

const validateStructure = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(schema);

const FINGERS = ['index', 'middle', 'ring', 'pinky'];

class KinematicValidationError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.code = code;
    this.path = path;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function rigProfileSha256(profile) {
  const unsigned = {...profile};
  delete unsigned.sha256;
  return crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

function fail(code, path, message) {
  throw new KinematicValidationError(code, path, message);
}

function number(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('KINEMATIC.NUMBER', path, 'finite number required');
  return value;
}

function unitQuaternion(value, path) {
  const norm = Math.hypot(...value.map((component, index) => number(component, `${path}[${index}]`)));
  if (Math.abs(norm - 1) > 1e-6) fail('KINEMATIC.QUATERNION', path, `unit quaternion required; norm=${norm}`);
}

function unitVector(value, path) {
  const norm = Math.hypot(...value.map((component, index) => number(component, `${path}[${index}]`)));
  if (Math.abs(norm - 1) > 1e-6) fail('KINEMATIC.UNIT_VECTOR', path, `unit vector required; norm=${norm}`);
}

function rotatedCanonicalPalmNormal(quaternion) {
  const [x, y, z, w] = quaternion;
  return [
    2 * (x * z + w * y),
    2 * (y * z - w * x),
    1 - 2 * (x * x + y * y),
  ];
}

function quaternionFromEulerDegrees(rotationDeg) {
  const [x, y, z] = rotationDeg.map(value => value * Math.PI / 180);
  const c1 = Math.cos(x / 2); const c2 = Math.cos(y / 2); const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2); const s2 = Math.sin(y / 2); const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function multiplyQuaternions(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function interval(record, durationMs, path) {
  if (!Number.isInteger(record.fromMs) || !Number.isInteger(record.toMs) || record.fromMs < 0 || record.toMs > durationMs || record.fromMs >= record.toMs) {
    fail('KINEMATIC.INTERVAL', path, `must satisfy 0 <= fromMs < toMs <= ${durationMs}`);
  }
}

function uniqueIds(records, path, ids) {
  for (const [index, record] of records.entries()) {
    if (ids.has(record.id)) fail('KINEMATIC.DUPLICATE_ID', `${path}[${index}].id`, `duplicate id ${record.id}`);
    ids.add(record.id);
  }
}

function genericJointKey(finger, joint, axis) {
  if (finger === 'thumb') return `thumb.${joint}.${axis}`;
  return `finger.${joint}.${axis}`;
}

function validateHand(hand, profile, path) {
  if (hand.arm) {
    hand.arm.elbow.rotationDeg.forEach((component, index) => {
      const value = number(component, `${path}.arm.elbow.rotationDeg[${index}]`);
      if (Math.abs(value) > 180) {
        fail('KINEMATIC.ELBOW_ROTATION', `${path}.arm.elbow.rotationDeg[${index}]`, 'must be within [-180, 180] degrees');
      }
    });
  }
  hand.wrist.positionM.forEach((component, index) => number(component, `${path}.wrist.positionM[${index}]`));
  unitQuaternion(hand.wrist.orientationQuat, `${path}.wrist.orientationQuat`);
  if (hand.wrist.orientationSpace === 'body-local') {
    unitVector(hand.wrist.palmFacingDirection, `${path}.wrist.palmFacingDirection`);
    const derivedNormal = rotatedCanonicalPalmNormal(hand.wrist.orientationQuat);
    const error = Math.hypot(...derivedNormal.map((value, index) => (
      value - hand.wrist.palmFacingDirection[index]
    )));
    if (error > 1e-6) {
      fail('KINEMATIC.PALM_FACING', `${path}.wrist`, 'orientationQuat must preserve palmFacingDirection');
    }
  }
  if (hand.wrist.relativeToForearmDeg) {
    if (!hand.arm) {
      fail('KINEMATIC.WRIST_FOREARM_REFERENCE', `${path}.wrist.relativeToForearmDeg`, 'requires an authored elbow rotation');
    }
    hand.wrist.relativeToForearmDeg.forEach((component, index) => {
      const value = number(component, `${path}.wrist.relativeToForearmDeg[${index}]`);
      if (Math.abs(value) > 90) {
        fail('KINEMATIC.WRIST_ROTATION', `${path}.wrist.relativeToForearmDeg[${index}]`, 'must be within [-90, 90] degrees');
      }
    });
    const composed = multiplyQuaternions(
      quaternionFromEulerDegrees(hand.arm.elbow.rotationDeg),
      quaternionFromEulerDegrees(hand.wrist.relativeToForearmDeg),
    );
    const alignment = Math.abs(composed.reduce((sum, value, index) => (
      sum + value * hand.wrist.orientationQuat[index]
    ), 0));
    if (1 - alignment > 1e-6) {
      fail('KINEMATIC.WRIST_COMPOSITION', `${path}.wrist.orientationQuat`, 'must equal elbow rotation composed with relative wrist rotation');
    }
  }
  const digits = [['thumb', ['cmc', 'mcp', 'ip']], ...FINGERS.map(finger => [finger, ['mcp', 'pip', 'dip']])];
  for (const [finger, joints] of digits) {
    for (const joint of joints) {
      const axes = joint === 'ip' || joint === 'pip' || joint === 'dip'
        ? ['flexionDeg'] : ['flexionDeg', 'abductionDeg', 'twistDeg'];
      for (const axis of axes) {
        const key = genericJointKey(finger, joint, axis);
        const [minimum, maximum] = profile.jointLimitsDeg[key] ?? [];
        const value = number(hand.joints[finger][joint][axis], `${path}.joints.${finger}.${joint}.${axis}`);
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) fail('KINEMATIC.RIG_LIMIT', path, `rig has no valid limit for ${key}`);
        if (value < minimum || value > maximum) fail('KINEMATIC.JOINT_LIMIT', `${path}.joints.${finger}.${joint}.${axis}`, `must be within rig range [${minimum}, ${maximum}]`);
      }
    }
  }
}

function validateIntervals(records, durationMs, path, ids) {
  uniqueIds(records, path, ids);
  records.forEach((record, index) => interval(record, durationMs, `${path}[${index}]`));
}

function validateKinematicMotionV3(motion, profile) {
  if (!validateStructure(motion)) {
    const first = validateStructure.errors?.[0];
    fail('KINEMATIC.STRUCTURE', first?.instancePath || '$', first?.message || 'invalid v3 motion structure');
  }
  if (!profile || profile.schema !== 'vozual.rig-profile' || profile.schemaVersion !== 1) {
    fail('KINEMATIC.RIG_PROFILE', '$.rig', 'known v1 rig profile required');
  }
  const calculatedProfileSha = rigProfileSha256(profile);
  if (profile.sha256 !== calculatedProfileSha) fail('KINEMATIC.RIG_HASH', '$.rig', 'rig profile checksum does not match its content');
  if (motion.rig.profileId !== profile.id || motion.rig.profileRevision !== profile.revision || motion.rig.sha256 !== profile.sha256) {
    fail('KINEMATIC.RIG_REFERENCE', '$.rig', 'motion must reference the exact rig profile id, revision and checksum');
  }

  const realization = motion.kinematicRealization;
  const durationMs = realization.durationMs;
  const allIds = new Set();
  uniqueIds(motion.linguisticIntent.phases, '$.linguisticIntent.phases', allIds);
  validateIntervals(motion.linguisticIntent.phases, durationMs, '$.linguisticIntent.phases', new Set());
  if (motion.linguisticIntent.phases.filter(phase => phase.role === 'stroke').length !== 1) {
    fail('KINEMATIC.STROKE_PHASE', '$.linguisticIntent.phases', 'exactly one stroke phase required per authored motion');
  }

  uniqueIds(realization.keyframes, '$.kinematicRealization.keyframes', allIds);
  let previousTime = -1;
  for (const [index, keyframe] of realization.keyframes.entries()) {
    if (keyframe.timeMs <= previousTime || keyframe.timeMs > durationMs) fail('KINEMATIC.KEYFRAME_TIME', `$.kinematicRealization.keyframes[${index}].timeMs`, 'keyframes must be strictly increasing and inside duration');
    previousTime = keyframe.timeMs;
    validateHand(keyframe.hands.left, profile, `$.kinematicRealization.keyframes[${index}].hands.left`);
    validateHand(keyframe.hands.right, profile, `$.kinematicRealization.keyframes[${index}].hands.right`);
  }
  if (realization.keyframes[0].timeMs !== 0 || realization.keyframes.at(-1).timeMs !== durationMs) {
    fail('KINEMATIC.KEYFRAME_COVERAGE', '$.kinematicRealization.keyframes', 'keyframes must start at 0 and end at durationMs');
  }

  validateIntervals(realization.nonManuals, durationMs, '$.kinematicRealization.nonManuals', allIds);
  const tracks = realization.nonManualTracks ?? [];
  if (tracks.length && realization.nonManuals.length) {
    fail('KINEMATIC.NON_MANUAL_CONFLICT', '$.kinematicRealization', 'legacy nonmanual intervals and channel tracks cannot be combined');
  }
  validateIntervals(tracks, durationMs, '$.kinematicRealization.nonManualTracks', allIds);
  for (const channel of ['headRotationDeg', 'gazeDirection', 'browRaise', 'smile', 'mouthOpening', 'mouthPucker']) {
    const ordered = tracks.filter(track => track.channel === channel)
      .sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].fromMs < ordered[index - 1].toMs) {
        fail('KINEMATIC.NON_MANUAL_OVERLAP', '$.kinematicRealization.nonManualTracks', 'tracks on the same channel cannot overlap');
      }
    }
  }
  const nonManualIds = new Set([...realization.nonManuals, ...tracks].map(value => value.id));
  for (const [index, phase] of motion.linguisticIntent.phases.entries()) {
    for (const nonManualId of phase.nonManualIds) {
      if (!nonManualIds.has(nonManualId)) fail('KINEMATIC.NON_MANUAL_REFERENCE', `$.linguisticIntent.phases[${index}].nonManualIds`, `unknown non-manual ${nonManualId}`);
    }
  }

  for (const [collection, path] of [[realization.contacts, '$.kinematicRealization.contacts'], [realization.proximities, '$.kinematicRealization.proximities'], [realization.relativePoses, '$.kinematicRealization.relativePoses'], [realization.jointRelations, '$.kinematicRealization.jointRelations'], [realization.trajectories, '$.kinematicRealization.trajectories']]) {
    validateIntervals(collection, durationMs, path, allIds);
  }
  realization.contacts.forEach((contact, index) => {
    const path = `$.kinematicRealization.contacts[${index}]`;
    if (contact.a === contact.b) fail('KINEMATIC.SELF_CONTACT', path, 'contact endpoints must differ');
    if (contact.releaseByMs !== undefined && (contact.releaseByMs < contact.toMs || contact.releaseByMs > durationMs)) fail('KINEMATIC.RELEASE_TIME', `${path}.releaseByMs`, 'must be within the motion and not precede the contact end');
  });
  realization.proximities.forEach((proximity, index) => {
    const path = `$.kinematicRealization.proximities[${index}]`;
    if (proximity.a === proximity.b) fail('KINEMATIC.SELF_PROXIMITY', path, 'proximity endpoints must differ');
    if (proximity.minDistanceM !== undefined && proximity.minDistanceM > proximity.maxDistanceM) fail('KINEMATIC.PROXIMITY_RANGE', path, 'minDistanceM must not exceed maxDistanceM');
  });
  realization.relativePoses.forEach((pose, index) => {
    if (pose.source === pose.target) fail('KINEMATIC.SELF_RELATIVE_POSE', `$.kinematicRealization.relativePoses[${index}]`, 'source and target must differ');
    if (pose.orientationQuat) unitQuaternion(pose.orientationQuat, `$.kinematicRealization.relativePoses[${index}].orientationQuat`);
  });
  realization.trajectories.forEach((trajectory, index) => {
    let lastTime = -1;
    trajectory.path.forEach((waypoint, waypointIndex) => {
      const path = `$.kinematicRealization.trajectories[${index}].path[${waypointIndex}]`;
      if (waypoint.timeMs < trajectory.fromMs || waypoint.timeMs > trajectory.toMs || waypoint.timeMs <= lastTime) fail('KINEMATIC.TRAJECTORY_TIME', `${path}.timeMs`, 'waypoints must be strictly increasing inside the trajectory interval');
      lastTime = waypoint.timeMs;
      if (waypoint.orientationQuat) unitQuaternion(waypoint.orientationQuat, `${path}.orientationQuat`);
    });
  });

  uniqueIds(realization.transitions, '$.kinematicRealization.transitions', allIds);
  const keyframeIds = new Set(realization.keyframes.map(keyframe => keyframe.id));
  realization.transitions.forEach((transition, index) => {
    const path = `$.kinematicRealization.transitions[${index}]`;
    if (transition.fromKeyframeId === transition.toKeyframeId || !keyframeIds.has(transition.fromKeyframeId) || !keyframeIds.has(transition.toKeyframeId)) fail('KINEMATIC.TRANSITION_REFERENCE', path, 'transition must connect two distinct declared keyframes');
  });
  return {profileSha256: calculatedProfileSha, durationMs, keyframeCount: realization.keyframes.length};
}

module.exports = {KinematicValidationError, canonicalJson, rigProfileSha256, validateKinematicMotionV3};
