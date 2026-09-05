import {resolvePublishedLscPlan} from './LinguisticCatalogService';

type CuratedPhraseSuggestion = {
  text: string;
  expectedGlosses: string[];
};

const CURATED_PHRASE_SUGGESTIONS: CuratedPhraseSuggestion[] = [
  {text: 'Buenos días, amigo', expectedGlosses: ['BUENOS DÍAS', 'AMIGO']},
  {text: 'Buenas tardes, amigo', expectedGlosses: ['BUENAS TARDES', 'AMIGO']},
  {text: 'Buenas noches, amigo', expectedGlosses: ['BUENAS NOCHES', 'AMIGO']},
  {text: 'Adiós, amigo', expectedGlosses: ['ADIÓS', 'AMIGO']},
  {text: 'Comer carne', expectedGlosses: ['COMER', 'CARNE']},
  {text: 'Hola, ¿cómo estás?', expectedGlosses: ['HOLA', '¿CÓMO ESTÁS?']},
  {text: 'Yo quiero comer carne', expectedGlosses: ['YO', 'QUERER', 'COMER', 'CARNE']},
  {text: 'Mamá quiere ir al hospital', expectedGlosses: ['MAMA', 'QUERER', 'IR', 'HOSPITAL']},
  {text: 'Yo tengo hambre', expectedGlosses: ['YO', 'TENER', 'HAMBRE']},
  {
    text: 'Yo no entiendo, por favor repite',
    expectedGlosses: ['YO', 'NO ENTIENDO', 'POR FAVOR', 'REPETIR'],
  },
  {text: 'Buenos días, mamá', expectedGlosses: ['BUENOS DÍAS', 'MAMA']},
  {text: 'Hoy estoy feliz', expectedGlosses: ['HOY', 'FELIZ']},
  {text: 'Él necesita ir al hospital', expectedGlosses: ['EL', 'NECESITAR', 'IR', 'HOSPITAL']},
  {
    text: 'Mañana quiero ir al hospital',
    expectedGlosses: ['MAÑANA', 'YO', 'QUERER', 'IR', 'HOSPITAL'],
  },
  {text: 'Por favor repite mi nombre', expectedGlosses: ['POR FAVOR', 'REPETIR', 'NOMBRE']},
];

function hasExpectedPublishedPlan(suggestion: CuratedPhraseSuggestion): boolean {
  const plan = resolvePublishedLscPlan(suggestion.text);
  const glosses = plan.tokens.map(token => token.gloss);
  return plan.unavailableMarkers.length === 0
    && glosses.length === suggestion.expectedGlosses.length
    && glosses.every((gloss, index) => gloss === suggestion.expectedGlosses[index]);
}

/** Suggestions are exposed only while every required animation is published. */
export const AVAILABLE_PHRASE_SUGGESTIONS = CURATED_PHRASE_SUGGESTIONS
  .filter(hasExpectedPublishedPlan)
  .map(suggestion => suggestion.text);

/** Keeps suggestions limited to signs the user chose to store locally. */
export function phraseSuggestionsForInstalledGlosses(
  installedGlosses: ReadonlySet<string>,
): string[] {
  const normalizedGlosses = new Set(
    [...installedGlosses].map(gloss => gloss.trim().toUpperCase()),
  );
  return CURATED_PHRASE_SUGGESTIONS
    .filter(hasExpectedPublishedPlan)
    .filter(suggestion => suggestion.expectedGlosses.every(
      gloss => normalizedGlosses.has(gloss),
    ))
    .map(suggestion => suggestion.text);
}

export function nextPhraseSuggestionIndex(
  currentIndex: number,
  randomValue = Math.random(),
  count = AVAILABLE_PHRASE_SUGGESTIONS.length,
): number {
  if (count <= 1) return 0;
  const offset = 1 + Math.floor(Math.min(0.999999, Math.max(0, randomValue)) * (count - 1));
  return (currentIndex + offset) % count;
}
