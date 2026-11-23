const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {compileSpatialGrammarIntentV2, serializeSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const inventory = require('../../../schemas/lsc-classifier-inventory-v1.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const repoRoot = path.resolve(__dirname, '../../..');
const cliPath = path.resolve(__dirname, '../compile-spatial-authoring-intent.cjs');
const profilePath = path.resolve(repoRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json');
let temporaryDirectory;

function classifierDraft() {
  return {
    schema: 'vozual.spatial-grammar-intent',
    schemaVersion: 2,
    id: 'draft.classifier-inventory',
    revision: 1,
    coordinateFrameRef: 'body',
    loci: [{id: 'locus.a', positionM: [0, 0, 0]}],
    entities: inventory.constructions.map(construction => ({
      id: `entity.${construction.id}`,
      roleRef: 'role.context-pending',
      locusRef: 'locus.a',
      objectFrameRef: 'object',
    })),
    relations: [],
    classifierAnnotations: inventory.constructions.map(construction => ({
      id: `annotation.${construction.id}`,
      inventoryRevision: inventory.revision,
      constructionId: construction.id,
      handshapeClass: construction.handshapeClass,
      entityRef: {
        kind: 'entity',
        id: `entity.${construction.id}`,
        role: construction.role,
        referentClass: construction.referentClass,
      },
    })),
    execution: 'authoring-only-not-executable',
    profileBinding: {
      id: profile.id,
      revision: profile.revision,
      sha256: profile.sha256,
      candidateSha256: profile.asset.candidateSha256,
    },
  };
}

function expectCode(callback, code) {
  try {
    callback();
    throw new Error(`Expected ${code} to be thrown`);
  } catch (error) {
    expect(error.code).toBe(code);
  }
}

describe('spatial grammar v2 classifier inventory', () => {
  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spatial-classifier-inventory-'));
  });

  afterAll(() => {
    const cleanedDirectory = temporaryDirectory;
    if (cleanedDirectory) fs.rmSync(cleanedDirectory, {recursive: true, force: true});
    expect(cleanedDirectory).toBeDefined();
    expect(fs.existsSync(cleanedDirectory)).toBe(false);
  });

  it('resolves each of the ten documented construction, handshape, role, and entity combinations', () => {
    const draft = classifierDraft();
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    const compiled = new Map(trace.classifierAnnotations.map(annotation => [annotation.constructionId, annotation]));

    expect(inventory.constructions).toHaveLength(10);
    for (const construction of inventory.constructions) {
      expect(compiled.get(construction.id)).toMatchObject({
        id: `annotation.${construction.id}`,
        inventoryId: inventory.id,
        inventoryRevision: inventory.revision,
        constructionId: construction.id,
        handshapeClass: construction.handshapeClass,
        sourceHandshapeNotation: construction.sourceHandshapeNotation,
        representedReferent: construction.representedReferent,
        role: construction.role,
        entityRef: {
          kind: 'entity',
          id: `entity.${construction.id}`,
          role: construction.role,
          referentClass: construction.referentClass,
          resolutionStatus: 'resolved-within-draft',
        },
        contextStatus: 'unreviewed',
      });
    }
    expect(trace.execution).toBe('authoring-only-not-executable');
    expect(trace.linguisticReviewStatus).toBe('unreviewed');
    expect(trace).not.toHaveProperty('trajectories');
    expect(Object.isFrozen(trace.classifierAnnotations)).toBe(true);
    expect(Object.isFrozen(trace.classifierAnnotations[0].entityRef.record)).toBe(true);
  });

  it.each(inventory.constructions)(
    'rejects a handshape class that does not match $id',
    construction => {
      const draft = classifierDraft();
      const annotation = draft.classifierAnnotations.find(item => item.constructionId === construction.id);
      annotation.handshapeClass = 'handshape.incompatible';
      expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SPATIAL.CLASSIFIER_HANDSHAPE_MISMATCH');
    },
  );

  it.each(inventory.constructions)(
    'rejects a role that does not match $id',
    construction => {
      const draft = classifierDraft();
      const annotation = draft.classifierAnnotations.find(item => item.constructionId === construction.id);
      annotation.entityRef.role = 'role.incompatible';
      expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SPATIAL.CLASSIFIER_ROLE_MISMATCH');
    },
  );

  it.each(inventory.constructions)(
    'rejects a referent class that does not match $id',
    construction => {
      const draft = classifierDraft();
      const annotation = draft.classifierAnnotations.find(item => item.constructionId === construction.id);
      annotation.entityRef.referentClass = 'referent.incompatible';
      expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SPATIAL.CLASSIFIER_REFERENT_MISMATCH');
    },
  );

  it('rejects a recipient in the transferred-object role and a 5o class under the biped walking construction', () => {
    const recipientDraft = classifierDraft();
    recipientDraft.classifierAnnotations.find(item => item.constructionId === 'give-cylindrical-object').entityRef.role = 'recipient';
    expectCode(() => compileSpatialGrammarIntentV2(recipientDraft, profile), 'SPATIAL.CLASSIFIER_ROLE_MISMATCH');

    const spiderDraft = classifierDraft();
    spiderDraft.classifierAnnotations.find(item => item.constructionId === 'walk-biped').handshapeClass = 'handshape.5o-active';
    expectCode(() => compileSpatialGrammarIntentV2(spiderDraft, profile), 'SPATIAL.CLASSIFIER_HANDSHAPE_MISMATCH');

    const stationaryObstacleDraft = classifierDraft();
    stationaryObstacleDraft.classifierAnnotations.find(item => item.constructionId === 'collide-two-wheeled-vehicle')
      .entityRef.referentClass = 'referent.stationary-obstacle';
    expectCode(() => compileSpatialGrammarIntentV2(stationaryObstacleDraft, profile), 'SPATIAL.CLASSIFIER_REFERENT_MISMATCH');

    const fourWheeledVehicleDraft = classifierDraft();
    fourWheeledVehicleDraft.classifierAnnotations.find(item => item.constructionId === 'collide-two-wheeled-vehicle')
      .entityRef.referentClass = 'referent.four-wheeled-vehicle';
    expectCode(() => compileSpatialGrammarIntentV2(fourWheeledVehicleDraft, profile), 'SPATIAL.CLASSIFIER_REFERENT_MISMATCH');
  });

  it.each([
    ['unsupported inventory revision', annotation => { annotation.inventoryRevision += 1; }, 'SPATIAL.INVALID_CLASSIFIER_INVENTORY_REVISION'],
    ['unknown construction', annotation => { annotation.constructionId = 'unknown-construction'; }, 'SPATIAL.UNKNOWN_CLASSIFIER_CONSTRUCTION'],
    ['undeclared entity', annotation => { annotation.entityRef.id = 'entity.unknown'; }, 'SPATIAL.UNKNOWN_CLASSIFIER_ENTITY'],
    ['duplicate global ID', (annotation, draft) => { annotation.id = draft.entities[0].id; }, 'SPATIAL.DUPLICATE_ID'],
  ])('rejects %s in classifier metadata', (_label, mutate, code) => {
    const draft = classifierDraft();
    mutate(draft.classifierAnnotations[0], draft);
    expectCode(() => compileSpatialGrammarIntentV2(draft, profile), code);
  });

  it('rejects a locus as a classifier entity reference at schema validation', () => {
    const draft = classifierDraft();
    draft.classifierAnnotations[0].entityRef = {kind: 'locus', id: 'locus.a'};
    expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SCHEMA.INVALID_SPATIAL_INTENT_V2');
  });

  it.each(['role', 'referentClass'])('requires %s to be bound inside the entity reference', field => {
    const draft = classifierDraft();
    delete draft.classifierAnnotations[0].entityRef[field];
    expectCode(() => compileSpatialGrammarIntentV2(draft, profile), 'SCHEMA.INVALID_SPATIAL_INTENT_V2');
  });

  it('sorts annotations and serializes the same authoring trace deterministically', () => {
    const draft = classifierDraft();
    draft.classifierAnnotations.reverse();
    const first = serializeSpatialGrammarIntentV2(draft, profile);
    const second = serializeSpatialGrammarIntentV2(draft, profile);
    expect(first).toEqual(second);
    expect(JSON.parse(first.json).classifierAnnotations.map(annotation => annotation.id)).toEqual(
      [...draft.classifierAnnotations].map(annotation => annotation.id).sort(),
    );
  });

  it('preserves v2 drafts without classifier annotations', () => {
    const draft = classifierDraft();
    delete draft.classifierAnnotations;
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    expect(trace).not.toHaveProperty('classifierAnnotations');
  });

  it('accepts all ten annotated constructions through the authoring CLI', () => {
    const draftPath = path.join(temporaryDirectory, 'all-ten-classifier-constructions.json');
    fs.writeFileSync(draftPath, `${JSON.stringify(classifierDraft())}\n`);
    const result = spawnSync(process.execPath, [cliPath, '--draft', draftPath, '--profile', profilePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 15000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const trace = JSON.parse(result.stdout);
    expect(trace.classifierAnnotations).toHaveLength(10);
    expect(trace.execution).toBe('authoring-only-not-executable');
    expect(trace.linguisticReviewStatus).toBe('unreviewed');
  });

  it('rejects an incompatible annotation through the authoring CLI without producing a trace', () => {
    const draft = classifierDraft();
    draft.classifierAnnotations.find(item => item.constructionId === 'give-cylindrical-object').entityRef.role = 'recipient';
    const draftPath = path.join(temporaryDirectory, 'incompatible-classifier-role.json');
    fs.writeFileSync(draftPath, `${JSON.stringify(draft)}\n`);
    const result = spawnSync(process.execPath, [cliPath, '--draft', draftPath, '--profile', profilePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 15000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SPATIAL\.CLASSIFIER_ROLE_MISMATCH/);
    expect(result.stdout).toBe('');
  });
});
