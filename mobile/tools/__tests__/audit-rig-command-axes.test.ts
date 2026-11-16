const crypto = require('crypto');
const realProfile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {profileSha256} = require('../rig-capability-profile.cjs');
const {auditRigCommandAxes, axisResponse, readGlbJson} = require('../audit-rig-command-axes.cjs');

function fixture() {
  const profile = JSON.parse(JSON.stringify(realProfile));
  const names = Object.keys(profile.descriptor.boneInventory.restAxesInventory.bones)
    .filter(name => /^DEF-(thumb|f_index|f_middle|f_ring|f_pinky)\.0[123]\.[LR]$/.test(name));
  const nodes = names.map(name => ({name, translation: [0, 0, 0.03],
    children: names.flatMap((child, index) =>
      profile.descriptor.boneInventory.restAxesInventory.bones[child].parent === name ? [index] : [])}));
  const json = Buffer.from(JSON.stringify({nodes}));
  const padded = Buffer.from(json.toString().padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const bytes = Buffer.concat([header, padded]);
  profile.asset.candidateSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  profile.descriptor.boneInventory.restAxesInventory.candidateSha256 = profile.asset.candidateSha256;
  profile.descriptor.boneInventory.restAxesInventory.sha256 = profileSha256(profile.descriptor.boneInventory.restAxesInventory);
  profile.descriptor.mechanicalObservationEvidence.candidateSha256 = profile.asset.candidateSha256;
  profile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = profile.descriptor.boneInventory.restAxesInventory.sha256;
  profile.sha256 = profileSha256(profile);
  return {profile, bytes};
}

describe('profile-bound digit command axis audit', () => {
  it('measures longitudinal Y with zero axial response and finite transverse response', () => {
    const response = axisResponse([0, 0.03, 0]);
    expect(response.longitudinalAxis).toBe('y');
    expect(response.probes.y.childDisplacementM).toBe(0);
    expect(response.probes.z.childDisplacementM).toBeCloseTo(0.005229345, 8);
  });

  it('detects a different longitudinal axis instead of assuming Blender conventions', () => {
    const {profile, bytes} = fixture();
    const report = auditRigCommandAxes(profile, bytes);
    expect(report.summary).toEqual({declaredDigitBones: 30, measuredDirectChildOffsets: 20,
      terminalBonesWithoutIndependentOffsets: 10, v3AbductionAxisLongitudinalCount: 0});
    expect(report.records.filter(record => record.longitudinalAxis).every(record => record.longitudinalAxis === 'z')).toBe(true);
  });

  it('does not label an oblique offset as axis aligned', () => {
    expect(axisResponse([0.02, 0.03, 0.01]).axisAligned).toBe(false);
    expect(() => axisResponse([0, 0, 0])).toThrow('nonzero');
    expect(() => axisResponse([0, Infinity, 0])).toThrow('finite');
  });

  it('rejects bytes outside the exact profile asset binding', () => {
    const {profile, bytes} = fixture();
    const changed = Buffer.from(bytes); changed[changed.length - 1] += 1;
    expect(() => auditRigCommandAxes(profile, changed)).toThrow('hash mismatch');
  });

  it('rejects malformed or truncated GLB containers', () => {
    expect(() => readGlbJson(Buffer.alloc(4))).toThrow('GLB');
    const {bytes} = fixture();
    expect(() => readGlbJson(bytes.subarray(0, bytes.length - 1))).toThrow('GLB');
  });
});
