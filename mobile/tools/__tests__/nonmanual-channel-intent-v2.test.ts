const {compileNonManualChannelIntentV2} = require('../nonmanual-channel-intent-v2.cjs');

function source(channels: Record<string, unknown>, tracks: unknown[]) {
  return {schema: 'vozual.nonmanual-channel-intent', schemaVersion: 2, id: 'fixture.task8.v2', revision: 1,
    durationMs: 1000, channels, tracks, execution: 'authoring-only-not-executable'};
}

function scalarDescriptor(operations = ['exclusive', 'override', 'additive', 'blend']) {
  return {domain: 'scalar', supportedOperations: operations, unit: 'normalized', neutral: 0,
    compatibilityGroups: ['smile-family']};
}

function cue(id: string, fromMs: number, toMs: number, mode: string, extra = {}) {
  const composition = mode === 'override' ? {mode, priority: 50, ...extra}
    : mode === 'blend' ? {mode, weight: 0.5, compatibilityGroupId: 'smile-family', ...extra}
      : {mode, ...extra};
  return {id, channel: 'mouthCorners.left', fromMs, toMs, intentRef: `intent.${id}`, composition};
}

describe('non-manual channel intent v2 composition', () => {
  it('keeps distinct channel timelines composable and emits deterministic authoring references only', () => {
    const value = source({
      'mouthCorners.left': scalarDescriptor(['exclusive']),
      'head.yaw': {domain: 'vector', supportedOperations: ['exclusive']},
    }, [
      {id: 'face', channel: 'mouthCorners.left', fromMs: 100, toMs: 700, intentRef: 'intent.face', composition: {mode: 'exclusive'}},
      {id: 'head', channel: 'head.yaw', fromMs: 200, toMs: 800, intentRef: 'intent.head', composition: {mode: 'exclusive'}},
    ]);
    const a = compileNonManualChannelIntentV2(value);
    const b = compileNonManualChannelIntentV2({...value, tracks: [...value.tracks].reverse()});
    expect(a.canonicalJson).toBe(b.canonicalJson);
    expect(a.sha256).toBe(b.sha256);
    expect(a.timeline.execution).toBe('authoring-only-not-executable');
    expect(a.timeline).not.toHaveProperty('frames');
    expect(a.timeline).not.toHaveProperty('poses');
  });

  it('selects the highest override priority and rejects a tie for the winning priority', () => {
    const descriptor = {domain: 'categorical-action', supportedOperations: ['override']};
    const valid = source({'mouthCorners.left': descriptor}, [
      cue('low', 0, 800, 'override', {priority: 10}),
      cue('high', 200, 600, 'override', {priority: 90}),
    ]);
    const result = compileNonManualChannelIntentV2(valid).timeline;
    expect(result.resolutions).toContainEqual(expect.objectContaining({fromMs: 200, toMs: 600,
      mode: 'override', winnerRef: 'intent.high', shadowedRefs: ['intent.low']}));
    const tied = source({'mouthCorners.left': descriptor}, [
      cue('first', 0, 800, 'override', {priority: 90}),
      cue('second', 200, 600, 'override', {priority: 90}),
    ]);
    expect(() => compileNonManualChannelIntentV2(tied))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.OVERRIDE_PRIORITY_TIE'}));
  });

  it('bounds override priority and rejects mixed operations on an overlapping channel', () => {
    const descriptor = scalarDescriptor();
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': descriptor}, [
      cue('bad-priority', 0, 500, 'override', {priority: 101}),
    ]))).toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTENT_V2'}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': descriptor}, [
      cue('override', 0, 600, 'override'), cue('blend', 200, 800, 'blend'),
    ]))).toThrow(expect.objectContaining({code: 'NONMANUAL.MIXED_OPERATIONS'}));
  });

  it('records additive operands in stable order and requires a typed neutral and unit', () => {
    const result = compileNonManualChannelIntentV2(source({'mouthCorners.left': scalarDescriptor(['additive'])}, [
      cue('z', 0, 500, 'additive'), cue('a', 200, 700, 'additive'),
    ])).timeline;
    expect(result.resolutions).toContainEqual(expect.objectContaining({fromMs: 200, toMs: 500,
      mode: 'additive', unit: 'normalized', neutral: 0, operandRefs: ['intent.a', 'intent.z']}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': {
      domain: 'scalar', supportedOperations: ['additive'], neutral: 0,
    }}, [cue('a', 0, 500, 'additive')]))).toThrow(expect.objectContaining({code: 'NONMANUAL.ADDITIVE_DESCRIPTOR'}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': {
      domain: 'target-reference', supportedOperations: ['additive'], unit: 'normalized', neutral: 0,
    }}, [cue('a', 0, 500, 'additive')]))).toThrow(expect.objectContaining({code: 'NONMANUAL.DOMAIN_OPERATION'}));
  });

  it('validates blend groups, weight bounds, and a sum tolerance of 1e-6', () => {
    const descriptor = scalarDescriptor(['blend']);
    const valid = source({'mouthCorners.left': descriptor}, [
      cue('a', 0, 500, 'blend', {weight: 0.4}), cue('b', 0, 500, 'blend', {weight: 0.6000005}),
    ]);
    const result = compileNonManualChannelIntentV2(valid).timeline;
    expect(result.resolutions[0]).toMatchObject({mode: 'blend', compatibilityGroupId: 'smile-family'});
    expect(result.resolutions[0].operands.map((item: {intentRef: string}) => item.intentRef)).toEqual(['intent.a', 'intent.b']);
    const invalidSum = source({'mouthCorners.left': descriptor}, [
      cue('a', 0, 500, 'blend', {weight: 0.4}), cue('b', 0, 500, 'blend', {weight: 0.600002}),
    ]);
    expect(() => compileNonManualChannelIntentV2(invalidSum))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.BLEND_WEIGHT_SUM'}));
    const badWeight = source({'mouthCorners.left': descriptor}, [cue('a', 0, 500, 'blend', {weight: 1.1})]);
    expect(() => compileNonManualChannelIntentV2(badWeight))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTENT_V2'}));
  });

  it.each([
    {weights: [0.25, 0.749999], accepted: true},
    {weights: [0.5, 0.500001], accepted: true},
    {weights: [0.999999, 0], accepted: true},
    {weights: [0.25, 0.7499989999999999], accepted: false},
    {weights: [0.5, 0.5000010000000001], accepted: false},
    {weights: [1, 1e-6], accepted: true},
    {weights: [1, 1e-6, 1e-20], accepted: false},
  ])('applies the inclusive decimal blend tolerance to $weights', ({weights, accepted}) => {
    const tracks = weights.map((weight, i) => cue('track-' + i, 0, 500, 'blend', {weight}));
    const compile = (ordered: typeof tracks) => compileNonManualChannelIntentV2(
      source({'mouthCorners.left': scalarDescriptor(['blend'])}, ordered));
    const reversed = [...tracks].reverse();
    if (accepted) {
      expect(compile(tracks).canonicalJson).toBe(compile(reversed).canonicalJson);
    } else {
      for (const order of [tracks, reversed]) {
        expect(() => compile(order)).toThrow(expect.objectContaining({code: 'NONMANUAL.BLEND_WEIGHT_SUM'}));
      }
    }
  });

  it('rejects undeclared operations and blend compatibility groups', () => {
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': scalarDescriptor(['exclusive'])}, [
      cue('a', 0, 500, 'override'),
    ]))).toThrow(expect.objectContaining({code: 'NONMANUAL.OPERATION_UNSUPPORTED'}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': {
      domain: 'scalar', supportedOperations: ['blend'], compatibilityGroups: ['other'],
    }}, [cue('a', 0, 500, 'blend')]))).toThrow(expect.objectContaining({code: 'NONMANUAL.BLEND_DESCRIPTOR'}));
  });

  it('rejects duplicate IDs, invalid intervals, and tied blend-group metadata', () => {
    const desc = scalarDescriptor();
    const base = cue('same', 0, 500, 'exclusive');
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': desc}, [base, {...base, fromMs: 500}])) )
      .toThrow(expect.objectContaining({code: 'NONMANUAL.DUPLICATE_ID'}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': desc}, [cue('late', 900, 1001, 'exclusive')])))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTERVAL'}));
    expect(() => compileNonManualChannelIntentV2(source({'mouthCorners.left': {
      ...scalarDescriptor(['blend']), compatibilityGroups: ['smile-family', 'other'],
    }}, [
      cue('a', 0, 500, 'blend', {weight: 0.5, compatibilityGroupId: 'smile-family'}),
      cue('b', 0, 500, 'blend', {weight: 0.5, compatibilityGroupId: 'other'}),
    ]))).toThrow(expect.objectContaining({code: 'NONMANUAL.BLEND_GROUP_MISMATCH'}));
  });
});
