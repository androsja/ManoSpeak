import {
  extractKnownSpeechWords,
  normalizeSpeech,
  speechContainsWord,
} from '../VoiceCommandService';

describe('VoiceCommandService', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeSpeech('¡HÓLA, cómo estás!')).toBe('hola como estas');
  });

  it('matches a complete word and not a substring', () => {
    expect(speechContainsWord('hola, buenos días', 'hola')).toBe(true);
    expect(speechContainsWord('holanda', 'hola')).toBe(false);
  });

  it('extracts every known word in spoken order', () => {
    expect(extractKnownSpeechWords('Hola, gracias', ['hola', 'gracias'])).toEqual([
      'hola',
      'gracias',
    ]);
  });

  it('preserves repeated known words and ignores unknown words', () => {
    expect(extractKnownSpeechWords('hola mundo hola', ['hola', 'gracias'])).toEqual([
      'hola',
      'hola',
    ]);
  });
});
