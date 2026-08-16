import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Pressable,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  extractKnownSpeechWords,
  selectKnownSpeechAlternative,
} from '../services/VoiceCommandService';
import { AvatarClip, SkeletalAvatar } from './SkeletalAvatar';
import {PipSkeletalAvatar} from './PipSkeletalAvatar';
import publishedSigns from '../../assets/motions/published_signs.json';

// Only clips explicitly published to the mobile avatar belong here. A sign
// may be safely kept and edited in VOZUAL without becoming active on phones.
const KNOWN_WORDS = publishedSigns.publishedGlosses;
const PUBLISHED_SIGN_COUNT = publishedSigns.publishedGlosses.length;
type KnownWord = string;
type SpeechEvent = { value?: string[]; error?: string };
type PipSpeechEvent = SpeechEvent & {
  type?: 'start' | 'partialResults' | 'results' | 'end' | 'error';
};
type NativeVoiceModule = {
  startSpeech: (locale: string, options: Record<string, unknown>, callback: (error?: string) => void) => void;
  stopSpeech: (callback: (error?: string) => void) => void;
  cancelSpeech: (callback: (error?: string) => void) => void;
  destroySpeech: (callback: (error?: string) => void) => void;
};
type SpeechAudioModule = {
  silenceRecognitionPrompts: () => Promise<void>;
  restoreAudioAfter: (delayMillis: number) => void;
};
const nativeVoice = NativeModules.RCTVoice as NativeVoiceModule | undefined;
const speechAudio = NativeModules.SpeechAudio as SpeechAudioModule | undefined;
const pictureInPicture = NativeModules.VozualPictureInPicture as {
  enter: () => Promise<boolean>;
  isActive: () => Promise<boolean>;
  stopListeningService: () => Promise<boolean>;
  reportPlaybackEvent: (event: string, publishedGloss: string) => void;
} | undefined;

export function ListenerScreen() {
  const libraryHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>();
  const recognitionGeneration = useRef(0);
  const recognitionReadyRef = useRef(false);
  const lastRecognitionActivity = useRef(0);
  const nativeStartInFlight = useRef(false);
  const listeningRef = useRef(false);
  const playingRef = useRef(false);
  const pictureInPictureModeRef = useRef(false);
  // The foreground service owns recognition in PiP; RCTVoice owns it while
  // the activity is fully visible. They must never use the microphone at the
  // same time.
  const nativePipSpeechActiveRef = useRef(false);
  const signQueue = useRef<KnownWord[]>([]);
  const recognizedWords = useRef<KnownWord[]>([]);
  const [listening, setListening] = useState(false);
  const [recognitionReady, setRecognitionReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [playingSign, setPlayingSign] = useState(false);
  const [activeClip, setActiveClip] = useState<AvatarClip>('IDLE');
  const [playbackId, setPlaybackId] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [showLibraryHint, setShowLibraryHint] = useState(false);
  const [pictureInPictureMode, setPictureInPictureMode] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  // Remount the full WebView after leaving PiP. Android can keep the compact
  // surface dimensions during the first layout pass when returning from PiP.
  const [avatarLayoutEpoch, setAvatarLayoutEpoch] = useState(0);
  const compactMode = pictureInPictureMode;

  const applyPictureInPictureState = useCallback((compact: boolean) => {
    const wasCompact = pictureInPictureModeRef.current;
    pictureInPictureModeRef.current = compact;
    setPictureInPictureMode(compact);
    if (wasCompact && !compact) {
      setAvatarReady(false);
      setAvatarLayoutEpoch((value) => value + 1);
    }
  }, []);

  const syncPictureInPictureState = useCallback(async () => {
    if (!pictureInPicture) return;
    try {
      applyPictureInPictureState(Boolean(await pictureInPicture.isActive()));
    } catch {
      // Native PiP state events remain the fallback on older Android builds.
    }
  }, [applyPictureInPictureState]);

  const showPublishedSignCount = useCallback(() => {
    if (libraryHintTimer.current) clearTimeout(libraryHintTimer.current);
    setShowLibraryHint(true);
    libraryHintTimer.current = setTimeout(() => {
      libraryHintTimer.current = undefined;
      setShowLibraryHint(false);
    }, 2200);
  }, []);

  const playNextSign = useCallback(() => {
    if (playingRef.current) return;
    const word = signQueue.current.shift();
    if (!word) {
      setPlayingSign(false);
      return;
    }
    playingRef.current = true;
    pictureInPicture?.reportPlaybackEvent('play-sign', word);
    setActiveClip(word.toUpperCase() as AvatarClip);
    setPlaybackId((value) => value + 1);
    setPlayingSign(true);
  }, []);

  const handleText = useCallback((text: string) => {
    setTranscript(text);
    const words = extractKnownSpeechWords(text, KNOWN_WORDS) as KnownWord[];
    const previous = recognizedWords.current;
    const extendsPrevious = previous.every((word, index) => words[index] === word);
    if (extendsPrevious && words.length > previous.length) {
      const newWords = words.slice(previous.length);
      // Android can preserve a pending Home playback while the PiP surface is
      // being attached. PiP must favour the newly spoken word instead of
      // waiting for that invisible playback to finish.
      if (pictureInPictureModeRef.current) {
        signQueue.current = [];
        playingRef.current = false;
        setPlayingSign(false);
      }
      signQueue.current.push(...newWords);
      recognizedWords.current = words;
      playNextSign();
    } else if (words.length === 0) {
      recognizedWords.current = [];
    }
  }, [playNextSign]);

  const onSpeechResults = useCallback((event: SpeechEvent) => {
    const bestText = selectKnownSpeechAlternative(event.value, KNOWN_WORDS);
    if (!bestText) {
      handleText('');
      return;
    }
    const matches = extractKnownSpeechWords(bestText, KNOWN_WORDS);
    if (matches.length > 0) {
      pictureInPicture?.reportPlaybackEvent(
        'matched-speech',
        matches.join(', '),
      );
    }
    handleText(bestText);
  }, [handleText]);

  const startNativeSpeech = useCallback(async (
    options: Record<string, unknown>,
    callback: (error?: string) => void,
  ) => {
    try {
      await speechAudio?.silenceRecognitionPrompts();
    } catch {
      // Recognition still works when a device does not allow prompt silencing.
    }
    if (!nativeVoice) {
      callback('Speech recognition is unavailable.');
      return;
    }
    nativeVoice.startSpeech('es-CO', options, callback);
  }, []);

  const markRecognitionUnavailable = useCallback(() => {
    recognitionReadyRef.current = false;
    nativeStartInFlight.current = false;
    setRecognitionReady(false);
  }, []);

  const startActivityRecognition = useCallback(async () => {
    if (!listeningRef.current || nativePipSpeechActiveRef.current) return;
    const generation = recognitionGeneration.current;
    nativePipSpeechActiveRef.current = false;
    nativeStartInFlight.current = true;
    recognitionReadyRef.current = false;
    setRecognitionReady(false);
    lastRecognitionActivity.current = Date.now();
    await startNativeSpeech({
      EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
      EXTRA_MAX_RESULTS: 5,
      EXTRA_PARTIAL_RESULTS: true,
      VOZUAL_CONTINUOUS: true,
      REQUEST_PERMISSIONS_AUTO: true,
    }, (error) => {
      nativeStartInFlight.current = false;
      if (error && listeningRef.current && generation === recognitionGeneration.current) {
        listeningRef.current = false;
        setListening(false);
        setErrorMessage('No se pudo iniciar el reconocimiento de voz. Intenta activarlo nuevamente.');
      }
    });
  }, [startNativeSpeech]);

  const startListening = useCallback(async () => {
    if (listeningRef.current) return;
    nativePipSpeechActiveRef.current = false;
    setStarting(true);
    setErrorMessage('');
    try {
      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Permiso para usar el micrófono',
            message: 'VOZUAL necesita escuchar el habla para activar las señas del avatar.',
            buttonPositive: 'Permitir',
            buttonNegative: 'No permitir',
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          setErrorMessage('Debes permitir el micrófono en los ajustes del teléfono.');
          return;
        }
      }
      if (!nativeVoice) {
        setErrorMessage('El reconocimiento de voz no está disponible en este dispositivo.');
        return;
      }
      recognitionGeneration.current += 1;
      listeningRef.current = true;
      setListening(true);
      await startActivityRecognition();
    } catch (error) {
      listeningRef.current = false;
      markRecognitionUnavailable();
      setListening(false);
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar el reconocimiento de voz.');
    } finally {
      setStarting(false);
    }
  }, [markRecognitionUnavailable, startActivityRecognition]);

  const releaseActivityRecognition = useCallback(async () => {
    if (!nativeVoice) return;
    await new Promise<void>((resolve) => {
      nativeVoice.cancelSpeech(() => {
        nativeVoice.destroySpeech(() => resolve());
      });
    });
  }, []);

  const enterFloatingMode = useCallback(async () => {
    if (!avatarReady) {
      setErrorMessage('Espera a que termine de cargar el avatar.');
      return;
    }
    if (!pictureInPicture) {
      setErrorMessage('La ventana flotante no está disponible en este Android.');
      return;
    }
    // Obtain permission while the activity is visible, then hand recognition
    // to Android's microphone foreground service before entering PiP.
    if (!listeningRef.current) await startListening();
    if (!listeningRef.current) return;
    nativePipSpeechActiveRef.current = true;
    recognitionGeneration.current += 1;
    markRecognitionUnavailable();
    await releaseActivityRecognition();
    // PiP mounts a different avatar renderer. Do not carry an in-flight Home
    // animation into it: keeping playingRef true makes PiP enqueue recognised
    // words forever without ever calling playNextSign for them.
    signQueue.current = [];
    recognizedWords.current = [];
    playingRef.current = false;
    setPlayingSign(false);
    setActiveClip('IDLE');
    setPlaybackId((value) => value + 1);
    // Switch away from the WebGL WebView before Android takes the PiP
    // snapshot. Some devices deliver onPictureInPictureModeChanged after
    // the snapshot, which otherwise captures a black WebView surface.
    applyPictureInPictureState(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 220));
      const entered = await pictureInPicture.enter();
      if (!entered) {
        nativePipSpeechActiveRef.current = false;
        applyPictureInPictureState(false);
        setErrorMessage('No se pudo abrir la ventana flotante.');
        await startActivityRecognition();
      }
    } catch {
      nativePipSpeechActiveRef.current = false;
      applyPictureInPictureState(false);
      setErrorMessage('No se pudo abrir la ventana flotante.');
      await startActivityRecognition();
    }
  }, [
    applyPictureInPictureState,
    avatarReady,
    markRecognitionUnavailable,
    releaseActivityRecognition,
    startActivityRecognition,
    startListening,
  ]);

  const finishPictureInPictureSession = useCallback(async (reason: string) => {
    pictureInPicture?.reportPlaybackEvent('speech-fallback', reason);
    await pictureInPicture?.stopListeningService();
    nativePipSpeechActiveRef.current = false;
    recognitionReadyRef.current = false;
    setRecognitionReady(false);
    if (listeningRef.current) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await startActivityRecognition();
    }
  }, [startActivityRecognition]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'onVozualPictureInPictureChanged',
      (isInPictureInPictureMode: boolean) => {
        const compact = Boolean(isInPictureInPictureMode);
        applyPictureInPictureState(compact);
        if (isInPictureInPictureMode) {
          nativePipSpeechActiveRef.current = true;
          if (!listeningRef.current) void startListening();
        } else if (!isInPictureInPictureMode) {
          void finishPictureInPictureSession('left-pip');
        }
      },
    );
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void syncPictureInPictureState();
      setTimeout(() => void syncPictureInPictureState(), 250);
      setTimeout(() => void syncPictureInPictureState(), 750);
    });
    void syncPictureInPictureState();
    return () => {
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [applyPictureInPictureState, finishPictureInPictureSession, startListening, syncPictureInPictureState]);

  const stopListening = useCallback(async () => {
    // Disable the session before calling the native module: stop/cancel emit
    // end and error events, and those events must not resurrect recognition.
    listeningRef.current = false;
    nativePipSpeechActiveRef.current = false;
    recognitionGeneration.current += 1;
    markRecognitionUnavailable();
    recognizedWords.current = [];
    setTranscript('');
    setListening(false);
    setErrorMessage('');
    try {
      await pictureInPicture?.stopListeningService();
      await speechAudio?.silenceRecognitionPrompts();
      nativeVoice?.cancelSpeech(() => undefined);
      nativeVoice?.stopSpeech(() => undefined);
      speechAudio?.restoreAudioAfter(900);
    } finally {
      // UI and lifecycle state were already cleared synchronously above.
    }
  }, [markRecognitionUnavailable]);

  useEffect(() => {
    if (!nativeVoice) {
      setErrorMessage('El reconocimiento de voz no está disponible en este dispositivo.');
      return undefined;
    }
    const emitter = DeviceEventEmitter;
    const startSubscription = emitter.addListener('onSpeechStart', () => {
      if (nativePipSpeechActiveRef.current) return;
      nativeStartInFlight.current = false;
      recognitionReadyRef.current = true;
      lastRecognitionActivity.current = Date.now();
      setRecognitionReady(true);
      recognizedWords.current = [];
      setErrorMessage('');
    });
    const partialResultsSubscription = emitter.addListener(
      'onSpeechPartialResults',
      (event: SpeechEvent) => {
        if (nativePipSpeechActiveRef.current) return;
        lastRecognitionActivity.current = Date.now();
        onSpeechResults(event);
      },
    );
    const finalResultsSubscription = emitter.addListener('onSpeechResults', (event: SpeechEvent) => {
      if (nativePipSpeechActiveRef.current) return;
      lastRecognitionActivity.current = Date.now();
      onSpeechResults(event);
      markRecognitionUnavailable();
    });
    const errorSubscription = emitter.addListener('onSpeechError', (event: SpeechEvent) => {
      if (nativePipSpeechActiveRef.current) return;
      markRecognitionUnavailable();
      if (event.error) setErrorMessage('');
    });
    const endSubscription = emitter.addListener('onSpeechEnd', () => {
      if (nativePipSpeechActiveRef.current) return;
      // Android recognition is phrase-based: it normally ends after silence
      // even when the user still wants continuous listening.
      markRecognitionUnavailable();
    });
    const volumeSubscription = emitter.addListener('onSpeechVolumeChanged', () => {
      if (nativePipSpeechActiveRef.current) return;
      lastRecognitionActivity.current = Date.now();
    });
    const pipSpeechSubscription = emitter.addListener(
      'onVozualPipSpeechEvent',
      (event: PipSpeechEvent) => {
        if (!listeningRef.current || !nativePipSpeechActiveRef.current) {
          pictureInPicture?.reportPlaybackEvent('ignored-speech-event', event.type ?? '');
          return;
        }
        lastRecognitionActivity.current = Date.now();
        if (event.type === 'start') {
          recognitionReadyRef.current = true;
          setRecognitionReady(true);
          recognizedWords.current = [];
          setErrorMessage('');
          return;
        }
        if (event.type === 'partialResults' || event.type === 'results') {
          pictureInPicture?.reportPlaybackEvent(
            event.type === 'results' ? 'js-final-results' : 'js-partial-results',
            '',
          );
          onSpeechResults(event);
          return;
        }
        if (event.type === 'end' || event.type === 'error') {
          recognitionReadyRef.current = false;
          setRecognitionReady(false);
        }
      },
    );

    return () => {
      listeningRef.current = false;
      recognitionGeneration.current += 1;
      startSubscription.remove();
      partialResultsSubscription.remove();
      finalResultsSubscription.remove();
      errorSubscription.remove();
      endSubscription.remove();
      volumeSubscription.remove();
      pipSpeechSubscription.remove();
      nativeVoice?.destroySpeech(() => undefined);
      void pictureInPicture?.stopListeningService();
      speechAudio?.restoreAudioAfter(900);
      if (libraryHintTimer.current) clearTimeout(libraryHintTimer.current);
    };
  }, [markRecognitionUnavailable, onSpeechResults]);

  const onSignEnd = useCallback(() => {
    const nextWord = signQueue.current.shift();
    if (nextWord) {
      setActiveClip(nextWord.toUpperCase() as AvatarClip);
      setPlaybackId((value) => value + 1);
      return;
    }
    playingRef.current = false;
    setPlayingSign(false);
    // Wait in a neutral posture instead of holding the last sign's hand pose.
    setActiveClip('IDLE');
    setPlaybackId((value) => value + 1);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      {!compactMode && <View style={styles.header}>
        <View>
          <Text style={styles.logo}>VOZUAL</Text>
          <Text style={styles.subtitle}>TRADUCTOR DE HABLA A LSC</Text>
        </View>
      </View>}

      <View style={[styles.avatarCard, compactMode && styles.avatarCardCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${PUBLISHED_SIGN_COUNT} señas publicadas en esta app`}
          onPress={showPublishedSignCount}
          style={styles.avatarSignCountBadge}
        >
          <Text style={styles.signCountText}>{PUBLISHED_SIGN_COUNT}</Text>
        </Pressable>
        {showLibraryHint && (
          <View style={styles.avatarSignCountHint}>
            <Text style={styles.signCountHintText}>{PUBLISHED_SIGN_COUNT} señas publicadas</Text>
          </View>
        )}
        {compactMode ? (
          <PipSkeletalAvatar
            clip={activeClip}
            playbackId={playbackId}
            onClipEnd={onSignEnd}
          />
        ) : (
          <SkeletalAvatar
            key={`full-avatar-${avatarLayoutEpoch}`}
            clip={activeClip}
            playbackId={playbackId}
            onClipEnd={onSignEnd}
            onReady={() => setAvatarReady(true)}
          />
        )}
        {!compactMode && !playingSign && <Text style={styles.hint}>Di una palabra publicada para ver la seña</Text>}
      </View>

      {!compactMode && <View style={styles.panel}>
        <Text style={styles.title}>Escucha y traduce</Text>
        <Text style={styles.description}>
          Activa el micrófono. Cuando la app escuche una palabra conocida, verás su esqueleto de movimiento correspondiente.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, listening && styles.buttonActive]}
          onPress={listening ? stopListening : startListening}
          disabled={starting}
        >
          {starting ? <ActivityIndicator color="#07111F" /> : <Text style={styles.buttonText}>{listening ? 'DETENER ESCUCHA' : 'ACTIVAR MICRÓFONO'}</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir VOZUAL en una ventana flotante sobre otras aplicaciones"
          style={[styles.floatingButton, !avatarReady && styles.floatingButtonDisabled]}
          onPress={enterFloatingMode}
          disabled={!avatarReady}
        >
          <Text style={[styles.floatingButtonText, !avatarReady && styles.floatingButtonTextDisabled]}>
            {avatarReady ? 'ABRIR VENTANA FLOTANTE' : 'CARGANDO AVATAR…'}
          </Text>
        </Pressable>
        <Text style={styles.status}>
          {listening
            ? (recognitionReady ? 'ESCUCHANDO…' : 'RECONECTANDO MICRÓFONO…')
            : 'Micrófono detenido'}
        </Text>
        {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
        <Text style={styles.transcript}>{transcript || 'Aquí aparecerá lo que se escuche'}</Text>
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111F' },
  header: { paddingHorizontal: 24, paddingTop: (StatusBar.currentHeight ?? 0) + 16, paddingBottom: 10 },
  logo: { color: '#F7F9FC', fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: '#16D9D1', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  avatarCard: { flex: 1, margin: 16, borderRadius: 24, overflow: 'hidden', backgroundColor: '#202A38', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarCardCompact: { margin: 0, borderRadius: 0 },
  hint: { position: 'absolute', bottom: 20, color: '#D8E1EC', fontSize: 14 },
  panel: { padding: 24, paddingTop: 8 },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  description: { color: '#A9B8C9', lineHeight: 20, marginTop: 8 },
  avatarSignCountBadge: { position: 'absolute', top: 14, right: 14, zIndex: 3, minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, backgroundColor: '#16D9D1', alignItems: 'center', justifyContent: 'center' },
  signCountText: { color: '#07111F', fontSize: 14, fontWeight: '900' },
  avatarSignCountHint: { position: 'absolute', right: 14, top: 52, borderRadius: 8, backgroundColor: '#102337', borderWidth: 1, borderColor: '#1A4960', paddingVertical: 7, paddingHorizontal: 10, zIndex: 3 },
  signCountHintText: { color: '#D8E1EC', fontSize: 11, fontWeight: '700' },
  button: { marginTop: 18, borderRadius: 14, backgroundColor: '#16D9D1', paddingVertical: 16, alignItems: 'center' },
  buttonActive: { backgroundColor: '#FF5470' },
  buttonText: { color: '#07111F', fontWeight: '800', letterSpacing: 0.4 },
  floatingButton: { marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: '#16D9D1', paddingVertical: 13, alignItems: 'center' },
  floatingButtonDisabled: { borderColor: '#526174' },
  floatingButtonText: { color: '#16D9D1', fontWeight: '800', letterSpacing: 0.4 },
  floatingButtonTextDisabled: { color: '#7C899A' },
  status: { color: '#16D9D1', textAlign: 'center', fontSize: 11, fontWeight: '700', marginTop: 12 },
  transcript: { color: '#D8E1EC', textAlign: 'center', marginTop: 8, minHeight: 20 },
  error: { color: '#A9B8C9', textAlign: 'center', marginTop: 8, fontSize: 12 },
});
