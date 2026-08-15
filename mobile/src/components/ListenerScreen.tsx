import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  NativeModules,
  Pressable,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { extractKnownSpeechWords } from '../services/VoiceCommandService';
import { AvatarClip, SkeletalAvatar } from './SkeletalAvatar';
import publishedSigns from '../../assets/motions/published_signs.json';

// Only clips explicitly published to the mobile avatar belong here. A sign
// may be safely kept and edited in VOZUAL without becoming active on phones.
const KNOWN_WORDS = publishedSigns.publishedGlosses.map((gloss) => gloss.toLowerCase());
type KnownWord = string;
type SpeechEvent = { value?: string[]; error?: string };
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

export function ListenerScreen() {
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>();
  const recognitionGeneration = useRef(0);
  const listeningRef = useRef(false);
  const playingRef = useRef(false);
  const signQueue = useRef<KnownWord[]>([]);
  const recognizedWords = useRef<KnownWord[]>([]);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [playingSign, setPlayingSign] = useState(false);
  const [activeClip, setActiveClip] = useState<AvatarClip>('IDLE');
  const [playbackId, setPlaybackId] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const playNextSign = useCallback(() => {
    if (playingRef.current) return;
    const word = signQueue.current.shift();
    if (!word) {
      setPlayingSign(false);
      return;
    }
    playingRef.current = true;
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
      signQueue.current.push(...words.slice(previous.length));
      recognizedWords.current = words;
      playNextSign();
    } else if (words.length === 0) {
      recognizedWords.current = [];
    }
  }, [playNextSign]);

  const onSpeechResults = useCallback((event: SpeechEvent) => {
    handleText(event.value?.[0] ?? '');
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
    nativeVoice?.startSpeech('es-CO', options, callback);
  }, []);

  const startListening = useCallback(async () => {
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
      await startNativeSpeech({
        EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
        EXTRA_MAX_RESULTS: 5,
        EXTRA_PARTIAL_RESULTS: true,
        REQUEST_PERMISSIONS_AUTO: true,
      }, (error) => {
        if (error && listeningRef.current) {
          listeningRef.current = false;
          setListening(false);
          setErrorMessage('No se pudo activar el micrófono. Intenta nuevamente.');
        }
      });
      setListening(true);
    } catch (error) {
      listeningRef.current = false;
      setListening(false);
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar el reconocimiento de voz.');
    } finally {
      setStarting(false);
    }
  }, [startNativeSpeech]);

  const stopListening = useCallback(async () => {
    // Disable the session before calling the native module: stop/cancel emit
    // end and error events, and those events must not resurrect recognition.
    listeningRef.current = false;
    recognitionGeneration.current += 1;
    if (restartTimer.current) {
      clearTimeout(restartTimer.current);
      restartTimer.current = undefined;
    }
    recognizedWords.current = [];
    setTranscript('');
    setListening(false);
    setErrorMessage('');
    try {
      await speechAudio?.silenceRecognitionPrompts();
      nativeVoice?.cancelSpeech(() => undefined);
      nativeVoice?.stopSpeech(() => undefined);
      speechAudio?.restoreAudioAfter(900);
    } finally {
      // UI and lifecycle state were already cleared synchronously above.
    }
  }, []);

  useEffect(() => {
    if (!nativeVoice) {
      setErrorMessage('El reconocimiento de voz no está disponible en este dispositivo.');
      return undefined;
    }
    const emitter = DeviceEventEmitter;
    const restartRecognition = (delayMillis: number) => {
      if (!listeningRef.current) return;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      const generation = recognitionGeneration.current;
      restartTimer.current = setTimeout(() => {
        restartTimer.current = undefined;
        if (!nativeVoice || !listeningRef.current || generation !== recognitionGeneration.current) {
          return;
        }
        void startNativeSpeech({
          EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
          EXTRA_MAX_RESULTS: 5,
          EXTRA_PARTIAL_RESULTS: true,
        }, (error) => {
          // Some Android engines briefly report "recognizer busy" while the
          // previous phrase is closing. Keep the continuous-listening contract
          // by retrying, but only while this same user session remains active.
          if (error && listeningRef.current && generation === recognitionGeneration.current) {
            restartRecognition(650);
          }
        });
      }, delayMillis);
    };
    const startSubscription = emitter.addListener('onSpeechStart', () => {
      if (restartTimer.current) {
        clearTimeout(restartTimer.current);
        restartTimer.current = undefined;
      }
      recognizedWords.current = [];
      setErrorMessage('');
    });
    const partialResultsSubscription = emitter.addListener(
      'onSpeechPartialResults',
      onSpeechResults,
    );
    const finalResultsSubscription = emitter.addListener('onSpeechResults', (event: SpeechEvent) => {
      onSpeechResults(event);
      restartRecognition(350);
    });
    const errorSubscription = emitter.addListener('onSpeechError', (event: SpeechEvent) => {
      restartRecognition(500);
      if (event.error) setErrorMessage('');
    });
    const endSubscription = emitter.addListener('onSpeechEnd', () => {
      // Android recognition is phrase-based: it normally ends after silence
      // even when the user still wants continuous listening.
      restartRecognition(250);
    });
    return () => {
      listeningRef.current = false;
      recognitionGeneration.current += 1;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      startSubscription.remove();
      partialResultsSubscription.remove();
      finalResultsSubscription.remove();
      errorSubscription.remove();
      endSubscription.remove();
      nativeVoice?.destroySpeech(() => undefined);
      speechAudio?.restoreAudioAfter(900);
    };
  }, [onSpeechResults, startNativeSpeech]);

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
      <View style={styles.header}>
        <Text style={styles.logo}>VOZUAL</Text>
        <Text style={styles.subtitle}>TRADUCTOR DE HABLA A LSC</Text>
      </View>

      <View style={styles.avatarCard}>
        <SkeletalAvatar clip={activeClip} playbackId={playbackId} onClipEnd={onSignEnd} />
        {!playingSign && <Text style={styles.hint}>Di una palabra publicada para ver la seña</Text>}
      </View>

      <View style={styles.panel}>
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
        <Text style={styles.status}>{listening ? 'ESCUCHANDO…' : 'Micrófono detenido'}</Text>
        {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
        <Text style={styles.transcript}>{transcript || 'Aquí aparecerá lo que se escuche'}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111F' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 10 },
  logo: { color: '#F7F9FC', fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: '#16D9D1', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  avatarCard: { flex: 1, margin: 16, borderRadius: 24, overflow: 'hidden', backgroundColor: '#202A38', alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', bottom: 20, color: '#D8E1EC', fontSize: 14 },
  panel: { padding: 24, paddingTop: 8 },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  description: { color: '#A9B8C9', lineHeight: 20, marginTop: 8 },
  button: { marginTop: 18, borderRadius: 14, backgroundColor: '#16D9D1', paddingVertical: 16, alignItems: 'center' },
  buttonActive: { backgroundColor: '#FF5470' },
  buttonText: { color: '#07111F', fontWeight: '800', letterSpacing: 0.4 },
  status: { color: '#16D9D1', textAlign: 'center', fontSize: 11, fontWeight: '700', marginTop: 12 },
  transcript: { color: '#D8E1EC', textAlign: 'center', marginTop: 8, minHeight: 20 },
  error: { color: '#A9B8C9', textAlign: 'center', marginTop: 8, fontSize: 12 },
});
