const crypto = require('crypto');
const {
  AtomicReleasePublisher, HmacManifestSigner, InMemoryImmutableObjectStore, InMemoryReleasePointerStore,
} = require('../atomic-release-publisher.cjs');
const {publishApprovedSigns} = require('../publish-approved-signs');

const hash = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const rig = {profileId: 'vozual-rig-1', profileRevision: 1, sha256: 'a'.repeat(64)};

function candidate(id: string, gloss: string, schemaVersion = 3) {
  const binary = Buffer.from(`binary:${id}`); const plan = Buffer.from(`plan:${id}`);
  const artifacts = [{kind: 'motion-binary', storagePath: 'ignored-before-publication', sha256: hash(binary), sizeBytes: binary.length, formatVersion: 3}];
  const bytes: Record<string, Buffer> = {'motion-binary': binary};
  if (schemaVersion === 3) { artifacts.push({kind: 'execution-plan', storagePath: 'ignored-before-publication', sha256: hash(plan), sizeBytes: plan.length, formatVersion: 1}); bytes['execution-plan'] = plan; }
  return {entry: {schema: 'vozual.release-sign-entry', formatVersion: 1, id, languageId: 'lsc-co', gloss, aliases: [gloss.toLowerCase()], categories: ['test'], status: 'published', approved: true,
    compatibility: {sourceMotionSchemaVersion: schemaVersion, minimumAppVersion: '1.0.0', compilerVersion: '3.0.0', rig}, artifacts}, approval: {status: 'approved', validationReportSha256: 'b'.repeat(64)}, artifactBytes: bytes};
}

function input(releaseId: string, entries = [candidate('lsc-co-hola', 'HOLA')]) {
  return {releaseId, languageId: 'lsc-co', locale: 'es-CO', createdAt: '2026-11-03T00:00:00.000Z', publishedAt: '2026-11-03T01:00:00.000Z', minimumAppVersion: '1.0.0', compilerVersion: '3.0.0', rig, entries};
}

describe('AtomicReleasePublisher', () => {
  it('uploads verified immutable artifacts and fragments before atomically activating a signed root', async () => {
    const objectStore = new InMemoryImmutableObjectStore(); const pointerStore = new InMemoryReleasePointerStore();
    const publisher = new AtomicReleasePublisher({objectStore, pointerStore, signer: new HmacManifestSigner(Buffer.alloc(32, 7))});
    const result = await publisher.publish(input('lsc-co-r1', [candidate('lsc-co-hola', 'HOLA'), candidate('lsc-co-adios', 'ADIÓS')]));
    expect(result.pointer.releaseId).toBe('lsc-co-r1');
    expect(result.root.fragments.map((fragment: {id: string}) => fragment.id)).toEqual(['ad', 'ho']);
    expect(result.root.manifestSignature).toMatch(/^publisher-hmac-v1:[a-f0-9]{64}$/);
    expect(result.pointer.rootManifestSha256).toBe(hash(objectStore.objects.get(result.pointer.rootManifestPath).bytes));
    expect(result.root.manifestSha256).not.toBe(result.pointer.rootManifestSha256);
    expect(pointerStore.pointers.get('lsc-co:es-CO')).toEqual(result.pointer);
    expect(pointerStore.audit).toHaveLength(1);
    expect(objectStore.objects.size).toBe(7); // 4 executable artifacts, 2 fragments, 1 root
  });

  it('retains the old active pointer when any immutable upload fails', async () => {
    const objectStore = new InMemoryImmutableObjectStore(); const pointerStore = new InMemoryReleasePointerStore();
    const publisher = new AtomicReleasePublisher({objectStore, pointerStore, signer: new HmacManifestSigner(Buffer.alloc(32, 8))});
    await publisher.publish(input('lsc-co-r1'));
    objectStore.failOnPath = 'distribution/releases/lsc-co-r2/signs/lsc-co-hola/motion-binary/' + hash(Buffer.from('binary:lsc-co-hola')) + '/artifact.bin';
    await expect(publisher.publish(input('lsc-co-r2'))).rejects.toThrow('Injected Storage failure');
    expect(pointerStore.pointers.get('lsc-co:es-CO')?.releaseId).toBe('lsc-co-r1');
    expect(pointerStore.audit).toHaveLength(1);
  });

  it('fails closed before publication and rolls back through an auditable historical pointer', async () => {
    const objectStore = new InMemoryImmutableObjectStore(); const pointerStore = new InMemoryReleasePointerStore();
    const publisher = new AtomicReleasePublisher({objectStore, pointerStore, signer: new HmacManifestSigner(Buffer.alloc(32, 9)), clock: () => '2026-11-03T02:00:00.000Z'});
    const invalid = candidate('lsc-co-hola', 'HOLA'); invalid.entry.approved = false;
    await expect(publisher.publish(input('lsc-co-invalid', [invalid]))).rejects.toThrow('approved and published');
    await publisher.publish(input('lsc-co-r1')); await publisher.publish(input('lsc-co-r2'));
    await publisher.rollback({languageId: 'lsc-co', locale: 'es-CO', releaseId: 'lsc-co-r1', reason: 'canary-failure'});
    expect(pointerStore.pointers.get('lsc-co:es-CO')?.releaseId).toBe('lsc-co-r1');
    expect(pointerStore.audit.at(-1)).toEqual(expect.objectContaining({action: 'rollback', reason: 'canary-failure', previousReleaseId: 'lsc-co-r2'}));
  });

  it('retires the Firestore/Base64 publishing path instead of bypassing immutable releases', async () => {
    await expect(publishApprovedSigns()).rejects.toThrow('legacy Firestore/Base64 publisher is retired');
  });
});
