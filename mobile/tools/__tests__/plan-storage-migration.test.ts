import fs from 'fs';
import path from 'path';

const {
  createMigrationPlan,
  normalizeRemoteSnapshot,
  renderMarkdown,
} = require('../plan-storage-migration');

const fixtures = path.join(__dirname, '..', 'fixtures');

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8')) as unknown;
}

describe('plan-storage-migration', () => {
  it('compares a local seed with a Firestore REST snapshot', () => {
    const plan = createMigrationPlan(
      readFixture('storage-migration-seed.json'),
      normalizeRemoteSnapshot(readFixture('storage-migration-firestore.snapshot.json')),
      {localSeed: 'fixture-seed', remote: 'fixture-snapshot'},
    );

    expect(plan.summary).toEqual(expect.objectContaining({
      total: 5,
      create: 2,
      update: 2,
      unchanged: 1,
      blocked: 3,
    }));
    expect(plan.summary.blockerCounts).toEqual(expect.objectContaining({
      'missing-downloadUrl': 2,
      'local-not-approved': 1,
      'missing-local-seed': 1,
    }));

    const byId = new Map(plan.entries.map((entry: {signId: string}) => [entry.signId, entry]));
    expect(byId.get('lsc-co-create')).toEqual(expect.objectContaining({
      action: 'create',
      blocked: false,
      localVersion: 1,
      remoteVersion: null,
    }));
    expect(byId.get('lsc-co-update')).toEqual(expect.objectContaining({
      action: 'update',
      blocked: false,
      localVersion: 2,
      remoteVersion: 1,
    }));
    expect(byId.get('lsc-co-unchanged')).toEqual(expect.objectContaining({
      action: 'unchanged',
      blocked: true,
      blockers: ['missing-downloadUrl'],
    }));
    expect(byId.get('lsc-co-blocked')).toEqual(expect.objectContaining({
      action: 'create',
      blocked: true,
      blockers: ['local-not-approved', 'missing-downloadUrl'],
    }));
    expect(byId.get('lsc-co-remote-only')).toEqual(expect.objectContaining({
      action: 'update',
      blocked: true,
      blockers: ['missing-local-seed'],
    }));
  });

  it('renders required migration fields and read-only semantics as Markdown', () => {
    const plan = createMigrationPlan(
      readFixture('storage-migration-seed.json'),
      normalizeRemoteSnapshot(readFixture('storage-migration-firestore.snapshot.json')),
    );
    const markdown = renderMarkdown(plan);

    expect(markdown).toContain('This manifest is read-only planning output.');
    expect(markdown).toContain('lsc-co-update');
    expect(markdown).toContain('7777777777777777777777777777777777777777777777777777777777777777');
    expect(markdown).toContain('missing-downloadUrl');
    expect(markdown).toContain('lsc-co/signs/lsc-co-update/v2/update.motion.bin');
  });
});
