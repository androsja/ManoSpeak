export function normalizeSpeech(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PictureInPictureTransition = 'entered' | 'left' | 'unchanged';

/** Distinguishes real PiP transitions from duplicate Android lifecycle events. */
export function resolvePictureInPictureTransition(
  wasActive: boolean,
  isActive: boolean,
): PictureInPictureTransition {
  if (!wasActive && isActive) return 'entered';
  if (wasActive && !isActive) return 'left';
  return 'unchanged';
}

/** Joins consecutive recognizer segments without duplicating a repeated prefix. */
export function mergeSpeechSegments(prefix: string, next: string): string {
  const normalizedPrefix = normalizeSpeech(prefix);
  const normalizedNext = normalizeSpeech(next);
  if (!normalizedPrefix) return normalizedNext;
  if (!normalizedNext) return normalizedPrefix;
  if (normalizedNext === normalizedPrefix || normalizedNext.startsWith(`${normalizedPrefix} `)) {
    return normalizedNext;
  }
  if (normalizedPrefix.startsWith(`${normalizedNext} `)) return normalizedPrefix;

  const prefixTokens = normalizedPrefix.split(' ');
  const nextTokens = normalizedNext.split(' ');
  const maximumOverlap = Math.min(prefixTokens.length, nextTokens.length);

  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const prefixSuffix = prefixTokens.slice(-overlap);
    const nextPrefix = nextTokens.slice(0, overlap);
    if (prefixSuffix.every((token, index) => token === nextPrefix[index])) {
      return [...prefixTokens, ...nextTokens.slice(overlap)].join(' ');
    }
  }

  return `${normalizedPrefix} ${normalizedNext}`;
}

export type IncrementalSpeechMatchUpdate<T extends string> = {
  newWords: T[];
  nextRecognizedWords: T[];
};

/**
 * Advances the signs already emitted for one recognizer utterance.
 * A final result closes the utterance so the same phrase can be emitted again.
 */
export function advanceIncrementalSpeechMatches<T extends string>(
  previous: readonly T[],
  current: readonly T[],
  isFinal: boolean,
): IncrementalSpeechMatchUpdate<T> {
  const extendsPrevious = previous.every(
    (word, index) => current[index] === word,
  );
  const newWords =
    extendsPrevious && current.length > previous.length
      ? current.slice(previous.length)
      : [];

  let nextRecognizedWords = [...previous];
  if (isFinal || current.length === 0) {
    nextRecognizedWords = [];
  } else if (newWords.length > 0) {
    nextRecognizedWords = [...current];
  }

  return {newWords: [...newWords], nextRecognizedWords};
}

export function speechContainsWord(text: string, word: string): boolean {
  const normalizedText = normalizeSpeech(text);
  const normalizedWord = normalizeSpeech(word);
  return normalizedWord.length > 0
    && normalizedText.split(' ').includes(normalizedWord);
}

type SpeechCandidate = {
  canonical: string;
  tokens: string[];
};

function speechCandidates(knownWords: SpeechVocabulary): SpeechCandidate[] {
  return knownWords.flatMap((entry) => {
    const canonical = typeof entry === 'string' ? entry : entry.gloss;
    const phrases = typeof entry === 'string' ? [entry] : [entry.gloss, ...(entry.aliases ?? [])];
    return phrases.map((phrase) => ({
      canonical,
      tokens: normalizeSpeech(phrase).split(' ').filter(Boolean),
    }));
  }).filter((candidate) => candidate.tokens.length > 0).sort(
    (first, second) => second.tokens.length - first.tokens.length,
  );
}

function speechMatchTokenCount(text: string, candidates: readonly SpeechCandidate[]): number {
  const spokenTokens = normalizeSpeech(text).split(' ').filter(Boolean);
  let tokenCount = 0;
  for (let index = 0; index < spokenTokens.length;) {
    const match = candidates.find((candidate) => candidate.tokens.every(
      (token, offset) => spokenTokens[index + offset] === token,
    ));
    if (!match) {
      index += 1;
      continue;
    }
    tokenCount += match.tokens.length;
    index += match.tokens.length;
  }
  return tokenCount;
}

export function extractKnownSpeechWords(
  text: string,
  knownWords: SpeechVocabulary,
): string[] {
  const candidates = speechCandidates(knownWords);
  const spokenTokens = normalizeSpeech(text).split(' ').filter(Boolean);
  const matches: string[] = [];

  for (let index = 0; index < spokenTokens.length;) {
    const match = candidates.find((candidate) => candidate.tokens.every(
      (token, offset) => spokenTokens[index + offset] === token,
    ));
    if (!match) {
      index += 1;
      continue;
    }
    matches.push(match.canonical);
    index += match.tokens.length;
  }
  return matches;
}

/**
 * A partial result may still be the beginning of another published sign. For
 * example, keep "no" pending while Android decides whether it becomes the
 * independently published expression "no entiendo". This applies to every
 * multi-word vocabulary entry, not to a hard-coded list of phrases.
 */
export function shouldDeferPartialSpeechMatch(
  text: string,
  knownWords: SpeechVocabulary,
): boolean {
  const spokenTokens = normalizeSpeech(text).split(' ').filter(Boolean);
  if (spokenTokens.length === 0) return false;
  const candidates = speechCandidates(knownWords);
  for (let start = 0; start < spokenTokens.length; start += 1) {
    const suffix = spokenTokens.slice(start);
    const exact = new Set(candidates.filter((candidate) =>
      candidate.tokens.length === suffix.length
      && candidate.tokens.every((token, index) => token === suffix[index]),
    ).map((candidate) => candidate.canonical));
    if (exact.size === 0) continue;
    if (candidates.some((candidate) => candidate.tokens.length > suffix.length
      && !exact.has(candidate.canonical)
      && suffix.every((token, index) => candidate.tokens[index] === token))) return true;
  }
  return false;
}

export function selectKnownSpeechAlternative(
  alternatives: readonly string[] | undefined,
  knownWords: SpeechVocabulary,
): string {
  if (!alternatives || alternatives.length === 0) return '';

  const candidates = speechCandidates(knownWords);
  return alternatives
    .map((text, index) => ({
      index,
      text,
      matchedTokens: speechMatchTokenCount(text, candidates),
      matchCount: extractKnownSpeechWords(text, knownWords).length,
    }))
    .sort((first, second) =>
      second.matchedTokens - first.matchedTokens
      || second.matchCount - first.matchCount
      || first.index - second.index,
    )[0].text;
}
export type SpeechSign = {
  gloss: string;
  aliases?: readonly string[];
};

type SpeechVocabulary = readonly (string | SpeechSign)[];
