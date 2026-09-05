import {
  AVAILABLE_PHRASE_SUGGESTIONS,
  nextPhraseSuggestionIndex,
  phraseSuggestionsForInstalledGlosses,
} from '../PhraseSuggestionService';
import {resolvePublishedLscPlan} from '../LinguisticCatalogService';

describe('PhraseSuggestionService', () => {
  it('offers only phrases made entirely from approved signs', () => {
    expect(AVAILABLE_PHRASE_SUGGESTIONS).toEqual([
      'Buenos días, amigo',
      'Buenas tardes, amigo',
      'Buenas noches, amigo',
      'Adiós, amigo',
      'Comer carne',
    ]);
    expect(resolvePublishedLscPlan('muchas gracias').tokens).toEqual([]);
  });

  it('filters phrases against the signs stored on the device', () => {
    expect(phraseSuggestionsForInstalledGlosses(new Set([
      'BUENOS DÍAS',
      'AMIGO',
    ]))).toEqual(['Buenos días, amigo']);
    expect(phraseSuggestionsForInstalledGlosses(new Set())).toEqual([]);
  });

  it('keeps a safe index for the currently available suggestions', () => {
    expect(nextPhraseSuggestionIndex(0, 0, 0)).toBe(0);
    expect(nextPhraseSuggestionIndex(0, 0.999, 1)).toBe(0);
    expect(nextPhraseSuggestionIndex(0, 0, 5)).toBe(1);
    expect(nextPhraseSuggestionIndex(0, 0.999, 5)).toBe(4);
  });
});
