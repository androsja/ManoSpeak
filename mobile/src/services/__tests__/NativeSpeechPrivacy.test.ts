const fs = require('fs');
const path = require('path');

function mobileSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('native speech privacy contract', () => {
  it('uses the local Sherpa recognizer and Silero VAD without a network fallback', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('OfflineRecognizer(');
    expect(source).toContain('OfflineNemoEncDecCtcModelConfig');
    expect(source).toContain('SileroVadModelConfig(');
    expect(source).toContain('AudioRecord(');
    expect(source).toContain('MediaRecorder.AudioSource.VOICE_RECOGNITION');
    expect(source).toContain('provider = "cpu"');
    expect(source).toContain('El reconocimiento se realiza localmente en este teléfono.');
    expect(source).not.toMatch(/SpeechRecognizer|RecognizerIntent|OkHttpClient|HttpURLConnection/);
  });

  it('does not restart microphone capture after the service is stopped or removed', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('return START_NOT_STICKY');
    expect(source).not.toContain('return START_STICKY');
    expect(source).toContain('override fun onTaskRemoved(rootIntent: Intent?)');
    expect(source).toContain('stopSelf()');
    expect(source).toContain('stopRequested.set(true)');
    expect(source).toContain('ContextCompat.checkSelfPermission');
    expect(source).toContain('ERROR_MICROPHONE_PERMISSION_DENIED');
  });

  it('releases the microphone, VAD, and recognizer when its local capture loop ends', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('private fun runCaptureLoop()');
    expect(source).toContain('audioRecord?.release()');
    expect(source).toContain('recognizer?.release()');
    expect(source).toContain('vad?.release()');
    expect(source).toContain('sendSpeechEvent(EVENT_ERROR');
  });

  it('rejects a missing Sherpa model before starting a foreground service', () => {
    const moduleSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/PictureInPictureModule.kt',
    );
    const modelCheck = moduleSource.indexOf('if (!hasLocalSherpaModel())');
    const foregroundStart = moduleSource.indexOf(
      'ContextCompat.startForegroundService',
      moduleSource.indexOf('fun startListeningService'),
    );

    expect(moduleSource).toContain('VoiceListeningService.hasModelFiles(reactApplicationContext)');
    expect(moduleSource).toContain('VoiceListeningService.isActive()');
    expect(moduleSource).toContain('El modelo de reconocimiento local de VOZUAL no está instalado');
    expect(modelCheck).toBeGreaterThan(-1);
    expect(foregroundStart).toBeGreaterThan(modelCheck);
    expect(moduleSource).not.toContain('SpeechRecognizer');
  });

  it('exposes user-visible Android controls for an active microphone service', () => {
    const serviceSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );
    const manifest = mobileSource('android/app/src/main/AndroidManifest.xml');
    const listenerSource = mobileSource('src/components/ListenerScreen.tsx');

    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android:foregroundServiceType="microphone"');
    expect(serviceSource).toContain('ACTION_STOP_LISTENING');
    expect(serviceSource).toContain('.addAction(android.R.drawable.ic_media_pause, "Detener"');
    expect(serviceSource).toContain('sendSpeechEvent(EVENT_STOPPED)');
    expect(listenerSource).toContain('PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS');
    expect(listenerSource).toContain('Linking.openSettings()');
    expect(listenerSource).toContain("event.type === 'stopped'");
    expect(listenerSource).toContain('MICROPHONE_PERMISSION_ERROR');
  });

  it('requires on-device iOS recognition and checks device support', () => {
    const source = mobileSource('ios/Vozual/VozualSpeechRecognizer.m');

    expect(source).toContain('supportsOnDeviceRecognition');
    expect(source).toContain('requiresOnDeviceRecognition = YES');
    expect(source).toContain('segment.confidence');
    expect(source).toContain('self.authorizing');
    expect(source).toContain('self.audioTapInstalled');
    expect(source).toContain('consecutiveErrorCount');
  });

  it('sends local speech segments to installed-sign matching without cloud transcription', () => {
    const androidService = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );
    const listenerSource = mobileSource('src/components/ListenerScreen.tsx');

    expect(androidService).toContain('sendSpeechEvent(EVENT_PARTIAL_RESULTS, arrayListOf(joined))');
    expect(androidService).toContain('sendSpeechEvent(EVENT_RESULTS, arrayListOf(phrase))');
    expect(listenerSource).toContain('extractKnownSpeechWords(bestText, knownWords)');
    expect(listenerSource).toContain('androidDirectSignVocabulary(installedSigns)');
    expect(listenerSource).toContain('newlyMatchedOccurrences: newWords.length');
    expect(listenerSource).not.toContain('SpeechRecognizer.CONFIDENCE_SCORES');
  });

  it('does not fall back to the third-party iOS recognizer', () => {
    const source = mobileSource('src/components/ListenerScreen.tsx');

    expect(source).not.toContain("from '@react-native-voice/voice'");
    expect(source).not.toContain('Voice.');
    expect(source).toContain('OFFLINE_SPEECH_MESSAGE');
    expect(source).toContain('OFFLINE_SPEECH_ERRORS.has(event.error)');
  });
});
