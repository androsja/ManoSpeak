import {
  nextPhraseSuggestionIndex,
  phraseSuggestionsForInstalledLibrary,
} from '../PhraseSuggestionService';
import type {InstalledPhrase, InstalledSign} from '../SignLanguageService';

describe('PhraseSuggestionService', () => {
  it('offers only remotely downloaded phrases whose signs are stored on the device', () => {
    const phrases: InstalledPhrase[] = [{
      id: 'lsc-co-buenos-dias-amigo',
      languageId: 'lsc-co',
      version: 1,
      spanish: 'Buenos días, amigo.',
      glossSequence: ['BUENOS DÍAS', 'AMIGO'],
      releaseSha256: 'a'.repeat(64),
      installedAt: '2026-09-26T00:00:00.000Z',
    }];
    const signs: Pick<InstalledSign, 'gloss'>[] = [
      {gloss: 'BUENOS DÍAS'},
      {gloss: 'AMIGO'},
    ];

    expect(phraseSuggestionsForInstalledLibrary(phrases, signs))
      .toEqual(['Buenos días, amigo.']);
    expect(phraseSuggestionsForInstalledLibrary(phrases, [])).toEqual([]);
  });

  it('keeps a safe index for the currently available suggestions', () => {
    expect(nextPhraseSuggestionIndex(0, 0, 0)).toBe(0);
    expect(nextPhraseSuggestionIndex(0, 0.999, 1)).toBe(0);
    expect(nextPhraseSuggestionIndex(0, 0, 5)).toBe(1);
    expect(nextPhraseSuggestionIndex(0, 0.999, 5)).toBe(4);
  });
});
