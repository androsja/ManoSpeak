jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
}));

import type {InstalledSign} from '../SignLanguageService';
import {resolveRuntimeLscPlayback} from '../LscRuntimePlaybackService';

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

describe('LSC runtime playback policy', () => {
  it('plays an approved and published installed sign in release mode', () => {
    expect(resolveRuntimeLscPlayback('hola', [installedHola], false)).toEqual(
      expect.objectContaining({status: 'reviewed', glosses: ['HOLA'], message: ''}),
    );
  });

});
