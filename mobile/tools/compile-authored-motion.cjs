'use strict';

const fs = require('fs');
const path = require('path');
const {compileKinematicMotionV3} = require('./compile-kinematic-motion-v3.cjs');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return process.argv[index + 1];
}

const inputPath = path.resolve(argument('--input'));
const profilePath = path.resolve(argument('--profile'));
const outputPath = path.resolve(argument('--output'));
const sampleRateHz = Number(process.argv[process.argv.indexOf('--sample-rate') + 1] ?? 120);

if (!Number.isInteger(sampleRateHz) || sampleRateHz < 30 || sampleRateHz > 120) {
  throw new Error('--sample-rate must be an integer between 30 and 120.');
}

const motion = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const compilation = compileKinematicMotionV3(motion, profile, {sampleRateHz});

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, `${JSON.stringify(compilation.plan, null, 2)}\n`, 'utf8');
process.stdout.write(`${motion.id}: ${compilation.plan.frames.length} frames at ${sampleRateHz} Hz -> ${outputPath}\n`);
