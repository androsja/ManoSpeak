const {compileSpatialGrammarIntentV2, serializeSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const inventory = require('../../../schemas/lsc-modulation-inventory-v1.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

function draft(modulationAnnotations) {
  return {
    schema: 'vozual.spatial-grammar-intent',
    schemaVersion: 2,
    id: 'draft.modulation',
    revision: 1,
    coordinateFrameRef: 'body',
    loci: [{id: 'locus.a', positionM: [0, 0, 0]}],
    entities: [],
    relations: [],
    ...(modulationAnnotations === undefined ? {} : {modulationAnnotations}),
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

describe('spatial grammar v2 source-bounded modulation inventory', () => {
  it('compiles every documented variant from data without gloss-specific branches', () => {
    const source = draft(inventory.variants.map(variant => ({
      id: `annotation.${variant.id}`,
      inventoryRevision: inventory.revision,
      variantId: variant.id,
      sourceGloss: variant.sourceSignGlosses[0] || 'GLOSS-UNDER-REVIEW',
    })));
    const trace = compileSpatialGrammarIntentV2(source, profile);
    const compiled = new Map(trace.modulationAnnotations.map(annotation => [annotation.variantId, annotation]));

    expect(inventory.variants).toHaveLength(14);
    for (const variant of inventory.variants) {
      expect(compiled.get(variant.id)).toMatchObject({
        inventoryId: inventory.id,
        inventoryRevision: inventory.revision,
        variantId: variant.id,
        sourceGloss: variant.sourceSignGlosses[0] || 'GLOSS-UNDER-REVIEW',
        domain: variant.domain,
        operation: variant.operation,
        sourceSignGlosses: variant.sourceSignGlosses,
        semanticEffect: variant.semanticEffect,
        qualitativeParameters: variant.qualitativeParameters,
        evidence: variant.evidence,
        interpretationStatus: 'source-documented-pattern-not-instance-validated',
        contextStatus: 'unreviewed',
      });
      expect(compiled.get(variant.id).signScopeStatus).toBe(variant.sourceSignGlosses.length > 0
        ? 'matches-source-listed-sign-scope'
        : 'requires-sign-specific-context-review');
    }
    expect(trace.execution).toBe('authoring-only-not-executable');
    expect(trace.linguisticReviewStatus).toBe('unreviewed');
    expect(trace).not.toHaveProperty('trajectories');
    expect(Object.isFrozen(trace.modulationAnnotations)).toBe(true);
    expect(Object.isFrozen(trace.modulationAnnotations[0].qualitativeParameters)).toBe(true);
  });

  it('preserves the unmodulated authoring trace when no modulation is declared', () => {
    const trace = compileSpatialGrammarIntentV2(draft(), profile);
    expect(trace).not.toHaveProperty('modulationAnnotations');
    expect(trace.execution).toBe('authoring-only-not-executable');
  });

  it('serializes modulation annotations deterministically regardless of source order', () => {
    const annotations = inventory.variants.slice(0, 4).map(variant => ({
      id: `annotation.${variant.id}`,
      inventoryRevision: inventory.revision,
      variantId: variant.id,
      sourceGloss: variant.sourceSignGlosses[0] || 'GLOSS-UNDER-REVIEW',
    }));
    const first = serializeSpatialGrammarIntentV2(draft(annotations), profile);
    const second = serializeSpatialGrammarIntentV2(draft([...annotations].reverse()), profile);
    expect(first).toEqual(second);
  });

  it('rejects unsupported inventory revisions and unknown variants, including standalone frequency', () => {
    const wrongRevision = draft([{id: 'annotation.a', inventoryRevision: 2, variantId: inventory.variants[0].id, sourceGloss: 'GRANDE'}]);
    const standaloneFrequency = draft([{id: 'annotation.a', inventoryRevision: 1, variantId: 'frequency.events-per-second', sourceGloss: 'COMPRAR'}]);
    expectCode(() => compileSpatialGrammarIntentV2(wrongRevision, profile), 'SPATIAL.INVALID_MODULATION_INVENTORY_REVISION');
    expectCode(() => compileSpatialGrammarIntentV2(standaloneFrequency, profile), 'SPATIAL.UNKNOWN_MODULATION_VARIANT');
    expect(inventory.domainDecisions.find(item => item.domain === 'frequency').decision)
      .toBe('not-an-independent-numeric-domain');
  });

  it('rejects duplicate annotation IDs and unreviewed numeric movement controls', () => {
    const duplicateIds = draft([
      {id: 'annotation.same', inventoryRevision: 1, variantId: inventory.variants[0].id, sourceGloss: 'GRANDE'},
      {id: 'annotation.same', inventoryRevision: 1, variantId: inventory.variants[1].id, sourceGloss: 'PEQUEÑO'},
    ]);
    const numericControl = draft([{
      id: 'annotation.numeric', inventoryRevision: 1, variantId: inventory.variants[0].id, sourceGloss: 'GRANDE', amplitudeM: 0.5,
    }]);
    expectCode(() => compileSpatialGrammarIntentV2(duplicateIds, profile), 'SPATIAL.DUPLICATE_ID');
    expectCode(() => compileSpatialGrammarIntentV2(numericControl, profile), 'SCHEMA.INVALID_SPATIAL_INTENT_V2');
  });

  it('rejects a sign gloss outside a construction-specific inventory row', () => {
    const mismatch = draft([{
      id: 'annotation.venir', inventoryRevision: 1,
      variantId: 'manner.venir-rapid-arrival', sourceGloss: 'SEÑAR',
    }]);
    expectCode(() => compileSpatialGrammarIntentV2(mismatch, profile), 'SPATIAL.MODULATION_GLOSS_MISMATCH');
  });
});
