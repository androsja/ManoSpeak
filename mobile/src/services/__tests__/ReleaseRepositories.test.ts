import type {ReleaseArtifact, ReleaseRootManifest, ReleaseSignEntry} from '../ReleaseCatalogContract';
import {
  InMemoryLocalLibraryDatabase,
  LegacyInstalledLibraryAdapter,
  TransactionalInstalledLibraryRepository,
  type InstalledRelease,
  type InstalledSignEntry,
} from '../repositories/ReleaseRepositories';
import {FakeArtifactRepository, FakeRecipeRepository, FakeReleaseCatalogRepository} from '../repositories/FakeReleaseRepositories';

const hash = 'a'.repeat(64);
const artifact: ReleaseArtifact = {
  kind: 'motion-binary', storagePath: `distribution/releases/lsc-co-r1/signs/lsc-co-hola/motion-binary/${hash}/artifact.bin`, sha256: hash, sizeBytes: 3, formatVersion: 1,
};
const root = (releaseId: string): ReleaseRootManifest => ({
  schema: 'vozual.release-root', formatVersion: 1, releaseId, languageId: 'lsc-co', locale: 'es-CO', status: 'published',
  createdAt: '2026-11-02T00:00:00.000Z', publishedAt: '2026-11-02T00:00:00.000Z', minimumAppVersion: '1.0.0', compilerVersion: '3.0.0',
  rig: {profileId: 'vozual-rig-1', profileRevision: 1, sha256: hash}, manifestSha256: hash, manifestSignature: 'signature',
  fragmentStrategy: {kind: 'gloss-prefix-v1', prefixLength: 2}, fragments: [{id: 'ho', storagePath: `distribution/releases/lsc-co-r1/fragments/ho/${hash}/fragment.json`, sha256: hash, sizeBytes: 5, entryCount: 1}],
});
const entry: ReleaseSignEntry = {
  schema: 'vozual.release-sign-entry', formatVersion: 1, id: 'lsc-co-hola', languageId: 'lsc-co', gloss: 'HOLA', aliases: ['hola'], categories: ['greetings'],
  status: 'published', approved: true, compatibility: {sourceMotionSchemaVersion: 2, minimumAppVersion: '1.0.0', compilerVersion: 'legacy', rig: {profileId: 'vozual-rig-1', profileRevision: 1, sha256: hash}}, artifacts: [artifact],
};
const release = (releaseId: string): InstalledRelease => ({releaseId, languageId: 'lsc-co', locale: 'es-CO', rootManifest: root(releaseId), installedAt: '2026-11-02T00:00:00.000Z'});
const installedEntry = (releaseId: string, state: 'verified' | 'failed' = 'verified'): InstalledSignEntry => ({
  releaseId, entry, artifacts: [{artifact, localPath: `/private/${releaseId}/hola.motion.bin`, state}],
});

describe('TransactionalInstalledLibraryRepository', () => {
  it('activates a verified stage atomically and rolls back to an installed release', async () => {
    const repository = new TransactionalInstalledLibraryRepository(new InMemoryLocalLibraryDatabase());
    await repository.beginStage(release('r1'));
    await repository.stageEntry('r1', installedEntry('r1'));
    await repository.activateStage('r1');
    expect((await repository.getActiveRelease('lsc-co', 'es-CO'))?.releaseId).toBe('r1');

    await repository.beginStage(release('r2'));
    await expect(repository.stageEntry('r2', installedEntry('r2', 'failed'))).rejects.toThrow('verified artifacts');
    expect((await repository.getActiveRelease('lsc-co', 'es-CO'))?.releaseId).toBe('r1');

    await repository.stageEntry('r2', installedEntry('r2'));
    await repository.activateStage('r2');
    expect((await repository.getActiveRelease('lsc-co', 'es-CO'))?.releaseId).toBe('r2');
    await repository.rollbackActiveRelease('lsc-co', 'es-CO', 'r1');
    expect((await repository.getActiveRelease('lsc-co', 'es-CO'))?.releaseId).toBe('r1');
    expect((await repository.getInstalledSign('r1', 'lsc-co-hola'))?.artifacts[0].localPath).toBe('/private/r1/hola.motion.bin');
  });
});

describe('repository fakes and legacy adapter', () => {
  it('operates without Firebase and accepts only a matching legacy binary', async () => {
    const pointer = {schema: 'vozual.active-release-pointer' as const, formatVersion: 1 as const, languageId: 'lsc-co', locale: 'es-CO', releaseId: 'r1', status: 'published' as const, rootManifestPath: 'releases/r1/root.json', rootManifestSha256: hash, updatedAt: '2026-11-02T00:00:00.000Z'};
    const catalog = new FakeReleaseCatalogRepository(pointer, root('r1'));
    expect((await catalog.getRootManifest((await catalog.getActiveRelease('lsc-co', 'es-CO'))!)).releaseId).toBe('r1');
    expect((await new FakeArtifactRepository({[artifact.storagePath]: new Uint8Array([1, 2, 3])}).download(artifact)).bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(await new FakeRecipeRepository({privateRecipe: {notForRuntime: true}}).getCompilationInput('privateRecipe')).toEqual({notForRuntime: true});

    const legacy = new LegacyInstalledLibraryAdapter({getInstalledMotion: async () => ({id: 'lsc-co-hola', languageId: 'lsc-co', localPath: '/old/hola.bin', sha256: hash, sizeBytes: 3})});
    expect((await legacy.getVerifiedMotion('lsc-co-hola', artifact))?.localPath).toBe('/old/hola.bin');
    expect(await legacy.getVerifiedMotion('lsc-co-hola', {...artifact, sha256: 'b'.repeat(64)})).toBeUndefined();
  });
});
