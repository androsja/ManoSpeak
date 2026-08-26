import {
  extractKnownSpeechWords,
  normalizeSpeech,
  selectKnownSpeechAlternative,
  shouldDeferPartialSpeechMatch,
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

  it('prefers every published expression over its individual words', () => {
    const vocabulary = [
      {gloss: 'NO', aliases: ['no']},
      {gloss: 'NO ENTIENDO', aliases: ['no entiendo']},
    ];
    expect(extractKnownSpeechWords('no entiendo', vocabulary)).toEqual(['NO ENTIENDO']);
    expect(shouldDeferPartialSpeechMatch('no', vocabulary)).toBe(true);
    expect(shouldDeferPartialSpeechMatch('no entiendo', vocabulary)).toBe(false);
  });

  it('maps verb conjugations to one canonical sign clip', () => {
    expect(extractKnownSpeechWords('yo necesito ayuda y nosotros necesitamos agua', [{
      gloss: 'NECESITAR',
      aliases: ['necesito', 'necesitas', 'necesita', 'necesitamos'],
    }])).toEqual(['NECESITAR', 'NECESITAR']);
  });

  it('selects a later recognition alternative when it contains a published sign', () => {
    expect(selectKnownSpeechAlternative(
      ['ola', 'hola'],
      ['HOLA', 'GRACIAS'],
    )).toBe('hola');
  });

  it('selects the alternative with the most matched phrase words', () => {
    expect(selectKnownSpeechAlternative(
      ['no', 'no entiendo'],
      [
        {gloss: 'NO', aliases: ['no']},
        {gloss: 'NO ENTIENDO', aliases: ['no entiendo']},
      ],
    )).toBe('no entiendo');
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
