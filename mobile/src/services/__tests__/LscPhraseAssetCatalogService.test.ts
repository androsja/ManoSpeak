import {
  type LscPhraseAssetCatalog,
  type LscPhraseAssetEntry,
  type InstalledLscAsset,
  LSC_PHRASE_ASSET_CATALOG,
  playableLscPhraseSuggestions,
  playableLscPhraseVocabulary,
  resolvePlayableLscPhrase,
  resolveReviewedLscPhrase,
  validateLscPhraseAssetCatalog,
} from '../LscPhraseAssetCatalogService';

const CHECKSUM = 'a'.repeat(64);

function approvedEntry(
  overrides: Partial<LscPhraseAssetEntry> = {},
): LscPhraseAssetEntry {
  return {
    id: 'greeting.hello',
    status: 'active',
    spanish: {
      variants: ['hola', 'buenas'],
      intendedMeaning: 'Greeting another person',
    },
    lsc: {
      glossSequence: ['HOLA_REVIEWED'],
      regionalVariant: 'Colombia; reviewer-recorded variant',
    },
    clips: [{id: 'clip.greeting.hello.v1', sha256: CHECKSUM}],
    licence: {status: 'verified', recordId: 'licence-record-1'},
    performerConsent: {
      status: 'granted',
      recordId: 'consent-record-1',
      version: '1',
    },
    review: {
      status: 'approved',
      reviewerId: 'lsc-reviewer-1',
      version: '1',
      reviewedAt: '2026-09-02T12:00:00Z',
    },
    ...overrides,
  };
}

function catalog(entries: LscPhraseAssetEntry[]): LscPhraseAssetCatalog {
  return {...LSC_PHRASE_ASSET_CATALOG, entries};
}

const installedAsset: InstalledLscAsset = {
  id: 'clip.greeting.hello.v1',
  gloss: 'HOLA_REVIEWED',
  sha256: CHECKSUM,
};

describe('LscPhraseAssetCatalogService', () => {
  it('keeps the production catalog closed until a reviewed phrase is available', () => {
    expect(validateLscPhraseAssetCatalog(LSC_PHRASE_ASSET_CATALOG)).toEqual({
      valid: true,
      activeEntries: [],
    });
    expect(resolveReviewedLscPhrase('hola')).toEqual(expect.objectContaining({
      status: 'unsupported',
      title: 'Frase no disponible',
    }));
  });

  it('resolves a complete confirmed phrase to its reviewed LSC sequence', () => {
    const result = resolveReviewedLscPhrase('  ¡HOLA!  ', catalog([approvedEntry()]));

    expect(result).toEqual(expect.objectContaining({
      status: 'matched',
      entry: expect.objectContaining({
        id: 'greeting.hello',
        lsc: {glossSequence: ['HOLA_REVIEWED'], regionalVariant: expect.any(String)},
        clips: [{id: 'clip.greeting.hello.v1', sha256: CHECKSUM}],
      }),
    }));
  });

  it('does not construct an unreviewed sequence from individual Spanish words', () => {
    const reviewed = catalog([
      approvedEntry({id: 'need', spanish: {variants: ['necesito'], intendedMeaning: 'Need'}}),
      approvedEntry({id: 'help', spanish: {variants: ['ayuda'], intendedMeaning: 'Help'}}),
    ]);

    expect(resolveReviewedLscPhrase('necesito ayuda', reviewed).status).toBe('unsupported');
  });

  it('requires every reviewed clip to be installed with the approved checksum and gloss', () => {
    const reviewed = catalog([approvedEntry()]);

    expect(resolvePlayableLscPhrase('hola', [installedAsset], reviewed).status).toBe('matched');
    expect(resolvePlayableLscPhrase('hola', [], reviewed)).toEqual(expect.objectContaining({
      status: 'unsupported',
      message: expect.stringContaining('no están instalados'),
    }));
    expect(resolvePlayableLscPhrase('hola', [{...installedAsset, sha256: 'b'.repeat(64)}], reviewed).status)
      .toBe('unsupported');
  });

  it('exposes speech vocabulary and suggestions only for playable reviewed phrases', () => {
    const reviewed = catalog([approvedEntry()]);

    expect(playableLscPhraseVocabulary([installedAsset], reviewed)).toEqual([{
      gloss: 'hola',
      aliases: ['buenas'],
    }]);
    expect(playableLscPhraseSuggestions([installedAsset], reviewed)).toEqual(['hola']);
    expect(playableLscPhraseVocabulary([], reviewed)).toEqual([]);
    expect(playableLscPhraseSuggestions([], reviewed)).toEqual([]);
  });

  it.each([
    ['review', {review: {status: 'pending', reviewerId: null, version: null, reviewedAt: null}}],
    ['licence', {licence: {status: 'pending', recordId: null}}],
    ['consent', {performerConsent: {status: 'pending', recordId: null, version: null}}],
    ['asset checksum', {clips: [{id: 'clip.greeting.hello.v1', sha256: ''}]}],
  ] as const)('rejects an active entry without complete %s evidence', (_name, overrides) => {
    const result = validateLscPhraseAssetCatalog(catalog([
      approvedEntry(overrides as Partial<LscPhraseAssetEntry>),
    ]));

    expect(result.valid).toBe(false);
    expect(result.activeEntries).toEqual([]);
  });

  it('rejects malformed runtime data without throwing', () => {
    const malformed = {
      ...LSC_PHRASE_ASSET_CATALOG,
      entries: [{id: 'broken', status: 'active'}],
    };

    expect(() => validateLscPhraseAssetCatalog(malformed)).not.toThrow();
    expect(validateLscPhraseAssetCatalog(malformed)).toEqual(expect.objectContaining({
      valid: false,
      activeEntries: [],
    }));
    expect(resolveReviewedLscPhrase('hola', malformed).status).toBe('unsupported');
  });

  it('rejects an active phrase whose ordered clips do not match its gloss sequence', () => {
    const result = validateLscPhraseAssetCatalog(catalog([
      approvedEntry({lsc: {glossSequence: ['HOLA_REVIEWED', 'AMIGO'], regionalVariant: 'Colombia'}}),
    ]));

    expect(result).toEqual(expect.objectContaining({valid: false, activeEntries: []}));
  });

  it('never plays candidate, rejected, or withdrawn records', () => {
    const statuses: LscPhraseAssetEntry['status'][] = ['candidate', 'in_review', 'rejected', 'withdrawn'];
    statuses.forEach((status) => {
      expect(resolveReviewedLscPhrase('hola', catalog([approvedEntry({status})])).status)
        .toBe('unsupported');
    });
  });

  it('requires a choice when one Spanish form has two approved meanings', () => {
    const result = resolveReviewedLscPhrase('buenas', catalog([
      approvedEntry(),
      approvedEntry({id: 'greeting.general'}),
    ]));

    expect(result).toEqual({
      status: 'ambiguous',
      candidates: [
        {id: 'greeting.hello', intendedMeaning: 'Greeting another person'},
        {id: 'greeting.general', intendedMeaning: 'Greeting another person'},
      ],
      message: 'Esta frase puede tener más de un significado en LSC. Elige una opción del catálogo.',
    });
  });

  it('resolves the explicitly selected approved meaning when a phrase is ambiguous', () => {
    const reviewed = catalog([
      approvedEntry(),
      approvedEntry({id: 'greeting.general'}),
    ]);

    expect(resolvePlayableLscPhrase(
      'buenas',
      [installedAsset],
      reviewed,
      'greeting.general',
    )).toEqual(expect.objectContaining({
      status: 'matched',
      entry: expect.objectContaining({id: 'greeting.general'}),
    }));
  });
});
