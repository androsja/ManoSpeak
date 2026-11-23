const {compileSpatialGrammarIntent} = require('../spatial-grammar-intent-v1.cjs');
const draft = require('../../../schemas/fixtures/spatial-grammar-intent-v1/asymmetric-draft.json');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');

describe('spatial grammar authoring references', () => {
  it('validates named loci and exact entity-to-locus references into a stable trace', () => {
    const trace = compileSpatialGrammarIntent(draft, profile);
    expect(trace).toMatchObject({
      schema: 'vozual.bound-spatial-authoring-trace',
      formatVersion: 1,
      rigProfile: {id: 'vozual-rig-1', revision: 8, sha256: profile.sha256, candidateSha256: profile.asset.candidateSha256, candidateStatus: 'temporary-uncertified'},
      coordinateFrame: {id: 'body', status: 'validated'},
      execution: 'authoring-only-not-executable',
      loci: [
        {id: 'locus.left', positionM: [-0.2, 0.35, 0.1]},
        {id: 'locus.right', positionM: [0.25, 0.4, -0.05]},
      ],
      entities: [
        {id: 'entity.object-a', roleRef: 'role.referent-a', locusRef: 'locus.left', objectFrame: {id: 'object', status: 'declared-unvalidated'}},
        {id: 'entity.object-b', roleRef: 'role.referent-b', locusRef: 'locus.right', objectFrame: {id: 'object', status: 'declared-unvalidated'}},
      ],
    });
    expect(Object.isFrozen(trace.loci[0].positionM)).toBe(true);
    expect(Object.isFrozen(trace.entities[0])).toBe(true);
  });

  it('sorts trace records independently of input order and leaves source unchanged', () => {
    const permuted = structuredClone(draft);
    permuted.loci.reverse();
    permuted.entities.reverse();
    const before = structuredClone(permuted);
    expect(compileSpatialGrammarIntent(permuted, profile)).toEqual(compileSpatialGrammarIntent(draft, profile));
    expect(permuted).toEqual(before);
  });

  it('rejects unresolved loci, duplicate IDs, and non-finite coordinates', () => {
    const unknown = structuredClone(draft);
    unknown.entities[0].locusRef = 'locus.missing';
    expect(() => compileSpatialGrammarIntent(unknown, profile)).toThrow(/undeclared locus/);

    const duplicate = structuredClone(draft);
    duplicate.entities[0].id = duplicate.loci[0].id;
    expect(() => compileSpatialGrammarIntent(duplicate, profile)).toThrow(/globally unique/);

    const nonFinite = structuredClone(draft);
    nonFinite.loci[0].positionM[0] = Infinity;
    expect(() => compileSpatialGrammarIntent(nonFinite, profile)).toThrow(/Invalid spatial grammar intent/);
  });

  it('rejects executable promotion and unsupported spatial or classifier fields', () => {
    const promoted = structuredClone(draft);
    promoted.execution = 'executable';
    expect(() => compileSpatialGrammarIntent(promoted, profile)).toThrow();

    const unreviewed = structuredClone(draft);
    unreviewed.entities[0].classifierHandshape = 'classifier.generic';
    expect(() => compileSpatialGrammarIntent(unreviewed, profile)).toThrow();
  });

  it('rejects unknown coordinate/object frames and any profile or candidate mismatch', () => {
    const unknownCoordinateFrame = structuredClone(draft);
    unknownCoordinateFrame.coordinateFrameRef = 'frame.discourse';
    expect(() => compileSpatialGrammarIntent(unknownCoordinateFrame, profile)).toThrow(/undeclared coordinate frame/);

    const unknownObjectFrame = structuredClone(draft);
    unknownObjectFrame.entities[0].objectFrameRef = 'frame.object-a';
    expect(() => compileSpatialGrammarIntent(unknownObjectFrame, profile)).toThrow(/undeclared object frame/);

    const wrongProfile = structuredClone(draft);
    wrongProfile.profileBinding.candidateSha256 = '0'.repeat(64);
    expect(() => compileSpatialGrammarIntent(wrongProfile, profile)).toThrow(/exact rig profile and candidate/);
  });

  it('preserves declared-unvalidated frame status without treating it as a transform', () => {
    const unvalidatedCoordinate = structuredClone(draft);
    unvalidatedCoordinate.coordinateFrameRef = 'object';
    const trace = compileSpatialGrammarIntent(unvalidatedCoordinate, profile);
    expect(trace.coordinateFrame).toMatchObject({id: 'object', status: 'declared-unvalidated'});
    expect(trace.execution).toBe('authoring-only-not-executable');
  });
});
