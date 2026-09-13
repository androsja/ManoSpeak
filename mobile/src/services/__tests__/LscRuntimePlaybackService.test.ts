jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
}));

import type {InstalledSign} from '../SignLanguageService';
import {resolveRuntimeLscPlayback} from '../LscRuntimePlaybackService';
import {shouldDeferSpeechMatch} from '../VoiceCommandService';
import {
  PUBLISHED_LSC_ENTRIES,
  PUBLISHED_LSC_SPEECH_VOCABULARY,
  speechVocabularyForInstalledSigns,
} from '../LinguisticCatalogService';

const installedHola: InstalledSign = {
  id: 'lsc-co-hola',
  languageId: 'lsc-co',
  gloss: 'HOLA',
  version: 1,
  assetName: 'hola.motion.bin',
  sizeBytes: 128,
  sha256: 'a'.repeat(64),
  speechAliases: ['hola'],
  categories: ['saludos_cortesia'],
  lexicalClass: 'fixed_expression',
  verbType: 'none',
  requiresSubjectMarker: false,
  installedAt: '2026-09-04T00:00:00.000Z',
  localPath: '/documents/hola.motion.bin',
};

const installedComer: InstalledSign = {
  ...installedHola,
  id: 'lsc-co-comer',
  gloss: 'COMER',
  assetName: 'comer.motion.bin',
  speechAliases: ['comer'],
  lexicalClass: 'verb',
  requiresSubjectMarker: true,
};

describe('LSC runtime playback policy', () => {
  it('plays an approved and published installed sign in release mode', () => {
    expect(resolveRuntimeLscPlayback('hola', [installedHola], false)).toEqual(
      expect.objectContaining({status: 'reviewed', glosses: ['HOLA'], message: ''}),
    );
  });

  it('plays an installed verb when a spoken conjugation needs an unavailable subject marker', () => {
    expect(resolveRuntimeLscPlayback('como', [installedComer], false)).toEqual(
      expect.objectContaining({status: 'reviewed', glosses: ['COMER'], message: ''}),
    );
  });

  it('keeps every published voice alias playable as a final phrase', () => {
    const installedSigns = PUBLISHED_LSC_ENTRIES.map(entry => ({
      ...installedHola,
      id: `lsc-co-${entry.id}`,
      gloss: entry.motion.clip,
      assetName: `${entry.id}.motion.bin`,
      // This is the metadata that arrives from Firebase when a person
      // downloads a sign. Do not rely on a bundled catalog for this contract.
      speechAliases: [...(PUBLISHED_LSC_SPEECH_VOCABULARY.find(
        vocabulary => vocabulary.gloss === entry.motion.clip,
      )?.aliases ?? [])],
      categories: entry.categories,
      lexicalClass: entry.lexicalClass,
      verbType: entry.lsc.verbType,
      requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
    }));
    const downloadedVocabulary = speechVocabularyForInstalledSigns(installedSigns);

    PUBLISHED_LSC_SPEECH_VOCABULARY.forEach(({gloss, aliases = []}) => {
      aliases.forEach(alias => {
        // A completed phrase always wins over a possible longer expression.
        // This is the regression guard for "como" versus "cómo estás".
        expect(shouldDeferSpeechMatch(alias, downloadedVocabulary, true, false)).toBe(false);
        expect(resolveRuntimeLscPlayback(alias, installedSigns, false)).toEqual(
          expect.objectContaining({
            status: 'reviewed',
            glosses: expect.arrayContaining([gloss]),
            message: '',
          }),
        );
        // Leading words that do not have a downloaded sign (for example YO)
        // must never suppress the installed sign that follows.
        expect(resolveRuntimeLscPlayback(`yo ${alias}`, installedSigns, false)).toEqual(
          expect.objectContaining({
            status: 'reviewed',
            glosses: expect.arrayContaining([gloss]),
            message: '',
          }),
        );
      });
    });
  });

  it('plays a newly downloaded Firebase alias without requiring an APK catalog update', () => {
    const firebaseOnlySign: InstalledSign = {
      ...installedHola,
      id: 'lsc-co-nueva',
      gloss: 'NUEVA',
      assetName: 'nueva.motion.bin',
      speechAliases: ['expresión nueva'],
      categories: ['prueba'],
      lexicalClass: 'noun',
    };

    expect(resolveRuntimeLscPlayback('expresión nueva', [firebaseOnlySign], false)).toEqual(
      expect.objectContaining({status: 'reviewed', glosses: ['NUEVA'], message: ''}),
    );
  });

});
