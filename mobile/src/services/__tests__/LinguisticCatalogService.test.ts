import publishedSigns from '../../../assets/motions/published_signs.json';
import {extractKnownSpeechWords} from '../VoiceCommandService';
import {
  findPublishedLscEntry,
  planPublishedLscGlosses,
  PUBLISHED_LSC_ENTRIES,
  PUBLISHED_LSC_SIGN_COUNT,
  PUBLISHED_LSC_SPEECH_VOCABULARY,
  resolveInstalledSignPlan,
  resolvePublishedLscPlan,
  speechVocabularyForInstalledSigns,
} from '../LinguisticCatalogService';

describe('LinguisticCatalogService', () => {
  it('exposes exactly the signs explicitly approved by the project owner', () => {
    expect(PUBLISHED_LSC_ENTRIES.every(
      (entry) => entry.review.ownerApproval?.status === 'approved',
    )).toBe(true);
    expect(PUBLISHED_LSC_ENTRIES.map((entry) => entry.motion.clip).sort())
      .toEqual([...publishedSigns.publishedGlosses].sort());
    expect(PUBLISHED_LSC_SIGN_COUNT).toBe(publishedSigns.publishedGlosses.length);
  });

  it('resolves every personally approved manifest clip through the catalog', () => {
    publishedSigns.publishedGlosses.forEach((clip) => {
      expect(findPublishedLscEntry(clip)).toEqual(expect.objectContaining({
        motion: expect.objectContaining({clip}),
        review: expect.objectContaining({
          ownerApproval: expect.objectContaining({status: 'approved'}),
        }),
      }));
    });
  });

  it('does not expose a linguistically reviewed sign before personal approval', () => {
    expect(findPublishedLscEntry('GRACIAS')).toBeUndefined();
    expect(planPublishedLscGlosses(['GRACIAS'])).toEqual([]);
    expect(resolvePublishedLscPlan('muchas gracias').tokens).toEqual([]);
  });

  it('recognizes voice forms only for personally approved clips', () => {
    const approvedEntry = PUBLISHED_LSC_ENTRIES[0];
    expect(approvedEntry).toBeDefined();
    const approvedPhrase = approvedEntry.spanish.lemmas[0] || approvedEntry.gloss;
    const recognized = extractKnownSpeechWords(
      approvedPhrase,
      PUBLISHED_LSC_SPEECH_VOCABULARY,
    );

    expect(recognized).toEqual([approvedEntry.motion.clip]);
    expect(planPublishedLscGlosses(recognized).map((token) => token.gloss))
      .toEqual([approvedEntry.motion.clip]);
    expect(resolvePublishedLscPlan(approvedPhrase).tokens.map((token) => token.gloss))
      .toEqual([approvedEntry.motion.clip]);
  });

  it('plans only signs that the user downloaded', () => {
    const installed = new Set(['AGUA']);
    expect(resolvePublishedLscPlan('agua y amigo', installed).tokens.map(token => token.gloss))
      .toEqual(['AGUA']);
  });

  it('uses linguistic metadata downloaded with an independent sign', () => {
    const signs = [{
      languageId: 'lsc-co',
      gloss: 'NUEVA',
      speechAliases: ['seña nueva'],
      categories: ['prueba'],
      lexicalClass: 'noun',
      verbType: 'none' as const,
      requiresSubjectMarker: false,
    }];

    expect(speechVocabularyForInstalledSigns(signs)).toEqual([{
      gloss: 'NUEVA',
      aliases: ['NUEVA', 'seña nueva'],
    }]);
    expect(resolveInstalledSignPlan('esta seña nueva', signs).tokens.map(token => token.gloss))
      .toEqual(['NUEVA']);
  });
});
