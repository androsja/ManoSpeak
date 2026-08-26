import {
  AVAILABLE_PHRASE_SUGGESTIONS,
  nextPhraseSuggestionIndex,
} from '../PhraseSuggestionService';
import {resolvePublishedLscPlan} from '../LinguisticCatalogService';

describe('PhraseSuggestionService', () => {
  it('offers only phrases backed by multiple published signs', () => {
    expect(AVAILABLE_PHRASE_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
    for (const phrase of AVAILABLE_PHRASE_SUGGESTIONS) {
      const plan = resolvePublishedLscPlan(phrase);
      expect(plan.unavailableMarkers).toEqual([]);
      expect(plan.tokens.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('selects a different phrase when alternatives are available', () => {
    expect(nextPhraseSuggestionIndex(0, 0)).toBe(1);
    expect(nextPhraseSuggestionIndex(0, 0.999)).not.toBe(0);
  });
});
