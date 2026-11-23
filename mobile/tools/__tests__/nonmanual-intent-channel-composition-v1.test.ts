const casesFixture = require('../../../schemas/fixtures/nonmanual-intent-channel-composition-v1/documentary-cases.json');
const bindingsFixture = require('../../../schemas/nonmanual-intent-channel-bindings-v1.json');
const {composeDocumentaryNonManualIntentChannels} = require('../nonmanual-intent-channel-composition-v1.cjs');

describe('documentary non-manual intent to semantic channel composition v1', () => {
  it('binds the four approved contrast contexts to semantic channels without physical controls', () => {
    const result = composeDocumentaryNonManualIntentChannels(casesFixture, bindingsFixture).composition;
    const indexed = Object.fromEntries(result.cases.map((item: {caseId: string}) => [item.caseId, item]));
    expect(indexed['question-assertion.meeting-place'].variants[0].channelIntents)
      .toEqual([{channelId: 'nonmanual.intent.question', intentRef: 'lsc.question.content-marker'}]);
    expect(indexed['negation-affirmation.arrival'].variants[1].channelIntents)
      .toEqual([{channelId: 'nonmanual.intent.polarity', intentRef: 'lsc.negation.headshake'}]);
    expect(indexed['affect-neutral.arrival'].variants[1].channelIntents)
      .toEqual([{channelId: 'nonmanual.intent.affect', intentRef: 'lsc.affective-intent.surprise'}]);
    expect(indexed['role-shift-narration.meeting'].segments.map((segment: {order: number}) => segment.order)).toEqual([1, 2, 3]);
    expect(indexed['role-shift-narration.meeting'].segments[1].channelIntents)
      .toEqual([{channelId: 'nonmanual.intent.perspective', intentRef: 'lsc.discourse.role-shift.participant-1'}]);
  });

  it('preserves empty contrast cues and narrator segments instead of inventing defaults', () => {
    const result = composeDocumentaryNonManualIntentChannels(casesFixture, bindingsFixture).composition;
    const assertion = result.cases.find((item: {caseId: string}) => item.caseId === 'question-assertion.meeting-place').variants[1];
    const affirmative = result.cases.find((item: {caseId: string}) => item.caseId === 'negation-affirmation.arrival').variants[0];
    const neutral = result.cases.find((item: {caseId: string}) => item.caseId === 'affect-neutral.arrival').variants[0];
    const narrator = result.cases.find((item: {caseId: string}) => item.caseId === 'role-shift-narration.meeting').segments[0];
    expect(assertion.channelIntents).toEqual([]);
    expect(affirmative.channelIntents).toEqual([]);
    expect(neutral.channelIntents).toEqual([]);
    expect(narrator.channelIntents).toEqual([]);
  });

  it('is deterministic under case and binding input reordering', () => {
    const forward = composeDocumentaryNonManualIntentChannels(casesFixture, bindingsFixture);
    const reversed = composeDocumentaryNonManualIntentChannels({...casesFixture, cases: [...casesFixture.cases].reverse()},
      {...bindingsFixture, bindings: [...bindingsFixture.bindings].reverse()});
    expect(reversed.canonicalJson).toBe(forward.canonicalJson);
    expect(reversed.sha256).toBe(forward.sha256);
  });

  it('keeps output non-executable and omits region, exact time, and physical channel assignments', () => {
    const output = composeDocumentaryNonManualIntentChannels(casesFixture, bindingsFixture).composition;
    expect(output.execution).toBe('authoring-only-not-executable');
    expect(output.semanticLayer).toBe('abstract-nonmanual-intent');
    expect(output).not.toHaveProperty('language');
    expect(output).not.toHaveProperty('regionalVariant');
    expect(output).not.toHaveProperty('frames');
    expect(output).not.toHaveProperty('durationMs');
    expect(JSON.stringify(output)).not.toContain('head.pitch');
    expect(JSON.stringify(output)).not.toContain('fromMs');
  });

  it('rejects unknown references, duplicate bindings, and two cues colliding on one semantic channel', () => {
    const missing = {...bindingsFixture, bindings: bindingsFixture.bindings.slice(1)};
    expect(() => composeDocumentaryNonManualIntentChannels(casesFixture, missing))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INTENT_CHANNEL_UNBOUND'}));
    const duplicate = {...bindingsFixture, bindings: [...bindingsFixture.bindings, bindingsFixture.bindings[0]]};
    expect(() => composeDocumentaryNonManualIntentChannels(casesFixture, duplicate))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INTENT_BINDING_DUPLICATE'}));
    const collisionSource = structuredClone(casesFixture);
    collisionSource.cases[0].contrast[0].abstractNonmanualIntentRefs.push('lsc.question.content-marker');
    expect(() => composeDocumentaryNonManualIntentChannels(collisionSource, bindingsFixture))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.SEMANTIC_CHANNEL_COLLISION'}));
  });

  it('rejects source cases that introduce physical mapping or exact timing', () => {
    const physical = structuredClone(casesFixture);
    physical.cases[0].physicalChannelMapping = 'head.pitch';
    expect(() => composeDocumentaryNonManualIntentChannels(physical, bindingsFixture))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.DOCUMENTARY_SCOPE'}));
    const timed = structuredClone(casesFixture);
    timed.cases[0].timing = '0-300ms';
    expect(() => composeDocumentaryNonManualIntentChannels(timed, bindingsFixture))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.DOCUMENTARY_SCOPE'}));
  });
});
