'use strict';

const fs = require('node:fs');
const path = require('node:path');

const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');
const round = value => Math.round(value * 100000) / 100000;

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-8 ? vector.map(value => value / length) : [0, 1, 0];
}

// Analytic open hand with explicit per-side lateral axis.
function analyticHand(wrist, direction, side, acrossDirection) {
  const forward = normalize(direction);
  const seed = acrossDirection ?? (side === 'right' ? [-1, 0, 0] : [0, 0, -1]);
  const dot = seed.reduce((sum, value, axis) => sum + value * forward[axis], 0);
  const across = normalize(seed.map((value, axis) => value - dot * forward[axis]));
  const point = (u, v) => wrist.map((value, axis) => round(value + across[axis] * u + forward[axis] * v));
  const thumbSign = side === 'left' ? -1 : 1;
  const points = [
    [...wrist],
    point(0.025 * thumbSign, 0.015),
    point(0.05 * thumbSign, 0.03),
    point(0.07 * thumbSign, 0.045),
    point(0.085 * thumbSign, 0.06),
  ];
  [0.035, 0.012, -0.012, -0.035].forEach((u, index) => {
    const length = [0.16, 0.18, 0.165, 0.14][index];
    [0.2, 0.52, 0.8, 1].forEach(t => points.push(point(u * thumbSign, length * t)));
  });
  return points;
}

function fanOpenHand(handPoints) {
  // Spread all five fingers cleanly so the open/curved '5' stays airy rather than bunched.
  // indexMcp - pinkyMcp already points toward the radial/thumb side for both hands.
  const wrist = handPoints[0];
  const middleMcp = handPoints[9];
  const forward = normalize(middleMcp.map((value, axis) => value - wrist[axis]));
  const indexMcp = handPoints[5];
  const pinkyMcp = handPoints[17];
  const rawAcross = indexMcp.map((value, axis) => value - pinkyMcp[axis]);
  const dot = rawAcross.reduce((sum, value, axis) => sum + value * forward[axis], 0);
  const across = normalize(rawAcross.map((value, axis) => value - dot * forward[axis]));
  const fanOffsets = [0.072, 0.025, -0.025, -0.072];
  const thumbExtras = [0.008, 0.02, 0.032, 0.044];
  const result = handPoints.map(point => [...point]);

  thumbExtras.forEach((extra, jointIndex) => {
    const point = result[1 + jointIndex];
    result[1 + jointIndex] = point.map((value, axis) => round(
      value + across[axis] * extra + forward[axis] * extra * 0.45,
    ));
  });

  fanOffsets.forEach((fan, fingerIndex) => {
    const baseIndex = 5 + fingerIndex * 4;
    [0.2, 0.52, 0.8, 1].forEach((t, jointIndex) => {
      const point = result[baseIndex + jointIndex];
      const delta = fan * (t - 0.2);
      result[baseIndex + jointIndex] = point.map((value, axis) => round(value + across[axis] * delta));
    });
  });
  return result;
}

function computeTangents(keys, getter) {
  return keys.map((key, index) => {
    if (index === 0 || index === keys.length - 1 || key.tangentMode === 'zero') {
      return getter(key).map(() => 0);
    }
    const prev = keys[index - 1];
    const next = keys[index + 1];
    const span = Math.max(1, next.ms - prev.ms);
    const prevValue = getter(prev);
    const nextValue = getter(next);
    return nextValue.map((value, axis) => (value - prevValue[axis]) / span);
  });
}

function evalHermite(p0, p1, m0, m1, dt, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return p0.map((value, axis) => round(
    h00 * value + h10 * dt * m0[axis] + h01 * p1[axis] + h11 * dt * m1[axis],
  ));
}

function buildFrames(recipe) {
  const frames = [];
  const keys = recipe.keyframes;
  const totalFrames = Math.round((recipe.durationMs * recipe.fps) / 1000);
  const fields = [
    'rightWrist', 'rightElbow', 'leftWrist', 'leftElbow',
    'rightDirection', 'leftDirection', 'rightAcross', 'leftAcross',
  ];
  const tangents = Object.fromEntries(
    fields.map(field => [field, computeTangents(keys, key => key[field])]),
  );
  const headTangents = computeTangents(keys, key => [key.headPitch ?? 0]);

  for (let index = 0; index <= totalFrames; index++) {
    const ms = (index * 1000) / recipe.fps;
    let segmentIndex = 0;
    for (let i = 0; i < keys.length - 1; i++) {
      if (ms >= keys[i].ms) segmentIndex = i;
    }
    const a = keys[segmentIndex];
    const b = keys[Math.min(keys.length - 1, segmentIndex + 1)];
    const dt = b.ms - a.ms;
    const s = dt <= 0 ? 0 : Math.min(1, Math.max(0, (ms - a.ms) / dt));

    const pose = {};
    fields.forEach(field => {
      const value = dt <= 0
        ? a[field]
        : evalHermite(
          a[field],
          b[field],
          tangents[field][segmentIndex],
          tangents[field][Math.min(keys.length - 1, segmentIndex + 1)],
          dt,
          s,
        );
      pose[field] = field.endsWith('Direction') || field.endsWith('Across')
        ? normalize(value)
        : value;
    });

    const headPitch = dt <= 0
      ? (a.headPitch ?? 0)
      : evalHermite(
        [a.headPitch ?? 0],
        [b.headPitch ?? 0],
        headTangents[segmentIndex],
        headTangents[Math.min(keys.length - 1, segmentIndex + 1)],
        dt,
        s,
      )[0];

    const bodyHands = Array.from({length: 75}, () => [0, 0, 0]);
    bodyHands[11] = [0.71, 0.68, 0];
    bodyHands[12] = [0.29, 0.68, 0];
    bodyHands[23] = [0.59, 1.15, 0];
    bodyHands[24] = [0.41, 1.15, 0];
    bodyHands[13] = pose.leftElbow;
    bodyHands[14] = pose.rightElbow;
    bodyHands[15] = pose.leftWrist;
    bodyHands[16] = pose.rightWrist;

    const leftHand = analyticHand(pose.leftWrist, pose.leftDirection, 'left', pose.leftAcross);
    const rightHand = analyticHand(pose.rightWrist, pose.rightDirection, 'right', pose.rightAcross);
    const isRest = ms <= 0;
    const finalLeft = isRest ? leftHand : fanOpenHand(leftHand);
    const finalRight = isRest ? rightHand : fanOpenHand(rightHand);

    finalLeft.forEach((point, i) => { bodyHands[33 + i] = point; });
    finalRight.forEach((point, i) => { bodyHands[54 + i] = point; });

    frames.push({
      bodyHands,
      face: Array.from({length: 468}, () => [0, 0, 0]),
      headOrientation: {yaw: 0, pitch: round(headPitch), roll: 0},
    });
  }
  return frames;
}

function fingerCurl(bend, scale) {
  const clampUnit = value => Math.min(1, round(value));
  return [
    clampUnit(0.48 * scale * bend),
    clampUnit(0.92 * scale * bend),
    clampUnit(0.88 * scale * bend),
  ];
}

function handPose(bend, thumbBend) {
  return {
    fist: 0,
    fingerJoints: {
      thumb: [round(0.24 * thumbBend), round(0.72 * thumbBend), round(0.78 * thumbBend)],
      index: fingerCurl(bend, 0.94),
      middle: fingerCurl(bend, 1),
      ring: fingerCurl(bend, 1.03),
      pinky: fingerCurl(bend, 1.06),
    },
  };
}

function buildMotion(recipe) {
  const frames = buildFrames(recipe);
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    reference: recipe.reference,
    description: recipe.description,
    publicationReview: {
      status: 'draft',
      scope: 'INSOR page 266 / owner visual review; awaiting approval.',
    },
    authoring: {
      source: 'procedural-keyframes',
      recipe: 'querer.authoring.json',
      referencePage: 266,
      speechAliases: recipe.releaseMetadata.speechAliases,
      strokes: [{fromMs: 500, toMs: 1467}],
    },
    avatarProfile: {
      activeHand: 'right',
      forceTwoHands: true,
      rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'captured',
      rigLeftHandShape: 'captured',
      rigRightPalmScaleMin: 0.9,
      rigRightPalmScaleMax: 0.9,
      rigLeftPalmScaleMin: 0.9,
      rigLeftPalmScaleMax: 0.9,
      contactAnchor: 'none',
      rigHandKeyframes: recipe.handKeyframes.map(({frame, transitionFrames, smile, eyeWidening, bend, thumbBend}) => ({
        frame,
        transitionFrames,
        smile,
        ...(eyeWidening !== undefined ? {eyeWidening} : {}),
        left: handPose(bend, thumbBend),
        right: handPose(bend, thumbBend),
      })),
    },
    frames,
  };
}

if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'querer.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(directory, 'querer.motion.json'), `${JSON.stringify(motion)}\n`);
  console.log(`QUERER: ${motion.frames.length} authored frames; local draft.`);
}

module.exports = {buildMotion, buildFrames};
