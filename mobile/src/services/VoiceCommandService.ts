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
  const known = new Set(knownWords.map(normalizeSpeech).filter(Boolean));
  return normalizeSpeech(text)
    .split(' ')
    .filter((word) => word.length > 0 && known.has(word));
}
