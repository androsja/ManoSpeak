import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const listenerScreenSource = readFileSync(
  join(__dirname, '..', 'ListenerScreen.tsx'),
  'utf8',
);

describe('Listener speech confirmation contract', () => {
  it('keeps a final transcript pending until the user confirms, edits, or cancels it', () => {
    expect(listenerScreenSource).toMatch(/transcriptDraft/);
    expect(listenerScreenSource).toMatch(/transcriptConfirmationVisible/);
    expect(listenerScreenSource).toMatch(/requestTranscriptConfirmation\(phraseText\)/);
    expect(listenerScreenSource).toMatch(/confirmTranscript/);
    expect(listenerScreenSource).toMatch(/setTranscriptDraft/);
    expect(listenerScreenSource).toMatch(/cancelTranscriptConfirmation/);
    expect(listenerScreenSource).toMatch(/TextInput/);
  });

  it('requires an explicit ambiguity choice instead of flattening it to unsupported', () => {
    expect(listenerScreenSource).toMatch(/resolution\.status === 'ambiguous'/);
    expect(listenerScreenSource).toMatch(/setAmbiguousCandidates\(resolution\.candidates\)/);
    expect(listenerScreenSource).toMatch(/ambiguousCandidates\.map\(candidate/);
    expect(listenerScreenSource).toMatch(/handleText\(ambiguousTranscript, true, candidate\.id\)/);
  });

  it('never sends a recognizer final result straight to playback', () => {
    expect(listenerScreenSource).not.toMatch(
      /handleText\(phraseText,\s*isFinal\);/,
    );
  });

  it('keeps the avatar layout stable while a sign is playing', () => {
    expect(listenerScreenSource).not.toMatch(/styles\.playbackControls/);
    expect(listenerScreenSource).not.toMatch(/t\('listener\.replayingPhrase'\)/);
    expect(listenerScreenSource).not.toMatch(/togglePlaybackPause/);
  });

  it('plays each newly recognized repeated Android sign without replaying duplicate partials', () => {
    expect(listenerScreenSource).toMatch(/androidRecognizedWordsRef/);
    expect(listenerScreenSource).toMatch(/advanceIncrementalSpeechMatches\(/);
    expect(listenerScreenSource).toMatch(/signQueue\.current\.push\(\.\.\.newWords\.map\(word => word\.toUpperCase\(\)\)\)/);
    expect(listenerScreenSource).toMatch(/androidDirectSignVocabulary\(installedSigns\)/);
    expect(listenerScreenSource).toMatch(/isFinal \? recognizedSigns : nextRecognizedWords/);
    expect(listenerScreenSource).toMatch(/normalizeSpeech\(nextWord\)[\s\S]*?normalizeSpeech\(lastStartedSignRef\.current/);
  });

  it('keeps detected words in a fixed-height single-line strip', () => {
    expect(listenerScreenSource).toMatch(/numberOfLines=\{1\}/);
    expect(listenerScreenSource).toMatch(/detectedWordsCard: \{ height: 24/);
    expect(listenerScreenSource).toMatch(/detectedWordsText: \{[^}]*fontSize: 10/);
  });
});
