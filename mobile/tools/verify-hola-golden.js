#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ASSET_PATH = path.resolve(__dirname, '../assets/motions/hola.motion.json');

const HOLA_GOLDEN = Object.freeze({
  byteLength: 389024,
  sha256: '414aada475136b534900aa71a1f47af39bcadfc9d9e00d788c981542f6f55169',
  fps: 30,
  frameCount: 73,
  layout: 'pose33_left21_right21_face468',
  activeHand: 'right',
  contactAnchor: 'temple',
  contactStartFrame: 16,
  contactEndFrame: 19,
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
