'use strict';

// Derive signed geometric directions from independently measured +/- probes.
// This does not assign anatomical axes or establish a safe range.
const crypto = require('crypto');
const fs = require('fs');
const {canonicalJson, validateRigCapabilityProfile} = require('./rig-capability-profile.cjs');

function summarize(profile, probeBytes) {
  validateRigCapabilityProfile(profile);
  const audit = JSON.parse(probeBytes);
  if (audit.schema !== 'vozual.rig-palm-axis-probes' || audit.profileDeclaredSha256 !== profile.sha256 ||
      audit.candidateSha256 !== profile.asset.candidateSha256 || audit.probeDegrees !== 10 || audit.bones.length !== 30) {
    throw new Error('Palm probe provenance, size or angle mismatch');
  }
  const inventory = profile.descriptor.boneInventory.restAxesInventory.bones;
  const seen = new Set();
  const records = audit.bones.map(bone => {
    if (!Object.hasOwn(inventory, bone.bone) || seen.has(bone.bone)) throw new Error('Missing or duplicate bone');
    seen.add(bone.bone);
    const directions = {};
    for (const axis of ['x', 'y', 'z']) {
      const plus = bone.probes[`${axis}+1`]?.deltaHandFrameM;
      const minus = bone.probes[`${axis}-1`]?.deltaHandFrameM;
      if (!Array.isArray(plus) || !Array.isArray(minus) || plus.length !== 3 || minus.length !== 3 ||
          [...plus, ...minus].some(value => !Number.isFinite(value))) throw new Error('Malformed signed probe');
      const derivative = plus.map((value, index) => (value - minus[index]) / 2);
      const length = Math.hypot(...derivative);
      directions[axis] = {centralResponseM: derivative, lengthM: length,
        unitHandFrame: length > 1e-8 ? derivative.map(value => value / length) : null};
    }
    return {bone: bone.bone, terminal: bone.terminal, directions};
  });
  return {schema: 'vozual.rig-palm-direction-observations', schemaVersion: 1,
    profileSha256: profile.sha256, candidateSha256: profile.asset.candidateSha256,
    sourceReportSha256: crypto.createHash('sha256').update(probeBytes).digest('hex'),
    method: 'half difference of +10 and -10 degree bone-tail displacements, fixed hand frame',
    records, limitations: ['Geometric response, not anatomical semantic classification or joint limits',
      'Imported tail agrees with source rest bone but is not an approved skin fingertip',
      'No coupled-pose, collision or full continuous domain inferred']};
}

if (require.main === module) {
  const [profilePath, inputPath, outputPath] = process.argv.slice(2);
  if (!profilePath || !inputPath || !outputPath) throw new Error('Usage: profile.json probes.json output.json');
  const report = summarize(JSON.parse(fs.readFileSync(profilePath)), fs.readFileSync(inputPath));
  const bytes = `${canonicalJson(report)}\n`;
  fs.writeFileSync(outputPath, bytes);
  process.stdout.write(`Measured ${report.records.length} bones; SHA-256 ${crypto.createHash('sha256').update(bytes).digest('hex')}\n`);
}

module.exports = {summarize};
