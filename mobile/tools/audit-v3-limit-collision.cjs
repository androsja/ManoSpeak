'use strict';

// Demonstrate the distinction between numeric v3 validation and avatar-surface checks.
// This is a synthetic draft probe, never an approved sign or publishable artifact.
const crypto = require('crypto');
const fs = require('fs');
const {canonicalJson, validateKinematicMotionV3} = require('./kinematic-motion-v3.cjs');
const {compileKinematicMotionV3} = require('./compile-kinematic-motion-v3.cjs');

function audit(profile, motion, probeBytes) {
  const report = JSON.parse(probeBytes);
  const expectedCandidate = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a';
  if (report.schema !== 'vozual.rig-per-bone-probes' || report.candidateSha256 !== expectedCandidate) {
    throw new Error('Unexpected per-bone evidence');
  }
  const hits = report.records.filter(record => record.bone === 'DEF-f_index.01.L' &&
    record.axis === 'z' && record.radians === -0.1);
  if (hits.length !== 1 || hits[0].overlapCount <= 0) throw new Error('Expected a unique colliding probe');
  const draft = JSON.parse(JSON.stringify(motion));
  // Set the left hand of the first frame to zero, so the probe matches the isolated rig test.
  const joints = draft.kinematicRealization.keyframes[0].hands.left.joints;
  for (const finger of Object.values(joints)) {
    for (const joint of Object.values(finger)) {
      for (const axis of Object.keys(joint)) joint[axis] = 0;
    }
  }
  joints.index.mcp.twistDeg = -0.1 * 180 / Math.PI;
  const validation = validateKinematicMotionV3(draft, profile);
  const compilation = compileKinematicMotionV3(draft, profile, {sampleRateHz: 120});
  const actual = compilation.plan.frames[0].hands.left.joints.index.mcp.twistDeg;
  if (Math.abs(actual - joints.index.mcp.twistDeg) > 1e-10) throw new Error('Compiled first frame differs from probe');
  return {schema: 'vozual.v3-numeric-limit-collision-audit', schemaVersion: 1,
    profileSha256: profile.sha256, candidateSha256: expectedCandidate,
    sourceMotionSha256: crypto.createHash('sha256').update(canonicalJson(motion)).digest('hex'),
    perBoneReportSha256: crypto.createHash('sha256').update(probeBytes).digest('hex'),
    probe: {bone: hits[0].bone, localAxis: hits[0].axis, radians: hits[0].radians,
      authoredPath: 'left.joints.index.mcp.twistDeg', authoredDegrees: actual,
      declaredRangeDegrees: profile.jointLimitsDeg['finger.mcp.twistDeg'],
      overlapCount: hits[0].overlapCount, collisionCategories: hits[0].categories},
    validation: {v3Accepted: true, keyframeCount: validation.keyframeCount,
      compiledFrameCount: compilation.plan.frames.length, compileSha256: compilation.sha256},
    limitations: ['Synthetic altered draft is not an approved sign',
      'The observed compiler value and prior isolated rig rotation are correlated by the existing binding; runtime playback was not executed here',
      'Collision evidence is scoped to isolated dominant-weight same-hand triangles',
      'v3 behavior is frozen and not modified; v4 temporal motion remains unsupported']};
}

if (require.main === module) {
  const [profilePath, motionPath, reportPath, outputPath] = process.argv.slice(2);
  if (!outputPath) throw new Error('Usage: profile.json motion.json per-bone-report.json output.json');
  const result = audit(JSON.parse(fs.readFileSync(profilePath)), JSON.parse(fs.readFileSync(motionPath)), fs.readFileSync(reportPath));
  const bytes = `${canonicalJson(result)}\n`;
  fs.writeFileSync(outputPath, bytes);
  process.stdout.write(`${JSON.stringify(result.probe)}\nSHA-256 ${crypto.createHash('sha256').update(bytes).digest('hex')}\n`);
}

module.exports = {audit};
