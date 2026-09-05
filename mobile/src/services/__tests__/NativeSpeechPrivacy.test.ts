const fs = require('fs');
const path = require('path');

function mobileSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('native speech privacy contract', () => {
  it('uses an on-device Android recognizer without a network fallback', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('SpeechRecognizer.isOnDeviceRecognitionAvailable(this)');
    expect(source).toContain('SpeechRecognizer.createOnDeviceSpeechRecognizer(this)');
    expect(source).toContain('putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)');
    expect(source).not.toContain('SpeechRecognizer.createSpeechRecognizer(this)');
    expect(source).not.toContain('putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)');
  });

  it('requires on-device iOS recognition and checks device support', () => {
    const source = mobileSource('ios/Vozual/VozualSpeechRecognizer.m');

    expect(source).toContain('supportsOnDeviceRecognition');
    expect(source).toContain('requiresOnDeviceRecognition = YES');
  });

  it('does not fall back to the third-party iOS recognizer', () => {
    const source = mobileSource('src/components/ListenerScreen.tsx');

    expect(source).not.toContain("from '@react-native-voice/voice'");
    expect(source).not.toContain('Voice.');
    expect(source).toContain('OFFLINE_SPEECH_MESSAGE');
    expect(source).toContain('OFFLINE_SPEECH_ERRORS.has(event.error)');
  });
});
