import catalogJson from '../../assets/data/lsc_linguistic_catalog.json';
import publishedSignsJson from '../../assets/motions/published_signs.json';
import {normalizeSpeech, type SpeechSign} from './VoiceCommandService';

export type LscVerbType =
  | 'none'
  | 'plain'
  | 'directional_review_required'
  | 'spatial_review_required';

export type LinguisticEntry = {
  id: string;
  gloss: string;
  categories: string[];
  lexicalClass: string;
  spanish: {
    lemmas: string[];
    synonyms: string[];
    forms: Array<{text: string}>;
    overrideDefaults?: boolean;
  };
  lsc: {
    verbType: LscVerbType;
    requiresSubjectMarker: boolean;
  };
  motion: {
    clip: string;
    published: boolean;
  };
  review: {
    status: string;
    regionalVariants: string[];
    ownerApproval?: {
      status: 'pending' | 'approved';
      approvedBy: string;
      approvedAt: string | null;
    };
  };
};

export type LscPlanToken = {
  gloss: string;
  source: 'lexical';
  categories: string[];
  verbType: LscVerbType;
  requiresSubjectMarker: boolean;
};

export type PublishedLscPlan = {
  tokens: LscPlanToken[];
  unavailableMarkers: string[];
};

export type InstalledLinguisticSign = {
  languageId: string;
  gloss: string;
  speechAliases: readonly string[];
  categories: readonly string[];
  lexicalClass: string;
  verbType: LscVerbType;
  requiresSubjectMarker: boolean;
};

type LinguisticCatalog = {
  version: number;
  language: 'LSC';
  grammar?: {
    subjectMarkers?: Record<string, string>;
    spanishVerbForms?: Record<string, string>;
    temporalMarkers?: Record<string, string>;
  };
  entries: LinguisticEntry[];
};

const CATALOG = catalogJson as LinguisticCatalog;
const GRAMMAR = CATALOG.grammar ?? {};
const OWNER_APPROVED_CLIPS = new Set<string>(publishedSignsJson.publishedGlosses);

function uniquePhrases(entry: LinguisticEntry): string[] {
  return Array.from(new Set([
    entry.gloss,
    ...entry.spanish.lemmas,
    ...entry.spanish.synonyms,
    ...entry.spanish.forms.map((form) => form.text),
  ].map((phrase) => phrase.trim()).filter(Boolean)));
}

const publishedClips = new Set<string>();
export const PUBLISHED_LSC_ENTRIES = CATALOG.entries.filter((entry) => {
  if (
    !entry.motion.published
    || entry.review.status === 'blocked'
    || entry.review.ownerApproval?.status !== 'approved'
    || !OWNER_APPROVED_CLIPS.has(entry.motion.clip)
  ) return false;
  // One physical animation can have historical linguistic records with the
  // same clip (for example ÉL and the non-sign article EL). The mobile
  // library and its counter must represent playable animations, not rows.
  if (publishedClips.has(entry.motion.clip)) return false;
  publishedClips.add(entry.motion.clip);
  return true;
});

export const PUBLISHED_LSC_SPEECH_VOCABULARY: SpeechSign[] = PUBLISHED_LSC_ENTRIES.map(
  (entry) => ({
    gloss: entry.motion.clip,
    aliases: uniquePhrases(entry),
  }),
);

export const PUBLISHED_LSC_SIGN_COUNT = PUBLISHED_LSC_ENTRIES.length;

const ENTRY_BY_CLIP = new Map(
  PUBLISHED_LSC_ENTRIES.map((entry) => [entry.motion.clip, entry]),
);
const ENTRY_BY_NORMALIZED_CLIP = new Map(
  CATALOG.entries.map((entry) => [normalizeSpeech(entry.motion.clip), entry]),
);
function catalogEntryForGloss(gloss: string): LinguisticEntry | undefined {
  return ENTRY_BY_CLIP.get(gloss) ?? ENTRY_BY_NORMALIZED_CLIP.get(normalizeSpeech(gloss));
}
const SUBJECT_MARKER_GLOSSES = new Set(Object.values(GRAMMAR.subjectMarkers ?? {}));

type SpeechCandidate = {
  entry: LinguisticEntry;
  normalized: string;
};

const SPEECH_CANDIDATES: SpeechCandidate[] = PUBLISHED_LSC_ENTRIES.flatMap((entry) =>
  uniquePhrases(entry).map((phrase) => ({entry, normalized: normalizeSpeech(phrase)})),
).filter((candidate) => candidate.normalized.length > 0).sort(
  (first, second) => second.normalized.split(' ').length - first.normalized.split(' ').length,
);

function tokenFor(entry: LinguisticEntry): LscPlanToken {
  return {
    gloss: entry.motion.clip,
    source: 'lexical',
    categories: entry.categories,
    verbType: entry.lsc.verbType,
    requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
  };
}

function hasExplicitSubjectInCurrentClause(tokens: readonly LscPlanToken[]): boolean {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const entry = ENTRY_BY_CLIP.get(token.gloss);
    if (entry?.lsc.requiresSubjectMarker) return false;
    // A lexical noun in subject position ("médico come") already supplies
    // the subject. Do not manufacture an additional pronoun sign from the
    // Spanish verb ending. Negation and other non-verbal function signs can
    // appear between the noun and verb, so inspect the current clause.
    if (
      SUBJECT_MARKER_GLOSSES.has(token.gloss)
      || entry?.lexicalClass === 'pronoun'
      || entry?.lexicalClass === 'noun'
    ) return true;
  }
  return false;
}

function isInstalled(entry: LinguisticEntry, installedGlosses?: ReadonlySet<string>): boolean {
  return installedGlosses == null || installedGlosses.has(entry.motion.clip.trim().toUpperCase());
}

function candidateAt(
  words: readonly string[],
  index: number,
  installedGlosses?: ReadonlySet<string>,
): SpeechCandidate | undefined {
  return SPEECH_CANDIDATES.find(({entry, normalized}) => {
    if (!isInstalled(entry, installedGlosses)) return false;
    const phrase = normalized.split(' ');
    return phrase.every((word, offset) => words[index + offset] === word);
  });
}

const NON_SIGN_FUNCTION_WORDS = new Set([
  'a', 'ante', 'bajo', 'cabe', 'con', 'contra', 'de', 'desde', 'durante',
  'en', 'entre', 'hacia', 'hasta', 'para', 'por', 'segun', 'sin', 'sobre',
  'tras', 'la', 'las', 'los', 'un', 'una', 'unos', 'unas', 'y', 'o',
]);

function isThirdPersonPronounEl(
  words: readonly string[],
  index: number,
  installedGlosses?: ReadonlySet<string>,
): boolean {
  if (words[index] !== 'el') return false;
  const following = candidateAt(words, index + 1, installedGlosses);
  // Speech recognition normally removes accents. Keep EL only in the one
  // context where it is a pronoun: immediately before a verb ("él come").
  // In every other context it is the article "el" and has no LSC token.
  return Boolean(following && following.entry.lexicalClass === 'verb');
}

/**
 * Keeps speech matching separate from LSC rendering. The current avatar plays
 * approved lexical clips only; verb direction and spatial agreement remain
 * explicit metadata until a Deaf-led review approves their parameterization.
 */
export function planPublishedLscGlosses(glosses: readonly string[]): LscPlanToken[] {
  return glosses.flatMap((gloss) => {
    const entry = ENTRY_BY_CLIP.get(gloss);
    if (!entry) return [];
    return [{
      gloss: entry.motion.clip,
      source: 'lexical',
      categories: entry.categories,
      verbType: entry.lsc.verbType,
      requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
    }];
  });
}

/**
 * Converts recognized Spanish into the currently renderable LSC plan. It only
 * inserts a person or time marker when an approved clip exists; unavailable
 * grammar is reported for authoring instead of being invented by the avatar.
 */
export function resolvePublishedLscPlan(
  text: string,
  installedGlosses?: ReadonlySet<string>,
): PublishedLscPlan {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  const tokens: LscPlanToken[] = [];
  const unavailableMarkers: string[] = [];

  for (let index = 0; index < words.length;) {
    // A multi-word alias may begin with a Spanish function word, e.g.
    // "hasta luego" → ADIÓS. Always try the complete vocabulary first.
    const candidate = candidateAt(words, index, installedGlosses);
    if (!candidate && NON_SIGN_FUNCTION_WORDS.has(words[index])) {
      index += 1;
      continue;
    }
    if (!candidate && words[index] === 'el' && !isThirdPersonPronounEl(words, index, installedGlosses)) {
      index += 1;
      continue;
    }
    if (!candidate) {
      const temporalGloss = GRAMMAR.temporalMarkers?.[words[index]];
      const temporalEntry = temporalGloss ? ENTRY_BY_CLIP.get(temporalGloss) : undefined;
      if (temporalGloss && (!temporalEntry || !isInstalled(temporalEntry, installedGlosses))) {
        unavailableMarkers.push(temporalGloss);
      }
      index += 1;
      continue;
    }

    const subjectKey = GRAMMAR.spanishVerbForms?.[candidate.normalized];
    const subjectGloss = subjectKey ? GRAMMAR.subjectMarkers?.[subjectKey] : undefined;
    if (candidate.entry.lsc.requiresSubjectMarker && subjectGloss) {
      const subjectEntry = ENTRY_BY_CLIP.get(subjectGloss);
      if (subjectEntry && isInstalled(subjectEntry, installedGlosses) && !hasExplicitSubjectInCurrentClause(tokens)) {
        tokens.push(tokenFor(subjectEntry));
      } else if (!subjectEntry || !isInstalled(subjectEntry, installedGlosses)) {
        unavailableMarkers.push(subjectGloss);
      }
    }
    tokens.push(tokenFor(candidate.entry));
    index += candidate.normalized.split(' ').length;
  }
  return {tokens, unavailableMarkers: Array.from(new Set(unavailableMarkers))};
}

export function findPublishedLscEntry(gloss: string): LinguisticEntry | undefined {
  return ENTRY_BY_CLIP.get(gloss);
}

type InstalledSpeechCandidate = {
  sign: InstalledLinguisticSign;
  normalized: string;
};

function installedSpeechCandidates(
  signs: readonly InstalledLinguisticSign[],
): InstalledSpeechCandidate[] {
  return signs.flatMap(sign => Array.from(new Set([
    sign.gloss,
    ...sign.speechAliases,
    ...(catalogEntryForGloss(sign.gloss)?.spanish
      ? uniquePhrases(catalogEntryForGloss(sign.gloss) as LinguisticEntry)
      : []),
  ])).map(phrase => ({
    sign,
    normalized: normalizeSpeech(phrase),
  }))).filter(candidate => candidate.normalized.length > 0).sort(
    (first, second) => second.normalized.split(' ').length - first.normalized.split(' ').length,
  );
}

function installedCandidateAt(
  words: readonly string[],
  index: number,
  candidates: readonly InstalledSpeechCandidate[],
): InstalledSpeechCandidate | undefined {
  return candidates.find(candidate => candidate.normalized.split(' ').every(
    (word, offset) => words[index + offset] === word,
  ));
}

function installedToken(sign: InstalledLinguisticSign): LscPlanToken {
  return {
    gloss: sign.gloss,
    source: 'lexical',
    categories: [...sign.categories],
    verbType: sign.verbType,
    requiresSubjectMarker: sign.requiresSubjectMarker,
  };
}

function installedPlanHasSubject(
  tokens: readonly LscPlanToken[],
  signsByGloss: ReadonlyMap<string, InstalledLinguisticSign>,
): boolean {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const sign = signsByGloss.get(tokens[index].gloss);
    if (sign?.requiresSubjectMarker) return false;
    if (
      SUBJECT_MARKER_GLOSSES.has(tokens[index].gloss)
      || sign?.lexicalClass === 'pronoun'
      || sign?.lexicalClass === 'noun'
    ) return true;
  }
  return false;
}

export function speechVocabularyForInstalledSigns(
  signs: readonly InstalledLinguisticSign[],
): SpeechSign[] {
  return signs.map(sign => ({
    gloss: sign.gloss,
    aliases: Array.from(new Set([
      sign.gloss,
      ...sign.speechAliases,
      ...(catalogEntryForGloss(sign.gloss)
        ? uniquePhrases(catalogEntryForGloss(sign.gloss) as LinguisticEntry)
        : []),
    ])),
  }));
}

/**
 * Plans speech exclusively from the metadata that arrived with downloaded
 * signs. This lets a newly approved sign work without shipping a new APK.
 * LSC receives the reviewed grammar helpers; other languages remain lexical
 * until their own grammar rules are explicitly implemented and reviewed.
 */
export function resolveInstalledSignPlan(
  text: string,
  signs: readonly InstalledLinguisticSign[],
): PublishedLscPlan {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  const candidates = installedSpeechCandidates(signs);
  const signsByGloss = new Map(signs.map(sign => [sign.gloss, sign]));
  const isLsc = signs.length > 0 && signs.every(sign => sign.languageId === 'lsc-co');
  const tokens: LscPlanToken[] = [];
  const unavailableMarkers: string[] = [];

  for (let index = 0; index < words.length;) {
    const candidate = installedCandidateAt(words, index, candidates);
    if (
      !candidate
      && isLsc
      && NON_SIGN_FUNCTION_WORDS.has(words[index])
    ) {
      index += 1;
      continue;
    }
    if (
      !candidate
      &&
      isLsc
      && words[index] === 'el'
      && installedCandidateAt(words, index + 1, candidates)?.sign.lexicalClass !== 'verb'
    ) {
      index += 1;
      continue;
    }
    if (!candidate) {
      const temporalGloss = isLsc ? GRAMMAR.temporalMarkers?.[words[index]] : undefined;
      if (temporalGloss && !signsByGloss.has(temporalGloss)) {
        unavailableMarkers.push(temporalGloss);
      }
      index += 1;
      continue;
    }

    if (isLsc && candidate.sign.requiresSubjectMarker) {
      const subjectKey = GRAMMAR.spanishVerbForms?.[candidate.normalized];
      const subjectGloss = subjectKey ? GRAMMAR.subjectMarkers?.[subjectKey] : undefined;
      if (subjectGloss && !installedPlanHasSubject(tokens, signsByGloss)) {
        const subjectSign = signsByGloss.get(subjectGloss);
        if (subjectSign) tokens.push(installedToken(subjectSign));
        else unavailableMarkers.push(subjectGloss);
      }
    }
    tokens.push(installedToken(candidate.sign));
    index += candidate.normalized.split(' ').length;
  }

  return {tokens, unavailableMarkers: Array.from(new Set(unavailableMarkers))};
}
