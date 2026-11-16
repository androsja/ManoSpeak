'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  RigCapabilityError,
  canonicalJson,
  profileSha256,
  validateRigCapabilityProfile,
  verifyCandidateAsset,
} = require('./rig-capability-profile.cjs');

const EXPECTED_SCHEMA = 'vozual.task3-20.visual-fidelity-evidence-manifest';
const EXPECTED_CLAIM = 'visual-fidelity-observations-only';
const EXPECTED_CANONICALIZATION = 'compact-sorted-json-utf8-v1';
const DEFAULT_MANIFEST_PATH = '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_20_diagnostics/acyclic_optical_evidence_binding_implementation/TASK_3_20_OPTICAL_EVIDENCE_MANIFEST.json';
const EXPECTED_ROLES = [
  'render-comparison-report',
  'render-comparison-json',
  'render-checksum-manifest',
  'optical-audit-report',
  'optical-property-matrix',
  'optical-checksum-manifest',
  'source-blend',
  'diagnostic-bake',
];
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Visual fidelity evidence ${message}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) {
    fail(`${label} path is invalid`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail(`${label} path escapes its evidence root`);
  return value;
}

function declaredFile(root, relativePath, label) {
  const relative = normalizedRelativePath(relativePath, label);
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(path.join(realRoot, ...relative.split('/')));
  } catch {
    fail(`${label} is missing`);
  }
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) fail(`${label} resolves outside its evidence root`);
  let stat;
  try {
    stat = fs.statSync(realFile);
  } catch {
    fail(`${label} is unavailable`);
  }
  if (!stat.isFile()) fail(`${label} is not a regular file`);
  return fs.readFileSync(realFile);
}

function forbidApprovalAndCycles(value, profileSha) {
  if (Array.isArray(value)) {
    value.forEach(item => forbidApprovalAndCycles(item, profileSha));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (value === profileSha) fail('manifest contains the full profile digest and would create a hash cycle');
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'profileSha256') fail('manifest contains a profileSha256 field and would create a hash cycle');
    if (/approval|adoption|threshold|degreesOfFreedom|jointLimits|executableCapability/i.test(key)) {
      fail(`manifest must not assert ${key}`);
    }
    forbidApprovalAndCycles(item, profileSha);
  }
}

function verifyFileEntry(root, entry, label) {
  if (!entry || !SHA256.test(entry.sha256 || '')) fail(`${label} declaration is malformed`);
  const bytes = declaredFile(root, entry.path, label);
  if (sha256(bytes) !== entry.sha256) fail(`${label} digest mismatch`);
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function verifyRenderArtifactInputs(root, renderReport, candidateSha256, sourceBlendSha256, bakeSha256) {
  const groups = renderReport.renderArtifacts;
  if (!groups || typeof groups !== 'object') fail('render artifact inventory is missing');
  for (const name of ['source', 'rev8', 'composite']) {
    if (!Array.isArray(groups[name]) || groups[name].length !== 2) fail(`render artifact inventory for ${name} is incomplete`);
    const expectedInput = name === 'source' ? sourceBlendSha256 : name === 'rev8' ? candidateSha256 : bakeSha256;
    for (const record of groups[name]) {
      if (record.inputSha256 !== expectedInput || !record.path || !SHA256.test(record.sha256 || '')) {
        fail(`render artifact input binding for ${name} is inconsistent`);
      }
      const bytes = declaredFile(root, record.path, `${name} render artifact`);
      if (sha256(bytes) !== record.sha256) fail(`${name} render artifact digest mismatch`);
      const sidecar = declaredFile(root, `${record.path}.json`, `${name} render sidecar`);
      const sidecarSha = renderReport.inputs?.[`${name === 'composite' ? 'composite' : name}RenderSidecarRun${groups[name].indexOf(record) + 1}`]?.sha256;
      if (sidecarSha && sha256(sidecar) !== sidecarSha) fail(`${name} render sidecar digest mismatch`);
    }
  }
}

function assertVisualFidelityEvidence(profile, candidateBytes, options = {}) {
  validateRigCapabilityProfile(profile);
  verifyCandidateAsset(profile, candidateBytes);
  const evidenceRoot = options.evidenceRoot;
  if (typeof evidenceRoot !== 'string' || !evidenceRoot) fail('requires an explicit evidenceRoot');

  const reference = profile.descriptor.visualFidelityEvidence;
  if (!reference || reference.schema !== EXPECTED_SCHEMA || reference.schemaVersion !== 1 ||
      reference.claim !== EXPECTED_CLAIM || !SHA256.test(reference.manifestSha256 || '') ||
      reference.candidateSha256 !== profile.asset.candidateSha256) {
    fail('profile reference is missing, malformed, or outside the observations-only claim');
  }
  const manifestBytes = declaredFile(evidenceRoot, options.manifestPath || DEFAULT_MANIFEST_PATH, 'canonical manifest');
  if (sha256(manifestBytes) !== reference.manifestSha256) fail('manifest digest differs from the profile reference');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('manifest is not valid JSON');
  }
  if (!manifestBytes.equals(Buffer.from(canonicalJson(manifest), 'utf8'))) fail('manifest bytes are not canonical');
  if (manifest.schema !== EXPECTED_SCHEMA || manifest.schemaVersion !== 1 ||
      manifest.canonicalization !== EXPECTED_CANONICALIZATION || manifest.claim !== EXPECTED_CLAIM ||
      manifest.candidate?.sha256 !== profile.asset.candidateSha256 ||
      manifest.candidate?.sha256 !== reference.candidateSha256 ||
      manifest.profileBasisSha256 !== profileSha256(withoutVisualFidelityReference(profile))) {
    fail('schema, claim, candidate, or derived profile-basis binding mismatch');
  }
  forbidApprovalAndCycles(manifest, profile.sha256);

  const candidateBytesFromRoot = verifyFileEntry(evidenceRoot, manifest.candidate, 'candidate');
  if (manifest.candidate.bytes !== candidateBytes.length ||
      !candidateBytes.equals(candidateBytesFromRoot) ||
      sha256(candidateBytes) !== profile.asset.candidateSha256) {
    fail('candidate bytes differ from the profile-bound candidate');
  }

  if (!Array.isArray(manifest.evidenceFiles)) fail('file inventory is missing');
  const roles = manifest.evidenceFiles.map(entry => entry?.role);
  if (roles.length !== EXPECTED_ROLES.length || new Set(roles).size !== roles.length ||
      EXPECTED_ROLES.some(role => !roles.includes(role))) {
    fail('file inventory roles are incomplete, duplicated, or unknown');
  }
  const verifiedFiles = new Map();
  for (const entry of manifest.evidenceFiles) {
    verifiedFiles.set(entry.role, verifyFileEntry(evidenceRoot, entry, entry.role));
  }

  const renderReport = parseJson(verifiedFiles.get('render-comparison-json'), 'render comparison JSON');
  const opticalMatrix = parseJson(verifiedFiles.get('optical-property-matrix'), 'optical property matrix');
  const profileBasisSha256 = manifest.profileBasisSha256;
  const candidateSha256 = profile.asset.candidateSha256;
  if (renderReport.profile?.canonicalSha256 !== profileBasisSha256 ||
      renderReport.profile?.boundCandidateSha256 !== candidateSha256 ||
      renderReport.rev8Candidate?.sha256 !== candidateSha256 ||
      opticalMatrix.profile?.canonicalSha256 !== profileBasisSha256 ||
      opticalMatrix.profile?.boundCandidateSha256 !== candidateSha256 ||
      opticalMatrix.rev8Glb?.sha256 !== candidateSha256) {
    fail('render/optical report profile or candidate binding mismatch');
  }

  const sourceBlend = manifest.evidenceFiles.find(entry => entry.role === 'source-blend');
  const diagnosticBake = manifest.evidenceFiles.find(entry => entry.role === 'diagnostic-bake');
  const renderSource = renderReport.inputs?.sourceBlend;
  const renderBake = renderReport.inputs?.compositeBakeGlbRun1;
  if (renderSource?.sha256 !== sourceBlend.sha256 ||
      renderBake?.sha256 !== diagnosticBake.sha256 ||
      opticalMatrix.sourceBlend?.sha256 !== sourceBlend.sha256 ||
      opticalMatrix.compositeBakeGlb?.sha256 !== diagnosticBake.sha256) {
    fail('source or diagnostic-bake identity differs across the reports');
  }
  if (!Array.isArray(renderReport.compositeDiagnosticGlbs) || renderReport.compositeDiagnosticGlbs.length !== 2) {
    fail('both diagnostic-bake runs are not declared');
  }
  for (const run of renderReport.compositeDiagnosticGlbs) {
    if (run.sha256 !== diagnosticBake.sha256) fail('diagnostic-bake run identity differs across the reports');
    const runBytes = declaredFile(evidenceRoot, run.path, 'diagnostic-bake run');
    if (sha256(runBytes) !== run.sha256) fail('diagnostic-bake run digest mismatch');
  }
  verifyRenderArtifactInputs(evidenceRoot, renderReport, candidateSha256, sourceBlend.sha256, diagnosticBake.sha256);

  return Object.freeze({
    manifestSha256: reference.manifestSha256,
    profileBasisSha256,
    candidateSha256,
    claim: EXPECTED_CLAIM,
    disposition: 'provenance-only-no-visual-approval',
    evidenceFileCount: manifest.evidenceFiles.length + 1,
  });
}

function withoutVisualFidelityReference(profile) {
  const basis = {...profile, descriptor: {...profile.descriptor}};
  delete basis.descriptor.visualFidelityEvidence;
  return basis;
}

module.exports = {assertVisualFidelityEvidence, EXPECTED_SCHEMA, EXPECTED_CLAIM};
