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
  selectPublishedLscEntries,
} from '../LinguisticCatalogService';

describe('LinguisticCatalogService', () => {
  it('resolves an accent-free clip to the manifest identity without mutating the catalog', () => {
    const source = {...PUBLISHED_LSC_ENTRIES[0], motion: {clip: 'ADIOS', published: true}};
    expect(selectPublishedLscEntries([source], ['ADIÓS'])[0].motion.clip).toBe('ADIÓS');
    expect(source.motion.clip).toBe('ADIOS');
    expect(selectPublishedLscEntries([source], ['ADIÓS', 'ÁDIOS'])).toEqual([]);
    expect(selectPublishedLscEntries([source], ['ADIOS', 'ADIÓS'])[0].motion.clip).toBe('ADIOS');
  });

  it('does not let accent matching bypass either approval or blocked status', () => {
    const source = {...PUBLISHED_LSC_ENTRIES[0], motion: {clip: 'ADIOS', published: true}};
    expect(selectPublishedLscEntries([source], [])).toEqual([]);
    expect(selectPublishedLscEntries([
      {...source, review: {...source.review, ownerApproval: undefined}},
      {...source, review: {...source.review, status: 'blocked'}},
      {...source, motion: {...source.motion, published: false}},
    ], ['ADIÓS'])).toEqual([]);
    expect(selectPublishedLscEntries([source, source], ['ADIÓS'])).toHaveLength(1);
  });

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
    expect(findPublishedLscEntry('PERDÓN')).toBeUndefined();
    expect(planPublishedLscGlosses(['PERDÓN'])).toEqual([]);
    expect(resolvePublishedLscPlan('perdón').tokens).toEqual([]);
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

  it('maps every catalog alias to an installed sign even when its gloss omits accents', () => {
    const signs = [{
      languageId: 'lsc-co',
      gloss: 'ADIOS',
      speechAliases: ['adios'],
      categories: ['saludos_cortesia'],
      lexicalClass: 'fixed_expression',
      verbType: 'none' as const,
      requiresSubjectMarker: false,
    }];

    expect(speechVocabularyForInstalledSigns(signs)[0].aliases).toContain('hasta luego');
    expect(resolveInstalledSignPlan('hasta luego', signs).tokens.map(token => token.gloss))
      .toEqual(['ADIOS']);
  });

  it('maps every approved voice alias to its installed sign', () => {
    const signs = PUBLISHED_LSC_ENTRIES.map(entry => ({
      languageId: 'lsc-co',
      gloss: entry.motion.clip,
      speechAliases: [],
      categories: entry.categories,
      lexicalClass: entry.lexicalClass,
      verbType: entry.lsc.verbType,
      requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
    }));

    PUBLISHED_LSC_SPEECH_VOCABULARY.forEach(({gloss, aliases = []}) => {
      aliases.forEach(alias => {
        expect(resolveInstalledSignPlan(alias, signs).tokens.map(token => token.gloss))
          .toContain(gloss);
      });
    });
  });
});
