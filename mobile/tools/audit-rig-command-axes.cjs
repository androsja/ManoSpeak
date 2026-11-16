'use strict';

const crypto = require('crypto');
const fs = require('fs');
const {canonicalJson, verifyCandidateAsset} = require('./rig-capability-profile.cjs');

const AXES = ['x', 'y', 'z'];
const PROBE_DEGREES = 10;

function readGlbJson(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(12) > bytes.length - 20) {
    throw new Error('Expected a complete GLB v2 with a JSON first chunk');
  }
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  if (!Array.isArray(document.nodes)) throw new Error('GLB nodes are required');
  return document;
}

/** Measure one downstream joint under isolated rest-relative local rotations. */
function axisResponse(translation) {
  if (!Array.isArray(translation) || translation.length !== 3 ||
      translation.some(value => !Number.isFinite(value)) || Math.hypot(...translation) <= 1e-8) {
    throw new Error('A finite nonzero child offset is required');
  }
  const length = Math.hypot(...translation);
  const sineHalfAngle = Math.sin(PROBE_DEGREES * Math.PI / 360);
  const probes = Object.fromEntries(AXES.map((axis, index) => {
    // For an isolated rotation: |R(axis, angle)t - t| = 2 sin(angle/2)|axis x t|.
    const transverseLength = Math.hypot(...translation.filter((_, component) => component !== index));
    return [axis, {absoluteLongitudinalAlignment: Math.abs(translation[index]) / length,
      childDisplacementM: 2 * sineHalfAngle * transverseLength}];
  }));
  const longitudinalAxis = AXES.reduce((best, axis) =>
    probes[axis].absoluteLongitudinalAlignment > probes[best].absoluteLongitudinalAlignment ? axis : best);
  return {lengthM: length, probes, longitudinalAxis,
    axisAligned: probes[longitudinalAxis].absoluteLongitudinalAlignment >= 0.99999};
}

function auditRigCommandAxes(profile, bytes) {
  verifyCandidateAsset(profile, bytes);
  const document = readGlbJson(bytes);
  const inventory = profile.descriptor.boneInventory.restAxesInventory.bones;
  // Selection is restricted to explicitly declared profile bones; names alone never authorize commands.
  const declaredNames = Object.keys(inventory).filter(name =>
    /^DEF-(thumb|f_index|f_middle|f_ring|f_pinky)\.0[123]\.[LR]$/.test(name)).sort();
  if (declaredNames.length !== 30) throw new Error('Expected 30 declared digit bones');
  const records = declaredNames.map(boneName => {
    const matches = document.nodes.filter(node => node.name === boneName);
    if (matches.length !== 1) throw new Error(`Missing or duplicate declared bone: ${boneName}`);
    const node = matches[0];
    const children = (node.children || []).map(index => document.nodes[index]);
    const childNames = declaredNames.filter(name => inventory[name].parent === boneName);
    if (!childNames.length) return {boneName, status: 'terminal-offset-unavailable',
      anatomicalAxes: 'unsupported', limits: 'unsupported'};
    if (childNames.length !== 1) throw new Error(`Ambiguous digit child for ${boneName}`);
    const child = children.find(item => item?.name === childNames[0]);
    if (!child || child.matrix) throw new Error(`Expected a direct TRS digit child for ${boneName}`);
    const measured = axisResponse(child.translation || [0, 0, 0]);
    return {boneName, childBoneName: child.name, childOffsetLocalM: child.translation,
      status: 'measured-isolated-geometric-response', ...measured,
      v3AbductionAxisIsLongitudinal: measured.axisAligned && measured.longitudinalAxis === 'y',
      anatomicalAxes: 'unsupported', limits: 'unsupported'};
  });
  const measured = records.filter(record => record.status === 'measured-isolated-geometric-response');
  return {
    schema: 'vozual.rig-command-axis-audit', schemaVersion: 1,
    profileSha256: profile.sha256, candidateSha256: profile.asset.candidateSha256,
    probeDegrees: PROBE_DEGREES,
    representation: 'rest-relative-local-isolated-axis-rotation',
    summary: {declaredDigitBones: records.length, measuredDirectChildOffsets: measured.length,
      terminalBonesWithoutIndependentOffsets: records.length - measured.length,
      v3AbductionAxisLongitudinalCount: measured.filter(record => record.v3AbductionAxisIsLongitudinal).length},
    records,
    disposition: 'v3-axis-semantics-require-versioned-remapping-before-range-transfer',
    limitations: ['No anatomical sign, flexion/spread basis or joint limit inferred',
      'Direct-child center response only; no skinned surface or collision validation',
      'Terminal bones require independent endpoints; no extrapolated axes',
      'Frozen v3 semantics and v2 profile are unchanged'],
  };
}

if (require.main === module) {
  const [profilePath, candidatePath, outputPath] = process.argv.slice(2);
  if (!profilePath || !candidatePath || !outputPath) {
    throw new Error('Usage: node audit-rig-command-axes.cjs profile.json candidate.glb report.json');
  }
  const report = auditRigCommandAxes(JSON.parse(fs.readFileSync(profilePath)), fs.readFileSync(candidatePath));
  fs.writeFileSync(outputPath, `${canonicalJson(report)}\n`);
  process.stdout.write(`${JSON.stringify(report.summary)}\nSHA-256 ${crypto.createHash('sha256').update(canonicalJson(report) + '\n').digest('hex')}\n`);
}

module.exports = {auditRigCommandAxes, axisResponse, readGlbJson};
