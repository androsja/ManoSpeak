const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {summarize} = require('../audit-rig-palm-directions.cjs');

function input() {
  const names = Object.keys(profile.descriptor.boneInventory.restAxesInventory.bones)
    .filter(name => /^DEF-(thumb|f_index|f_middle|f_ring|f_pinky)\.0[123]\.[LR]$/.test(name));
  return {schema: 'vozual.rig-palm-axis-probes', profileDeclaredSha256: profile.sha256,
    candidateSha256: profile.asset.candidateSha256, probeDegrees: 10,
    bones: names.map(bone => ({bone, terminal: bone.includes('.03.'), probes: {
      'x+1': {deltaHandFrameM: [0.011, 0.002, 0]}, 'x-1': {deltaHandFrameM: [-0.009, 0.002, 0]},
      'y+1': {deltaHandFrameM: [0, 0, 0]}, 'y-1': {deltaHandFrameM: [0, 0, 0]},
      'z+1': {deltaHandFrameM: [0, 0, -0.02]}, 'z-1': {deltaHandFrameM: [0, 0, 0.02]},
    }}))};
}

describe('palm direction observations', () => {
  it('uses the central signed difference and represents zero response without guessing', () => {
    const result = summarize(profile, Buffer.from(JSON.stringify(input())));
    expect(result.records).toHaveLength(30);
    expect(result.records[0].directions.x.unitHandFrame).toEqual([1, 0, 0]);
    expect(result.records[0].directions.y.unitHandFrame).toBeNull();
    expect(result.records[0].directions.z.unitHandFrame).toEqual([0, 0, -1]);
  });

  it('rejects mismatched candidate provenance and duplicate bones', () => {
    const invalid = input();
    invalid.candidateSha256 = '0'.repeat(64);
    expect(() => summarize(profile, Buffer.from(JSON.stringify(invalid)))).toThrow('provenance');
    const duplicate = input();
    duplicate.bones[1].bone = duplicate.bones[0].bone;
    expect(() => summarize(profile, Buffer.from(JSON.stringify(duplicate)))).toThrow('duplicate');
  });
});
