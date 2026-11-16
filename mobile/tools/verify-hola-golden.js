#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ASSET_PATH = path.resolve(__dirname, '../assets/motions/hola.motion.json');

const HOLA_GOLDEN = Object.freeze({
  byteLength: 1171340,
  sha256: '75b67d4a3c9335a2e8a5ce196a96833b52a722a391134e2e5437ec0706b2dc66',
  fps: 30,
  frameCount: 36,
  layout: 'pose33_left21_right21_face468',
  activeHand: 'left',
  contactAnchor: 'forehead',
  contactStartFrame: 0,
  contactEndFrame: 12,
  palmAtContact: 'camera',
});

function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`HOLA golden regression failed: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

function verifyHolaGoldenBytes(bytes, assetLabel = 'hola.motion.json') {
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assertEqual(bytes.byteLength, HOLA_GOLDEN.byteLength, 'byteLength');
  assertEqual(actualSha256, HOLA_GOLDEN.sha256, 'sha256');

  let motion;
  try {
    motion = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`HOLA golden regression failed: ${assetLabel} is not valid JSON.`);
  }
  assertEqual(motion.fps, HOLA_GOLDEN.fps, 'fps');
  assertEqual(Array.isArray(motion.frames) ? motion.frames.length : undefined, HOLA_GOLDEN.frameCount, 'frameCount');
  assertEqual(motion.layout, HOLA_GOLDEN.layout, 'layout');
  const profile = motion.avatarProfile ?? {};
  assertEqual(profile.activeHand, HOLA_GOLDEN.activeHand, 'avatarProfile.activeHand');
  assertEqual(profile.contactAnchor, HOLA_GOLDEN.contactAnchor, 'avatarProfile.contactAnchor');
  assertEqual(profile.contactStartFrame, HOLA_GOLDEN.contactStartFrame, 'avatarProfile.contactStartFrame');
  assertEqual(profile.contactEndFrame, HOLA_GOLDEN.contactEndFrame, 'avatarProfile.contactEndFrame');
  assertEqual(profile.palmAtContact, HOLA_GOLDEN.palmAtContact, 'avatarProfile.palmAtContact');

  return {
    asset: assetLabel,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    fps: motion.fps,
    frameCount: motion.frames.length,
    layout: motion.layout,
    activeHand: profile.activeHand,
    contact: {
      anchor: profile.contactAnchor,
      startFrame: profile.contactStartFrame,
      endFrame: profile.contactEndFrame,
      palm: profile.palmAtContact,
    },
  };
}

function verifyHolaGolden(assetPath = DEFAULT_ASSET_PATH) {
  const bytes = fs.readFileSync(assetPath);
  return verifyHolaGoldenBytes(bytes, assetPath);
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verifyHolaGolden(process.argv[2] ?? DEFAULT_ASSET_PATH), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  HOLA_GOLDEN,
  verifyHolaGolden,
  verifyHolaGoldenBytes,
};
