import {
  extractKnownSpeechWords,
  normalizeSpeech,
  selectKnownSpeechAlternative,
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

  it('recognizes a published multi-word sign as one canonical clip name', () => {
    expect(extractKnownSpeechWords('Buenos dias, hola', ['BUENOS DÍAS', 'HOLA'])).toEqual([
      'BUENOS DÍAS',
      'HOLA',
    ]);
  });

  it('selects a later recognition alternative when it contains a published sign', () => {
    expect(selectKnownSpeechAlternative(
      ['ola', 'hola'],
      ['HOLA', 'GRACIAS'],
    )).toBe('hola');
  });

  it('preserves recognizer order when alternatives have the same match count', () => {
    expect(selectKnownSpeechAlternative(
      ['hola', 'gracias'],
      ['HOLA', 'GRACIAS'],
    )).toBe('hola');
  });

  it('returns an empty result when the recognizer supplies no alternatives', () => {
    expect(selectKnownSpeechAlternative(undefined, ['HOLA'])).toBe('');
  });
});
