const mockFiles = new Map<string, string>();

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  mkdir: jest.fn(async () => undefined),
  exists: jest.fn(async (path: string) => mockFiles.has(path)),
  readFile: jest.fn(async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) throw new Error(`Missing ${path}`);
    return content;
  }),
  writeFile: jest.fn(async (path: string, content: string) => {
    mockFiles.set(path, content);
  }),
  unlink: jest.fn(async (path: string) => {
    if (!mockFiles.delete(path)) throw new Error(`Missing ${path}`);
  }),
  moveFile: jest.fn(async (source: string, destination: string) => {
    const content = mockFiles.get(source);
    if (content === undefined) throw new Error(`Missing ${source}`);
    mockFiles.set(destination, content);
    mockFiles.delete(source);
  }),
  hash: jest.fn(async () => 'a'.repeat(64)),
}));

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocsFromServer: jest.fn(),
  getFirestore: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import {
  filterPublishedSigns,
  hasUnpromptedSignChanges,
  installedPhrasesForSelectedLanguage,
  installedSignsForSelectedLanguage,
  listSignLanguages,
  mergeSignLanguageStatuses,
  installSignLanguageChanges,
  parsePublishedSign,
  parsePublishedPhrase,
  parseSignLanguage,
  readInstalledSignPayload,
  type InstalledSign,
  type InstalledPhrase,
  type SignLibraryState,
  unpromptedSignChangeCount,
} from '../SignLanguageService';
import {getDoc, getDocsFromServer} from '@react-native-firebase/firestore';

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
  releaseSha256: 'd'.repeat(64),
  speechAliases: ['agua'],
  categories: ['sustantivos'],
  lexicalClass: 'noun',
  verbType: 'none',
  requiresSubjectMarker: false,
  approved: true,
  compiled: true,
  published: true,
});

function state(
  installedSigns: Record<string, InstalledSign> = {},
  installedPhrases: Record<string, InstalledPhrase> = {},
): SignLibraryState {
  return {installedSigns, installedPhrases, followedLanguageIds: [], dismissedRevisions: {}};
}

const phrase = parsePublishedPhrase('lsc-co-agua-necesito', {
  languageId: 'lsc-co',
  version: 1,
  spanish: 'Necesito agua.',
  glossSequence: ['AGUA'],
  releaseSha256: 'e'.repeat(64),
  approved: true,
  published: true,
});

describe('SignLanguageService', () => {
  beforeEach(() => {
    mockFiles.clear();
    jest.clearAllMocks();
  });
  it('filters a large catalogue by gloss, aliases, and categories without accents', () => {
    const signs = [
      sign,
      {...sign, id: 'lsc-co-bano', gloss: 'BAÑO', speechAliases: ['necesito ir al sanitario'], categories: ['lugares']},
    ];

    expect(filterPublishedSigns(signs, 'bano').map(item => item.gloss)).toEqual(['BAÑO']);
    expect(filterPublishedSigns(signs, 'sanitario').map(item => item.gloss)).toEqual(['BAÑO']);
    expect(filterPublishedSigns(signs, 'sustantivos').map(item => item.gloss)).toEqual(['AGUA']);
  });

  it('checks Firebase directly for downloadable sign and phrase changes', async () => {
    (getDocsFromServer as jest.Mock)
      .mockResolvedValueOnce({
        docs: [{
          id: language.id,
          data: () => ({
            code: language.code,
            name: language.name,
            region: language.region,
            published: true,
          }),
        }],
      })
      .mockResolvedValueOnce({
        docs: [{id: sign.id, data: () => sign}],
      })
      .mockResolvedValueOnce({
        docs: [{id: phrase.id, data: () => phrase}],
      });

    await expect(listSignLanguages()).resolves.toEqual([
      expect.objectContaining({
        id: language.id,
        pendingSigns: [expect.objectContaining({gloss: 'AGUA'})],
        pendingPhrases: [expect.objectContaining({spanish: 'Necesito agua.'})],
      }),
    ]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(3);
  });

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
    expect(() => parsePublishedSign('../unsafe', {
      ...sign,
      assetDocumentPath: 'signs/../unsafe/versions/v2',
    })).toThrow('invalid ID');
    expect(() => parsePublishedSign('safe-id', {
      ...sign,
      assetName: '../unsafe.motion.bin',
      assetDocumentPath: 'signs/safe-id/versions/v2',
    })).toThrow('invalid asset name');
  });

  it('rejects a phrase that is not independently approved and published', () => {
    expect(() => parsePublishedPhrase('draft-phrase', {
      ...phrase,
      approved: false,
    })).toThrow('not approved');
    expect(() => parsePublishedPhrase('../unsafe', phrase)).toThrow('invalid ID');
    expect(() => parsePublishedPhrase('empty-sequence', {
      ...phrase,
      glossSequence: [],
    })).toThrow('empty gloss sequence');
  });

  it('keeps the installed library unchanged when a multi-sign download is interrupted', async () => {
    const statePath = '/documents/vozual-sign-languages/library.json';
    const oldPath = '/documents/vozual-sign-languages/lsc-co/old.motion.bin';
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
      localPath: oldPath,
    };
    const originalState = state({[sign.id]: oldSign});
    mockFiles.set(statePath, JSON.stringify(originalState));
    mockFiles.set(oldPath, 'old-content');
    const secondSign = {...sign, id: 'lsc-co-hola', gloss: 'HOLA', assetName: 'hola.motion.bin', assetDocumentPath: 'signs/lsc-co-hola/versions/v2'};
    const status = mergeSignLanguageStatuses([language], [sign, secondSign], originalState)[0];
    (getDoc as jest.Mock)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          approved: true,
          compiled: true,
          published: true,
          sha256: sign.sha256,
          profileSha256: sign.profileSha256,
          releaseSha256: sign.releaseSha256,
          sizeBytes: sign.sizeBytes,
          contentBase64: 'new-content',
          avatarProfile: {version: 1},
        }),
      })
      .mockRejectedValueOnce(new Error('Network interrupted'));

    await expect(installSignLanguageChanges(status)).rejects.toThrow('Network interrupted');

    expect(mockFiles.get(statePath)).toBe(JSON.stringify(originalState));
    expect(mockFiles.get(oldPath)).toBe('old-content');
    expect([...mockFiles.keys()].some(path => path.endsWith('.download'))).toBe(false);
  });

  it('commits a verified update before deleting the previously installed asset', async () => {
    const statePath = '/documents/vozual-sign-languages/library.json';
    const oldPath = '/documents/vozual-sign-languages/lsc-co/old.motion.bin';
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
      localPath: oldPath,
    };
    const originalState = state({[sign.id]: oldSign});
    mockFiles.set(statePath, JSON.stringify(originalState));
    mockFiles.set(oldPath, 'old-content');
    const status = mergeSignLanguageStatuses([language], [sign], originalState)[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        approved: true,
        compiled: true,
        published: true,
        sha256: sign.sha256,
        profileSha256: sign.profileSha256,
        releaseSha256: sign.releaseSha256,
        sizeBytes: sign.sizeBytes,
        contentBase64: 'new-content',
        avatarProfile: {version: 1},
      }),
    });

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);

    const committed = JSON.parse(mockFiles.get(statePath) ?? '{}') as SignLibraryState;
    expect(committed.installedSigns[sign.id]).toEqual(expect.objectContaining({
      version: 2,
      sha256: sign.sha256,
      profileSha256: sign.profileSha256,
      releaseSha256: sign.releaseSha256,
      localPath: expect.stringContaining('/2-aaaaaaaaaaaaaaaa-cccccccccccccccc-agua.motion.bin'),
    }));
    expect(mockFiles.has(committed.installedSigns[sign.id].localPath)).toBe(true);
    expect(mockFiles.has(oldPath)).toBe(false);
  });

  it('downloads a new phrase transactionally with its installed signs', async () => {
    const installed: InstalledSign = {
      id: sign.id,
      languageId: sign.languageId,
      gloss: sign.gloss,
      version: sign.version,
      assetName: sign.assetName,
      sizeBytes: sign.sizeBytes,
      sha256: sign.sha256,
      profileSha256: sign.profileSha256,
      releaseSha256: sign.releaseSha256,
      speechAliases: sign.speechAliases,
      categories: sign.categories,
      lexicalClass: sign.lexicalClass,
      verbType: sign.verbType,
      requiresSubjectMarker: sign.requiresSubjectMarker,
      installedAt: '2026-09-01T00:00:00.000Z',
      localPath: '/documents/agua.motion.bin',
    };
    const status = mergeSignLanguageStatuses(
      [language],
      [sign],
      state({[sign.id]: installed}),
      [phrase],
    )[0];
    mockFiles.set(
      '/documents/vozual-sign-languages/library.json',
      JSON.stringify(state({[sign.id]: installed})),
    );
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => phrase,
    });

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);
    await expect(installedPhrasesForSelectedLanguage()).resolves.toEqual([
      expect.objectContaining({
        id: phrase.id,
        spanish: 'Necesito agua.',
        glossSequence: ['AGUA'],
      }),
    ]);
  });

  it('does not install a phrase that references a missing sign', () => {
    const invalidPhrase = {...phrase, glossSequence: ['AGUA', 'INEXISTENTE']};
    const [status] = mergeSignLanguageStatuses([language], [sign], state(), [invalidPhrase]);

    expect(status.phrases).toEqual([]);
    expect(status.pendingPhrases).toEqual([]);
  });

  it('does not activate a phrase-only update when its sign is absent locally', async () => {
    const installed: InstalledSign = {
      id: sign.id,
      languageId: sign.languageId,
      gloss: sign.gloss,
      version: sign.version,
      assetName: sign.assetName,
      sizeBytes: sign.sizeBytes,
      sha256: sign.sha256,
      profileSha256: sign.profileSha256,
      releaseSha256: sign.releaseSha256,
      speechAliases: sign.speechAliases,
      categories: sign.categories,
      lexicalClass: sign.lexicalClass,
      verbType: sign.verbType,
      requiresSubjectMarker: sign.requiresSubjectMarker,
      installedAt: '2026-09-01T00:00:00.000Z',
      localPath: '/documents/agua.motion.bin',
    };
    const [status] = mergeSignLanguageStatuses(
      [language],
      [sign],
      state({[sign.id]: installed}),
      [phrase],
    );
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => phrase,
    });

    await expect(installSignLanguageChanges(status)).rejects.toThrow(
      'Phrase Necesito agua. has invalid published metadata.',
    );
    await expect(installedPhrasesForSelectedLanguage()).resolves.toEqual([]);
  });

  it('rebases stored iOS sandbox paths before reading an installed motion', async () => {
    const statePath = '/documents/vozual-sign-languages/library.json';
    const currentMotionPath = '/documents/vozual-sign-languages/lsc-co/hola.motion.bin';
    const staleMotionPath = '/private/var/mobile/Containers/Data/Application/'
      + 'OLD-CONTAINER/Documents/vozual-sign-languages/lsc-co/hola.motion.bin';
    const installedHola: InstalledSign = {
      id: 'lsc-co-hola',
      languageId: 'lsc-co',
      gloss: 'HOLA',
      version: 1,
      assetName: 'hola.motion.bin',
      sizeBytes: 128,
      sha256: 'a'.repeat(64),
      speechAliases: ['hola'],
      categories: ['saludos'],
      lexicalClass: 'interjection',
      verbType: 'none',
      requiresSubjectMarker: false,
      installedAt: '2026-09-01T00:00:00.000Z',
      localPath: staleMotionPath,
    };
    mockFiles.set(statePath, JSON.stringify({
      ...state({[installedHola.id]: installedHola}),
      selectedLanguageId: 'lsc-co',
    }));
    mockFiles.set(currentMotionPath, 'motion-base64');

    await expect(installedSignsForSelectedLanguage()).resolves.toEqual([
      expect.objectContaining({
        id: installedHola.id,
        localPath: currentMotionPath,
      }),
    ]);
    await expect(readInstalledSignPayload('hola')).resolves.toEqual({
      contentBase64: 'motion-base64',
      avatarProfile: undefined,
    });
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
    expect(unpromptedSignChangeCount([status])).toBe(1);
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

  it('refreshes installed voice aliases when the published semantic release changes', () => {
    const installed: InstalledSign = {
      id: sign.id,
      languageId: sign.languageId,
      gloss: sign.gloss,
      version: sign.version,
      assetName: sign.assetName,
      sizeBytes: sign.sizeBytes,
      sha256: sign.sha256,
      profileSha256: sign.profileSha256,
      releaseSha256: 'e'.repeat(64),
      speechAliases: ['agua anterior'],
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

  it('installs a legacy motion document when its root sign has a current release digest', async () => {
    const status = mergeSignLanguageStatuses([language], [sign], state())[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        approved: true,
        compiled: true,
        published: true,
        sha256: sign.sha256,
        profileSha256: sign.profileSha256,
        sizeBytes: sign.sizeBytes,
        contentBase64: 'new-content',
        avatarProfile: {version: 1},
      }),
    });

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);
  });

  it('does not repeat a prompt after the current independent-sign revision is dismissed', () => {
    const initial = mergeSignLanguageStatuses([language], [sign], state())[0];
    const dismissedState = state();
    dismissedState.followedLanguageIds = [language.id];
    dismissedState.dismissedRevisions[language.id] = initial.revision;
    const dismissed = mergeSignLanguageStatuses([language], [sign], dismissedState)[0];
    expect(dismissed.dismissed).toBe(true);
    expect(unpromptedSignChangeCount([dismissed])).toBe(0);
    expect(hasUnpromptedSignChanges([dismissed])).toBe(false);
  });
});
