'use strict';

const fs = require('fs');
const path = require('path');

const HEADER_SIZE = 16;
const FORMAT_VERSION = 2;
const DEFAULT_SCALE = 10000;

function validateMotion(motion, sourceName = 'motion') {
  if (!Number.isInteger(motion.fps) || motion.fps <= 0 || motion.fps > 65535) {
    throw new Error(`${sourceName} has an invalid FPS value.`);
  }
  if (!Array.isArray(motion.frames) || motion.frames.length === 0 || motion.frames.length > 65535) {
    throw new Error(`${sourceName} has an invalid frame count.`);
  }
  const bodyPointCount = motion.frames[0].bodyHands?.length;
  const facePointCount = motion.frames[0].face?.length;
  if (!bodyPointCount || !facePointCount || bodyPointCount > 65535 || facePointCount > 65535) {
    throw new Error(`${sourceName} has invalid landmark dimensions.`);
  }
  for (const [frameIndex, frame] of motion.frames.entries()) {
    if (frame.bodyHands?.length !== bodyPointCount || frame.face?.length !== facePointCount) {
      throw new Error(`${sourceName} changes landmark dimensions at frame ${frameIndex}.`);
    }
  }
  return {bodyPointCount, facePointCount};
}

function compileMotion(motion, scale = DEFAULT_SCALE, sourceName = 'motion') {
  const {bodyPointCount, facePointCount} = validateMotion(motion, sourceName);
  const coordinateCount = motion.frames.length * (bodyPointCount + facePointCount) * 3;
  const output = Buffer.allocUnsafe(HEADER_SIZE + coordinateCount * 2);
  output.write('VZMB', 0, 4, 'ascii');
  output.writeUInt8(FORMAT_VERSION, 4);
  output.writeUInt8(0, 5);
  output.writeUInt16LE(motion.fps, 6);
  output.writeUInt16LE(motion.frames.length, 8);
  output.writeUInt16LE(bodyPointCount, 10);
  output.writeUInt16LE(facePointCount, 12);
  output.writeUInt16LE(scale, 14);

  let offset = HEADER_SIZE;
  for (const frame of motion.frames) {
    for (const point of [...frame.bodyHands, ...frame.face]) {
      if (!Array.isArray(point) || point.length !== 3) {
        throw new Error(`${sourceName} contains a malformed landmark.`);
      }
      for (const coordinate of point) {
        if (!Number.isFinite(coordinate)) {
          throw new Error(`${sourceName} contains a non-finite coordinate.`);
        }
        const quantized = Math.round(coordinate * scale);
        if (quantized < -32768 || quantized > 32767) {
          throw new Error(`${sourceName} contains a coordinate outside the compact range.`);
        }
        output.writeInt16LE(quantized, offset);
        offset += 2;
      }
    }
  }
  return output;
}

function compactPublishedMotions(sourceDirectory, outputDirectory) {
  const catalogPath = path.join(sourceDirectory, 'published_signs.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const glosses = Array.isArray(catalog.publishedGlosses) ? catalog.publishedGlosses : [];
  if (glosses.length === 0) throw new Error('The published sign catalog is empty.');

  fs.mkdirSync(outputDirectory, {recursive: true});
  for (const filename of fs.readdirSync(outputDirectory)) {
    if (filename.endsWith('.motion.json') || filename.endsWith('.motion.bin')) {
      fs.unlinkSync(path.join(outputDirectory, filename));
    }
  }

  let sourceBytes = 0;
  let compactBytes = 0;
  for (const rawGloss of glosses) {
    const gloss = String(rawGloss).trim();
    const sourcePath = path.join(sourceDirectory, `${gloss.toLowerCase()}.motion.json`);
    const outputPath = path.join(outputDirectory, `${gloss.toLowerCase()}.motion.bin`);
    const source = fs.readFileSync(sourcePath);
    const compact = compileMotion(JSON.parse(source.toString('utf8')), DEFAULT_SCALE, sourcePath);
    fs.writeFileSync(outputPath, compact);
    sourceBytes += source.byteLength;
    compactBytes += compact.byteLength;
  }
  fs.copyFileSync(catalogPath, path.join(outputDirectory, 'published_signs.json'));
  return {signCount: glosses.length, sourceBytes, compactBytes};
}

if (require.main === module) {
  const [, , sourceDirectory, outputDirectory] = process.argv;
  if (!sourceDirectory || !outputDirectory) {
    throw new Error('Usage: node compact-sign-motion.js <source-directory> <output-directory>');
  }
  const result = compactPublishedMotions(sourceDirectory, outputDirectory);
  const reduction = 100 * (1 - result.compactBytes / result.sourceBytes);
  console.log(
    `Compiled ${result.signCount} signs: ${result.sourceBytes} -> ${result.compactBytes} bytes ` +
      `(${reduction.toFixed(1)}% smaller before APK compression).`,
  );
}

module.exports = {compileMotion, compactPublishedMotions};
