'use strict';

const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(MOBILE_ROOT, 'assets/motions/drafts/numbers');
const DICTIONARY_URL = 'https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf';
const NUMERAL_REFERENCE = {
  title: 'Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales',
  publisher: 'Editorial Universidad Distrital Francisco José de Caldas',
  authors: ['Dora Inés Calderón', 'Olga Lucía León Corredor'],
  year: 2016,
  pages: '94-96',
  url: 'https://repository.udistrital.edu.co/server/api/core/bitstreams/d0377a58-82c3-4c9a-a050-66670890541f/content',
};

const NUMBER_SIGNS = [
  {
    number: 1,
    gloss: 'UNO',
    speechAliases: ['uno', '1'],
    fingers: {thumb: 'closed', index: 'extended', middle: 'closed', ring: 'closed', pinky: 'closed'},
  },
  {
    number: 2,
    gloss: 'DOS',
    speechAliases: ['dos', '2'],
    lateralFingerSpread: 1.8,
    rigFingerSplayDegrees: 28,
    fingers: {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'closed', pinky: 'closed'},
  },
  {
    number: 3,
    gloss: 'TRES',
    speechAliases: ['tres', '3'],
    lateralFingerSpread: 1.8,
    rigFingerSplayDegrees: 22,
    fingers: {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'closed'},
  },
  {
    number: 4,
    gloss: 'CUATRO',
    speechAliases: ['cuatro', '4'],
    lateralFingerSpread: 1.8,
    rigFingerSplayDegrees: 16,
    fingers: {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended'},
  },
  {
    number: 5,
    gloss: 'CINCO',
    speechAliases: ['cinco', '5'],
    // Open the four long fingers beyond the default parallel rig pose.
    lateralFingerSpread: 1.8,
    rigFingerSplayDegrees: 20,
    fingers: {thumb: 'extended', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended'},
  },
  {
    number: 6,
    gloss: 'SEIS',
    speechAliases: ['seis', '6'],
    fingers: {thumb: 'closed', index: 'captured', middle: 'closed', ring: 'closed', pinky: 'closed'},
    movement: {type: 'index-flexion', flexStartFrame: 12, fullFlexFrame: 24, extensionEndFrame: 36, flexAmount: 0.9},
    source: NUMERAL_REFERENCE,
  },
];

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

function flexIndexFrame(frame, amount, states) {
  if (amount <= 0) return frame;
  const bodyHands = frame.bodyHands.map(point => [...point]);
  const hand = bodyHands.slice(33, 54);
  const foldedHand = applyNumberFingerStates(hand, {...states, index: 'closed'});
  [6, 7, 8].forEach(index => {
    bodyHands[33 + index] = roundPoint(hand[index].map((value, axis) => (
      value + (foldedHand[index][axis] - value) * amount
    )));
  });
  return {bodyHands, face: frame.face.map(point => [...point])};
}

function motionFor(sign) {
  const lateralFingerSpread = sign.lateralFingerSpread ?? 1;
  const rest = canonicalFrame(lateralFingerSpread);
  const target = raisedNumberFrame(rest, lateralFingerSpread);
  const frameCount = sign.movement?.type === 'index-flexion' ? 48 : 36;
  const frames = Array.from({length: frameCount}, (_, index) => {
    const armProgress = Math.min(1, index / 6);
    const frame = shapedFrame(interpolateFrame(rest, target, armProgress), sign.fingers);
    if (sign.movement?.type !== 'index-flexion') {
      return frame;
    }
    const {flexStartFrame, fullFlexFrame, extensionEndFrame, flexAmount} = sign.movement;
    const flexProgress = index < flexStartFrame
      ? 0
      : index <= fullFlexFrame
        ? easedProgress((index - flexStartFrame) / (fullFlexFrame - flexStartFrame))
        : index < extensionEndFrame
          ? 1 - easedProgress((index - fullFlexFrame) / (extensionEndFrame - fullFlexFrame))
          : 0;
    return flexIndexFrame(frame, flexProgress * flexAmount, sign.fingers);
  });
  const source = sign.source ?? {
    title: 'Diccionario Básico de la Lengua de Señas Colombiana',
    publisher: 'Ministerio de Educación Nacional e INSOR',
    url: DICTIONARY_URL,
  };
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
      ...(sign.movement ? {
        movementPresentationNote: 'The index extends and flexes while the other fingers remain folded, following the cited LSC numeral description. The avatar timing is authored for this prototype and is not source timing evidence.',
      } : {}),
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
  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  const catalog = {
    schema: 'vozual.number-motion-draft-catalog',
    status: 'owner-approved-prototype',
    languageId: 'lsc-co',
    source: {
      title: 'Diccionario Básico de la Lengua de Señas Colombiana',
      publisher: 'Ministerio de Educación Nacional e INSOR',
      url: DICTIONARY_URL,
    },
    entries: [],
  };

  NUMBER_SIGNS.forEach(sign => {
    const motion = motionFor(sign);
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
