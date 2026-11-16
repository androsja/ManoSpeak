import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');

const profileTemplate = require('../../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {canonicalJson, profileSha256, restAxesInventorySha256} = require('../../rig-capability-profile.cjs');

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

function write(root: string, relative: string, bytes: Buffer) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, bytes);
}

function createVisualFidelityEvidenceFixture() {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozual-task3-20-visual-evidence-'));
  const candidateBytes = Buffer.from('synthetic Task 3.20 candidate\n');
  const sourceBytes = Buffer.from('synthetic source evidence\n');
  const bakeBytes = Buffer.from('synthetic diagnostic bake\n');
  const bakeRun2Path = 'diagnostic-bake-run2.glb';
  const candidatePath = 'candidate.glb';
  const sourcePath = 'source.blend';
  const bakePath = 'diagnostic-bake.glb';
  const manifestPath = '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_20_diagnostics/acyclic_optical_evidence_binding_implementation/TASK_3_20_OPTICAL_EVIDENCE_MANIFEST.json';
  write(evidenceRoot, candidatePath, candidateBytes);
  write(evidenceRoot, sourcePath, sourceBytes);
  write(evidenceRoot, bakePath, bakeBytes);
  write(evidenceRoot, bakeRun2Path, bakeBytes);

  const profile = JSON.parse(JSON.stringify(profileTemplate));
  const candidateSha256 = sha256(candidateBytes);
  profile.asset.candidateSha256 = candidateSha256;
  const inventory = profile.descriptor.boneInventory.restAxesInventory;
  inventory.candidateSha256 = candidateSha256;
  inventory.sha256 = restAxesInventorySha256(inventory);
  profile.descriptor.mechanicalObservationEvidence.candidateSha256 = candidateSha256;
  profile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = inventory.sha256;
  profile.descriptor.visualFidelityEvidence = {
    schema: 'vozual.task3-20.visual-fidelity-evidence-manifest',
    schemaVersion: 1,
    manifestSha256: '0'.repeat(64),
    candidateSha256,
    claim: 'visual-fidelity-observations-only',
  };

  const profileBasis = JSON.parse(JSON.stringify(profile));
  delete profileBasis.descriptor.visualFidelityEvidence;
  const profileBasisSha256 = profileSha256(profileBasis);
  const renderArtifacts: Record<string, Array<{path: string; inputSha256: string; sha256: string}>> = {
    source: [],
    rev8: [],
    composite: [],
  };
  const renderInputs: Record<string, {sha256: string}> = {
    sourceBlend: {sha256: sha256(sourceBytes)},
    compositeBakeGlbRun1: {sha256: sha256(bakeBytes)},
  };
  for (const group of ['source', 'rev8', 'composite']) {
    const inputSha256 = group === 'source' ? sha256(sourceBytes) : group === 'rev8' ? candidateSha256 : sha256(bakeBytes);
    for (const run of [1, 2]) {
      const imagePath = `${group}-run${run}.png`;
      const sidecarPath = `${imagePath}.json`;
      const imageBytes = Buffer.from(`${group} render ${run}\n`);
      const sidecarBytes = Buffer.from(`{"run":${run},"group":"${group}"}\n`);
      write(evidenceRoot, imagePath, imageBytes);
      write(evidenceRoot, sidecarPath, sidecarBytes);
      renderArtifacts[group].push({path: imagePath, inputSha256, sha256: sha256(imageBytes)});
      const sidecarKey = `${group === 'composite' ? 'composite' : group}RenderSidecarRun${run}`;
      renderInputs[sidecarKey] = {sha256: sha256(sidecarBytes)};
    }
  }

  const renderData = {
    profile: {canonicalSha256: profileBasisSha256, boundCandidateSha256: candidateSha256},
    rev8Candidate: {sha256: candidateSha256},
    compositeDiagnosticGlbs: [
      {path: bakePath, sha256: sha256(bakeBytes)},
      {path: bakeRun2Path, sha256: sha256(bakeBytes)},
    ],
    inputs: renderInputs,
    renderArtifacts,
  };
  const opticalData = {
    profile: {canonicalSha256: profileBasisSha256, boundCandidateSha256: candidateSha256},
    sourceBlend: {sha256: sha256(sourceBytes)},
    rev8Glb: {sha256: candidateSha256},
    compositeBakeGlb: {sha256: sha256(bakeBytes)},
  };
  const renderJsonPath = 'render-comparison.json';
  const renderReportPath = 'render-comparison.md';
  const renderSumsPath = 'render-SHA256SUMS.txt';
  const opticalJsonPath = 'optical-matrix.json';
  const opticalReportPath = 'optical-audit.md';
  const opticalSumsPath = 'optical-SHA256SUMS.txt';
  const renderJsonBytes = Buffer.from(`${JSON.stringify(renderData, null, 2)}\n`);
  const opticalJsonBytes = Buffer.from(`${JSON.stringify(opticalData, null, 2)}\n`);
  write(evidenceRoot, renderJsonPath, renderJsonBytes);
  write(evidenceRoot, renderReportPath, Buffer.from('Synthetic render comparison report.\n'));
  write(evidenceRoot, renderSumsPath, Buffer.from('synthetic render checksums\n'));
  write(evidenceRoot, opticalJsonPath, opticalJsonBytes);
  write(evidenceRoot, opticalReportPath, Buffer.from('Synthetic optical audit report.\n'));
  write(evidenceRoot, opticalSumsPath, Buffer.from('synthetic optical checksums\n'));

  const evidenceFiles = [
    ['render-comparison-report', renderReportPath],
    ['render-comparison-json', renderJsonPath],
    ['render-checksum-manifest', renderSumsPath],
    ['optical-audit-report', opticalReportPath],
    ['optical-property-matrix', opticalJsonPath],
    ['optical-checksum-manifest', opticalSumsPath],
    ['source-blend', sourcePath],
    ['diagnostic-bake', bakePath],
  ].map(([role, relative]) => ({role, path: relative, sha256: sha256(fs.readFileSync(path.join(evidenceRoot, relative)))}));
  const manifest = {
    schema: 'vozual.task3-20.visual-fidelity-evidence-manifest',
    schemaVersion: 1,
    canonicalization: 'compact-sorted-json-utf8-v1',
    profileBasisSha256,
    claim: 'visual-fidelity-observations-only',
    candidate: {path: candidatePath, sha256: candidateSha256, bytes: candidateBytes.length},
    evidenceFiles,
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  write(evidenceRoot, manifestPath, manifestBytes);
  profile.descriptor.visualFidelityEvidence.manifestSha256 = sha256(manifestBytes);
  profile.sha256 = profileSha256(profile);

  return {evidenceRoot, manifestPath, manifest, candidateBytes, candidateSha256, profile, profileBasisSha256};
}

function refreshManifest(fixture: ReturnType<typeof createVisualFidelityEvidenceFixture>, manifest = fixture.manifest) {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  write(fixture.evidenceRoot, fixture.manifestPath, manifestBytes);
  fixture.profile.descriptor.visualFidelityEvidence.manifestSha256 = sha256(manifestBytes);
  fixture.profile.sha256 = profileSha256(fixture.profile);
  fixture.manifest = manifest;
}

function disposeVisualFidelityEvidenceFixture(fixture: ReturnType<typeof createVisualFidelityEvidenceFixture>) {
  fs.rmSync(fixture.evidenceRoot, {recursive: true, force: true});
}

export {createVisualFidelityEvidenceFixture, disposeVisualFidelityEvidenceFixture, refreshManifest, sha256};
