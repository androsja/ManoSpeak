'use strict';

const fs = require('node:fs');
const path = require('node:path');

const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');
const round = x => Math.round(x * 100000) / 100000;
const normalize = v => {
  const len = Math.hypot(...v);
  return len > 1e-8 ? v.map(x => x / len) : [0, 1, 0];
};
const mix = (a, b, t) => a.map((x, i) => round(x + (b[i] - x) * t));

// Analytic open hand supporting per-frame lateral orientation for both sides.
function hand(wrist, direction, side, acrossDirection) {
  const forward = normalize(direction);
  const seed = acrossDirection ?? (side === 'right' ? [-1, 0, 0] : [0, 0, -1]);
  const dot = seed.reduce((sum, x, i) => sum + x * forward[i], 0);
  const across = normalize(seed.map((x, i) => x - dot * forward[i]));
  const point = (u, v) => wrist.map((x, i) => round(x + across[i] * u + forward[i] * v));
  const thumbSign = side === 'left' ? -1 : 1;
  const points = [
    [...wrist],
    point(0.025 * thumbSign, 0.015),
    point(0.05 * thumbSign, 0.03),
    point(0.07 * thumbSign, 0.045),
    point(0.085 * thumbSign, 0.06),
  ];
  [0.035, 0.012, -0.012, -0.035].forEach((u, i) => {
    const length = [0.16, 0.18, 0.165, 0.14][i];
    [0.2, 0.52, 0.8, 1].forEach(t => points.push(point(u * thumbSign, length * t)));
  });
  return points;
}

function buildFrames(recipe) {
  const frames = [];
  const keys = recipe.keyframes;
  const totalFrames = Math.round((recipe.durationMs * recipe.fps) / 1000);
  for (let index = 0; index <= totalFrames; index++) {
    const ms = (index * 1000) / recipe.fps;
    const next = keys.findIndex(k => k.ms >= ms);
    const a = keys[Math.max(0, next - 1)];
    const b = keys[next >= 0 ? next : keys.length - 1];
    const amount = a.ms === b.ms ? 0 : (ms - a.ms) / (b.ms - a.ms);
    const t = amount * amount * (3 - 2 * amount);
    const pose = {};
    ['rightWrist', 'rightElbow', 'leftWrist', 'leftElbow', 'rightDirection', 'leftDirection']
      .forEach(key => { pose[key] = mix(a[key], b[key], t); });
    const bodyHands = Array.from({length: 75}, () => [0, 0, 0]);
    bodyHands[11] = [0.71, 0.68, 0];
    bodyHands[12] = [0.29, 0.68, 0];
    bodyHands[23] = [0.59, 1.15, 0];
    bodyHands[24] = [0.41, 1.15, 0];
    bodyHands[13] = pose.leftElbow;
    bodyHands[14] = pose.rightElbow;
    bodyHands[15] = pose.leftWrist;
    bodyHands[16] = pose.rightWrist;
    const leftAcross = mix(a.leftAcross ?? [0, 0, -1], b.leftAcross ?? [0, 0, -1], t);
    const rightAcross = mix(a.rightAcross ?? [-1, 0, 0], b.rightAcross ?? [-1, 0, 0], t);
    hand(pose.leftWrist, pose.leftDirection, 'left', leftAcross)
      .forEach((p, i) => { bodyHands[33 + i] = p; });
    hand(pose.rightWrist, pose.rightDirection, 'right', rightAcross)
      .forEach((p, i) => { bodyHands[54 + i] = p; });
    frames.push({
      bodyHands,
      face: Array.from({length: 468}, () => [0, 0, 0]),
      headOrientation: {
        yaw: 0,
        pitch: round(a.headPitch + (b.headPitch - a.headPitch) * t),
        roll: 0,
      },
    });
  }
  return frames;
}

function buildMotion(recipe) {
  const frames = buildFrames(recipe);
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    description: recipe.description,
    reference: recipe.reference,
    publicationReview: {
      status: 'draft',
      scope: 'INSOR page 487; awaiting owner visual review.',
    },
    authoring: {
      source: 'procedural-keyframes',
      recipe: 'buenos-dias.authoring.json',
      referencePage: 487,
      speechAliases: ['buenos días', 'buenos dias', 'buen día', 'buen dia'],
      strokes: [{fromMs: 550, toMs: 1200}, {fromMs: 1600, toMs: 2450}],
    },
    avatarProfile: {
      activeHand: 'right',
      forceTwoHands: true,
      rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'captured',
      rigLeftHandShape: 'captured',
      rigRightPalmScaleMin: 0.84,
      rigRightPalmScaleMax: 0.84,
      rigLeftPalmScaleMin: 0.84,
      rigLeftPalmScaleMax: 0.84,
      contactAnchor: 'chin',
      contactStartFrame: 16,
      contactEndFrame: 21,
      rigContactLandmark: 12,
      rigContactUseAvatarAnchor: true,
      rigContactSnap: 1,
      rigContactFadeFrames: 4,
      rigInterHandContact: {
        movingSide: 'R',
        movingLandmarks: [8, 12, 16],
        supportSide: 'L',
        supportLandmarks: [0, 5, 9, 13, 17],
        preserveCapturedOffset: false,
        snap: 1,
        startFrame: 31,
        endFrame: 36,
        fadeFrames: 4,
        maximumCorrection: 0.3,
      },
      rigHandKeyframes: [
        {
          frame: 0,
          transitionFrames: 4,
          smile: 0.25,
          left: {fist: 0},
          right: {fist: 0},
        },
        {
          frame: 42,
          transitionFrames: 5,
          smile: 0.35,
          left: {fist: 1, fingers: {thumb: 0.7}},
          right: {fist: 1, fingers: {thumb: 0.7}},
        },
        {
          frame: 53,
          transitionFrames: 4,
          smile: 0.35,
          left: {fist: 1, fingers: {thumb: 0.7}},
          right: {fist: 1, fingers: {thumb: 0.7}},
        },
        {
          frame: 65,
          transitionFrames: 6,
          smile: 0.45,
          left: {fist: 0, fingers: {thumb: 0}},
          right: {fist: 0, fingers: {thumb: 0}},
        },
      ],
    },
    frames,
  };
}

if (require.main === module) {
  const recipe = JSON.parse(
    fs.readFileSync(path.join(directory, 'buenos-dias.authoring.json'), 'utf8'),
  );
  const motion = buildMotion(recipe);
  fs.writeFileSync(
    path.join(directory, 'buenos-dias.motion.json'),
    JSON.stringify(motion) + '\n',
  );
  console.log(`BUENOS DÍAS: ${motion.frames.length} authored frames; draft only.`);
}

module.exports = {buildMotion, buildFrames};
