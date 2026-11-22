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
  writeFile: jest.fn(async (path: string, content: string, encoding?: string) => {
    mockFiles.set(path, encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content);
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
  stat: jest.fn(async () => ({size: 1024})),
  downloadFile: jest.fn(({toFile}: {toFile: string}) => ({
    promise: (async () => { mockFiles.set(toFile, 'storage-content'); })(),
  })),
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
  createFirebaseStorageAdapter,
  hasUnpromptedSignChanges,
  installedPhrasesForSelectedLanguage,
  installedSignsForSelectedLanguage,
  listSignLanguages,
  listSignLanguagesWithMigration,
  listVersionedJsonReleaseLanguages,
  mergeSignLanguageStatuses,
  installSignLanguageChanges,
  parsePublishedSign,
  parsePublishedPhrase,
  parsePublishedAssetReference,
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

  it('accepts Storage references while preserving legacy asset-document metadata', () => {
    expect(parsePublishedAssetReference({
      storagePath: 'lsc-co/signs/lsc-co-agua/v2/agua.motion.bin',
      semanticPath: 'lsc-co/signs/lsc-co-agua/v2/agua.semantic.json',
      profilePath: 'lsc-co/signs/lsc-co-agua/v2/agua.profile.json',
    })).toEqual({
      storagePath: 'lsc-co/signs/lsc-co-agua/v2/agua.motion.bin',
      downloadUrl: undefined,
      semanticPath: 'lsc-co/signs/lsc-co-agua/v2/agua.semantic.json',
      profilePath: 'lsc-co/signs/lsc-co-agua/v2/agua.profile.json',
    });
    expect(parsePublishedAssetReference({
      downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/example/o/agua.motion.bin',
    }).downloadUrl).toContain('https://');
    expect(() => parsePublishedAssetReference({storagePath: '../unsafe.motion.bin'})).toThrow('invalid storagePath');
  });

  it('keeps Firebase URL resolution injectable and validates the resolved URL', async () => {
    const resolveDownloadUrl = jest.fn(async (storagePath: string) => (
      `https://firebasestorage.googleapis.com/v0/b/example/o/${storagePath}`
    ));
    const downloadToFile = jest.fn(async () => undefined);
    const adapter = createFirebaseStorageAdapter({resolveDownloadUrl, downloadToFile});

    await adapter.downloadToFile('lsc-co/agua.motion.bin', '/documents/agua.download');

    expect(resolveDownloadUrl).toHaveBeenCalledWith('lsc-co/agua.motion.bin');
    expect(downloadToFile).toHaveBeenCalledWith(
      'https://firebasestorage.googleapis.com/v0/b/example/o/lsc-co/agua.motion.bin',
      '/documents/agua.download',
    );
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

    await expect(listSignLanguagesWithMigration({enableLegacyCatalogMigration: true})).resolves.toEqual([
      expect.objectContaining({
        id: language.id,
        pendingSigns: [expect.objectContaining({gloss: 'AGUA'})],
        pendingPhrases: [expect.objectContaining({spanish: 'Necesito agua.'})],
      }),
    ]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(3);
  });

  it('does not query every Firestore collection during the normal startup route', async () => {
    await expect(listSignLanguages()).resolves.toEqual([]);
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('reads the separate versioned JSON release without querying the legacy catalogue', async () => {
    const jsonSign = {
      id: 'lsc-co-adios',
      languageId: 'lsc-co',
      gloss: 'ADIÓS',
      version: 1,
      assetName: 'adios.motion.json',
      sizeBytes: 117,
      sha256: 'a'.repeat(64),
      profileSha256: 'b'.repeat(64),
      releaseSha256: 'c'.repeat(64),
      speechAliases: ['ADIÓS', 'adiós', 'chao'],
      categories: ['saludos_cortesia'],
      lexicalClass: 'fixed_expression',
      verbType: 'none',
      requiresSubjectMarker: false,
      motionFormat: 'legacy-json-v2',
      jsonChunkCount: 2,
      approved: true,
      compiled: true,
      published: true,
    };
    (getDoc as jest.Mock)
      .mockResolvedValueOnce({exists: () => true, data: () => ({
        schema: 'vozual.sign-json-release-pointer',
        languageId: 'lsc-co',
        releaseId: 'lsc-co-json-v1',
        version: 1,
        published: true,
      })})
      .mockResolvedValueOnce({exists: () => true, data: () => ({
        schema: 'vozual.sign-json-release',
        releaseId: 'lsc-co-json-v1',
        languageId: 'lsc-co',
        version: 1,
        published: true,
        signs: [jsonSign],
      })});

    await expect(listVersionedJsonReleaseLanguages()).resolves.toEqual([
      expect.objectContaining({
        id: 'lsc-co',
        changeCount: 1,
        pendingSigns: [expect.objectContaining({
          gloss: 'ADIÓS',
          motionFormat: 'legacy-json-v2',
          jsonChunkCount: 2,
          jsonReleaseId: 'lsc-co-json-v1',
        })],
      }),
    ]);
    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('installs JSON motion chunks together with their speech aliases after acceptance', async () => {
    const motionDocument = {
      version: 2,
      fps: 30,
      layout: 'pose33_left21_right21_face468',
      avatarProfile: {activeHand: 'left'},
      frames: [
        {bodyHands: [[0, 0, 0]], face: [[0, 0, 0]]},
        {bodyHands: [[0, 0, 0]], face: [[0, 0, 0]]},
      ],
    };
    const compactJson = JSON.stringify(motionDocument);
    const jsonText = compactJson + ' '.repeat(1024 - Buffer.byteLength(compactJson));
    const contentBase64 = Buffer.from(jsonText).toString('base64');
    const jsonSign = parsePublishedSign('lsc-co-number-01', {
      languageId: 'lsc-co',
      gloss: 'UNO',
      version: 4,
      assetName: 'uno.motion.json',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      profileSha256: 'b'.repeat(64),
      releaseSha256: 'c'.repeat(64),
      speechAliases: ['uno', '1'],
      categories: ['numeros_cantidades'],
      lexicalClass: 'numeral',
      verbType: 'none',
      requiresSubjectMarker: false,
      motionFormat: 'legacy-json-v2',
      jsonReleaseId: 'lsc-co-json-v4',
      jsonChunkCount: 1,
      approved: true,
      compiled: true,
      published: true,
    });
    const status = mergeSignLanguageStatuses([language], [jsonSign], state())[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        releaseId: 'lsc-co-json-v4',
        signId: jsonSign.id,
        index: 0,
        count: 1,
        contentBase64,
      }),
    });
    (require('react-native-fs').hash as jest.Mock).mockResolvedValueOnce(jsonSign.sha256);
    (require('react-native-fs').stat as jest.Mock).mockResolvedValueOnce({size: jsonSign.sizeBytes});

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);

    const installedState = JSON.parse(
      mockFiles.get('/documents/vozual-sign-languages/library.json') ?? '{}',
    ) as SignLibraryState;
    expect(installedState.installedSigns[jsonSign.id]).toEqual(expect.objectContaining({
      version: 4,
      speechAliases: ['uno', '1'],
      motionFormat: 'legacy-json-v2',
    }));
    await expect(readInstalledSignPayload('UNO')).resolves.toEqual(expect.objectContaining({
      contentBase64: '',
      motionDocument: expect.objectContaining({avatarProfile: {activeHand: 'left'}}),
      avatarProfile: {activeHand: 'left'},
    }));
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

  it('does not request a re-download when only an unchanged sign version increases', () => {
    const installed: InstalledSign = {
      ...sign,
      version: 3,
      installedAt: '2026-08-30T00:00:00.000Z',
      localPath: '/documents/agua-v3.motion.json',
    };
    const unchangedRelease = {...sign, version: 4};

    const [status] = mergeSignLanguageStatuses(
      [language],
      [unchangedRelease],
      state({[sign.id]: installed}),
    );

    expect(status.pendingSigns).toEqual([]);
    expect(status.changeCount).toBe(0);
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

  it('downloads a Storage URL, verifies it with the same hash, and persists sidecar paths', async () => {
    const storageSign = parsePublishedSign('lsc-co-agua', {
      ...sign,
      storagePath: 'lsc-co/signs/lsc-co-agua/v2/agua.motion.bin',
      downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/example/o/agua.motion.bin',
      semanticPath: 'lsc-co/signs/lsc-co-agua/v2/agua.semantic.json',
      profilePath: 'lsc-co/signs/lsc-co-agua/v2/agua.profile.json',
    });
    const status = mergeSignLanguageStatuses([language], [storageSign], state())[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        approved: true,
        compiled: true,
        published: true,
        sha256: storageSign.sha256,
        profileSha256: storageSign.profileSha256,
        releaseSha256: storageSign.releaseSha256,
        sizeBytes: storageSign.sizeBytes,
        storagePath: storageSign.storagePath,
        downloadUrl: storageSign.downloadUrl,
        semanticPath: storageSign.semanticPath,
        profilePath: storageSign.profilePath,
        avatarProfile: {version: 1},
      }),
    });

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);
    expect(require('react-native-fs').downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      fromUrl: storageSign.downloadUrl,
    }));
    const committed = JSON.parse(
      mockFiles.get('/documents/vozual-sign-languages/library.json') ?? '{}',
    ) as SignLibraryState;
    expect(committed.installedSigns[storageSign.id]).toEqual(expect.objectContaining({
      storagePath: storageSign.storagePath,
      downloadUrl: storageSign.downloadUrl,
      semanticPath: storageSign.semanticPath,
      profilePath: storageSign.profilePath,
    }));
  });

  it('carries public HOLA metadata through mocked installation to the avatar payload boundary', async () => {
    const holaProfile = {
      activeHand: 'left',
      contactAnchor: 'forehead',
      contactStartFrame: 0,
      contactEndFrame: 12,
      palmAtContact: 'camera',
    };
    const hola = parsePublishedSign('lsc-co-00006800006f00006c000061', {
      languageId: 'lsc-co',
      gloss: 'HOLA',
      version: 1,
      assetName: 'm_00006800006f00006c000061.motion.bin',
      sizeBytes: 117304,
      assetDocumentPath: 'signs/lsc-co-00006800006f00006c000061/versions/v1',
      storagePath: 'lsc-co/signs/lsc-co-00006800006f00006c000061/v1/m_00006800006f00006c000061.motion.bin',
      downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/vozual-lsc-prod/o/hola.motion.bin',
      sha256: '7c649d28dc0b23a6fedb54324c9fa873472ac7ea2ddfaca2ee360c40f7fda08e',
      profileSha256: '3fb7dff99748985ab308fdc699f3f20047b9696c0db5ce27f6f05fc54bc2769b',
      releaseSha256: 'f8d3f28776a091ee14b362f58446889f8bfcfdd2b6a1103a10286ee7915029cc',
      speechAliases: ['HOLA', 'hola'],
      categories: ['saludos_cortesia'],
      lexicalClass: 'fixed_expression',
      verbType: 'none',
      requiresSubjectMarker: false,
      approved: true,
      compiled: true,
      published: true,
    });
    const status = mergeSignLanguageStatuses([language], [hola], state())[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        approved: true,
        compiled: true,
        published: true,
        sha256: hola.sha256,
        profileSha256: hola.profileSha256,
        releaseSha256: hola.releaseSha256,
        sizeBytes: hola.sizeBytes,
        storagePath: hola.storagePath,
        downloadUrl: hola.downloadUrl,
        avatarProfile: holaProfile,
      }),
    });
    const fs = require('react-native-fs');
    (fs.stat as jest.Mock).mockResolvedValueOnce({size: hola.sizeBytes});
    (fs.hash as jest.Mock).mockResolvedValueOnce(hola.sha256);

    await expect(installSignLanguageChanges(status)).resolves.toBe(1);
    await expect(readInstalledSignPayload('HOLA')).resolves.toEqual({
      contentBase64: 'storage-content',
      avatarProfile: holaProfile,
      storagePath: hola.storagePath,
      downloadUrl: hola.downloadUrl,
      semanticPath: undefined,
      profilePath: undefined,
    });
  });

  it('downloads a storagePath through an injected adapter and verifies its bytes', async () => {
    const storageSign = parsePublishedSign('lsc-co-agua', {
      ...sign,
      storagePath: 'lsc-co/signs/lsc-co-agua/v2/agua.motion.bin',
      semanticPath: 'lsc-co/signs/lsc-co-agua/v2/agua.semantic.json',
      profilePath: 'lsc-co/signs/lsc-co-agua/v2/agua.profile.json',
    });
    const status = mergeSignLanguageStatuses([language], [storageSign], state())[0];
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        approved: true,
        compiled: true,
        published: true,
        sha256: storageSign.sha256,
        profileSha256: storageSign.profileSha256,
        releaseSha256: storageSign.releaseSha256,
        sizeBytes: storageSign.sizeBytes,
        storagePath: storageSign.storagePath,
        semanticPath: storageSign.semanticPath,
        profilePath: storageSign.profilePath,
        avatarProfile: {version: 1},
      }),
    });
    const storageAdapter = {
      downloadToFile: jest.fn(async (_storagePath: string, destinationPath: string) => {
        mockFiles.set(destinationPath, 'storage-content');
      }),
    };

    await expect(installSignLanguageChanges(status, undefined, storageAdapter)).resolves.toBe(1);
    expect(storageAdapter.downloadToFile).toHaveBeenCalledWith(
      storageSign.storagePath,
      expect.stringContaining('.download'),
    );
    expect(require('react-native-fs').downloadFile).not.toHaveBeenCalled();
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
