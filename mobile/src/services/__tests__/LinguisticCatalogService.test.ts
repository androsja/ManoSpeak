import {extractKnownSpeechWords} from '../VoiceCommandService';
import {
  findPublishedLscEntry,
  planPublishedLscGlosses,
  PUBLISHED_LSC_ENTRIES,
  PUBLISHED_LSC_SIGN_COUNT,
  PUBLISHED_LSC_SPEECH_VOCABULARY,
  resolvePublishedLscPlan,
} from '../LinguisticCatalogService';

describe('LinguisticCatalogService', () => {
  it('covers every currently published motion through one LSC catalog', () => {
    expect(findPublishedLscEntry('NECESITAR')?.categories).toContain('necesidades');
    expect(findPublishedLscEntry('QUERER')?.categories).toContain('verbos_acciones');
  });

  it('counts shared historical records as one playable animation', () => {
    const elEntries = PUBLISHED_LSC_ENTRIES.filter((entry) => entry.motion.clip === 'EL');

    expect(elEntries).toHaveLength(1);
    expect(elEntries[0]).toEqual(expect.objectContaining({gloss: 'ÉL', lexicalClass: 'pronoun'}));
    expect(new Set(PUBLISHED_LSC_ENTRIES.map((entry) => entry.motion.clip)).size)
      .toBe(PUBLISHED_LSC_SIGN_COUNT);
  });

  it('normalizes verb forms while retaining every approved lexical clip', () => {
    const recognized = extractKnownSpeechWords(
      'necesitamos ayuda porque requiero apoyo',
      PUBLISHED_LSC_SPEECH_VOCABULARY,
    );

    expect(planPublishedLscGlosses(recognized).map((token) => token.gloss)).toEqual([
      'NECESITAR',
      'AYUDAR',
      'NECESITAR',
    ]);
  });

  it('retains linguistic metadata instead of treating a verb as an anonymous clip', () => {
    expect(planPublishedLscGlosses(['IR'])).toEqual([expect.objectContaining({
      gloss: 'IR',
      verbType: 'directional_review_required',
      requiresSubjectMarker: true,
    })]);
  });

  it('adds an approved subject marker before a first-person verb', () => {
    expect(resolvePublishedLscPlan('necesito ayuda').tokens.map((token) => token.gloss))
      .toEqual(['YO', 'NECESITAR', 'AYUDAR']);
  });

  it('adds the published second-person marker for a conjugated verb', () => {
    expect(resolvePublishedLscPlan('necesitas ayuda').tokens.map((token) => token.gloss))
      .toEqual(['TÚ', 'NECESITAR', 'AYUDAR']);
  });

  it('does not duplicate an explicit subject separated by negation', () => {
    expect(resolvePublishedLscPlan('yo no quiero comer').tokens.map((token) => token.gloss))
      .toEqual(['YO', 'NO', 'QUERER', 'COMER']);
  });

  it('omits the definite article but retains the third-person pronoun', () => {
    expect(resolvePublishedLscPlan('el médico come').tokens.map((token) => token.gloss))
      .toEqual(['MÉDICO', 'COMER']);
    expect(resolvePublishedLscPlan('el come').tokens.map((token) => token.gloss))
      .toEqual(['EL', 'COMER']);
    expect(resolvePublishedLscPlan('el médico come con perro').tokens.map((token) => token.gloss))
      .toEqual(['MÉDICO', 'COMER', 'PERRO']);
  });

  it('maps comer conjugations and comida to the COMER lexical sign', () => {
    expect(resolvePublishedLscPlan('yo no como').tokens.map((token) => token.gloss))
      .toEqual(['YO', 'NO', 'COMER']);
    expect(resolvePublishedLscPlan('comida').tokens.map((token) => token.gloss))
      .toEqual(['COMER']);
    expect(resolvePublishedLscPlan('alimento').tokens.map((token) => token.gloss))
      .toEqual(['COMER']);
    expect(resolvePublishedLscPlan('alimentaremos').tokens.map((token) => token.gloss))
      .toEqual(['COMER']);
  });

  it('maps mucho gender and number variants to one lexical sign', () => {
    expect(resolvePublishedLscPlan('mucha').tokens.map((token) => token.gloss))
      .toEqual(['MUCHO']);
    expect(resolvePublishedLscPlan('muchos').tokens.map((token) => token.gloss))
      .toEqual(['MUCHO']);
    expect(resolvePublishedLscPlan('muchas').tokens.map((token) => token.gloss))
      .toEqual(['MUCHO']);
  });

  it('maps doctor and doctora to the published MÉDICO sign', () => {
    expect(resolvePublishedLscPlan('doctor come').tokens.map((token) => token.gloss))
      .toEqual(['MÉDICO', 'COMER']);
    expect(resolvePublishedLscPlan('doctora come').tokens.map((token) => token.gloss))
      .toEqual(['MÉDICO', 'COMER']);
    expect(resolvePublishedLscPlan('médica come').tokens.map((token) => token.gloss))
      .toEqual(['MÉDICO', 'COMER']);
  });

  it('keeps consecutive phrase signs in spoken order', () => {
    expect(resolvePublishedLscPlan('hola cómo estás').tokens.map((token) => token.gloss))
      .toEqual(['HOLA', '¿CÓMO ESTÁS?']);
  });

  it('reports an unavailable marker instead of inventing an unapproved animation', () => {
    expect(resolvePublishedLscPlan('necesitamos ayuda')).toEqual(expect.objectContaining({
      tokens: [
        expect.objectContaining({gloss: 'NECESITAR'}),
        expect.objectContaining({gloss: 'AYUDAR'}),
      ],
      unavailableMarkers: ['NOSOTROS'],
    }));
  });
});
