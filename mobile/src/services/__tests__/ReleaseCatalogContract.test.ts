import {
  assertReleaseContract,
  validateActiveReleasePointer,
  validateReleaseFragment,
  validateReleaseRootManifest,
  validateReleaseSignEntry,
} from '../ReleaseCatalogContract';

const hash = 'a'.repeat(64);
const rig = {profileId: 'vozual-rig-1', profileRevision: 1, sha256: hash};
const v2Entry = {
  schema: 'vozual.release-sign-entry', formatVersion: 1, id: 'lsc-co-hola', languageId: 'lsc-co',
  gloss: 'HOLA', aliases: ['hola'], categories: ['greetings'], status: 'published', approved: true,
  compatibility: {sourceMotionSchemaVersion: 2, minimumAppVersion: '1.0.0', compilerVersion: 'legacy-2.4.0', rig},
  artifacts: [{kind: 'motion-binary', storagePath: `distribution/releases/lsc-co-r1/signs/lsc-co-hola/motion-binary/${hash}/artifact.bin`, sha256: hash, sizeBytes: 10, formatVersion: 1}],
};

describe('ReleaseCatalogContract', () => {
  it('serializes a signed root, fragment, entry, and active pointer', () => {
    const root = {
      schema: 'vozual.release-root', formatVersion: 1, releaseId: 'lsc-co-r1', languageId: 'lsc-co', locale: 'es-CO', status: 'published',
      createdAt: '2026-11-02T00:00:00.000Z', publishedAt: '2026-11-02T01:00:00.000Z', minimumAppVersion: '1.0.0', compilerVersion: '3.0.0', rig,
      manifestSha256: hash, manifestSignature: 'ed25519:example', fragmentStrategy: {kind: 'gloss-prefix-v1', prefixLength: 2},
      fragments: [{id: 'ho', storagePath: `distribution/releases/lsc-co-r1/fragments/ho/${hash}/fragment.json`, sha256: hash, sizeBytes: 10, entryCount: 1}],
    };
    const fragment = {schema: 'vozual.release-fragment', formatVersion: 1, releaseId: 'lsc-co-r1', fragmentId: 'ho', entries: [v2Entry]};
    const pointer = {schema: 'vozual.active-release-pointer', formatVersion: 1, languageId: 'lsc-co', locale: 'es-CO', releaseId: 'lsc-co-r1', status: 'published', rootManifestPath: `distribution/releases/lsc-co-r1/root/${hash}/manifest.json`, rootManifestSha256: hash, updatedAt: '2026-11-02T01:00:00.000Z'};
    expect(validateReleaseRootManifest(JSON.parse(JSON.stringify(root))).valid).toBe(true);
    expect(validateReleaseFragment(JSON.parse(JSON.stringify(fragment))).valid).toBe(true);
    expect(validateActiveReleasePointer(JSON.parse(JSON.stringify(pointer))).valid).toBe(true);
  });

  it('keeps v2 compatibility and requires an execution plan for v3', () => {
    expect(validateReleaseSignEntry(v2Entry).valid).toBe(true);
    const v3Entry = {...v2Entry, compatibility: {...v2Entry.compatibility, sourceMotionSchemaVersion: 3}};
    expect(validateReleaseSignEntry(v3Entry).errors).toContain('v3 entry needs an execution-plan artifact');
    expect(validateReleaseSignEntry({...v3Entry, artifacts: [...v3Entry.artifacts, {kind: 'execution-plan', storagePath: `distribution/releases/lsc-co-r1/signs/lsc-co-hola/execution-plan/${hash}/artifact.json`, sha256: hash, sizeBytes: 10, formatVersion: 1}]}).valid).toBe(true);
  });

  it('fails closed for missing approval, integrity, rig, or artifact', () => {
    expect(validateReleaseSignEntry({...v2Entry, approved: false}).valid).toBe(false);
    expect(validateReleaseSignEntry({...v2Entry, artifacts: []}).valid).toBe(false);
    expect(validateReleaseSignEntry({...v2Entry, compatibility: {...v2Entry.compatibility, rig: {...rig, sha256: 'unsafe'}}}).valid).toBe(false);
    expect(() => assertReleaseContract(validateReleaseSignEntry({...v2Entry, status: 'review'}))).toThrow('Invalid release catalogue contract');
  });

  it('rejects distribution paths that are mutable or not content-addressed', () => {
    const fragment = {schema: 'vozual.release-fragment', formatVersion: 1, releaseId: 'lsc-co-r1', fragmentId: 'ho', entries: [{...v2Entry, artifacts: [{...v2Entry.artifacts[0], storagePath: 'distribution/releases/lsc-co-r1/signs/lsc-co-hola/motion-binary/current/artifact.bin'}]}]};
    expect(validateReleaseFragment(fragment).valid).toBe(false);
    expect(validateActiveReleasePointer({schema: 'vozual.active-release-pointer', formatVersion: 1, languageId: 'lsc-co', locale: 'es-CO', releaseId: 'lsc-co-r1', status: 'published', rootManifestPath: 'distribution/releases/lsc-co-r1/root/current/manifest.json', rootManifestSha256: hash, updatedAt: '2026-11-02T01:00:00.000Z'}).valid).toBe(false);
  });
});
