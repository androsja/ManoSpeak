jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
}));

import type {InstalledSign} from '../SignLanguageService';
import {resolveRuntimeLscPlayback} from '../LscRuntimePlaybackService';
import {
  PUBLISHED_LSC_ENTRIES,
  PUBLISHED_LSC_SPEECH_VOCABULARY,
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

  it('routes every published voice alias to its installed sign in release mode', () => {
    const installedSigns = PUBLISHED_LSC_ENTRIES.map(entry => ({
      ...installedHola,
      id: `lsc-co-${entry.id}`,
      gloss: entry.motion.clip,
      assetName: `${entry.id}.motion.bin`,
      speechAliases: [],
      categories: entry.categories,
      lexicalClass: entry.lexicalClass,
      verbType: entry.lsc.verbType,
      requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
    }));

    PUBLISHED_LSC_SPEECH_VOCABULARY.forEach(({gloss, aliases = []}) => {
      aliases.forEach(alias => {
        expect(resolveRuntimeLscPlayback(alias, installedSigns, false)).toEqual(
          expect.objectContaining({
            status: 'reviewed',
            glosses: expect.arrayContaining([gloss]),
            message: '',
          }),
        );
      });
    });
  });

});
