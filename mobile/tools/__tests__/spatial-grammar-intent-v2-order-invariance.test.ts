const {compileSpatialGrammarIntentV2, serializeSpatialGrammarIntentV2} = require('../spatial-grammar-intent-v2.cjs');
const draft = require('../../../schemas/fixtures/spatial-grammar-intent-v2/duck-house-draft.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

describe('spatial grammar v2 authoring order invariance', () => {
  it('serializes permuted declarations byte-identically and resolves refs to their exact draft records', () => {
    const permuted = structuredClone(draft);
    permuted.loci.reverse();
    permuted.entities.reverse();
    permuted.relations.reverse();

    const baseline = serializeSpatialGrammarIntentV2(draft, profile);
    const reordered = serializeSpatialGrammarIntentV2(permuted, profile);

    expect(reordered.json).toBe(baseline.json);
    expect(reordered.sha256).toBe(baseline.sha256);

    const trace = JSON.parse(baseline.json);
    expect(trace).toMatchObject({
      schema: 'vozual.bound-spatial-authoring-trace',
      formatVersion: 2,
      execution: 'authoring-only-not-executable',
      linguisticReviewStatus: 'unreviewed',
    });

    const declaredInputByKind = {
      entity: new Map(draft.entities.map(record => [record.id, record])),
      locus: new Map(draft.loci.map(record => [record.id, record])),
    };
    const normalizedTraceByKind = {
      entity: new Map(trace.entities.map(record => [record.id, record])),
      locus: new Map(trace.loci.map(record => [record.id, record])),
    };
    const declaredRelations = new Map(draft.relations.map(relation => [relation.id, relation]));
    for (const relation of trace.relations) {
      const declaredRelation = declaredRelations.get(relation.id);
      for (const field of ['sourceRef', 'targetRef']) {
        const reference = relation[field];
        const declaredReference = declaredRelation[field];
        const declaredRecord = declaredInputByKind[declaredReference.kind].get(declaredReference.id);
        expect(reference.resolutionStatus).toBe('resolved-within-draft');
        expect(reference).toMatchObject({kind: declaredReference.kind, id: declaredReference.id});
        expect(reference.record).toEqual(normalizedTraceByKind[reference.kind].get(reference.id));
        if (reference.kind === 'locus') {
          expect(reference.record).toEqual(declaredRecord);
        } else {
          expect(reference.record).toMatchObject({
            id: declaredRecord.id,
            roleRef: declaredRecord.roleRef,
            locusRef: declaredRecord.locusRef,
            objectFrame: {id: declaredRecord.objectFrameRef},
          });
        }
      }
    }

    expect(trace.relations.find(relation => relation.kind === 'agreement').agreementRef).toEqual({
      id: 'agreement.example-pending',
      resolutionStatus: 'opaque-unverified',
    });
  });

  it('returns a deeply immutable trace without mutating the source draft', () => {
    const candidate = structuredClone(draft);
    const original = structuredClone(candidate);
    const trace = compileSpatialGrammarIntentV2(candidate, profile);
    const relation = trace.relations.find(item => item.kind === 'agreement');

    expect(candidate).toEqual(original);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.relations)).toBe(true);
    expect(Object.isFrozen(relation)).toBe(true);
    expect(Object.isFrozen(relation.agreementRef)).toBe(true);
    expect(Object.isFrozen(relation.sourceRef.record)).toBe(true);
    expect(Object.isFrozen(relation.sourceRef.record.objectFrame)).toBe(true);
    expect(Reflect.set(relation.sourceRef.record.objectFrame, 'status', 'validated')).toBe(false);
    expect(relation.sourceRef.record.objectFrame.status).toBe('declared-unvalidated');
  });
});
