'use strict';

const crypto = require('crypto');
const {canonicalJson, validateKinematicMotionV3} = require('./kinematic-motion-v3.cjs');

const FINGERS = ['index', 'middle', 'ring', 'pinky'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function lerpVector(a, b, amount) {
  return a.map((value, index) => lerp(value, b[index], amount));
}

function slerpQuaternion(a, b, amount) {
  let dot = a.reduce((total, value, index) => total + value * b[index], 0);
  const target = dot < 0 ? b.map(value => -value) : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const result = lerpVector(a, target, amount);
    const norm = Math.hypot(...result);
    return result.map(value => value / norm);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - amount) * theta) / sinTheta;
  const right = Math.sin(amount * theta) / sinTheta;
  return a.map((value, index) => value * left + target[index] * right);
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

function interpolateJoint(a, b, amount) {
  return Object.fromEntries(Object.keys(a).map(axis => [axis, lerp(a[axis], b[axis], amount)]));
}

function interpolateHand(a, b, amount) {
  const joints = {
    thumb: {
      cmc: interpolateJoint(a.joints.thumb.cmc, b.joints.thumb.cmc, amount),
      mcp: interpolateJoint(a.joints.thumb.mcp, b.joints.thumb.mcp, amount),
      ip: interpolateJoint(a.joints.thumb.ip, b.joints.thumb.ip, amount),
    },
  };
  for (const finger of FINGERS) {
    joints[finger] = {
      mcp: interpolateJoint(a.joints[finger].mcp, b.joints[finger].mcp, amount),
      pip: interpolateJoint(a.joints[finger].pip, b.joints[finger].pip, amount),
      dip: interpolateJoint(a.joints[finger].dip, b.joints[finger].dip, amount),
    };
  }
  const wrist = {
    positionM: lerpVector(a.wrist.positionM, b.wrist.positionM, amount),
    orientationQuat: slerpQuaternion(a.wrist.orientationQuat, b.wrist.orientationQuat, amount),
  };
  if (a.wrist.orientationSpace === 'body-local' && b.wrist.orientationSpace === 'body-local') {
    wrist.orientationSpace = 'body-local';
    const direction = lerpVector(a.wrist.palmFacingDirection, b.wrist.palmFacingDirection, amount);
    const norm = Math.hypot(...direction);
    wrist.palmFacingDirection = direction.map(value => value / norm);
  }
  const result = {
    wrist,
    joints,
  };
  if (a.arm?.elbow?.space === 'body-local' && b.arm?.elbow?.space === 'body-local') {
    result.arm = {
      elbow: {
        rotationDeg: lerpVector(a.arm.elbow.rotationDeg, b.arm.elbow.rotationDeg, amount),
        space: 'body-local',
      },
    };
  }
  if (a.wrist.relativeToForearmDeg && b.wrist.relativeToForearmDeg && result.arm) {
    wrist.relativeToForearmDeg = lerpVector(
      a.wrist.relativeToForearmDeg,
      b.wrist.relativeToForearmDeg,
      amount,
    );
    wrist.orientationQuat = multiplyQuaternions(
      quaternionFromEulerDegrees(result.arm.elbow.rotationDeg),
      quaternionFromEulerDegrees(wrist.relativeToForearmDeg),
    );
  }
  return result;
}

function transitionProgress(curve, amount) {
  const clamped = Math.min(1, Math.max(0, amount));
  return curve === 'cubic'
    ? clamped * clamped * (3 - 2 * clamped)
    : clamped;
}

function interpolateKeyframes(keyframes, transitions, timeMs) {
  const nextIndex = keyframes.findIndex(keyframe => keyframe.timeMs >= timeMs);
  if (nextIndex <= 0) {
    const keyframe = keyframes[0];
    return {hands: {
      left: interpolateHand(keyframe.hands.left, keyframe.hands.left, 0),
      right: interpolateHand(keyframe.hands.right, keyframe.hands.right, 0),
    }};
  }
  if (nextIndex === -1) {
    const keyframe = keyframes.at(-1);
    return {hands: {
      left: interpolateHand(keyframe.hands.left, keyframe.hands.left, 0),
      right: interpolateHand(keyframe.hands.right, keyframe.hands.right, 0),
    }};
  }
  const previous = keyframes[nextIndex - 1];
  const next = keyframes[nextIndex];
  const transition = transitions.find(candidate => (
    candidate.fromKeyframeId === previous.id && candidate.toKeyframeId === next.id
  ));
  const amount = transitionProgress(
    transition?.curve ?? 'linear',
    (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs),
  );
  return {
    hands: {
      left: interpolateHand(previous.hands.left, next.hands.left, amount),
      right: interpolateHand(previous.hands.right, next.hands.right, amount),
    },
  };
}

function trajectoryValueAt(trajectory, timeMs) {
  if (timeMs < trajectory.fromMs || timeMs > trajectory.toMs) return undefined;
  const nextIndex = trajectory.path.findIndex(waypoint => waypoint.timeMs >= timeMs);
  if (nextIndex <= 0) return trajectory.path[0];
  if (nextIndex === -1) return trajectory.path.at(-1);
  const previous = trajectory.path[nextIndex - 1];
  const next = trajectory.path[nextIndex];
  const amount = transitionProgress(
    trajectory.curve,
    (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs),
  );
  return {
    positionM: lerpVector(previous.positionM, next.positionM, amount),
    orientationQuat: previous.orientationQuat && next.orientationQuat
      ? slerpQuaternion(previous.orientationQuat, next.orientationQuat, amount)
      : undefined,
  };
}

function applyTrajectories(hands, trajectories, timeMs) {
  for (const trajectory of trajectories) {
    const match = /^hand\.(left|right)\.palm\.center$/.exec(trajectory.target);
    if (!match) continue;
    const value = trajectoryValueAt(trajectory, timeMs);
    if (!value) continue;
    const wrist = hands[match[1]].wrist;
    wrist.positionM = [...value.positionM];
    if (value.orientationQuat) wrist.orientationQuat = [...value.orientationQuat];
  }
  return hands;
}

function nonManualAt(nonManuals, timeMs) {
  const active = nonManuals.find(record => record.fromMs <= timeMs && timeMs <= record.toMs);
  return active ? {
    id: active.id,
    headRotationDeg: [...active.headRotationDeg],
    gazeDirection: [...active.gazeDirection],
    browRaise: active.browRaise,
    smile: active.smile ?? 0,
    mouthOpening: active.mouthOpening,
    mouthPucker: active.mouthPucker,
  } : {
    id: 'neutral', headRotationDeg: [0, 0, 0], gazeDirection: [0, 0, 1], browRaise: 0, smile: 0, mouthOpening: 0, mouthPucker: 0,
  };
}

function sampledTimes(durationMs, sampleRateHz) {
  const intervalMs = 1000 / sampleRateHz;
  const times = [0];
  for (let time = intervalMs; time < durationMs; time += intervalMs) times.push(Math.round(time));
  if (times.at(-1) !== durationMs) times.push(durationMs);
  return [...new Set(times)];
}

function compileKinematicMotionV3(motion, profile, options = {}) {
  const sampleRateHz = options.sampleRateHz ?? 60;
  if (!Number.isInteger(sampleRateHz) || sampleRateHz < 30 || sampleRateHz > 120) {
    throw new Error('sampleRateHz must be an integer between 30 and 120.');
  }
  const validation = validateKinematicMotionV3(motion, profile);
  const realization = motion.kinematicRealization;
  const frames = sampledTimes(realization.durationMs, sampleRateHz).map(timeMs => {
    const pose = interpolateKeyframes(realization.keyframes, realization.transitions, timeMs);
    const hands = applyTrajectories(pose.hands, realization.trajectories, timeMs);
    return {timeMs, hands, nonManual: nonManualAt(realization.nonManuals, timeMs)};
  });
  const sourceSha256 = sha256(canonicalJson(motion));
  const plan = {
    schema: 'vozual.runtime-execution-plan',
    formatVersion: 1,
    source: {id: motion.id, revision: motion.revision, sha256: sourceSha256},
    rig: {profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256},
    durationMs: realization.durationMs,
    sampleRateHz,
    frames,
    constraints: {
      requiredContactIds: realization.contacts.filter(record => record.strength === 'required').map(record => record.id),
      requiredProximityIds: realization.proximities.filter(record => record.strength === 'required').map(record => record.id),
      requiredJointRelationIds: realization.jointRelations.filter(record => record.strength === 'required').map(record => record.id),
    },
    validation,
  };
  return {plan, sha256: sha256(canonicalJson(plan))};
}

module.exports = {compileKinematicMotionV3, interpolateHand, slerpQuaternion, transitionProgress};
