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
    expect(source).toContain('listOf("es-CO", "es-US", "es-ES")');
    expect(source).not.toContain('SpeechRecognizer.createSpeechRecognizer(this)');
    expect(source).not.toContain('putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)');
  });

  it('never resurrects an Android microphone session without another user action', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('return START_NOT_STICKY');
    expect(source).not.toContain('return START_STICKY');
    expect(source).toContain('override fun onTaskRemoved(rootIntent: Intent?)');
    expect(source).toContain('ERROR_INSUFFICIENT_PERMISSIONS');
    expect(source).toContain('ERROR_MICROPHONE_PERMISSION_DENIED');
    expect(source).toContain('ContextCompat.checkSelfPermission');
  });

  it('recovers an Android recognition cycle that stops delivering callbacks', () => {
    const source = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/VoiceListeningService.kt',
    );

    expect(source).toContain('private var recognitionWatchdog: Runnable? = null');
    expect(source).toContain('reason = "missing-result-after-end-of-speech"');
    expect(source).toContain('TERMINAL_CALLBACK_TIMEOUT_MILLIS = 4_000L');
    expect(source).toContain('RECOGNITION_STALL_TIMEOUT_MILLIS = 20_000L');
    expect(source).toContain('recreate = true');
    expect(source).toContain('cancelRecognitionWatchdog()');
  });

  it('rejects a missing local recognizer before starting a foreground service', () => {
    const moduleSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/PictureInPictureModule.kt',
    );
    const availabilityCheck = moduleSource.indexOf('if (!hasOnDeviceSpeechRecognizer())');
    const foregroundStart = moduleSource.indexOf(
      'ContextCompat.startForegroundService',
      moduleSource.indexOf('fun startListeningService'),
    );

    expect(moduleSource).toContain('SpeechRecognizer.isOnDeviceRecognitionAvailable');
    expect(moduleSource).toContain('VoiceListeningService.isActive()');
    expect(moduleSource).toContain('Settings.ACTION_VOICE_INPUT_SETTINGS');
    expect(availabilityCheck).toBeGreaterThan(-1);
    expect(foregroundStart).toBeGreaterThan(availabilityCheck);
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
  });

  it('does not fall back to the third-party iOS recognizer', () => {
    const source = mobileSource('src/components/ListenerScreen.tsx');

    expect(source).not.toContain("from '@react-native-voice/voice'");
    expect(source).not.toContain('Voice.');
    expect(source).toContain('OFFLINE_SPEECH_MESSAGE');
    expect(source).toContain('OFFLINE_SPEECH_ERRORS.has(event.error)');
  });
});
