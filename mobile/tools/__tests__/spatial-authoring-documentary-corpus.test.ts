import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const {compileSpatialGrammarAuthoringIntent} = require('../spatial-grammar-intent.cjs');
const {serializeSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const corpus = require('../../../schemas/fixtures/spatial-grammar-intent-v2/documentary-review-corpus.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const repoRoot = resolve(__dirname, '../../..');
const profilePath = join(repoRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json');
const cliPath = resolve(__dirname, '../compile-spatial-authoring-intent.cjs');
let directory: string;

function invokeCli(draftPath: string) {
  const result = spawnSync(process.execPath, [cliPath, '--draft', draftPath, '--profile', profilePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  return result;
}

function expectFrozen(value: unknown) {
  if (value !== null && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(expectFrozen);
  }
}

function rejectionFor(draft: object) {
  try {
    compileSpatialGrammarAuthoringIntent(draft, profile);
  } catch (error) {
    return error as {code: string; details: {errors?: object[]}};
  }
  throw new Error('Expected the authoring validator to reject this case.');
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'vozual-spatial-review-corpus-'));
});

afterAll(() => {
  if (directory) rmSync(directory, {recursive: true, force: true});
});

it('links each unique case to a source and covers both outcomes in each group', () => {
  expect(corpus.scope).toBe('documentary-draft-validation');
  const ids = new Set<string>();
  const coverage = new Set<string>();

  for (const item of corpus.cases) {
    expect(item.id).toMatch(/^[a-z][a-z0-9.-]*$/);
    expect(ids.has(item.id)).toBe(false);
    ids.add(item.id);
    expect(item.rule.trim()).not.toBe('');
    expect(item.context.trim()).not.toBe('');
    expect(item.rationale.trim()).not.toBe('');
    expect(item.source.printedPages.length).toBeGreaterThan(0);
    const source = corpus.sources[item.source.documentId];
    expect(source.documentUrl).toMatch(/^https:\/\//);
    expect(source.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
    coverage.add(`${item.group}:${item.expected.outcome}`);
  }

  expect([...coverage].sort()).toEqual([
    'classifiers:accept', 'classifiers:reject', 'modulation:accept',
    'modulation:reject', 'relations:accept', 'relations:reject',
  ]);
});

it.each(corpus.cases)('$group / $id ($expected.outcome)', item => {
  const draft = structuredClone({...corpus.draftDefaults, ...item.draft, id: `corpus.${item.id}`});
  const draftPath = join(directory, `${item.id}.json`);
  writeFileSync(draftPath, JSON.stringify(draft));
  const result = invokeCli(draftPath);
  const {expected} = item;

  if (expected.outcome === 'reject') {
    const error = rejectionFor(draft);
    expect(error.code).toBe(expected.error.code);
    if (expected.error.details) expect(error.details).toMatchObject(expected.error.details);
    if (expected.error.schemaIssue) {
      expect(error.details.errors).toEqual(expect.arrayContaining([
        expect.objectContaining(expected.error.schemaIssue),
      ]));
    }
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Spatial authoring compilation failed ${expected.error.code}: `);
    expect(result.stdout).toBe('');
    return;
  }

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const repeat = invokeCli(draftPath);
  expect(repeat.status).toBe(0);
  expect(repeat.stderr).toBe('');
  expect(repeat.stdout).toBe(result.stdout);

  const trace = compileSpatialGrammarAuthoringIntent(draft, profile);
  expectFrozen(trace);
  expect(trace).toMatchObject({
    ...expected.trace,
    execution: 'authoring-only-not-executable',
    linguisticReviewStatus: 'unreviewed',
  });
  for (const key of expected.absent ?? []) expect(trace).not.toHaveProperty(key);
  if (item.group === 'modulation') {
    const {effect, base, result: intendedMeaning} = expected.meaning;
    expect(base.trim()).not.toBe('');
    expect(intendedMeaning.trim()).not.toBe('');
    if (effect === 'preserve') {
      expect(intendedMeaning).toBe(base);
      expect(trace).not.toHaveProperty('modulationAnnotations');
    } else {
      expect(effect).toBe('modify');
      expect(intendedMeaning).not.toBe(base);
      expect(trace.modulationAnnotations[0].semanticEffect).toBe(
        expected.trace.modulationAnnotations[0].semanticEffect,
      );
    }
  }
  expect(result.stdout).toBe(`${serializeSpatialGrammarIntentV2(draft, profile).json}\n`);
});
