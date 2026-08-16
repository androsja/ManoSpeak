export function normalizeSpeech(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speechContainsWord(text: string, word: string): boolean {
  const normalizedText = normalizeSpeech(text);
  const normalizedWord = normalizeSpeech(word);
  return normalizedWord.length > 0
    && normalizedText.split(' ').includes(normalizedWord);
}

export function extractKnownSpeechWords(
  text: string,
  knownWords: readonly string[],
): string[] {
  const candidates = knownWords
    .map((word) => ({
      canonical: word,
      normalized: normalizeSpeech(word),
    }))
    .filter((candidate) => candidate.normalized.length > 0)
    // Prefer the longest phrase so "buenos días" is one sign rather than
    // two unrelated tokens when both expressions exist in a future catalog.
    .sort((first, second) => second.normalized.split(' ').length - first.normalized.split(' ').length);
  const spokenTokens = normalizeSpeech(text).split(' ').filter(Boolean);
  const matches: string[] = [];

  for (let index = 0; index < spokenTokens.length;) {
    const match = candidates.find((candidate) => {
      const phrase = candidate.normalized.split(' ');
      return phrase.every((token, offset) => spokenTokens[index + offset] === token);
    });
    if (!match) {
      index += 1;
      continue;
    }
    matches.push(match.canonical);
    index += match.normalized.split(' ').length;
  }
  return matches;
}

export function selectKnownSpeechAlternative(
  alternatives: readonly string[] | undefined,
  knownWords: readonly string[],
): string {
  if (!alternatives || alternatives.length === 0) return '';

  return alternatives
    .map((text, index) => ({
      index,
      text,
      matchCount: extractKnownSpeechWords(text, knownWords).length,
    }))
    .sort((first, second) =>
      second.matchCount - first.matchCount || first.index - second.index,
    )[0].text;
}
