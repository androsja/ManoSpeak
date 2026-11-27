import {
  advanceIncrementalSpeechMatches,
  advanceRevisableSpeechMatches,
  androidDirectSignVocabulary,
  extractKnownSpeechWords,
  mergeSpeechSegments,
  normalizeSpeech,
  resolvePictureInPictureTransition,
  selectKnownSpeechAlternative,
  standaloneSpeechMatches,
  shouldDeferSpeechMatch,
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

  it('queues each repeated sign occurrence once as partial results grow', () => {
    const vocabulary = [{gloss: 'ADIÓS', aliases: ['adiós']}];
    const repeatedWords = extractKnownSpeechWords('adiós adiós', vocabulary);
    const firstPartial = advanceIncrementalSpeechMatches(
      [],
      extractKnownSpeechWords('adiós', vocabulary),
      false,
    );
    expect(firstPartial.newWords).toEqual(['ADIÓS']);

    const repeatedPartial = advanceIncrementalSpeechMatches(
      firstPartial.nextRecognizedWords,
      extractKnownSpeechWords('adiós adiós', vocabulary),
      false,
    );
    expect(repeatedPartial.newWords).toEqual(['ADIÓS']);

    const duplicateCallback = advanceIncrementalSpeechMatches(
      repeatedPartial.nextRecognizedWords,
      extractKnownSpeechWords('adiós adiós', vocabulary),
      false,
    );
    expect(duplicateCallback.newWords).toEqual([]);

    const finalResult = advanceIncrementalSpeechMatches(
      duplicateCallback.nextRecognizedWords,
      repeatedWords,
      true,
    );
    expect(finalResult).toEqual({newWords: [], nextRecognizedWords: []});

    expect(advanceIncrementalSpeechMatches([], repeatedWords, true).newWords).toEqual([
      'ADIÓS',
      'ADIÓS',
    ]);
  });
});

describe('advanceRevisableSpeechMatches', () => {
  it('keeps a stable first word and adds later words as Apple expands a partial', () => {
    const firstPartial = advanceRevisableSpeechMatches<string>([], ['UNO'], false);
    expect(firstPartial).toEqual({
      newWords: ['UNO'],
      nextRecognizedWords: ['UNO'],
    });

    const settledLongerPartial = advanceRevisableSpeechMatches(
      firstPartial.nextRecognizedWords,
      ['UNO', 'DOS', 'TRES'],
      false,
    );
    expect(settledLongerPartial).toEqual({
      newWords: ['DOS', 'TRES'],
      nextRecognizedWords: ['UNO', 'DOS', 'TRES'],
    });

    expect(advanceRevisableSpeechMatches(
      settledLongerPartial.nextRecognizedWords,
      ['UNO', 'DOS', 'TRES'],
      true,
    )).toEqual({
      newWords: [],
      nextRecognizedWords: [],
    });
  });
});

describe('standaloneSpeechMatches', () => {
  it('plays each independent Android final result, including repeated signs', () => {
    expect(standaloneSpeechMatches(['TRES'], true)).toEqual({
      newWords: ['TRES'],
      nextRecognizedWords: [],
    });
    expect(standaloneSpeechMatches(['CUATRO'], true)).toEqual({
      newWords: ['CUATRO'],
      nextRecognizedWords: [],
    });
    expect(standaloneSpeechMatches(['TRES'], true)).toEqual({
      newWords: ['TRES'],
      nextRecognizedWords: [],
    });
  });

  it('does not enqueue a partial callback before its final segment result', () => {
    expect(standaloneSpeechMatches(['TRES'], false)).toEqual({
      newWords: [],
      nextRecognizedWords: [],
    });
  });
});

describe('VoiceCommandService', () => {
  it('exposes every installed sign and its aliases to Android continuous listening', () => {
    expect(androidDirectSignVocabulary([
      {gloss: 'ADIÓS', speechAliases: ['adios', 'chao'], categories: ['despedidas'], lexicalClass: 'interjection'},
      {gloss: 'UNO', speechAliases: ['uno'], categories: ['numeros_cantidades'], lexicalClass: 'numeral'},
      {gloss: 'DOS', speechAliases: ['dos'], categories: ['numeros_cantidades'], lexicalClass: 'numeral'},
      {gloss: 'MUCHO', speechAliases: ['mucho'], categories: ['numeros_cantidades'], lexicalClass: 'adjective'},
      {gloss: 'HOLA', speechAliases: ['hola'], categories: ['saludos'], lexicalClass: 'interjection'},
      {gloss: 'COMER', speechAliases: ['comer', 'come', 'comes', 'comía'], categories: ['acciones'], lexicalClass: 'verb'},
    ])).toEqual([
      {gloss: 'ADIÓS', aliases: ['adios', 'chao']},
      {gloss: 'UNO', aliases: ['uno']},
      {gloss: 'DOS', aliases: ['dos']},
      {gloss: 'MUCHO', aliases: ['mucho']},
      {gloss: 'HOLA', aliases: ['hola']},
      {gloss: 'COMER', aliases: ['comer', 'come', 'comes', 'comía']},
    ]);
  });

  it('keeps digit aliases from the installed Firebase sign metadata', () => {
    const vocabulary = androidDirectSignVocabulary([
      {gloss: 'UNO', speechAliases: ['uno', '1'], categories: ['numeros_cantidades'], lexicalClass: 'numeral'},
      {gloss: 'DOS', speechAliases: ['dos', '2'], categories: ['numeros_cantidades'], lexicalClass: 'numeral'},
    ]);

    expect(vocabulary).toEqual([
      {gloss: 'UNO', aliases: ['uno', '1']},
      {gloss: 'DOS', aliases: ['dos', '2']},
    ]);
    expect(extractKnownSpeechWords('1 y dos', vocabulary)).toEqual(['UNO', 'DOS']);
  });

  it('normalizes accents and punctuation', () => {
    expect(normalizeSpeech('¡HÓLA, cómo estás!')).toBe('hola como estas');
  });

  it('matches recognized digits to the installed Spanish number signs', () => {
    const vocabulary = [
      {gloss: 'UNO', aliases: ['uno']},
      {gloss: 'DOS', aliases: ['dos']},
      {gloss: 'TRES', aliases: ['tres']},
      {gloss: 'CUATRO', aliases: ['cuatro']},
      {gloss: 'CINCO', aliases: ['cinco']},
    ];

    expect(extractKnownSpeechWords('1 2 3 4 5', vocabulary)).toEqual([
      'UNO',
      'DOS',
      'TRES',
      'CUATRO',
      'CINCO',
    ]);
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

  it('resolves a final alias even when it can start a longer expression', () => {
    const vocabulary = [
      {gloss: 'COMER', aliases: ['como']},
      {gloss: '¿CÓMO ESTÁS?', aliases: ['como estas']},
    ];

    expect(shouldDeferPartialSpeechMatch('yo como', vocabulary)).toBe(true);
    expect(shouldDeferSpeechMatch('yo como', vocabulary, false, false)).toBe(true);
    expect(shouldDeferSpeechMatch('yo como', vocabulary, true, false)).toBe(false);
    expect(shouldDeferSpeechMatch('yo como', vocabulary, true, true)).toBe(true);
  });

  it('joins consecutive recognizer segments for a longer expression', () => {
    expect(mergeSpeechSegments('cómo', 'estás')).toBe('como estas');
    expect(mergeSpeechSegments('cómo', 'cómo estás')).toBe('como estas');
    expect(mergeSpeechSegments('hola cómo', 'cómo estás')).toBe('hola como estas');
    expect(mergeSpeechSegments('hola cómo estás', 'cómo estás')).toBe('hola como estas');
    expect(mergeSpeechSegments('hola', 'buenas tardes')).toBe('hola buenas tardes');
  });

  it('maps common forms of a verb to its canonical sign clip', () => {
    const vocabulary = androidDirectSignVocabulary([{
      gloss: 'COMER',
      speechAliases: ['comer', 'come', 'comes', 'comemos', 'comen', 'comía', 'comían'],
      categories: ['acciones'],
      lexicalClass: 'verb',
    }]);

    expect(extractKnownSpeechWords(
      'comer, come, comes, comemos, comen, comía y comían',
      vocabulary,
    )).toEqual([
      'COMER',
      'COMER',
      'COMER',
      'COMER',
      'COMER',
      'COMER',
      'COMER',
    ]);
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
