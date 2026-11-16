const v3Profile = require('../../../schemas/rig-profiles/vozual-rig-1.v1.json');
const authoredMotion = require('../../assets/motions/adios.motion.v3.json');
const {audit} = require('../audit-v3-limit-collision.cjs');

function evidence() {
  return {schema: 'vozual.rig-per-bone-probes',
    candidateSha256: '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a',
    records: [{bone: 'DEF-f_index.01.L', axis: 'z', radians: -0.1,
      overlapCount: 161, categories: ['left-middle']}]};
}

describe('v3 numeric limit versus rig collision diagnostic', () => {
  it('demonstrates that numeric acceptance does not validate the geometry', () => {
    const original = JSON.stringify(authoredMotion);
    const result = audit(v3Profile, authoredMotion, Buffer.from(JSON.stringify(evidence())));
    expect(result.validation.v3Accepted).toBe(true);
    expect(result.probe.authoredDegrees).toBeCloseTo(-5.729577951);
    expect(result.probe.declaredRangeDegrees).toEqual([-20, 20]);
    expect(result.probe.overlapCount).toBe(161);
    expect(JSON.stringify(authoredMotion)).toBe(original);
  });

  it('rejects mismatched or ambiguous evidence', () => {
    const wrong = evidence();
    wrong.candidateSha256 = '0'.repeat(64);
    expect(() => audit(v3Profile, authoredMotion, Buffer.from(JSON.stringify(wrong)))).toThrow('Unexpected');
    const duplicate = evidence();
    duplicate.records.push(duplicate.records[0]);
    expect(() => audit(v3Profile, authoredMotion, Buffer.from(JSON.stringify(duplicate)))).toThrow('unique');
  });
});
