#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_POLICY_PATH = path.join(MOBILE_ROOT, 'config/npm-audit-policy.json');

function advisoryId(entry) {
  if (typeof entry?.url !== 'string') return '';
  return entry.url.split('/').filter(Boolean).pop() ?? '';
}

function evaluateAuditReport(report, policy, today = new Date()) {
  const reviewAfter = new Date(`${policy.reviewAfter}T23:59:59Z`);
  if (!Number.isFinite(reviewAfter.getTime()) || today > reviewAfter) {
    return {
      allowed: [],
      blocked: [`Audit exception review expired on ${policy.reviewAfter}.`],
    };
  }

  const allowedPackages = new Set(policy.allowedPackages ?? []);
  const allowedAdvisories = new Set(policy.allowedAdvisories ?? []);
  const allowed = [];
  const blocked = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(vulnerability.severity)) continue;
    if (vulnerability.severity === 'critical') {
      blocked.push(`${name}: critical vulnerabilities cannot be excepted.`);
      continue;
    }
    if (!allowedPackages.has(name)) {
      blocked.push(`${name}: ${vulnerability.severity} package is not allowlisted.`);
      continue;
    }
    const directAdvisories = (vulnerability.via ?? [])
      .filter(entry => entry && typeof entry === 'object')
      .map(advisoryId)
      .filter(Boolean);
    const unexpectedAdvisories = directAdvisories.filter(id => !allowedAdvisories.has(id));
    if (unexpectedAdvisories.length > 0) {
      blocked.push(`${name}: unexpected advisories ${unexpectedAdvisories.join(', ')}.`);
      continue;
    }
    allowed.push(`${name}:${vulnerability.severity}`);
  }
  return {allowed, blocked};
}

function readAuditReport(inputPath) {
  if (inputPath) return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--audit-level=high', '--json'],
    {cwd: MOBILE_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024},
  );
  if (!result.stdout?.trim()) {
    throw new Error(`npm audit returned no report${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (inputIndex >= 0 && !inputPath) throw new Error('--input requires a JSON file path.');
  const policy = JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH, 'utf8'));
  const report = readAuditReport(inputPath);
  const result = evaluateAuditReport(report, policy);
  if (result.blocked.length > 0) {
    throw new Error(`Dependency audit blocked:\n- ${result.blocked.join('\n- ')}`);
  }
  const critical = report.metadata?.vulnerabilities?.critical ?? 0;
  console.log(
    `Dependency audit passed: ${critical} critical; ${result.allowed.length} documented high package findings reviewed through ${policy.reviewAfter}.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {evaluateAuditReport};
