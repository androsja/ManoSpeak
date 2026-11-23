const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const cliPath = path.resolve(__dirname, '../compile-spatial-authoring-intent.cjs');
const profilePath = path.join(repoRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json');
const v1FixturePath = path.join(repoRoot, 'schemas/fixtures/spatial-grammar-intent-v1/asymmetric-draft.json');
const v2FixturePath = path.join(repoRoot, 'schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
const v1Fixture = require('../../../schemas/fixtures/spatial-grammar-intent-v1/asymmetric-draft.json');
const v2Fixture = require('../../../schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
let tempDirectory;

function writeDraft(name, draft) {
  const draftPath = path.join(tempDirectory, `${name}.json`);
  fs.writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  return draftPath;
}

function invokeCli(draftPath) {
  return spawnSync(process.execPath, [cliPath, '--draft', draftPath, '--profile', profilePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function expectInvalidInvocation(result, usefulStderr) {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/Spatial authoring compilation failed/);
  expect(result.stderr).toMatch(usefulStderr);
  expect(result.stdout).toBe('');
}

describe('spatial authoring CLI', () => {
  beforeAll(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spatial-authoring-cli-'));
  });

  afterAll(() => {
    const cleanedPath = tempDirectory;
    if (cleanedPath) fs.rmSync(cleanedPath, {recursive: true, force: true});
    expect(cleanedPath).toBeDefined();
    expect(fs.existsSync(cleanedPath)).toBe(false);
  });

  it('parses the valid v1 fixture as a non-executable authoring trace', () => {
    const result = invokeCli(v1FixturePath);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const trace = JSON.parse(result.stdout);
    expect(trace).toMatchObject({
      schema: 'vozual.bound-spatial-authoring-trace',
      formatVersion: 1,
      execution: 'authoring-only-not-executable',
    });
  });

  it('parses the valid v2 fixture as unreviewed, non-executable authoring output and repeats byte-identically', () => {
    const first = invokeCli(v2FixturePath);
    const second = invokeCli(v2FixturePath);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    const trace = JSON.parse(first.stdout);
    expect(trace).toMatchObject({
      schema: 'vozual.bound-spatial-authoring-trace',
      formatVersion: 2,
      execution: 'authoring-only-not-executable',
      linguisticReviewStatus: 'unreviewed',
    });
    expect(second.stdout).toBe(first.stdout);
  });

  it('rejects an unsupported schema version with nonzero status and no stdout', () => {
    const draft = structuredClone(v2Fixture);
    draft.schemaVersion = 3;
    const result = invokeCli(writeDraft('unsupported-version', draft));
    expectInvalidInvocation(result, /SCHEMA\.UNSUPPORTED_SPATIAL_INTENT_VERSION.*Unsupported spatial grammar intent version/);
  });

  it('rejects a mismatched candidate pin with nonzero status and no stdout', () => {
    const draft = structuredClone(v2Fixture);
    draft.profileBinding.candidateSha256 = '0'.repeat(64);
    const result = invokeCli(writeDraft('mismatched-candidate-pin', draft));
    expectInvalidInvocation(result, /COMPATIBILITY\.SPATIAL_PROFILE_BINDING.*exact rig profile and candidate/);
  });

  it('rejects a mismatched profile digest pin with nonzero status and no stdout', () => {
    const draft = structuredClone(v1Fixture);
    draft.profileBinding.sha256 = '0'.repeat(64);
    const result = invokeCli(writeDraft('mismatched-profile-pin', draft));
    expectInvalidInvocation(result, /COMPATIBILITY\.SPATIAL_PROFILE_BINDING.*exact rig profile and candidate/);
  });

  it.each([
    ['id', 'vozual-rig-other'],
    ['revision', v2Fixture.profileBinding.revision + 1],
  ])('rejects a v2 profile %s mismatch with no stdout', (field, value) => {
    const draft = structuredClone(v2Fixture);
    draft.profileBinding[field] = value;
    const result = invokeCli(writeDraft(`mismatched-profile-${field}`, draft));
    expectInvalidInvocation(result, /COMPATIBILITY\.SPATIAL_PROFILE_BINDING.*exact rig profile and candidate/);
  });

  it('rejects an unknown typed reference with nonzero status and no stdout', () => {
    const draft = structuredClone(v2Fixture);
    draft.relations[0].sourceRef.id = 'entity.unknown';
    const result = invokeCli(writeDraft('unknown-typed-reference', draft));
    expectInvalidInvocation(result, /SPATIAL\.UNKNOWN_REFERENCE.*undeclared entity or locus/);
  });

  it('rejects an agreement relation without agreementRef with nonzero status and no stdout', () => {
    const draft = structuredClone(v2Fixture);
    const relation = draft.relations.find(item => item.kind === 'agreement');
    delete relation.agreementRef;
    const result = invokeCli(writeDraft('agreement-missing-reference', draft));
    expectInvalidInvocation(result, /SCHEMA\.INVALID_SPATIAL_INTENT_V2.*Invalid spatial grammar intent v2/);
  });

  it('rejects agreementRef on a direction relation with nonzero status and no stdout', () => {
    const draft = structuredClone(v2Fixture);
    const relation = draft.relations.find(item => item.kind === 'direction');
    relation.agreementRef = {id: 'agreement.forbidden'};
    const result = invokeCli(writeDraft('direction-forbidden-reference', draft));
    expectInvalidInvocation(result, /SCHEMA\.INVALID_SPATIAL_INTENT_V2.*Invalid spatial grammar intent v2/);
  });
});
