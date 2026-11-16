import {createHash} from 'crypto';
import type {
  ActiveReleasePointer,
  ReleaseFragment,
  ReleaseRootManifest,
  ReleaseSignEntry,
} from '../ReleaseCatalogContract';
import {
  InMemoryReleaseCatalogueCacheRepository,
  ReleaseCatalogueSynchronizer,
  releaseCatalogueCanonicalJson,
  type ReleaseCatalogueIntegrity,
} from '../ReleaseCatalogSyncService';
import {FakeReleaseCatalogRepository} from '../repositories/FakeReleaseRepositories';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const artifactHash = 'a'.repeat(64);
const rig = {profileId: 'vozual-rig-1', profileRevision: 1, sha256: artifactHash};

function buildRelease(): {pointer: ActiveReleasePointer; root: ReleaseRootManifest; fragment: ReleaseFragment} {
  const entry: ReleaseSignEntry = {
    schema: 'vozual.release-sign-entry', formatVersion: 1, id: 'lsc-co-hola', languageId: 'lsc-co', gloss: 'HOLA', aliases: ['hola'], categories: ['greetings'], status: 'published', approved: true,
    compatibility: {sourceMotionSchemaVersion: 2, minimumAppVersion: '1.0.0', compilerVersion: '3.0.0', rig},
    artifacts: [{kind: 'motion-binary', storagePath: `distribution/releases/lsc-co-r1/signs/lsc-co-hola/motion-binary/${artifactHash}/artifact.bin`, sha256: artifactHash, sizeBytes: 3, formatVersion: 1}],
  };
  const fragment: ReleaseFragment = {schema: 'vozual.release-fragment', formatVersion: 1, releaseId: 'lsc-co-r1', fragmentId: 'ho', entries: [entry]};
  const fragmentBytes = releaseCatalogueCanonicalJson(fragment);
  const fragmentHash = digest(fragmentBytes);
  const unsigned = {
    schema: 'vozual.release-root' as const, formatVersion: 1 as const, releaseId: 'lsc-co-r1', languageId: 'lsc-co', locale: 'es-CO', status: 'published' as const,
    createdAt: '2026-11-04T00:00:00.000Z', publishedAt: '2026-11-04T00:00:00.000Z', minimumAppVersion: '1.0.0', compilerVersion: '3.0.0', rig,
    fragmentStrategy: {kind: 'gloss-prefix-v1' as const, prefixLength: 2},
    fragments: [{id: 'ho', storagePath: `distribution/releases/lsc-co-r1/fragments/ho/${fragmentHash}/fragment.json`, sha256: fragmentHash, sizeBytes: new TextEncoder().encode(fragmentBytes).byteLength, entryCount: 1}],
  };
  const root: ReleaseRootManifest = {...unsigned, manifestSha256: digest(releaseCatalogueCanonicalJson(unsigned)), manifestSignature: 'test:valid'};
  const rootHash = digest(releaseCatalogueCanonicalJson(root));
  const pointer: ActiveReleasePointer = {
    schema: 'vozual.active-release-pointer', formatVersion: 1, languageId: 'lsc-co', locale: 'es-CO', releaseId: 'lsc-co-r1', status: 'published',
    rootManifestPath: `distribution/releases/lsc-co-r1/root/${rootHash}/manifest.json`, rootManifestSha256: rootHash, updatedAt: '2026-11-04T00:00:00.000Z',
  };
  return {pointer, root, fragment};
}

const integrity = (signatureValid = true): ReleaseCatalogueIntegrity => ({
  sha256Utf8: async value => digest(value),
  verifyManifestSignature: async () => signatureValid,
});

describe('ReleaseCatalogueSynchronizer', () => {
  it('checks one pointer and does nothing when the verified release is unchanged', async () => {
    const {pointer, root, fragment} = buildRelease();
    const remote = new FakeReleaseCatalogRepository(pointer, root, {[`${root.releaseId}:ho`]: fragment});
    const getRoot = jest.spyOn(remote, 'getRootManifest');
    const cache = new InMemoryReleaseCatalogueCacheRepository();
    const synchronizer = new ReleaseCatalogueSynchronizer(remote, cache, integrity());
    const request = {languageId: 'lsc-co', locale: 'es-CO', appVersion: '1.0.0', requiredFragmentIds: ['ho']};
    expect((await synchronizer.sync(request)).status).toBe('updated');
    expect((await synchronizer.sync(request)).status).toBe('unchanged');
    expect(getRoot).toHaveBeenCalledTimes(1);
  });

  it('downloads and activates only requested, verified fragments', async () => {
    const {pointer, root, fragment} = buildRelease();
    const remote = new FakeReleaseCatalogRepository(pointer, root, {[`${root.releaseId}:ho`]: fragment});
    const getFragment = jest.spyOn(remote, 'getFragment');
    const result = await new ReleaseCatalogueSynchronizer(remote, new InMemoryReleaseCatalogueCacheRepository(), integrity()).sync({
      languageId: 'lsc-co', locale: 'es-CO', appVersion: '1.0.0', requiredFragmentIds: ['ho'],
    });
    expect(result.status).toBe('updated');
    expect(result.status === 'updated' && result.catalogue.fragments).toHaveLength(1);
    expect(getFragment).toHaveBeenCalledWith('lsc-co-r1', 'ho');
  });

  it('keeps the previous verified release on interrupted, corrupt, or incompatible updates', async () => {
    const valid = buildRelease();
    const cache = new InMemoryReleaseCatalogueCacheRepository();
    const request = {languageId: 'lsc-co', locale: 'es-CO', appVersion: '1.0.0', requiredFragmentIds: ['ho']};
    await new ReleaseCatalogueSynchronizer(
      new FakeReleaseCatalogRepository(valid.pointer, valid.root, {[`${valid.root.releaseId}:ho`]: valid.fragment}), cache, integrity(),
    ).sync(request);

    const corruptRoot = {...valid.root, manifestSignature: 'test:tampered'};
    const corruptRootHash = digest(releaseCatalogueCanonicalJson(corruptRoot));
    const corruptPointer: ActiveReleasePointer = {
      ...valid.pointer,
      rootManifestSha256: corruptRootHash,
      rootManifestPath: `distribution/releases/lsc-co-r1/root/${corruptRootHash}/manifest.json`,
    };
    const corrupt = await new ReleaseCatalogueSynchronizer(
      new FakeReleaseCatalogRepository(corruptPointer, corruptRoot, {[`${valid.root.releaseId}:ho`]: valid.fragment}), cache, integrity(false),
    ).sync({...request, appVersion: '0.9.0'});
    expect(corrupt.status).toBe('offline');
    expect(corrupt.catalogue?.pointer.releaseId).toBe('lsc-co-r1');

    const unavailable = new ReleaseCatalogueSynchronizer({
      getActiveRelease: async () => { throw new Error('network unavailable'); }, getRootManifest: async () => valid.root, getFragment: async () => valid.fragment,
    }, cache, integrity());
    expect((await unavailable.sync(request)).status).toBe('offline');
  });

  it('uses legacy migration only when explicitly enabled', async () => {
    const migration = jest.fn(async () => undefined);
    const emptyRemote = new FakeReleaseCatalogRepository();
    const synchronizer = new ReleaseCatalogueSynchronizer(emptyRemote, new InMemoryReleaseCatalogueCacheRepository(), integrity());
    const base = {languageId: 'lsc-co', locale: 'es-CO', appVersion: '1.0.0', legacyMigration: migration};
    expect((await synchronizer.sync(base)).status).toBe('offline');
    expect(migration).not.toHaveBeenCalled();
    expect((await synchronizer.sync({...base, allowLegacyMigration: true})).status).toBe('migration-required');
    expect(migration).toHaveBeenCalledTimes(1);
  });
});
