'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const profilePath = 'schemas/rig-profiles/vozual-rig-1.v2.json';
const catalogPath = 'schemas/rig-profiles/vozual-rig-1.isolated-probes.v2.json';
const densePath = '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/TASK_3_PER_BONE_DENSE.json';
const pm10Path = '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/TASK_3_PER_BONE_COLLISION_PM10_BUILD4.json';
const validatorPath = 'mobile/tools/rig-mechanical-conformance.cjs';
const canonicalizerPath = 'mobile/tools/rig-capability-profile.cjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = p => sha(fs.readFileSync(path.join(root, p)));
const profile = JSON.parse(fs.readFileSync(path.join(root, profilePath), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, catalogPath), 'utf8'));
const { profileSha256, canonicalJson, restAxesInventorySha256 } = require(path.join(root, canonicalizerPath));
const { validateMechanicalConformanceProbes } = require(path.join(root, validatorPath));
const unsignedCatalog = { ...catalog }; delete unsignedCatalog.sha256;
const rows = [];
for (const [bone, axes] of Object.entries(catalog.bones)) {
  for (const [axis, values] of Object.entries(axes)) {
    for (const [radians, overlapCount] of values) rows.push({ bone, axis, radians, overlapCount });
  }
}
const sourceRows = [];
for (const p of [densePath, pm10Path]) {
  const report = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  for (const r of report.records) sourceRows.push({ bone: r.bone, axis: r.axis, radians: Number(r.radians), overlapCount: Number(r.overlapCount) });
}
const key = r => `${r.bone}\0${r.axis}\0${Number(r.radians)}`;
const catalogMap = new Map(rows.map(r => [key(r), r.overlapCount]));
let sourceMismatches = 0;
for (const r of sourceRows) if (catalogMap.get(key(r)) !== r.overlapCount) sourceMismatches++;
const sourceKeys = new Set(sourceRows.map(key));
const missingSourceKeys = rows.filter(r => !sourceKeys.has(key(r))).length;
const counts = { neutralRows: 0, acceptedNonzero: 0, collisionRejectedNonzero: 0, otherRejected: 0, countMismatches: 0 };
const errors = [];
for (const row of rows) {
  if (row.radians === 0) {
    counts.neutralRows++;
    if (row.overlapCount !== 0) counts.countMismatches++;
    continue;
  }
  const vector = [0, 0, 0];
  vector[['x', 'y', 'z'].indexOf(row.axis)] = row.radians;
  try {
    validateMechanicalConformanceProbes(profile, [{ poseId: 'isolated-bone-probe-v1', rotationCommandsRad: { [row.bone]: vector } }]);
    counts.acceptedNonzero++;
    if (row.overlapCount !== 0) counts.countMismatches++;
  } catch (e) {
    if (e.code === 'KINEMATIC.DIAGNOSTIC_COLLISION') {
      counts.collisionRejectedNonzero++;
      if (Number(e.details?.overlapCount) !== row.overlapCount) counts.countMismatches++;
    } else {
      counts.otherRejected++;
      errors.push({ bone: row.bone, axis: row.axis, radians: row.radians, code: e.code || e.name, message: e.message });
    }
  }
}
const result = {
  schema: 'vozual.task3-14b-current-catalog-sweep.v1',
  binding: {
    profileRawSha256: fileSha(profilePath),
    profileCanonicalSha256: profileSha256(profile),
    catalogRawSha256: fileSha(catalogPath),
    catalogDeclaredSha256: catalog.sha256,
    catalogCanonicalSha256: sha(canonicalJson(unsignedCatalog)),
    catalogProfileBasisSha256: catalog.profileSha256,
    candidateSha256: profile.asset.candidateSha256,
    catalogCandidateSha256: catalog.candidateSha256,
    profileInventorySha256: restAxesInventorySha256(profile.descriptor.boneInventory.restAxesInventory),
    catalogInventorySha256: catalog.restAxesInventorySha256,
    validatorSha256: fileSha(validatorPath),
    canonicalizerSha256: fileSha(canonicalizerPath),
    sourceReports: [densePath, pm10Path].map(p => ({ path: p, sha256: fileSha(p) }))
  },
  coverage: {
    rows: rows.length,
    uniquePoints: new Set(rows.map(key)).size,
    bones: Object.keys(catalog.bones).length,
    rowsPerBone: [],
    sourceRows: sourceRows.length,
    sourceUniquePoints: sourceKeys.size,
    sourceMismatches,
    missingSourceKeys,
    perAxisRows: Object.fromEntries(['x','y','z'].map(axis => [axis, rows.filter(r => r.axis === axis).length])),
    distinctAngles: new Set(rows.map(r => r.radians)).size
  },
  outcomes: counts,
  unexpectedErrors: errors,
  limitations: ['Exact discrete catalog points only.', 'Not evidence of anatomy, safe ranges, interpolation, continuous motion, or general collision clearance.']
};
result.coverage.rowsPerBone = [...new Set(Object.values(catalog.bones).map(axes => Object.values(axes).reduce((n, values) => n + values.length, 0)))];
result.passed = result.binding.profileCanonicalSha256 === profile.sha256 &&
  result.binding.catalogDeclaredSha256 === result.binding.catalogCanonicalSha256 &&
  result.binding.catalogProfileBasisSha256 === '7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0' &&
  result.binding.catalogCandidateSha256 === result.binding.candidateSha256 &&
  result.binding.profileInventorySha256 === result.binding.catalogInventorySha256 &&
  result.coverage.rows === 1710 && result.coverage.uniquePoints === 1710 && result.coverage.bones === 30 &&
  result.coverage.rowsPerBone.length === 1 && result.coverage.rowsPerBone[0] === 57 &&
  result.coverage.sourceRows === 1710 && result.coverage.sourceUniquePoints === 1710 &&
  result.coverage.sourceMismatches === 0 && result.coverage.missingSourceKeys === 0 &&
  counts.neutralRows === 90 && counts.acceptedNonzero === 1385 && counts.collisionRejectedNonzero === 235 &&
  counts.otherRejected === 0 && counts.countMismatches === 0;
const out = process.argv[2];
if (!out) throw new Error('usage: node verify_current_catalog_sweep.cjs <output-json>');
fs.writeFileSync(path.resolve(root, out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, binding: result.binding, coverage: result.coverage, outcomes: result.outcomes, unexpectedErrors: result.unexpectedErrors }, null, 2));
if (!result.passed) process.exitCode = 1;
