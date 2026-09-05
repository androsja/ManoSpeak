const {evaluateAuditReport} = require('../../tools/check-npm-audit');

const policy = {
  reviewAfter: '2026-12-01',
  allowedAdvisories: ['GHSA-reviewed'],
  allowedPackages: ['image-size', 'metro'],
};

function report(vulnerabilities: Record<string, unknown>) {
  return {vulnerabilities, metadata: {vulnerabilities: {critical: 0}}};
}

describe('npm audit exception policy', () => {
  it('allows only the reviewed high build-time dependency chain', () => {
    const result = evaluateAuditReport(report({
      'image-size': {
        severity: 'high',
        via: [{url: 'https://github.com/advisories/GHSA-reviewed'}],
      },
      metro: {severity: 'high', via: ['image-size']},
    }), policy, new Date('2026-09-05T00:00:00Z'));

    expect(result.blocked).toEqual([]);
    expect(result.allowed).toHaveLength(2);
  });

  it('blocks a new advisory or a new high-severity package', () => {
    const result = evaluateAuditReport(report({
      'image-size': {
        severity: 'high',
        via: [{url: 'https://github.com/advisories/GHSA-new'}],
      },
      runtimePackage: {severity: 'high', via: []},
    }), policy, new Date('2026-09-05T00:00:00Z'));

    expect(result.blocked).toHaveLength(2);
  });

  it('never allows critical findings and expires the entire exception', () => {
    const critical = evaluateAuditReport(report({
      metro: {severity: 'critical', via: ['image-size']},
    }), policy, new Date('2026-09-05T00:00:00Z'));
    const expired = evaluateAuditReport(
      report({}),
      policy,
      new Date('2026-12-02T00:00:00Z'),
    );

    expect(critical.blocked[0]).toContain('critical');
    expect(expired.blocked[0]).toContain('expired');
  });
});
