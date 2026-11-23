const {compileSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const draft = require('../../../schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

function expectGlobalDuplicateIdFailure(candidate) {
  let trace;
  let thrown;
  try {
    trace = compileSpatialGrammarIntentV2(candidate, profile);
  } catch (error) {
    thrown = error;
  }
  expect(trace).toBeUndefined();
  expect(thrown).toBeDefined();
  expect(thrown.code).toBe('SPATIAL.DUPLICATE_ID');
}

describe('spatial grammar v2 global ID collisions', () => {
  it('rejects a relation ID colliding with a declared entity ID', () => {
    const candidate = structuredClone(draft);
    candidate.relations[0].id = candidate.entities[0].id;

    expectGlobalDuplicateIdFailure(candidate);
  });

  it('rejects a relation ID colliding with a declared locus ID', () => {
    const candidate = structuredClone(draft);
    candidate.relations[0].id = candidate.loci[0].id;

    expectGlobalDuplicateIdFailure(candidate);
  });

  it('rejects duplicate relation IDs', () => {
    const candidate = structuredClone(draft);
    candidate.relations[1].id = candidate.relations[0].id;

    expectGlobalDuplicateIdFailure(candidate);
  });
});
