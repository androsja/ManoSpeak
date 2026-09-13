import {
  advanceIncrementalSpeechMatches,
  extractKnownSpeechWords,
  mergeSpeechSegments,
  normalizeSpeech,
  resolvePictureInPictureTransition,
  selectKnownSpeechAlternative,
  shouldDeferPartialSpeechMatch,
  speechContainsWord,
} from '../VoiceCommandService';

describe('advanceIncrementalSpeechMatches', () => {
  it('allows an identical final utterance after the previous utterance ends', () => {
    const partial = advanceIncrementalSpeechMatches<string>(
      [],
      ['HOLA'],
      false,
    );
    expect(partial).toEqual({
      newWords: ['HOLA'],
      nextRecognizedWords: ['HOLA'],
    });

    const firstFinal = advanceIncrementalSpeechMatches(
      partial.nextRecognizedWords,
      ['HOLA', '¿CÓMO ESTÁS?'],
      true,
    );
    expect(firstFinal).toEqual({
      newWords: ['¿CÓMO ESTÁS?'],
      nextRecognizedWords: [],
    });

    const repeatedFinal = advanceIncrementalSpeechMatches(
      firstFinal.nextRecognizedWords,
      ['HOLA', '¿CÓMO ESTÁS?'],
      true,
    );
    expect(repeatedFinal).toEqual({
      newWords: ['HOLA', '¿CÓMO ESTÁS?'],
      nextRecognizedWords: [],
    });
  });

  it('clears partial matches when the final result repeats them', () => {
    expect(
      advanceIncrementalSpeechMatches(['HOLA'], ['HOLA'], true),
    ).toEqual({
      newWords: [],
      nextRecognizedWords: [],
    });
  });
});

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

  it('waits for and prefers CÓMO ESTÁS over the individual CÓMO sign', () => {
    const vocabulary = [
      {gloss: 'CÓMO', aliases: ['como']},
      {gloss: '¿CÓMO ESTÁS?', aliases: ['como estas', 'cómo estás']},
    ];

    expect(shouldDeferPartialSpeechMatch('cómo', vocabulary)).toBe(true);
    expect(extractKnownSpeechWords('¿cómo estás?', vocabulary)).toEqual(['¿CÓMO ESTÁS?']);
    expect(shouldDeferPartialSpeechMatch('cómo estás', vocabulary)).toBe(false);
  });

  it('joins consecutive recognizer segments for a longer expression', () => {
    expect(mergeSpeechSegments('cómo', 'estás')).toBe('como estas');
    expect(mergeSpeechSegments('cómo', 'cómo estás')).toBe('como estas');
    expect(mergeSpeechSegments('hola cómo', 'cómo estás')).toBe('hola como estas');
    expect(mergeSpeechSegments('hola cómo estás', 'cómo estás')).toBe('hola como estas');
    expect(mergeSpeechSegments('hola', 'buenas tardes')).toBe('hola buenas tardes');
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

  it('ignores duplicate Android picture-in-picture lifecycle events', () => {
    expect(resolvePictureInPictureTransition(false, false)).toBe('unchanged');
    expect(resolvePictureInPictureTransition(true, true)).toBe('unchanged');
  });

  it('detects only real Android picture-in-picture transitions', () => {
    expect(resolvePictureInPictureTransition(false, true)).toBe('entered');
    expect(resolvePictureInPictureTransition(true, false)).toBe('left');
  });
});
