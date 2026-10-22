import type {InstalledPhrase, InstalledSign} from './SignLanguageService';

/**
 * Remote phrase records become visible only after the complete reviewed sign
 * sequence has committed to local storage. This is deliberately defensive:
 * a partially restored library can never advertise a phrase it cannot play.
 */
export function phraseSuggestionsForInstalledLibrary(
  phrases: readonly InstalledPhrase[],
  signs: readonly Pick<InstalledSign, 'gloss'>[],
): string[] {
  const normalizedGlosses = new Set(
    signs.map(sign => sign.gloss.trim().toLocaleUpperCase('es-CO')),
  );
  return phrases
    .filter(phrase => phrase.glossSequence.every(
      gloss => normalizedGlosses.has(gloss),
    ))
    .map(phrase => phrase.spanish);
}

export function nextPhraseSuggestionIndex(
  currentIndex: number,
  randomValue = Math.random(),
  count = 0,
): number {
  if (count <= 1) return 0;
  const offset = 1 + Math.floor(Math.min(0.999999, Math.max(0, randomValue)) * (count - 1));
  return (currentIndex + offset) % count;
}
