const {compileSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

function syntheticDraft() {
  return {
    schema: 'vozual.spatial-grammar-intent',
    schemaVersion: 2,
    id: 'draft.synthetic',
    revision: 1,
    coordinateFrameRef: 'body',
    loci: [{id: 'locus.a', positionM: [0, 0, 0]}],
    entities: [{id: 'entity.a', roleRef: 'role.a', locusRef: 'locus.a', objectFrameRef: 'object'}],
    relations: [],
    execution: 'authoring-only-not-executable',
    profileBinding: {
      id: profile.id,
      revision: profile.revision,
      sha256: profile.sha256,
      candidateSha256: profile.asset.candidateSha256,
    },
  };
}

const ref = kind => ({kind, id: `${kind}.a`});
const relation = (id, sourceKind, targetKind) => ({
  id,
  kind: 'direction',
  sourceRef: ref(sourceKind),
  targetRef: ref(targetKind),
});

describe('v2 approved draft structural contract', () => {
  it('resolves all declared source and target kind pairings, including equal endpoints', () => {
    const draft = syntheticDraft();
    draft.relations = [
      relation('relation.a', 'entity', 'entity'),
      relation('relation.b', 'entity', 'locus'),
      relation('relation.c', 'locus', 'entity'),
      relation('relation.d', 'locus', 'locus'),
    ];
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    expect(trace.relations).toHaveLength(4);
    for (const [index, resolved] of trace.relations.entries()) {
      expect(resolved).toMatchObject({
        id: draft.relations[index].id,
        kind: 'direction',
        sourceRef: {...draft.relations[index].sourceRef, resolutionStatus: 'resolved-within-draft'},
        targetRef: {...draft.relations[index].targetRef, resolutionStatus: 'resolved-within-draft'},
      });
    }
  });

  it('accepts an empty relation collection', () => {
    expect(compileSpatialGrammarIntentV2(syntheticDraft(), profile).relations).toEqual([]);
  });

  it('preserves repeated relation content under distinct IDs without creating temporal metadata', () => {
    const draft = syntheticDraft();
    draft.relations = [relation('relation.z', 'locus', 'entity'), relation('relation.a', 'locus', 'entity')];
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    expect(trace.relations.map(item => item.id)).toEqual(['relation.a', 'relation.z']);
    const [{id: firstId, ...first}, {id: secondId, ...second}] = trace.relations;
    expect(firstId).not.toBe(secondId);
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('temporalRefs');
    expect(trace).not.toHaveProperty('temporalTimelineBinding');
  });

  it.each([
    ['id only', {id: 'agreement.a'}],
    ['revision only', {id: 'agreement.a', revision: 2}],
    ['digest only', {id: 'agreement.a', sha256: 'a'.repeat(64)}],
    ['revision and digest', {id: 'agreement.a', revision: 2, sha256: 'a'.repeat(64)}],
  ])('preserves opaque agreement metadata with %s and no temporal binding', (_label, agreementRef) => {
    const draft = syntheticDraft();
    draft.relations = [{...relation('relation.a', 'entity', 'locus'), kind: 'agreement', agreementRef}];
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    expect(trace.relations[0].agreementRef).toEqual({...agreementRef, resolutionStatus: 'opaque-unverified'});
    expect(trace.relations[0]).not.toHaveProperty('temporalRefs');
    expect(trace).not.toHaveProperty('temporalTimelineBinding');
  });

  it('rejects agreement metadata without an id', () => {
    const draft = syntheticDraft();
    draft.relations = [{...relation('relation.a', 'entity', 'locus'), kind: 'agreement', agreementRef: {revision: 2}}];
    expect(() => compileSpatialGrammarIntentV2(draft, profile)).toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_SPATIAL_INTENT_V2'}));
  });

  it('rejects agreement metadata on a demonstrative relation', () => {
    const draft = syntheticDraft();
    draft.relations = [{...relation('relation.a', 'entity', 'locus'), kind: 'demonstrative', agreementRef: {id: 'agreement.a'}}];
    expect(() => compileSpatialGrammarIntentV2(draft, profile)).toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_SPATIAL_INTENT_V2'}));
  });

  it.each(['object', 'locus', 'free-signing-space'])('preserves the declared-unvalidated %s frame as authoring metadata', frame => {
    const draft = syntheticDraft();
    draft.coordinateFrameRef = frame;
    draft.entities[0].objectFrameRef = frame;
    const trace = compileSpatialGrammarIntentV2(draft, profile);
    expect(trace).toMatchObject({
      schema: 'vozual.bound-spatial-authoring-trace',
      execution: 'authoring-only-not-executable',
      linguisticReviewStatus: 'unreviewed',
      coordinateFrame: {id: frame, status: 'declared-unvalidated'},
      entities: [{objectFrame: {id: frame, status: 'declared-unvalidated'}}],
    });
    expect(trace).not.toHaveProperty('frames');
    expect(trace).not.toHaveProperty('trajectories');
    expect(trace.coordinateFrame).not.toHaveProperty('transform');
    expect(trace.entities[0].objectFrame).not.toHaveProperty('transform');
  });
});
