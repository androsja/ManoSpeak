jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
}));

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getFirestore: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import {
  hasUnpromptedSignChanges,
  mergeSignLanguageStatuses,
  parsePublishedSign,
  parseSignLanguage,
  type InstalledSign,
  type SignLibraryState,
} from '../SignLanguageService';

const language = parseSignLanguage('lsc-co', {
  code: 'lsc-co',
  name: 'Lengua de Señas Colombiana',
  region: 'Colombia',
  published: true,
});

const sign = parsePublishedSign('lsc-co-agua', {
  languageId: 'lsc-co',
  gloss: 'AGUA',
  version: 2,
  assetName: 'agua.motion.bin',
  sizeBytes: 1024,
  assetDocumentPath: 'signs/lsc-co-agua/versions/v2',
  sha256: 'a'.repeat(64),
  profileSha256: 'c'.repeat(64),
  speechAliases: ['agua'],
  categories: ['sustantivos'],
  lexicalClass: 'noun',
  verbType: 'none',
  requiresSubjectMarker: false,
  approved: true,
  compiled: true,
  published: true,
});

function state(installedSigns: Record<string, InstalledSign> = {}): SignLibraryState {
  return {installedSigns, followedLanguageIds: [], dismissedRevisions: {}};
}

describe('SignLanguageService', () => {
  it('accepts only independently downloadable approved compiled signs', () => {
    expect(sign.gloss).toBe('AGUA');
    expect(() => parsePublishedSign('draft', {
      ...sign,
      assetDocumentPath: 'signs/draft/versions/v2',
      approved: false,
    })).toThrow('not approved');
    expect(() => parsePublishedSign('wrong-path', {
      ...sign,
      assetDocumentPath: 'signs/another-sign/versions/v2',
    })).toThrow('asset document path');
  });

  it('detects a new or changed sign without requiring a language package', () => {
    const oldSign: InstalledSign = {
      id: sign.id,
      languageId: sign.languageId,
      gloss: sign.gloss,
      version: 1,
      assetName: sign.assetName,
      sizeBytes: sign.sizeBytes,
      sha256: 'b'.repeat(64),
      speechAliases: sign.speechAliases,
      categories: sign.categories,
      lexicalClass: sign.lexicalClass,
      verbType: sign.verbType,
      requiresSubjectMarker: sign.requiresSubjectMarker,
      installedAt: '2026-08-30T00:00:00.000Z',
      localPath: '/documents/agua.motion.bin',
    };
    const [status] = mergeSignLanguageStatuses(
      [language],
      [sign],
      state({[sign.id]: oldSign}),
    );
    expect(status.installedSignCount).toBe(1);
    expect(status.pendingSigns.map(item => item.gloss)).toEqual(['AGUA']);
    expect(status.changeCount).toBe(1);
    expect(hasUnpromptedSignChanges([status])).toBe(true);
  });

  it('detects a visual-profile change even when motion bytes stay the same', () => {
    const installed: InstalledSign = {
      id: sign.id,
      languageId: sign.languageId,
      gloss: sign.gloss,
      version: sign.version,
      assetName: sign.assetName,
      sizeBytes: sign.sizeBytes,
      sha256: sign.sha256,
      profileSha256: 'd'.repeat(64),
      speechAliases: sign.speechAliases,
      categories: sign.categories,
      lexicalClass: sign.lexicalClass,
      verbType: sign.verbType,
      requiresSubjectMarker: sign.requiresSubjectMarker,
      installedAt: '2026-08-30T00:00:00.000Z',
      localPath: '/documents/agua.motion.bin',
    };
    const [status] = mergeSignLanguageStatuses(
      [language],
      [sign],
      state({[sign.id]: installed}),
    );
    expect(status.pendingSigns.map(item => item.gloss)).toEqual(['AGUA']);
  });

  it('does not repeat a prompt after the current independent-sign revision is dismissed', () => {
    const initial = mergeSignLanguageStatuses([language], [sign], state())[0];
    const dismissedState = state();
    dismissedState.followedLanguageIds = [language.id];
    dismissedState.dismissedRevisions[language.id] = initial.revision;
    const dismissed = mergeSignLanguageStatuses([language], [sign], dismissedState)[0];
    expect(dismissed.dismissed).toBe(true);
    expect(hasUnpromptedSignChanges([dismissed])).toBe(false);
  });
});
