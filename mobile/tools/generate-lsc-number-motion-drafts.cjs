'use strict';

const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(MOBILE_ROOT, 'assets/motions/drafts/numbers');
const AUTHORING_CATALOG_PATH = path.join(OUTPUT_DIR, 'number-motion-authoring.json');
const FINGER_LANDMARK_CHAINS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

function roundPoint(point) {
  return point.map(value => Number(value.toFixed(5)));
}

function handAt(wrist, thumbDirection, lateralFingerSpread = 1) {
  const point = (x, y, z = 0) => roundPoint([wrist[0] + x, wrist[1] + y, wrist[2] + z]);
  const hand = [roundPoint(wrist)];
  // MediaPipe hand landmarks: thumb, then index, middle, ring, and little finger.
  hand.push(
    point(thumbDirection * 0.035, 0.008),
    point(thumbDirection * 0.057, -0.006, 0.004),
    point(thumbDirection * 0.078, -0.029, 0.008),
    point(thumbDirection * 0.091, -0.055, 0.012),
  );
  const fingers = [
    {x: -0.044, mcpY: -0.022, pipY: -0.076, dipY: -0.12, tipY: -0.16},
    {x: -0.015, mcpY: -0.026, pipY: -0.087, dipY: -0.14, tipY: -0.18},
    {x: 0.015, mcpY: -0.023, pipY: -0.079, dipY: -0.126, tipY: -0.164},
    {x: 0.044, mcpY: -0.018, pipY: -0.064, dipY: -0.103, tipY: -0.135},
  ];
  fingers.forEach(finger => {
    const lateralX = finger.x * lateralFingerSpread;
    hand.push(
      point(lateralX, finger.mcpY),
      point(lateralX * 1.12, finger.pipY),
      point(lateralX * 1.2, finger.dipY),
      point(lateralX * 1.25, finger.tipY),
    );
  });
  return hand;
}

function canonicalFrame(lateralFingerSpread = 1) {
  const bodyHands = Array.from({length: 75}, () => [0, 0, 0]);
  bodyHands[11] = [0.71, 0.68, 0];
  bodyHands[12] = [0.29, 0.68, 0];
  bodyHands[13] = [0.71, 0.887, 0];
  bodyHands[14] = [0.29, 0.887, 0];
  bodyHands[15] = [0.71, 1.094, 0];
  bodyHands[16] = [0.29, 1.094, 0];
  bodyHands[23] = [0.59, 1.15, 0];
  bodyHands[24] = [0.41, 1.15, 0];
  handAt(bodyHands[15], 1, lateralFingerSpread).forEach((point, index) => { bodyHands[33 + index] = point; });
  // An all-zero hand block is the runtime's explicit "not captured" marker.
  // Keeping generated landmarks for the resting hand makes the renderer treat
  // these one-handed numerals as two-handed signs and animate both rig hands.
  return {bodyHands, face: Array.from({length: 468}, () => [0, 0, 0])};
}

function raisedNumberFrame(rest, lateralFingerSpread = 1) {
  const frame = {
    bodyHands: rest.bodyHands.map(point => [...point]),
    face: rest.face.map(point => [...point]),
  };
  // Lift the active hand to the side of the avatar's face, away from its center.
  frame.bodyHands[13] = [0.82, 0.75, -0.02];
  frame.bodyHands[15] = [0.77, 0.58, -0.04];
  handAt(frame.bodyHands[15], -1, lateralFingerSpread).forEach((point, index) => { frame.bodyHands[33 + index] = point; });
  return frame;
}

function interpolateFrame(start, end, amount) {
  const interpolatePoints = (first, second) => first.map((point, index) => roundPoint(
    point.map((value, axis) => value + (second[index][axis] - value) * amount),
  ));
  return {
    bodyHands: interpolatePoints(start.bodyHands, end.bodyHands),
    face: interpolatePoints(start.face, end.face),
  };
}

function applyNumberFingerStates(hand, states) {
  const result = hand.map(point => [...point]);
  const longFingerChains = [
    ['index', [5, 6, 7, 8]],
    ['middle', [9, 10, 11, 12]],
    ['ring', [13, 14, 15, 16]],
    ['pinky', [17, 18, 19, 20]],
  ];
  longFingerChains.forEach(([finger, chain]) => {
    if (states[finger] !== 'closed') return;
    const [mcp, pip, dip, tip] = chain;
    const base = result[mcp];
    const originalPip = result[pip];
    const originalDip = result[dip];
    const originalTip = result[tip];
    const pipLength = Math.hypot(...originalPip.map((value, axis) => value - base[axis]));
    const dipLength = Math.hypot(...originalDip.map((value, axis) => value - originalPip[axis]));
    const tipLength = Math.hypot(...originalTip.map((value, axis) => value - originalDip[axis]));
    const towardPalm = -Math.sign(base[0] || 1);
    result[pip] = [base[0], base[1] - pipLength, base[2]];
    result[dip] = [
      originalPip[0] + towardPalm * dipLength * 0.25,
      originalPip[1] + dipLength * 0.92,
      originalPip[2],
    ];
    result[tip] = [
      result[dip][0] + towardPalm * tipLength * 0.25,
      result[dip][1] + tipLength * 0.92,
      result[dip][2],
    ];
  });
  if (states.thumb === 'closed') {
    const cmc = result[1];
    const towardPalm = -Math.sign(result[2][0] || 1);
    result[2] = [cmc[0] + towardPalm * 0.006, cmc[1] - 0.024, cmc[2]];
    result[3] = [result[2][0] + towardPalm * 0.03, result[2][1] + 0.015, cmc[2]];
    result[4] = [result[3][0] + towardPalm * 0.02, result[3][1] + 0.022, cmc[2]];
  }
  return result;
}

function shapedFrame(frame, states) {
  const bodyHands = frame.bodyHands.map(point => [...point]);
  const hand = bodyHands.slice(33, 54);
  const configuredHand = applyNumberFingerStates(hand, states);
  configuredHand.forEach((point, index) => { bodyHands[33 + index] = roundPoint(point); });
  return {bodyHands, face: frame.face.map(point => [...point])};
}

function easedProgress(value) {
  const amount = Math.max(0, Math.min(1, value));
  return amount * amount * (3 - 2 * amount);
}

function frameCountFor(sign) {
  const movement = sign.movement;
  if (!movement) return 36;
  if (movement.type !== 'finger-flexion-repetitions') {
    throw new Error(`Unsupported number motion primitive: ${movement.type}`);
  }
  const values = [movement.repetitions, movement.startFrame, movement.flexionFrames,
    movement.returnFrames, movement.pauseFrames, movement.holdFrames];
  if (values.some(value => !Number.isInteger(value) || value < 0)
      || movement.repetitions < 1 || movement.flexionFrames < 1 || movement.returnFrames < 1
      || !Number.isFinite(movement.flexAmount) || movement.flexAmount <= 0 || movement.flexAmount > 1) {
    throw new Error(`Invalid finger-flexion-repetitions plan for ${sign.gloss}.`);
  }
  const cycleLength = movement.flexionFrames + movement.returnFrames + movement.pauseFrames;
  return movement.startFrame + movement.repetitions * cycleLength + movement.holdFrames;
}

function movementProgressAtFrame(frameIndex, movement) {
  if (!movement) return 0;
  const cycleLength = movement.flexionFrames + movement.returnFrames + movement.pauseFrames;
  let progress = 0;
  for (let repetition = 0; repetition < movement.repetitions; repetition += 1) {
    const startFrame = movement.startFrame + repetition * cycleLength;
    const flexionEndFrame = startFrame + movement.flexionFrames;
    const returnEndFrame = flexionEndFrame + movement.returnFrames;
    const cycleProgress = frameIndex < startFrame
      ? 0
      : frameIndex <= flexionEndFrame
        ? easedProgress((frameIndex - startFrame) / movement.flexionFrames)
        : frameIndex <= returnEndFrame
          ? 1 - easedProgress((frameIndex - flexionEndFrame) / movement.returnFrames)
          : 0;
    progress = Math.max(progress, cycleProgress);
  }
  return progress * movement.flexAmount;
}

function flexFingerFrame(frame, finger, amount, states) {
  if (amount <= 0) return frame;
  const chain = FINGER_LANDMARK_CHAINS[finger];
  if (!chain) throw new Error(`Unsupported finger-flexion target: ${finger}`);
  const bodyHands = frame.bodyHands.map(point => [...point]);
  const hand = bodyHands.slice(33, 54);
  const foldedHand = applyNumberFingerStates(hand, {...states, [finger]: 'closed'});
  chain.slice(1).forEach(index => {
    bodyHands[33 + index] = roundPoint(hand[index].map((value, axis) => (
      value + (foldedHand[index][axis] - value) * amount
    )));
  });
  return {bodyHands, face: frame.face.map(point => [...point])};
}

function motionFor(sign, defaultSource) {
  const lateralFingerSpread = sign.lateralFingerSpread ?? 1;
  const rest = canonicalFrame(lateralFingerSpread);
  const target = raisedNumberFrame(rest, lateralFingerSpread);
  const frameCount = frameCountFor(sign);
  const frames = Array.from({length: frameCount}, (_, index) => {
    const armProgress = Math.min(1, index / 6);
    const frame = shapedFrame(interpolateFrame(rest, target, armProgress), sign.fingers);
    if (!sign.movement) return frame;
    return flexFingerFrame(
      frame,
      sign.movement.finger,
      movementProgressAtFrame(index, sign.movement),
      sign.fingers,
    );
  });
  const source = sign.source ?? defaultSource;
  const movementPresentationNote = sign.movement
    ? `The ${sign.movement.finger} extends and flexes down ${sign.movement.repetitions} times, returning toward extension between flexions; the timing is authored for this avatar prototype and is not source timing evidence.`
    : undefined;
  return {
    version: 2,
    fps: 30,
    layout: 'pose33_left21_right21_face468',
    avatarProfile: {
      activeHand: 'left',
      contactAnchor: 'none',
      palmAtContact: 'camera',
      rigLeftHandShape: 'fully-open',
      rigLeftFingerStates: sign.fingers,
      ...(sign.rigFingerSplayDegrees !== undefined ? {
        rigLeftFingerSplayDegrees: sign.rigFingerSplayDegrees,
      } : {}),
    },
    semantic: {
      schema: 'vozual.number-motion-draft',
      status: 'draft',
      language: 'lsc-CO',
      gloss: sign.gloss,
      number: sign.number,
      source,
      handshape: sign.fingers,
      ...(movementPresentationNote ? {movementPresentationNote} : {}),
      ...(lateralFingerSpread > 1 ? {
        handshapePresentationNote: `Extended fingers use a ${lateralFingerSpread} lateral landmark spread factor and a ${sign.rigFingerSplayDegrees}-degree rig splay for visual clarity in this avatar prototype; this is not regional performance evidence.`,
      } : {}),
      locationPresentationNote: 'The active hand is placed high beside the avatar face and offset to its screen-right side, not centered in front of the face; this is a constructed avatar placement, not regional performance evidence.',
      realizationNote: sign.movement
        ? 'Constructed avatar draft from the cited LSC numeral description; not a recorded regional performance.'
        : 'Constructed avatar draft from the dictionary handshape description; not a recorded regional performance.',
      timingNote: 'Prototype transition and hold duration for renderer review; not source timing evidence.',
    },
    frames,
    publicationReview: {
      status: 'owner-approved-prototype',
      approvedAt: '2026-11-22',
      authority: 'project-owner-requested-production-publication',
      scope: sign.movement
        ? 'The index-flexion pattern follows the cited academic description; avatar timing and regional realization are not professionally validated.'
        : 'Hand configurations follow the cited dictionary; avatar movement and regional realization are not professionally validated.',
    },
  };
}

function main() {
  const authoringCatalog = JSON.parse(fs.readFileSync(AUTHORING_CATALOG_PATH, 'utf8'));
  if (authoringCatalog.schema !== 'vozual.number-motion-authoring'
      || !Array.isArray(authoringCatalog.entries)
      || !authoringCatalog.source) {
    throw new Error('The number motion authoring catalog is invalid.');
  }
  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  const catalog = {
    schema: 'vozual.number-motion-draft-catalog',
    status: authoringCatalog.status,
    languageId: authoringCatalog.languageId,
    source: authoringCatalog.source,
    entries: [],
  };

  authoringCatalog.entries.forEach(sign => {
    const motion = motionFor(sign, authoringCatalog.source);
    const fileName = `${sign.gloss.toLocaleLowerCase('es-CO')}.motion.json`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    const content = `${JSON.stringify(motion)}\n`;
    fs.writeFileSync(filePath, content);
    catalog.entries.push({
      id: `lsc-co-number-${String(sign.number).padStart(2, '0')}`,
      gloss: sign.gloss,
      speechAliases: sign.speechAliases,
      categories: ['numeros_cantidades'],
      lexicalClass: 'numeral',
      motionFormat: 'legacy-json-v2',
      assetName: fileName,
      approvalStatus: 'owner-approved-prototype',
      ownerApproval: {
        approvedBy: 'project_owner',
        approvedAt: '2026-11-22',
        scope: 'Prototype release authorization; not professional LSC or regional validation.',
      },
    });
    process.stdout.write(`${fileName}\t${Buffer.byteLength(content)} bytes\n`);
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'sign-catalog.json'),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
}

main();
