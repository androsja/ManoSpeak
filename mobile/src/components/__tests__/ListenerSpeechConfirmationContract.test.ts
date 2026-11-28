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

  it('plays each independent Android continuous result instead of treating it as cumulative', () => {
    expect(listenerScreenSource).toMatch(/standaloneSpeechMatches\(/);
    expect(listenerScreenSource).toMatch(/Sherpa continuous mode emits each VAD segment as its own final result/);
    expect(listenerScreenSource).toMatch(/advanceIncrementalSpeechMatches\(/);
    expect(listenerScreenSource).toMatch(/signQueue\.current\.push\(\.\.\.newWords\.map\(word => word\.toUpperCase\(\)\)\)/);
    expect(listenerScreenSource).toMatch(/androidDirectSignVocabulary\(installedSigns\)/);
    expect(listenerScreenSource).not.toMatch(/androidRecognizedWordsRef/);
    expect(listenerScreenSource).toMatch(/normalizeSpeech\(nextWord\)[\s\S]*?normalizeSpeech\(lastStartedSignRef\.current/);
  });

  it('keeps detected words visible across three lines', () => {
    expect(listenerScreenSource).toMatch(/numberOfLines=\{3\}/);
    expect(listenerScreenSource).toMatch(/detectedWordsCard: \{ minHeight: 56/);
    expect(listenerScreenSource).toMatch(/liveListeningIndicatorActive/);
    expect(listenerScreenSource).toMatch(/detectedWordsText: \{[^}]*fontSize: 12/);
  });

  it('keeps the speak button disabled on iOS until permissions are granted, then auto-starts', () => {
    expect(listenerScreenSource).toMatch(/iosPermissionsReady = Platform\.OS !== 'ios' \|\| iosPermissionsStatus === 'granted'/);
    expect(listenerScreenSource).toMatch(/speechButtonDisabled[\s\S]*?!iosPermissionsReady/);
    expect(listenerScreenSource).toMatch(/canAutoStart[\s\S]*?iosPermissionsStatus === 'granted'/);
  });
});
