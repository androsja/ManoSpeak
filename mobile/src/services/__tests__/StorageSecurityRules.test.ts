import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../../..');
const rules = fs.readFileSync(path.join(repositoryRoot, 'storage.rules'), 'utf8');
const firestoreRules = fs.readFileSync(path.join(repositoryRoot, 'firestore.rules'), 'utf8');

describe('immutable artifact security policy', () => {
  it('keeps source authoring private and grants reviewers reports only', () => {
    const authoringBlock = rules.match(/match \/authoring\/[\s\S]*?\n    \}/)?.[0] ?? '';
    expect(rules).toMatch(/match \/authoring\/\{authorId\}\/\{allPaths=\*\*\}/);
    expect(rules).toMatch(/request\.auth\.uid == authorId/);
    expect(rules).toMatch(/match \/review\/\{releaseId\}\/reports\/\{digest\}\/report\.json/);
    expect(authoringBlock).not.toContain('allow read: if true');
  });

  it('permits public reads only for immutable published object namespaces', () => {
    expect(rules).toMatch(/distribution\/releases\/\{releaseId\}\/root\/\{digest\}\/manifest\.json/);
    expect(rules).toMatch(/distribution\/releases\/\{releaseId\}\/fragments\/\{fragmentId\}\/\{digest\}\/fragment\.json/);
    expect(rules).toMatch(/motion-binary\/\{digest\}\/artifact\.bin/);
    expect(rules).toMatch(/execution-plan\/\{digest\}\/artifact\.json/);
    expect(rules).toMatch(/allow update, delete: if false/);
    expect(rules).toMatch(/allow read, write: if false/);
  });

  it('requires publisher identity and integrity metadata for a distribution create', () => {
    expect(rules).toMatch(/publisher\(\) && hash\(digest\) && immutableMetadata\(releaseId, digest\)/);
    for (const key of ['sha256', 'releaseId', 'compilerVersion', 'rigProfileId', 'rigProfileRevision', 'formatVersion']) {
      expect(rules).toContain(`request.resource.metadata.${key}`);
    }
  });

  it('denies Firestore Base64 motion payloads and client catalogue writes', () => {
    expect(firestoreRules).toContain("!resource.data.keys().hasAny(['contentBase64'])");
    expect(firestoreRules).toMatch(/match \/signs\/\{signId\}[\s\S]*?allow write: if false/);
    expect(firestoreRules).toMatch(/match \/phrases\/\{phraseId\}[\s\S]*?allow write: if false/);
  });
});
