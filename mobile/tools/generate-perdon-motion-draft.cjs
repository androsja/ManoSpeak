'use strict';

const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function roundPoint(point) {
  return point.map(v => Number(v.toFixed(5)));
}

/** Linear interpolation between two [x,y,z] points, t in [0,1]. */
function lerp3(a, b, t) {
  return roundPoint([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/** Smooth-step easing (3t²-2t³). */
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// ---------------------------------------------------------------------------
// Right-hand fist landmark block – palm facing the chest (+Z).
//
// Coordinate system: normalized-body, x-right(avatar-left), y-down, z-away.
// For the RIGHT hand with palm toward chest (+Z direction):
//   - Dorsal side faces camera (-Z)
//   - Fingers curl inward (upward in y-down: -Y offset from MCP to tip)
//   - Thumb sits at the radial/superior side: -X (avatar's own right), -Y (up)
//   - Index MCP is on the radial side (-X), pinky MCP is on the ulnar (+X)
//   This matches handAt(wrist, thumbDirection=-1) anatomy used in number drafts.
//
// All offsets are wrist-relative in the same body space.
// The rig overrides the visual shape via rigRightHandShape:'fist' +
// rigRightFingerStates (all closed); these offsets serve as pose hints.
// ---------------------------------------------------------------------------

/** Returns 21 right-hand landmark points (wrist-relative fist, palm toward chest). */
function fistHandLandmarks(wrist) {
  // Right hand in a closed fist with palm facing the chest (+Z) and fingers
  // angled slightly diagonally (~22 deg toward +X/-Y) so the wrist follows the
  // forearm smoothly across to the opposite pectoral.
  const rawOffsets = [
    [0,       0,      0     ],
    // thumb CMC-MCP-IP-tip (radial/superior side)
    [-0.026, -0.014,  0.004 ],
    [-0.040, -0.028,  0.008 ],
    [-0.030, -0.042,  0.010 ],
    [-0.020, -0.050,  0.010 ],
    // index MCP-PIP-DIP-tip
    [-0.044, -0.022,  0.002 ],
    [-0.044, -0.040,  0.004 ],
    [-0.044, -0.048,  0.004 ],
    [-0.044, -0.054,  0.004 ],
    // middle MCP-PIP-DIP-tip
    [-0.015, -0.026,  0.002 ],
    [-0.015, -0.044,  0.004 ],
    [-0.015, -0.052,  0.004 ],
    [-0.015, -0.058,  0.004 ],
    // ring MCP-PIP-DIP-tip
    [ 0.015, -0.023,  0.002 ],
    [ 0.015, -0.038,  0.004 ],
    [ 0.015, -0.044,  0.004 ],
    [ 0.015, -0.050,  0.004 ],
    // pinky MCP-PIP-DIP-tip
    [ 0.044, -0.018,  0.002 ],
    [ 0.044, -0.030,  0.004 ],
    [ 0.044, -0.036,  0.004 ],
    [ 0.044, -0.040,  0.004 ],
  ];
  const tilt = 0.38; // ~22 deg toward avatar's left pectoral (+X, -Y)
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return rawOffsets.map(([dx, dy, dz]) => {
    // Rotate in XY so upward (-Y) tilts toward (+X, -Y)
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return roundPoint([wrist[0] + rx, wrist[1] + ry, wrist[2] + dz]);
  });
}

// ---------------------------------------------------------------------------
// Frame builder
// ---------------------------------------------------------------------------

// Circle geometry — frontal (XY) plane, constant Z well clear of the chest.
const CENTER_X     = 0.58;   // avatar's left pectoral (opposite side of right hand)
const CENTER_Y     = 0.83;   // upper-chest height (y-down)
const CENTER_Z     = -0.38;  // clear in front of the bust/dress without clipping
const RADIUS_X     = 0.055;  // clearly visible small horizontal radius (XY circle)
const RADIUS_Y     = 0.048;  // clearly visible small vertical radius (XY circle)

// The exact point where angle=0 (top of circle) — Phase 1 must end here,
// Phase 4 must start here to guarantee zero discontinuity.
const CIRCLE_START_WRIST = roundPoint([
  CENTER_X + RADIUS_X * Math.sin(0),          // CENTER_X
  CENTER_Y - RADIUS_Y * Math.cos(0),          // CENTER_Y - RADIUS_Y
  CENTER_Z,
]);
const CIRCLE_START_ELBOW = roundPoint([0.30, 1.00 - RADIUS_Y * 0.2, -0.26]);

/**
 * Builds the frame list for the PERDÓN sign (frontal XY circle on left pectoral).
 *
 *   Phase 0 (frames  0-5):  hold at rest (dress/abdomen)
 *   Phase 1 (frames  6-11): smooth rise to circle start point (top of circle)
 *   Phase 2 (frames 12-47): 2 clockwise circles in XY plane (18 frames each)
 *   Phase 3 (frames 48-51): hold at circle start point (seamless from last turn)
 *   Phase 4 (frames 52-66): return smoothly to rest
 *   Phase 5 (frames 67-72): hold at rest
 *
 * Total: 73 frames.
 */
function buildFramesPerdon(recipe) {
  const REST_WRIST = [0.40, 1.13, -0.36];
  const REST_ELBOW = [0.27, 1.04, -0.20];
  const REST_LEFT_ELBOW = [0.78, 1.0, -0.13];
  const REST_LEFT_WRIST = [0.61, 1.04, -0.30];
  const BASE_ELBOW = [0.30, 1.00, -0.26];

  // Static body pose landmarks (unchanged throughout)
  const SHOULDERS = [[0.71, 0.68, 0], [0.29, 0.68, 0]];
  const HIPS = [[0.59, 1.15, 0], [0.41, 1.15, 0]];

  const TOTAL_FRAMES = 73;
  const frames = [];

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    let wrist, elbow;

    if (i < 6) {
      // Phase 0: rest
      wrist = [...REST_WRIST];
      elbow = [...REST_ELBOW];

    } else if (i < 12) {
      // Phase 1: smooth approach from rest to CIRCLE_START_WRIST (top of circle).
      // Ending exactly at CIRCLE_START_WRIST guarantees continuity into Phase 2.
      const t = smoothstep((i - 6) / 6);
      wrist = lerp3(REST_WRIST, CIRCLE_START_WRIST, t);
      elbow = lerp3(REST_ELBOW, CIRCLE_START_ELBOW, t);

    } else if (i < 48) {
      // Phase 2: two clockwise circles in the XY (frontal) plane.
      const circleFrame = i - 12;                        // 0..35
      const angle = (circleFrame / 18) * 2 * Math.PI;   // 0..4π (2 full turns)
      const dx = RADIUS_X * Math.sin(angle);
      const dy = -RADIUS_Y * Math.cos(angle);
      wrist = roundPoint([
        CENTER_X + dx,
        CENTER_Y + dy,
        CENTER_Z,
      ]);
      elbow = roundPoint([
        BASE_ELBOW[0] + dx * 0.2,
        BASE_ELBOW[1] + dy * 0.2,
        BASE_ELBOW[2],
      ]);

    } else if (i < 52) {
      // Phase 3: hold at the circle start point (same as angle=0 = frame 12 = frame 30).
      wrist = [...CIRCLE_START_WRIST];
      elbow = [...CIRCLE_START_ELBOW];

    } else if (i < 67) {
      // Phase 4: smooth return from CIRCLE_START_WRIST to rest.
      const t = smoothstep((i - 52) / 15);
      wrist = lerp3(CIRCLE_START_WRIST, REST_WRIST, t);
      elbow = lerp3(CIRCLE_START_ELBOW, REST_ELBOW, t);

    } else {
      // Phase 5: rest
      wrist = [...REST_WRIST];
      elbow = [...REST_ELBOW];
    }

    // Build bodyHands array (75 points, all [0,0,0] by default)
    const bodyHands = Array.from({length: 75}, () => [0, 0, 0]);

    bodyHands[11] = [...SHOULDERS[0]];     // left shoulder
    bodyHands[12] = [...SHOULDERS[1]];     // right shoulder
    bodyHands[13] = [...REST_LEFT_ELBOW];  // left elbow (rest)
    bodyHands[14] = roundPoint(elbow);     // right elbow
    bodyHands[15] = [...REST_LEFT_WRIST];  // left wrist (rest)
    bodyHands[16] = roundPoint(wrist);     // right wrist (active)
    bodyHands[23] = [...HIPS[0]];
    bodyHands[24] = [...HIPS[1]];

    // Left hand (indices 33-53): all zeros → runtime treats as inactive
    // Right hand landmarks (indices 54-74): fist offsets with palm toward chest
    fistHandLandmarks(roundPoint(wrist)).forEach((pt, idx) => {
      bodyHands[54 + idx] = pt;
    });

    frames.push({
      bodyHands,
      face: Array.from({length: 468}, () => [0, 0, 0]),
      headOrientation: {yaw: 0, pitch: 0, roll: 0},
    });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Motion document builder
// ---------------------------------------------------------------------------

function buildMotion(recipe) {
  const frames = buildFramesPerdon(recipe);
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    description: recipe.description,
    reference: recipe.reference,
    publicationReview: {
      status: 'draft',
      scope: 'Owner-defined fist-on-chest sign; awaiting owner visual review after INSOR p.491 variant was rejected on 2026-11-26.',
    },
    authoring: {
      source: 'procedural-keyframes',
      recipe: 'perdon.authoring.json',
      speechAliases: [
        'perdón', 'perdon', 'perdona', 'perdone', 'perdóname', 'perdóneme', 'perdónenme',
        'pido perdón', 'te pido perdón', 'le pido perdón', 'perdonar',
        'disculpa', 'disculpe', 'discúlpame', 'discúlpeme', 'discúlpenme',
        'disculpas', 'pido disculpas', 'te pido disculpas', 'le pido disculpas', 'disculpar',
      ],
      strokes: [{fromMs: 600, toMs: 1800}],
    },
    avatarProfile: {
      activeHand: 'right',
      forceTwoHands: false,
      rigArmDepthSpace: 'shoulder-relative',
      contactAnchor: 'none',
      rigRightHandShape: 'fist',
      rigRightFingerStates: {
        thumb: 'closed',
        index: 'closed',
        middle: 'closed',
        ring: 'closed',
        pinky: 'closed',
      },
      rigRightPalmScaleMin: 0.84,
      rigRightPalmScaleMax: 0.84,
    },
    frames,
  };
}

if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'perdon.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(directory, 'perdon.motion.json'), JSON.stringify(motion) + '\n');
  console.log(`PERDÓN: ${motion.frames.length} frames; XY-plane fist-on-left-pectoral circle draft.`);
}
module.exports = {buildMotion};
