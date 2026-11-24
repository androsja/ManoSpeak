import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  DeviceEventEmitter,
  Linking,
  Modal,
  NativeEventEmitter,
  NativeModules,
  Pressable,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {
  advanceIncrementalSpeechMatches,
  androidDirectSignVocabulary,
  extractKnownSpeechWords,
  mergeSpeechSegments,
  resolvePictureInPictureTransition,
  selectKnownSpeechAlternative,
  standaloneSpeechMatches,
  shouldDeferSpeechMatch,
  normalizeSpeech,
} from '../services/VoiceCommandService';
import type {InstalledPhrase, InstalledSign} from '../services/SignLanguageService';
import {
  playableLscPhraseVocabulary,
  playableLscPhraseSuggestions,
} from '../services/LscPhraseAssetCatalogService';
import {resolveRuntimeLscPlayback} from '../services/LscRuntimePlaybackService';
import {
  deriveListenerFlowState,
  listenerFlowAccessibilityLabel,
} from '../services/ListenerFlowState';
import {PHRASE_CONTINUATION_GRACE_MS} from '../services/SignPhraseContinuity';
import {nextPhraseSuggestionIndex} from '../services/PhraseSuggestionService';
import { AvatarClip, AvatarRenderMode, SkeletalAvatar } from './SkeletalAvatar';
import {PipSkeletalAvatar} from './PipSkeletalAvatar';
import type {ActivationAccount} from '../services/ActivationService';
import {messageForAccountDeletionError} from '../services/ActivationErrorMessage';
import type {AppAccessConfig} from '../services/AppAccessConfigService';
import {
  VOZUAL_ACCOUNT_DELETION_URL,
  VOZUAL_PRIVACY_POLICY_URL,
} from '../services/PrivacyPolicyService';
import {resolveAccessPolicy} from '../services/AccessPolicyService';
import {
  emptyUsagePeriod,
  loadLocalUsage,
  recordActiveTranslationSeconds,
  type UsagePeriod,
} from '../services/UsageMeterService';
import {BillingSandboxSheet} from './BillingSandboxSheet';
import {
  activateBillingSandboxEntitlement,
  clearBillingSandboxEntitlement,
  emptyBillingSandboxEntitlement,
  loadBillingSandboxEntitlement,
  type BillingPlan,
  type BillingSandboxEntitlement,
} from '../services/BillingSandboxService';
import {SUPPORTED_APP_LOCALES, useI18n} from '../i18n/I18n';
// The shared linguistic catalog controls what speech can activate a published
// avatar clip. A clip may stay in VOZUAL without entering this vocabulary.
const PLAYBACK_SPEEDS = [0.5, 1, 2, 3, 4] as const;
const PLAYBACK_SPEED_PREFERENCE_PATH = `${RNFS.DocumentDirectoryPath}/vozual-playback-speed.json`;
const LISTENER_TUTORIAL_PATH = `${RNFS.DocumentDirectoryPath}/vozual-listener-tutorial-v1.json`;
const AVATAR_ZOOM_MIN = 0.85;
const AVATAR_ZOOM_MAX = 1.3;
const AVATAR_ZOOM_STEP = 0.05;
const DEFAULT_AVATAR_ZOOM = 1;
const CONTINUOUS_PREFIX_WAIT_MS = 1200;
const MIN_FINAL_SPEECH_CONFIDENCE = 0.55;
type ListeningMode = 'continuous' | 'phrase';
// Reviewed LSC playback requires a person to confirm the transcript first.
// Continuous mode remains unavailable until it can preserve that boundary.
const LISTENING_MODES: readonly ListeningMode[] = ['phrase'];
const AVATAR_RENDER_MODES: readonly AvatarRenderMode[] = ['points', 'rigged'];
type KnownWord = string;
type SpeechEvent = {
  value?: string[];
  confidence?: number[];
  error?: string | {code?: string | number; message?: string};
};
type IosNativeSpeechEndEvent = {
  willRestart?: boolean;
  reason?: string;
};
type PipSpeechEvent = SpeechEvent & {
  type?: 'start' | 'partialResults' | 'results' | 'end' | 'error' | 'stopped';
};
const OFFLINE_SPEECH_ERRORS = new Set([
  'offline_speech_unavailable',
  'offline_es_co_unavailable',
  'sherpa_model_missing',
]);
const OFFLINE_SPEECH_MESSAGE = 'El modelo de reconocimiento local de VOZUAL no está instalado. Descarga el paquete de voz sin conexión y vuelve a intentarlo.';
const MICROPHONE_PERMISSION_ERROR = 'microphone_permission_denied';
function speechDebug(event: string, details?: unknown): void {
  if (__DEV__) console.info(`[VozualSpeech] ${event}`, details ?? '');
}
function speechErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as {message?: unknown}).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function isOfflineSpeechUnavailable(error: unknown): boolean {
  const message = speechErrorMessage(error).toLocaleLowerCase('es-CO');
  return message.includes('reconocimiento local') || message.includes('no admite reconocimiento de voz local');
}
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
type IosSpeechRecognizerModule = {
  start: (locale: string, mode: ListeningMode) => Promise<boolean>;
  stop: () => Promise<boolean>;
  finishPhrase: () => Promise<boolean>;
  isListening: () => Promise<boolean>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};
const nativeVoice = NativeModules.RCTVoice as NativeVoiceModule | undefined;
const speechAudio = NativeModules.SpeechAudio as SpeechAudioModule | undefined;
const iosSpeechRecognizer = NativeModules.VozualSpeechRecognizer as IosSpeechRecognizerModule | undefined;
const pictureInPicture = NativeModules.VozualPictureInPicture as {
  enter: () => Promise<boolean>;
  isActive: () => Promise<boolean>;
  startListeningService: () => Promise<boolean>;
  isListeningServiceReady?: () => Promise<boolean>;
  stopListeningService: () => Promise<boolean>;
  finishListeningPhrase: () => Promise<boolean>;
  enqueueSigns: (glosses: string[]) => void;
  resetPlayback: () => void;
  setPlaybackPaused: (paused: boolean) => void;
  setListeningMode: (mode: ListeningMode, microphoneActive: boolean) => void;
  openSpeechSettings?: () => Promise<boolean>;
  setAvatarPresentation: (renderMode: AvatarRenderMode, avatarZoom: number, playbackSpeed: number) => void;
  reportPlaybackEvent: (event: string, publishedGloss: string) => void;
} | undefined;

type ListenerScreenProps = {
  account?: ActivationAccount | null;
  accessConfig: AppAccessConfig;
  hasPlusEntitlement?: boolean;
  installedSigns?: readonly InstalledSign[];
  installedPhrases?: readonly InstalledPhrase[];
  availableSignChangeCount?: number;
  onManageAccount?: () => void;
  onManageSignLanguages?: () => void;
  onSignOut?: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
};

export function ListenerScreen({
  account,
  accessConfig,
  hasPlusEntitlement = false,
  installedSigns = [],
  installedPhrases: _installedPhrases = [],
  availableSignChangeCount = 0,
  onManageAccount,
  onManageSignLanguages,
  onSignOut,
  onDeleteAccount,
}: ListenerScreenProps) {
  const {locale, setLocale, t} = useI18n();
  const phraseContinuationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phraseFinalizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deferredSpeechTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deferredSpeechPrefix = useRef('');
  const iosRecognitionRestartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startActivityRecognitionRef = useRef<() => Promise<void>>(async () => undefined);
  const iosLastSpeechEvent = useRef<SpeechEvent | undefined>(undefined);
  const iosFinalResultHandled = useRef(false);
  const recognitionGeneration = useRef(0);
  const recognitionReadyRef = useRef(false);
  const lastRecognitionActivity = useRef(0);
  const nativeStartInFlight = useRef(false);
  const listeningStartInFlight = useRef(false);
  const autoListeningAttempted = useRef(false);
  const listeningRef = useRef(false);
  const listeningModeRef = useRef<ListeningMode>('phrase');
  const phrasePartialTextRef = useRef('');
  const playingRef = useRef(false);
  const phraseInProgressRef = useRef(false);
  const lastStartedSignRef = useRef<KnownWord | undefined>(undefined);
  const pictureInPictureModeRef = useRef(false);
  const nativePictureInPictureEventRef = useRef(false);
  const usageRemainderMillisRef = useRef(0);
  // One Android-owned foreground service owns the microphone in both Home
  // and PiP. React Native only renders state and forwards recognized text.
  const nativePipSpeechActiveRef = useRef(false);
  const signQueue = useRef<KnownWord[]>([]);
  const recognizedWords = useRef<KnownWord[]>([]);
  const [listening, setListening] = useState(false);
  const [listeningMode, setListeningMode] = useState<ListeningMode>('phrase');
  const [phraseFinalizing, setPhraseFinalizing] = useState(false);
  const [recognitionReady, setRecognitionReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptConfirmationVisible, setTranscriptConfirmationVisible] = useState(false);
  const [ambiguousTranscript, setAmbiguousTranscript] = useState('');
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<Array<{
    id: string;
    intendedMeaning: string;
  }>>([]);
  const [plannedLsc, setPlannedLsc] = useState('');
  const [playingSign, setPlayingSign] = useState(false);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(2);
  const [avatarZoom, setAvatarZoom] = useState(DEFAULT_AVATAR_ZOOM);
  const [avatarRenderMode, setAvatarRenderMode] = useState<AvatarRenderMode>('rigged');
  const [activeClip, setActiveClip] = useState<AvatarClip>('IDLE');
  const [playbackId, setPlaybackId] = useState(0);
  const [continuePhrase, setContinuePhrase] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [microphonePermissionBlocked, setMicrophonePermissionBlocked] = useState(false);
  const [notificationPermissionBlocked, setNotificationPermissionBlocked] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [licensesVisible, setLicensesVisible] = useState(false);
  const [accountActionPending, setAccountActionPending] = useState(false);
  const [accountActionError, setAccountActionError] = useState('');
  const [phraseSuggestionIndex, setPhraseSuggestionIndex] = useState(0);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [pictureInPictureMode, setPictureInPictureMode] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  // Remount the full WebView after leaving PiP. Android can keep the compact
  // surface dimensions during the first layout pass when returning from PiP.
  const [avatarLayoutEpoch, setAvatarLayoutEpoch] = useState(0);
  const [usagePeriod, setUsagePeriod] = useState<UsagePeriod>(() => emptyUsagePeriod());
  const [billingSandboxVisible, setBillingSandboxVisible] = useState(false);
  const [billingSandboxFeedback, setBillingSandboxFeedback] = useState('');
  const [billingSandboxEntitlement, setBillingSandboxEntitlement] = useState<BillingSandboxEntitlement>(
    () => emptyBillingSandboxEntitlement(),
  );
  const compactMode = pictureInPictureMode;
  const microphonePreparing = listening && !recognitionReady;
  // Android may report a terminal recognition error while the asynchronous
  // start request is still unwinding. A terminal session must never leave the
  // primary action visually busy: only render its spinner while a session is
  // still active.
  const speechActionBusy = starting || (listening && phraseFinalizing);
  const speechButtonDisabled = speechActionBusy || (!listening && (!avatarReady || playingSign));
  const listenerFlowState = useMemo(() => deriveListenerFlowState({
    listening,
    starting,
    phraseFinalizing,
    transcriptConfirmationVisible,
    ambiguousCandidateCount: ambiguousCandidates.length,
    playingSign,
    microphonePermissionBlocked,
    notificationPermissionBlocked,
    hasError: Boolean(errorMessage),
  }), [
    ambiguousCandidates.length,
    errorMessage,
    listening,
    microphonePermissionBlocked,
    notificationPermissionBlocked,
    phraseFinalizing,
    playingSign,
    starting,
    transcriptConfirmationVisible,
  ]);
  const reportPlaybackDiagnostic = useCallback((event: string, value: string) => {
    pictureInPicture?.reportPlaybackEvent(event, value);
  }, []);
  const phraseSuggestions = useMemo(
    () => playableLscPhraseSuggestions(installedSigns),
    [installedSigns],
  );
  const phraseSuggestion = phraseSuggestions.length > 0
    ? phraseSuggestions[phraseSuggestionIndex % phraseSuggestions.length]
    : '';
  const androidAutoVocabulary = useMemo(
    () => androidDirectSignVocabulary(installedSigns),
    [installedSigns],
  );
  const androidAutoSignsAvailable = Platform.OS === 'android' && androidAutoVocabulary.length > 0;
  const knownWords = useMemo(() => {
    if (Platform.OS === 'android') return androidAutoVocabulary;
    return playableLscPhraseVocabulary(installedSigns);
  }, [androidAutoVocabulary, installedSigns]);
  const installedSignCount = installedSigns.length;
  // Development builds exercise the complete Plus flow without contacting a
  // store or charging a real payment method. Release builds always use the
  // remotely configured production policy and verified store entitlements.
  const billingSandboxEnabled = __DEV__;
  const effectiveAccessConfig = billingSandboxEnabled
    ? {
      ...accessConfig,
      monetizationEnabled: true,
      quotaEnforcementEnabled: true,
    }
    : accessConfig;
  const accessPolicy = resolveAccessPolicy(
    effectiveAccessConfig,
    usagePeriod,
    hasPlusEntitlement || (billingSandboxEnabled && billingSandboxEntitlement.active),
  );
  const availableListeningModes = useMemo(
    () => LISTENING_MODES.filter(mode => (
      mode === 'continuous'
        ? accessPolicy.canUseContinuousMode
        : accessPolicy.canUsePhraseMode
    )),
    [accessPolicy.canUseContinuousMode, accessPolicy.canUsePhraseMode],
  );
  const accountEmail = account?.email?.trim() ?? '';
  const accountDisplayName = account?.displayName?.trim();
  const visibleAccountName = accountDisplayName && accountDisplayName.toLowerCase() !== accountEmail.toLowerCase()
    ? accountDisplayName
    : account?.providerIds.includes('apple.com')
      ? t('settings.appleAccount')
      : account?.providerIds.includes('google.com')
        ? t('settings.googleAccount')
        : t('settings.noAccount');
  const visibleAccountDetail = account?.providerIds.includes('apple.com')
    ? t('settings.privateAppleEmail')
    : accountEmail || t('settings.protectedAccount');
  const launchAccessCopy = accessPolicy.canUseContinuousMode
    ? t('settings.launchAccessAllModes')
    : t('settings.launchAccessPhrase');
  const hasActivePlus = hasPlusEntitlement || (billingSandboxEnabled && billingSandboxEntitlement.active);
  const accessTitle = hasActivePlus
    ? t('settings.plusAccess')
    : effectiveAccessConfig.monetizationEnabled
      ? t('settings.freePlan')
      : t('settings.freeLaunchAccess');

  useEffect(() => {
    if (availableListeningModes.includes(listeningMode)) return;
    const fallbackMode = availableListeningModes[0] ?? 'phrase';
    setListeningMode(fallbackMode);
    listeningModeRef.current = fallbackMode;
  }, [availableListeningModes, listeningMode]);

  const showNextPhraseSuggestion = useCallback(() => {
    setPhraseSuggestionIndex(current => nextPhraseSuggestionIndex(
      current,
      Math.random(),
      phraseSuggestions.length,
    ));
  }, [phraseSuggestions.length]);

  useEffect(() => {
    const timer = setInterval(showNextPhraseSuggestion, 60_000);
    return () => clearInterval(timer);
  }, [showNextPhraseSuggestion]);

  useEffect(() => {
    let active = true;
    if (Platform.OS === 'android') return () => { active = false; };
    RNFS.exists(LISTENER_TUTORIAL_PATH)
      .then(completed => {
        if (active && !completed) setTutorialVisible(true);
      })
      .catch(() => {
        if (active) setTutorialVisible(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadLocalUsage(account?.uid).then(period => {
      if (active) setUsagePeriod(period);
    });
    return () => { active = false; };
  }, [account?.uid]);

  useEffect(() => {
    let active = true;
    loadBillingSandboxEntitlement(account?.uid)
      .then(entitlement => {
        if (active) setBillingSandboxEntitlement(entitlement);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [account?.uid]);

  const openBillingSandbox = useCallback((message = '') => {
    setSettingsVisible(false);
    setBillingSandboxFeedback(message);
    setBillingSandboxVisible(true);
  }, []);

  const simulateBillingPurchase = useCallback((plan: BillingPlan) => {
    Alert.alert(
      'Simular compra de VOZUAL Plus',
      'Esta operación es solo una prueba local. No se usará una tarjeta ni habrá ningún cobro.',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => setBillingSandboxFeedback('Compra de prueba cancelada.'),
        },
        {
          text: 'Simular rechazo',
          style: 'destructive',
          onPress: () => setBillingSandboxFeedback('El pago de prueba fue rechazado. Plus continúa inactivo.'),
        },
        {
          text: 'Aprobar prueba',
          onPress: () => {
            activateBillingSandboxEntitlement(account?.uid, plan)
              .then(entitlement => {
                setBillingSandboxEntitlement(entitlement);
                setBillingSandboxFeedback('Compra de prueba aprobada. VOZUAL Plus está activo.');
              })
              .catch(() => setBillingSandboxFeedback('No se pudo guardar la compra de prueba.'));
          },
        },
      ],
    );
  }, [account?.uid]);

  const restoreBillingSandbox = useCallback(() => {
    loadBillingSandboxEntitlement(account?.uid)
      .then(entitlement => {
        setBillingSandboxEntitlement(entitlement);
        setBillingSandboxFeedback(entitlement.active
          ? 'Compra de prueba restaurada correctamente.'
          : 'No hay una compra de prueba activa para esta cuenta.');
      })
      .catch(() => setBillingSandboxFeedback('No se pudo restaurar la compra de prueba.'));
  }, [account?.uid]);

  const resetBillingSandbox = useCallback(() => {
    clearBillingSandboxEntitlement(account?.uid)
      .then(entitlement => {
        setBillingSandboxEntitlement(entitlement);
        setBillingSandboxFeedback('Estado de compra reiniciado. La cuenta volvió al plan gratuito.');
      })
      .catch(() => setBillingSandboxFeedback('No se pudo reiniciar el estado de prueba.'));
  }, [account?.uid]);

  const openAccountResource = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      setAccountActionError('No pudimos abrir el enlace. Escríbenos a androsjapps@gmail.com.');
    });
  }, []);

  const confirmAccountDeletion = useCallback(() => {
    if (!account || !onDeleteAccount || accountActionPending) return;
    Alert.alert(
      'Eliminar cuenta y datos',
      'Esta acción elimina tu cuenta de VOZUAL, el perfil y el uso asociados. Google puede pedirte confirmar tu identidad. No elimina tu cuenta de Google.',
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Eliminar definitivamente',
          style: 'destructive',
          onPress: () => {
            setAccountActionPending(true);
            setAccountActionError('');
            onDeleteAccount()
              .then(() => {
                setSettingsVisible(false);
              })
              .catch(error => {
                setAccountActionError(messageForAccountDeletionError(error));
              })
              .finally(() => setAccountActionPending(false));
          },
        },
      ],
    );
  }, [account, accountActionPending, onDeleteAccount]);

  useEffect(() => {
    if (!playingSign || activeClip === 'IDLE' || activeClip === 'PHRASE_WAIT') return;
    const startedAt = Date.now();
    return () => {
      const totalMillis = usageRemainderMillisRef.current + (Date.now() - startedAt);
      const seconds = Math.floor(totalMillis / 1000);
      usageRemainderMillisRef.current = totalMillis - seconds * 1000;
      if (seconds <= 0) return;
      recordActiveTranslationSeconds(account?.uid, seconds)
        .then(setUsagePeriod)
        .catch(() => undefined);
    };
  }, [account?.uid, activeClip, playingSign]);

  useEffect(() => {
    let active = true;
    RNFS.readFile(PLAYBACK_SPEED_PREFERENCE_PATH, 'utf8')
      .then((raw) => {
        const preferences = JSON.parse(raw) as {speed?: unknown; zoom?: unknown; listeningMode?: unknown};
        const storedSpeed = Number(preferences.speed);
        const storedZoom = Number(preferences.zoom);
        if (active && PLAYBACK_SPEEDS.includes(storedSpeed as (typeof PLAYBACK_SPEEDS)[number])) {
          setPlaybackSpeed(storedSpeed as (typeof PLAYBACK_SPEEDS)[number]);
        }
        if (active && Number.isFinite(storedZoom) && storedZoom >= AVATAR_ZOOM_MIN && storedZoom <= AVATAR_ZOOM_MAX) {
          setAvatarZoom(storedZoom);
        }
        const storedMode = preferences.listeningMode;
        if (active && (storedMode === 'phrase' || storedMode === 'continuous')) {
          const permittedMode = storedMode === 'continuous' && !accessPolicy.canUseContinuousMode
            ? 'phrase'
            : storedMode;
          listeningModeRef.current = permittedMode;
          setListeningMode(permittedMode);
        }
      })
      // A first launch has no preference file. Playback starts at 2×.
      .catch(() => undefined);
    return () => { active = false; };
  }, [accessPolicy.canUseContinuousMode]);

  useEffect(() => {
    if (accessPolicy.canUseContinuousMode || listeningModeRef.current !== 'continuous') return;
    listeningModeRef.current = 'phrase';
    phrasePartialTextRef.current = '';
    setListeningMode('phrase');
    setTranscript('');
    setPlannedLsc('');
    RNFS.writeFile(
      PLAYBACK_SPEED_PREFERENCE_PATH,
      JSON.stringify({speed: playbackSpeed, zoom: avatarZoom, listeningMode: 'phrase'}),
      'utf8',
    ).catch(() => undefined);
  }, [accessPolicy.canUseContinuousMode, avatarZoom, playbackSpeed]);

  const choosePlaybackSpeed = useCallback((speed: (typeof PLAYBACK_SPEEDS)[number]) => {
    setPlaybackSpeed(speed);
    RNFS.writeFile(PLAYBACK_SPEED_PREFERENCE_PATH, JSON.stringify({speed, zoom: avatarZoom, listeningMode: listeningModeRef.current}), 'utf8')
      .catch(() => undefined);
  }, [avatarZoom]);

  const chooseAvatarZoom = useCallback((direction: -1 | 1) => {
    setAvatarZoom((current) => {
      const next = Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, Math.round((current + direction * AVATAR_ZOOM_STEP) * 100) / 100));
      RNFS.writeFile(PLAYBACK_SPEED_PREFERENCE_PATH, JSON.stringify({speed: playbackSpeed, zoom: next, listeningMode: listeningModeRef.current}), 'utf8')
        .catch(() => undefined);
      return next;
    });
  }, [playbackSpeed]);

  const chooseListeningMode = useCallback((mode: ListeningMode) => {
    if (listeningRef.current || playingRef.current || phraseFinalizing) return;
    if (mode === 'phrase' && !accessPolicy.canUsePhraseMode) {
      openBillingSandbox('El modo Por frase es una función de VOZUAL Plus. Puedes simular su compra aquí.');
      return;
    }
    if (mode === 'continuous' && !accessPolicy.canUseContinuousMode) {
      openBillingSandbox('El modo En vivo es una función de VOZUAL Plus. Puedes simular su compra aquí.');
      return;
    }
    listeningModeRef.current = mode;
    phrasePartialTextRef.current = '';
    setListeningMode(mode);
    setTranscript('');
    setPlannedLsc('');
    setErrorMessage('');
    RNFS.writeFile(
      PLAYBACK_SPEED_PREFERENCE_PATH,
      JSON.stringify({speed: playbackSpeed, zoom: avatarZoom, listeningMode: mode}),
      'utf8',
    ).catch(() => undefined);
  }, [accessPolicy.canUseContinuousMode, accessPolicy.canUsePhraseMode, avatarZoom, openBillingSandbox, phraseFinalizing, playbackSpeed]);

  useEffect(() => {
    pictureInPicture?.setAvatarPresentation(avatarRenderMode, avatarZoom, playbackSpeed);
  }, [avatarRenderMode, avatarZoom, playbackSpeed]);

  useEffect(() => {
    const nativeMode = Platform.OS === 'android' && androidAutoSignsAvailable
      ? 'continuous'
      : listeningMode;
    pictureInPicture?.setListeningMode(nativeMode, listening);
  }, [androidAutoSignsAvailable, listening, listeningMode]);

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
      const active = Boolean(await pictureInPicture.isActive());
      // Android replaces the full WebView with its compact native renderer.
      // iOS captures that same WebView into AVPictureInPictureController, so
      // it must remain mounted as the live source while the app is floating.
      if (Platform.OS === 'android') applyPictureInPictureState(active);
    } catch {
      // Native PiP state events remain the fallback on older Android builds.
    }
  }, [applyPictureInPictureState]);

  const clearPhraseContinuationTimer = useCallback(() => {
    if (!phraseContinuationTimer.current) return;
    clearTimeout(phraseContinuationTimer.current);
    phraseContinuationTimer.current = undefined;
  }, []);

  const startSign = useCallback((word: KnownWord, continuation: boolean) => {
    clearPhraseContinuationTimer();
    speechDebug('avatar-sign-requested', word);
    lastStartedSignRef.current = word;
    playingRef.current = true;
    phraseInProgressRef.current = true;
    pictureInPicture?.reportPlaybackEvent('play-sign', word);
    setContinuePhrase(continuation);
    setPlaybackPaused(false);
    setActiveClip(word.toUpperCase() as AvatarClip);
    setPlaybackId((value) => value + 1);
    setPlayingSign(true);
  }, [clearPhraseContinuationTimer]);

  const finishPhrase = useCallback(() => {
    clearPhraseContinuationTimer();
    phraseInProgressRef.current = false;
    lastStartedSignRef.current = undefined;
    playingRef.current = false;
    setContinuePhrase(false);
    setPlaybackPaused(false);
    setPlayingSign(false);
    setActiveClip('IDLE');
    setPlaybackId((value) => value + 1);
    pictureInPicture?.reportPlaybackEvent('play-sign', 'IDLE');
  }, [clearPhraseContinuationTimer]);

  const playNextSign = useCallback(() => {
    if (playingRef.current) return;
    const word = signQueue.current.shift();
    if (!word) {
      return;
    }
    const continuation = phraseInProgressRef.current
      && normalizeSpeech(word) !== normalizeSpeech(lastStartedSignRef.current ?? '');
    startSign(word, continuation);
  }, [startSign]);

  const handleText = useCallback((text: string, isFinal = false, selectedEntryId?: string) => {
    setTranscript(text);
    const resolution = resolveRuntimeLscPlayback(text, installedSigns, undefined, selectedEntryId);
    const words = resolution.glosses as KnownWord[];
    speechDebug('speech-resolution', {
      final: isFinal,
      status: resolution.status,
      resolvedGlossCount: words.length,
      hasRecoveryMessage: resolution.message.length > 0,
    });
    setPlannedLsc(words.join(' · '));
    setErrorMessage(resolution.message);
    if (resolution.status === 'ambiguous') {
      setAmbiguousTranscript(text);
      setAmbiguousCandidates(resolution.candidates);
      return;
    }
    setAmbiguousTranscript('');
    setAmbiguousCandidates([]);
    const {newWords, nextRecognizedWords} = advanceIncrementalSpeechMatches(
      recognizedWords.current,
      words,
      isFinal,
    );
    recognizedWords.current = nextRecognizedWords;
    if (newWords.length > 0) {
      if (pictureInPictureModeRef.current) {
        pictureInPicture?.enqueueSigns(newWords);
        setPlayingSign(true);
      } else {
        signQueue.current.push(...newWords);
        playNextSign();
      }
    }
  }, [installedSigns, playNextSign]);

  const requestTranscriptConfirmation = useCallback((text: string) => {
    const draft = text.trim();
    if (!draft) return;
    recognizedWords.current = [];
    signQueue.current = [];
    setTranscript(draft);
    setTranscriptDraft(draft);
    setPlannedLsc('');
    setErrorMessage('');
    setAmbiguousTranscript('');
    setAmbiguousCandidates([]);
    setTranscriptConfirmationVisible(true);
  }, []);

  const confirmTranscript = useCallback(() => {
    const confirmedText = transcriptDraft.trim();
    if (!confirmedText) {
      setErrorMessage(t('listener.confirmation.empty'));
      return;
    }
    recognizedWords.current = [];
    signQueue.current = [];
    setTranscriptConfirmationVisible(false);
    handleText(confirmedText, true);
  }, [handleText, t, transcriptDraft]);

  const cancelTranscriptConfirmation = useCallback(() => {
    recognizedWords.current = [];
    signQueue.current = [];
    setTranscriptConfirmationVisible(false);
    setTranscriptDraft('');
    setTranscript('');
    setPlannedLsc('');
    setErrorMessage('');
    setAmbiguousTranscript('');
    setAmbiguousCandidates([]);
  }, []);

  const playSuggestedPhrase = useCallback(() => {
    if (!phraseSuggestion || listening || playingSign) return;
    recognizedWords.current = [];
    handleText(phraseSuggestion, true);
  }, [handleText, listening, phraseSuggestion, playingSign]);

  const dismissTutorial = useCallback(() => {
    setTutorialVisible(false);
    RNFS.writeFile(LISTENER_TUTORIAL_PATH, JSON.stringify({completedAt: new Date().toISOString()}), 'utf8')
      .catch(() => undefined);
  }, []);

  const clearDeferredSpeech = useCallback(() => {
    if (deferredSpeechTimer.current) clearTimeout(deferredSpeechTimer.current);
    deferredSpeechTimer.current = undefined;
    deferredSpeechPrefix.current = '';
  }, []);

  const onSpeechResults = useCallback((event: SpeechEvent, isFinal = false) => {
    const currentText = selectKnownSpeechAlternative(event.value, knownWords);
    const combinedText = listeningModeRef.current === 'continuous' && deferredSpeechPrefix.current
      ? mergeSpeechSegments(deferredSpeechPrefix.current, currentText)
      : currentText;
    const bestText = selectKnownSpeechAlternative(
      combinedText === currentText ? [currentText] : [combinedText, currentText],
      knownWords,
    );
    const confidence = event.confidence?.[0];
    const hasMeasuredConfidence = typeof confidence === 'number' && Number.isFinite(confidence);
    const lowConfidenceFinal = isFinal && hasMeasuredConfidence && confidence < MIN_FINAL_SPEECH_CONFIDENCE;
    speechDebug('speech-text-selected', {
      final: isFinal,
      alternativeCount: event.value?.length ?? 0,
      hasCandidate: bestText.length > 0,
      hasMeasuredConfidence,
      lowConfidenceFinal,
    });
    if (Platform.OS === 'android') {
      if (bestText) setTranscript(bestText);
      const recognizedSigns = bestText ? extractKnownSpeechWords(bestText, knownWords) : [];
      // Sherpa continuous mode emits each VAD segment as its own final result.
      // It does not send cumulative final results, so deduplicating against
      // the preceding segment incorrectly drops different following signs.
      const {newWords} = standaloneSpeechMatches(
        recognizedSigns,
        isFinal,
      );
      speechDebug('android-direct-sign-match-check', {
        final: isFinal,
        matchedOccurrences: recognizedSigns.length,
        newlyMatchedOccurrences: newWords.length,
        lowConfidenceFinal,
      });
      // Queue matches from the complete installed sign vocabulary.
      // Repeated partial callbacks do not replay a word, while repeated words
      // in one utterance remain separate sign requests.
      if (!androidAutoSignsAvailable || (isFinal && lowConfidenceFinal) || newWords.length === 0) return;
      recognizedWords.current = [];
      signQueue.current.push(...newWords.map(word => word.toUpperCase()));
      playNextSign();
      setErrorMessage('');
      return;
    }
    if (listeningModeRef.current === 'phrase' && !isFinal) {
      if (bestText) {
        phrasePartialTextRef.current = bestText;
        setTranscript(bestText);
        const previewResolution = resolveRuntimeLscPlayback(bestText, installedSigns);
        const preview = previewResolution.glosses;
        setPlannedLsc(preview.length > 0 ? preview.join(' · ') : '');
      }
      return;
    }
    const phraseText = listeningModeRef.current === 'phrase'
      ? bestText || phrasePartialTextRef.current
      : bestText;
    if (!phraseText) {
      handleText('', isFinal);
      if (listeningModeRef.current === 'phrase' && isFinal) {
        if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
        phraseFinalizeTimer.current = undefined;
        listeningRef.current = false;
        nativePipSpeechActiveRef.current = false;
        recognitionReadyRef.current = false;
        setRecognitionReady(false);
        setListening(false);
        setPhraseFinalizing(false);
        setErrorMessage('No entendí la frase. Toca HABLAR para intentarlo nuevamente.');
        void pictureInPicture?.stopListeningService();
      }
      return;
    }
    if (lowConfidenceFinal) {
      // Never resolve or queue a low-confidence final result. Preserve the
      // draft so the person can correct it, then make confirmation explicit.
      recognizedWords.current = [];
      signQueue.current = [];
      setTranscript(phraseText);
      setTranscriptDraft(phraseText);
      setPlannedLsc('');
      setErrorMessage('El reconocimiento tuvo baja confianza. Revisa o corrige la frase antes de confirmarla.');
      setTranscriptConfirmationVisible(true);
      return;
    }
    if (shouldDeferSpeechMatch(
      phraseText,
      knownWords,
      isFinal,
      listeningModeRef.current === 'continuous',
    )) {
      setTranscript(phraseText);
      if (isFinal && listeningModeRef.current === 'continuous') {
        if (deferredSpeechTimer.current) clearTimeout(deferredSpeechTimer.current);
        deferredSpeechPrefix.current = phraseText;
        deferredSpeechTimer.current = setTimeout(() => {
          const pendingText = deferredSpeechPrefix.current;
          deferredSpeechTimer.current = undefined;
          deferredSpeechPrefix.current = '';
          if (pendingText && listeningRef.current) {
            requestTranscriptConfirmation(pendingText);
          }
        }, CONTINUOUS_PREFIX_WAIT_MS);
      }
      return;
    }
    if (listeningModeRef.current === 'continuous') clearDeferredSpeech();
    if (isFinal) requestTranscriptConfirmation(phraseText);
    if (listeningModeRef.current === 'phrase' && isFinal) {
      if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
      phraseFinalizeTimer.current = undefined;
      phrasePartialTextRef.current = '';
      listeningRef.current = false;
      nativePipSpeechActiveRef.current = false;
      recognitionReadyRef.current = false;
      setRecognitionReady(false);
      setListening(false);
      setPhraseFinalizing(false);
      void pictureInPicture?.stopListeningService();
    }
  }, [androidAutoSignsAvailable, clearDeferredSpeech, handleText, installedSigns, knownWords, playNextSign, requestTranscriptConfirmation]);

  const markRecognitionUnavailable = useCallback(() => {
    recognitionReadyRef.current = false;
    nativeStartInFlight.current = false;
    setRecognitionReady(false);
  }, []);

  const startActivityRecognition = useCallback(async () => {
    speechDebug('start-request', {
      platform: Platform.OS,
      mode: listeningModeRef.current,
      listening: listeningRef.current,
      ready: recognitionReadyRef.current,
    });
    if (
      !listeningRef.current ||
      nativePipSpeechActiveRef.current ||
      nativeStartInFlight.current ||
      recognitionReadyRef.current
    ) return;
    const generation = recognitionGeneration.current;
    nativeStartInFlight.current = true;
    recognitionReadyRef.current = false;
    setRecognitionReady(false);
    lastRecognitionActivity.current = Date.now();
    if (Platform.OS === 'ios') {
      try {
        if (!iosSpeechRecognizer) {
          throw new Error(OFFLINE_SPEECH_MESSAGE);
        }
        await iosSpeechRecognizer.start('es-CO', listeningModeRef.current);
        nativeStartInFlight.current = false;
        if (
          listeningRef.current &&
          generation === recognitionGeneration.current &&
          !recognitionReadyRef.current
        ) {
          // Native onSpeechStart normally arrives first. This fallback keeps
          // the UI out of an indefinite preparing state if event delivery is
          // delayed even though the audio engine started successfully.
          recognitionReadyRef.current = true;
          setRecognitionReady(true);
        }
      } catch (error) {
        nativeStartInFlight.current = false;
        markRecognitionUnavailable();
        if (isOfflineSpeechUnavailable(error)) {
          listeningRef.current = false;
          setListening(false);
          setErrorMessage(OFFLINE_SPEECH_MESSAGE);
          return;
        }
        if (
          listeningRef.current &&
          generation === recognitionGeneration.current &&
          listeningModeRef.current === 'continuous'
        ) {
          if (iosRecognitionRestartTimer.current) clearTimeout(iosRecognitionRestartTimer.current);
          iosRecognitionRestartTimer.current = setTimeout(() => {
            iosRecognitionRestartTimer.current = undefined;
            if (listeningRef.current && !recognitionReadyRef.current) {
              void startActivityRecognitionRef.current();
            }
          }, 650);
        } else if (listeningRef.current && generation === recognitionGeneration.current) {
          listeningRef.current = false;
          setListening(false);
          setErrorMessage(speechErrorMessage(error) || 'No se pudo iniciar el reconocimiento de voz en este iPhone.');
        }
      }
      return;
    }
    nativePipSpeechActiveRef.current = true;
    if (!pictureInPicture) {
      nativePipSpeechActiveRef.current = false;
      nativeStartInFlight.current = false;
      if (listeningRef.current && generation === recognitionGeneration.current) {
        listeningRef.current = false;
        setListening(false);
        setErrorMessage('El escuchador nativo no está disponible en este dispositivo.');
      }
      return;
    }
    try {
      await pictureInPicture.startListeningService();
      speechDebug('android-service-requested');
      nativeStartInFlight.current = false;

      // Android can keep the foreground recognizer alive while React Native
      // is recreated. In that case the native `ready` event happened before
      // this screen subscribed to it. Confirm the service state explicitly so
      // the UI cannot remain on "preparing microphone" forever.
      const waitForReady = async (attempts: number): Promise<boolean> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (
            !listeningRef.current ||
            generation !== recognitionGeneration.current
          ) return false;
          if (recognitionReadyRef.current) return true;
          const nativeReady = pictureInPicture.isListeningServiceReady
            ? await pictureInPicture.isListeningServiceReady().catch(() => false)
            : attempt >= 5;
          if (nativeReady) {
            recognitionReadyRef.current = true;
            setRecognitionReady(true);
            setErrorMessage('');
            return true;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 160));
        }
        return false;
      };

      if (await waitForReady(16)) return;

      // A recognizer provider can occasionally accept the service request but
      // never reach onReadyForSpeech. Recreate it once; after that, fail with
      // a recoverable message instead of leaving an endless progress state.
      await pictureInPicture.stopListeningService().catch(() => false);
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      if (!listeningRef.current || generation !== recognitionGeneration.current) return;
      await pictureInPicture.startListeningService();
      if (await waitForReady(20)) return;

      nativePipSpeechActiveRef.current = false;
      listeningRef.current = false;
      recognitionReadyRef.current = false;
      setRecognitionReady(false);
      setListening(false);
      setErrorMessage('El micrófono no logró quedar listo. Toca ACTIVAR MICRÓFONO para intentarlo de nuevo.');
      await pictureInPicture.stopListeningService().catch(() => false);
    } catch (error) {
      nativePipSpeechActiveRef.current = false;
      nativeStartInFlight.current = false;
      if (listeningRef.current && generation === recognitionGeneration.current) {
        listeningRef.current = false;
        setListening(false);
        setErrorMessage(
          isOfflineSpeechUnavailable(error)
            ? OFFLINE_SPEECH_MESSAGE
            : 'No se pudo iniciar el escuchador nativo. Intenta activarlo nuevamente.',
        );
      }
    }
  }, [markRecognitionUnavailable]);
  startActivityRecognitionRef.current = startActivityRecognition;

  const startListening = useCallback(async () => {
    if (listeningRef.current || listeningStartInFlight.current) return;
    listeningStartInFlight.current = true;
    nativePipSpeechActiveRef.current = false;
    setStarting(true);
    if (Platform.OS === 'android') {
      setTranscript('');
      setPlannedLsc('');
    }
    setErrorMessage('');
    setMicrophonePermissionBlocked(false);
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
          setMicrophonePermissionBlocked(true);
          setErrorMessage('Debes permitir el micrófono en los ajustes del teléfono.');
          return;
        }
        if (Number(Platform.Version) >= 33) {
          const notificationPermission = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            {
              title: 'Control de escucha activa',
              message: 'Permite las notificaciones para ver y detener la escucha de VOZUAL desde Android.',
              buttonPositive: 'Permitir',
              buttonNegative: 'Ahora no',
            },
          );
          setNotificationPermissionBlocked(
            notificationPermission !== PermissionsAndroid.RESULTS.GRANTED,
          );
        }
      }
      if (Platform.OS === 'android' && !pictureInPicture) {
        setErrorMessage('El escuchador nativo no está disponible en este dispositivo.');
        return;
      }
      recognitionGeneration.current += 1;
      listeningRef.current = true;
      setListening(true);
      setStarting(false);
      await startActivityRecognition();
    } catch (error) {
      listeningRef.current = false;
      markRecognitionUnavailable();
      setListening(false);
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar el reconocimiento de voz.');
    } finally {
      listeningStartInFlight.current = false;
      setStarting(false);
    }
  }, [markRecognitionUnavailable, startActivityRecognition]);

  const startPhraseListening = useCallback(async () => {
    if (listeningRef.current || playingRef.current) return;
    if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
    phraseFinalizeTimer.current = undefined;
    phrasePartialTextRef.current = '';
    recognizedWords.current = [];
    signQueue.current = [];
    setPhraseFinalizing(false);
    setTranscript('');
    setPlannedLsc('');
    setErrorMessage('');
    if (pictureInPictureModeRef.current) pictureInPicture?.resetPlayback();
    await startListening();
  }, [startListening]);

  useEffect(() => {
    if (
      Platform.OS !== 'android'
      || !androidAutoSignsAvailable
      || !avatarReady
      || autoListeningAttempted.current
    ) return;
    autoListeningAttempted.current = true;
    speechDebug('android-direct-sign-auto-start', 'listener-ready');
    startPhraseListening().catch(error => {
      speechDebug('android-direct-sign-auto-start-failed', error);
    });
  }, [androidAutoSignsAvailable, avatarReady, startPhraseListening]);

  const finishPhraseListening = useCallback(async () => {
    if (!listeningRef.current || listeningModeRef.current !== 'phrase' || phraseFinalizing) return;
    setPhraseFinalizing(true);
    setRecognitionReady(false);
    const requested = Platform.OS === 'ios'
      ? await iosSpeechRecognizer?.finishPhrase().catch(() => false) ?? false
      : await pictureInPicture?.finishListeningPhrase().catch(() => false);
    if (!requested) {
      setPhraseFinalizing(false);
      setErrorMessage('No se pudo terminar la frase. Intenta nuevamente.');
      return;
    }
    if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
    phraseFinalizeTimer.current = setTimeout(() => {
      phraseFinalizeTimer.current = undefined;
      if (!listeningRef.current) return;
      const fallbackText = phrasePartialTextRef.current;
      listeningRef.current = false;
      nativePipSpeechActiveRef.current = false;
      recognitionReadyRef.current = false;
      setRecognitionReady(false);
      setListening(false);
      setPhraseFinalizing(false);
      if (fallbackText) {
        handleText(fallbackText, true);
        phrasePartialTextRef.current = '';
      } else {
        setErrorMessage('No entendí la frase. Toca HABLAR para intentarlo nuevamente.');
      }
      void pictureInPicture?.stopListeningService();
    }, 3000);
  }, [handleText, phraseFinalizing]);

  const enterFloatingMode = useCallback(async () => {
    if (!accessPolicy.canUsePictureInPicture) {
      openBillingSandbox('La ventana flotante es una función de VOZUAL Plus. Puedes simular su compra aquí.');
      return;
    }
    if (!avatarReady) {
      setErrorMessage('Espera a que termine de cargar el avatar.');
      return;
    }
    if (!pictureInPicture) {
      setErrorMessage('La ventana flotante no está disponible en este dispositivo.');
      return;
    }
    pictureInPicture.setAvatarPresentation(avatarRenderMode, avatarZoom, playbackSpeed);
    if (Platform.OS === 'ios') {
      if (!listeningRef.current) {
        if (listeningModeRef.current === 'phrase') await startPhraseListening();
        else await startListening();
      }
      if (!listeningRef.current) return;
      try {
        const entered = await pictureInPicture.enter();
        if (!entered) {
          setErrorMessage('iOS no pudo iniciar la ventana flotante. Intenta nuevamente.');
        }
      } catch {
        setErrorMessage('iOS no pudo iniciar la ventana flotante. Intenta nuevamente.');
      }
      return;
    }
    pictureInPicture.resetPlayback();
    // The same Android microphone service continues seamlessly into PiP.
    if (!listeningRef.current) {
      if (listeningModeRef.current === 'phrase') await startPhraseListening();
      else await startListening();
    }
    if (!listeningRef.current) return;
    nativePipSpeechActiveRef.current = true;
    recognitionGeneration.current += 1;
    markRecognitionUnavailable();
    // PiP mounts a different avatar renderer. Do not carry an in-flight Home
    // animation into it: keeping playingRef true makes PiP enqueue recognised
    // words forever without ever calling playNextSign for them.
    signQueue.current = [];
    recognizedWords.current = [];
    clearPhraseContinuationTimer();
    phraseInProgressRef.current = false;
    lastStartedSignRef.current = undefined;
    playingRef.current = false;
    setContinuePhrase(false);
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
    accessPolicy.canUsePictureInPicture,
    applyPictureInPictureState,
    avatarRenderMode,
    avatarReady,
    avatarZoom,
    markRecognitionUnavailable,
    playbackSpeed,
    openBillingSandbox,
    startActivityRecognition,
    startListening,
    startPhraseListening,
    clearPhraseContinuationTimer,
  ]);

  const finishPictureInPictureSession = useCallback(async (reason: string) => {
    pictureInPicture?.reportPlaybackEvent('speech-fallback', reason);
    await pictureInPicture?.stopListeningService();
    nativePipSpeechActiveRef.current = false;
    recognitionReadyRef.current = false;
    setRecognitionReady(false);
    setPlayingSign(false);
    if (listeningRef.current) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await startActivityRecognition();
    }
  }, [startActivityRecognition]);

  const scheduleIosRecognitionRestart = useCallback(() => {
    if (Platform.OS !== 'ios' || !listeningRef.current || listeningModeRef.current !== 'continuous') return;
    if (iosRecognitionRestartTimer.current) clearTimeout(iosRecognitionRestartTimer.current);
    iosRecognitionRestartTimer.current = setTimeout(() => {
      iosRecognitionRestartTimer.current = undefined;
      if (
        listeningRef.current &&
        listeningModeRef.current === 'continuous' &&
        !recognitionReadyRef.current &&
        !nativeStartInFlight.current
      ) {
        void startActivityRecognitionRef.current();
      }
    }, 350);
  }, []);

  const finalizeIosSpeechResult = useCallback(() => {
    if (iosFinalResultHandled.current) return;
    iosFinalResultHandled.current = true;
    const finalEvent = iosLastSpeechEvent.current;
    if (finalEvent?.value?.length) {
      onSpeechResults(finalEvent, true);
    }
  }, [onSpeechResults]);

  const ensureIosRecognitionHealth = useCallback(async () => {
    if (
      Platform.OS !== 'ios' ||
      !listeningRef.current ||
      listeningModeRef.current !== 'continuous' ||
      nativeStartInFlight.current
    ) return;
    const isRecognizing = await iosSpeechRecognizer?.isListening().catch(() => false) ?? false;
    if (!listeningRef.current || listeningModeRef.current !== 'continuous') return;
    if (!isRecognizing) {
      markRecognitionUnavailable();
      scheduleIosRecognitionRestart();
    }
  }, [markRecognitionUnavailable, scheduleIosRecognitionRestart]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const healthTimer = setInterval(() => {
      void ensureIosRecognitionHealth();
    }, 1500);
    return () => clearInterval(healthTimer);
  }, [ensureIosRecognitionHealth]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'onVozualPictureInPictureChanged',
      (isInPictureInPictureMode: boolean) => {
        if (Platform.OS === 'ios') {
          // The iOS bridge mirrors the live full-size avatar. It does not own
          // speech or playback state and therefore must not restart either.
          return;
        }
        const compact = Boolean(isInPictureInPictureMode);
        const transition = resolvePictureInPictureTransition(
          nativePictureInPictureEventRef.current,
          compact,
        );
        nativePictureInPictureEventRef.current = compact;
        applyPictureInPictureState(compact);
        if (transition === 'entered') {
          nativePipSpeechActiveRef.current = true;
          if (!listeningRef.current) {
            if (listeningModeRef.current === 'phrase') void startPhraseListening();
            else void startListening();
          }
        } else if (transition === 'left') {
          void finishPictureInPictureSession('left-pip');
        }
      },
    );
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (Platform.OS === 'ios') void ensureIosRecognitionHealth();
      void syncPictureInPictureState();
      setTimeout(() => void syncPictureInPictureState(), 250);
      setTimeout(() => void syncPictureInPictureState(), 750);
    });
    void syncPictureInPictureState();
    return () => {
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [applyPictureInPictureState, ensureIosRecognitionHealth, finishPictureInPictureSession, startListening, startPhraseListening, syncPictureInPictureState]);

  const stopListening = useCallback(async () => {
    // Disable the session before calling the native module: stop/cancel emit
    // end and error events, and those events must not resurrect recognition.
    listeningRef.current = false;
    listeningStartInFlight.current = false;
    nativePipSpeechActiveRef.current = false;
    recognitionGeneration.current += 1;
    markRecognitionUnavailable();
    recognizedWords.current = [];
    signQueue.current = [];
    phrasePartialTextRef.current = '';
    clearDeferredSpeech();
    if (iosRecognitionRestartTimer.current) clearTimeout(iosRecognitionRestartTimer.current);
    iosRecognitionRestartTimer.current = undefined;
    if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
    phraseFinalizeTimer.current = undefined;
    clearPhraseContinuationTimer();
    phraseInProgressRef.current = false;
    playingRef.current = false;
    setContinuePhrase(false);
    setTranscript('');
    setPlannedLsc('');
    setListening(false);
    setPhraseFinalizing(false);
    setMicrophonePermissionBlocked(false);
    setErrorMessage('');
    try {
      await pictureInPicture?.stopListeningService();
      pictureInPicture?.resetPlayback();
      await speechAudio?.silenceRecognitionPrompts();
      if (Platform.OS === 'ios') {
        await iosSpeechRecognizer?.stop().catch(() => undefined);
      } else {
        nativeVoice?.cancelSpeech(() => undefined);
        nativeVoice?.stopSpeech(() => undefined);
      }
      speechAudio?.restoreAudioAfter(900);
    } finally {
      // UI and lifecycle state were already cleared synchronously above.
    }
  }, [clearDeferredSpeech, clearPhraseContinuationTimer, markRecognitionUnavailable]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onVozualPipPrimaryAction', () => {
      if (!pictureInPictureModeRef.current) return;
      if (Platform.OS === 'android' && androidAutoSignsAvailable) {
        if (listeningRef.current) stopListening().catch(() => undefined);
        else startListening().catch(() => undefined);
        return;
      }
      if (listeningModeRef.current === 'phrase') {
        if (listeningRef.current) void finishPhraseListening();
        else void startPhraseListening();
        return;
      }
      if (listeningRef.current) void stopListening();
      else void startListening();
    });
    return () => subscription.remove();
  }, [androidAutoSignsAvailable, finishPhraseListening, startListening, startPhraseListening, stopListening]);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      if (iosSpeechRecognizer) {
        const emitter = new NativeEventEmitter(iosSpeechRecognizer);
        const startSubscription = emitter.addListener('onVozualIosSpeechStart', () => {
          speechDebug('ios-start');
          nativeStartInFlight.current = false;
          recognitionReadyRef.current = true;
          iosLastSpeechEvent.current = undefined;
          iosFinalResultHandled.current = false;
          recognizedWords.current = [];
          lastRecognitionActivity.current = Date.now();
          setRecognitionReady(true);
          setErrorMessage('');
        });
        const partialSubscription = emitter.addListener(
          'onVozualIosSpeechPartialResults',
          (event: SpeechEvent) => {
            if (!listeningRef.current) return;
            lastRecognitionActivity.current = Date.now();
            if (event.value?.length) iosLastSpeechEvent.current = event;
            onSpeechResults(event, false);
          },
        );
        const resultsSubscription = emitter.addListener(
          'onVozualIosSpeechResults',
          (event: SpeechEvent) => {
            if (!listeningRef.current) return;
            lastRecognitionActivity.current = Date.now();
            if (event.value?.length) iosLastSpeechEvent.current = event;
            iosFinalResultHandled.current = true;
            onSpeechResults(event, true);
          },
        );
        const errorSubscription = emitter.addListener('onVozualIosSpeechError', (event: SpeechEvent) => {
          speechDebug('ios-error', event.error);
          nativeStartInFlight.current = false;
          if (listeningModeRef.current === 'phrase') {
            finalizeIosSpeechResult();
          }
          if (isOfflineSpeechUnavailable(event.error)) {
            listeningRef.current = false;
            markRecognitionUnavailable();
            setListening(false);
            setPhraseFinalizing(false);
            setErrorMessage(OFFLINE_SPEECH_MESSAGE);
            void iosSpeechRecognizer.stop();
            return;
          }
          // Continuous recognition is restarted by the native module. Do not
          // stop the user's listening session because one Apple task ended.
        });
        const endSubscription = emitter.addListener(
          'onVozualIosSpeechEnd',
          (event: IosNativeSpeechEndEvent) => {
            speechDebug('ios-end', event);
            nativeStartInFlight.current = false;
            if (listeningModeRef.current === 'phrase') {
              finalizeIosSpeechResult();
              return;
            }
            if (!event.willRestart) markRecognitionUnavailable();
          },
        );
        return () => {
          listeningRef.current = false;
          recognitionGeneration.current += 1;
          startSubscription.remove();
          partialSubscription.remove();
          resultsSubscription.remove();
          errorSubscription.remove();
          endSubscription.remove();
          void iosSpeechRecognizer.stop();
          if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
          clearPhraseContinuationTimer();
        };
      }
      setErrorMessage(OFFLINE_SPEECH_MESSAGE);
      return undefined;
    }
    if (!pictureInPicture) {
      setErrorMessage('El escuchador nativo no está disponible en este dispositivo.');
      return undefined;
    }
    const emitter = DeviceEventEmitter;
    const startSubscription = emitter.addListener('onSpeechStart', () => {
      speechDebug('android-start');
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
        onSpeechResults(event, false);
      },
    );
    const finalResultsSubscription = emitter.addListener('onSpeechResults', (event: SpeechEvent) => {
      if (nativePipSpeechActiveRef.current) return;
      lastRecognitionActivity.current = Date.now();
      onSpeechResults(event, true);
      markRecognitionUnavailable();
    });
    const errorSubscription = emitter.addListener('onSpeechError', (event: SpeechEvent) => {
      speechDebug('android-error', event.error);
      if (nativePipSpeechActiveRef.current) return;
      markRecognitionUnavailable();
      if (event.error) setErrorMessage('');
    });
    const endSubscription = emitter.addListener('onSpeechEnd', () => {
      speechDebug('android-end', {listening: listeningRef.current, mode: listeningModeRef.current});
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
        speechDebug('android-service-event', {
          type: event.type,
          error: event.error,
          resultCount: event.value?.length ?? 0,
          listening: listeningRef.current,
        });
        if (!listeningRef.current || !nativePipSpeechActiveRef.current) {
          pictureInPicture?.reportPlaybackEvent('ignored-speech-event', event.type ?? '');
          return;
        }
        lastRecognitionActivity.current = Date.now();
        if (event.type === 'start') {
          recognitionReadyRef.current = true;
          setRecognitionReady(true);
          recognizedWords.current = [];
          setMicrophonePermissionBlocked(false);
          setErrorMessage('');
          return;
        }
        if (event.type === 'partialResults' || event.type === 'results') {
          pictureInPicture?.reportPlaybackEvent(
            event.type === 'results' ? 'js-final-results' : 'js-partial-results',
            '',
          );
          onSpeechResults(event, event.type === 'results');
          return;
        }
        if (
          event.type === 'error'
          && typeof event.error === 'string'
          && OFFLINE_SPEECH_ERRORS.has(event.error)
        ) {
          if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
          phraseFinalizeTimer.current = undefined;
          listeningRef.current = false;
          nativePipSpeechActiveRef.current = false;
          recognitionReadyRef.current = false;
          setRecognitionReady(false);
          setListening(false);
          setPhraseFinalizing(false);
          setErrorMessage(OFFLINE_SPEECH_MESSAGE);
          pictureInPicture?.stopListeningService().catch(() => false);
          return;
        }
        if (event.type === 'stopped') {
          if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
          phraseFinalizeTimer.current = undefined;
          listeningRef.current = false;
          nativePipSpeechActiveRef.current = false;
          recognitionReadyRef.current = false;
          setRecognitionReady(false);
          setListening(false);
          setPhraseFinalizing(false);
          setErrorMessage('La escucha se detuvo desde el control de Android.');
          return;
        }
        if (
          event.type === 'error'
          && event.error === MICROPHONE_PERMISSION_ERROR
        ) {
          if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
          phraseFinalizeTimer.current = undefined;
          listeningRef.current = false;
          nativePipSpeechActiveRef.current = false;
          recognitionReadyRef.current = false;
          setRecognitionReady(false);
          setListening(false);
          setPhraseFinalizing(false);
          setMicrophonePermissionBlocked(true);
          setErrorMessage('Android retiró el permiso del micrófono. Permítelo nuevamente en los ajustes.');
          pictureInPicture?.stopListeningService().catch(() => false);
          return;
        }
        if (
          event.type === 'error'
          && listeningModeRef.current === 'phrase'
          && !(Platform.OS === 'android' && androidAutoSignsAvailable)
        ) {
          if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
          phraseFinalizeTimer.current = undefined;
          listeningRef.current = false;
          nativePipSpeechActiveRef.current = false;
          recognitionReadyRef.current = false;
          setRecognitionReady(false);
          setListening(false);
          setPhraseFinalizing(false);
          setErrorMessage('No entendí la frase. Toca HABLAR para intentarlo nuevamente.');
          void pictureInPicture?.stopListeningService();
          return;
        }
        if (event.type === 'end' || event.type === 'error') {
          // Android SpeechRecognizer is phrase-based: a normal pause closes
          // one request and the foreground service immediately starts the
          // next. Keep the listening UI stable during that tiny handoff so it
          // never looks as if VOZUAL stopped listening between phrases.
          return;
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
      if (phraseFinalizeTimer.current) clearTimeout(phraseFinalizeTimer.current);
      clearDeferredSpeech();
      clearPhraseContinuationTimer();
    };
  }, [androidAutoSignsAvailable, clearDeferredSpeech, clearPhraseContinuationTimer, finalizeIosSpeechResult, markRecognitionUnavailable, onSpeechResults, scheduleIosRecognitionRestart]);

  const onSignEnd = useCallback(() => {
    const nextWord = signQueue.current.shift();
    if (nextWord) {
      const continuation = normalizeSpeech(nextWord)
        !== normalizeSpeech(lastStartedSignRef.current ?? '');
      startSign(nextWord, continuation);
      return;
    }
    playingRef.current = false;
    if (!listeningRef.current) {
      finishPhrase();
      return;
    }

    // SpeechRecognizer can deliver one fast sentence in several partial
    // results. Keep the hands coasting through a partial return while waiting
    // so a newly recognized word joins the phrase without a frozen pose or a
    // complete trip through IDLE.
    setContinuePhrase(true);
    setActiveClip('PHRASE_WAIT');
    setPlaybackId((value) => value + 1);
    pictureInPicture?.reportPlaybackEvent('play-sign', 'PHRASE_WAIT');
    clearPhraseContinuationTimer();
    phraseContinuationTimer.current = setTimeout(() => {
      phraseContinuationTimer.current = undefined;
      const queuedWord = signQueue.current.shift();
      if (queuedWord) {
        startSign(queuedWord, true);
        return;
      }
      finishPhrase();
    }, PHRASE_CONTINUATION_GRACE_MS);
  }, [clearPhraseContinuationTimer, finishPhrase, startSign]);

  return (
    <View style={styles.safeArea}>
      {!compactMode && <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.logo}>VOZUAL</Text>
          <View style={styles.headerSpeedControl}>
            <Text style={styles.speedLabel}>{t('listener.speed')}</Text>
            <View style={styles.speedOptions}>
              {PLAYBACK_SPEEDS.map((speed) => (
                <Pressable
                  key={speed}
                  accessibilityRole="button"
                  accessibilityLabel={t('listener.speedLabel', {speed})}
                  onPress={() => choosePlaybackSpeed(speed)}
                  style={[styles.speedOption, playbackSpeed === speed && styles.speedOptionActive]}
                >
                  <Text style={[styles.speedOptionText, playbackSpeed === speed && styles.speedOptionTextActive]}>{speed}×</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        <Text style={styles.subtitle}>{t('listener.subtitle')}</Text>
      </View>}

      <View style={[styles.avatarCard, compactMode && styles.avatarCardCompact]}>
        {!compactMode && <Pressable
          accessibilityRole="button"
          accessibilityLabel={account ? t('listener.openSettings') : t('listener.activateFree')}
          onPress={() => {
            if (account) {
              setSettingsVisible(true);
            } else {
              onManageAccount?.();
            }
          }}
          style={[styles.avatarSettingsButton, !account && styles.avatarAccountButton]}
        >
          <Text style={[styles.avatarSettingsIcon, !account && styles.avatarAccountButtonText]}>
            {account ? '⚙' : '●'}
          </Text>
          <Text style={[styles.avatarSettingsText, !account && styles.avatarAccountButtonText]}>
            {account ? t('listener.settings') : t('listener.activateFree')}
          </Text>
        </Pressable>}
        {Platform.OS === 'android' && <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('listener.downloadedSigns', {count: installedSignCount})}
          onPress={onManageSignLanguages}
          style={styles.avatarSignCountBadge}
        >
          <Text style={styles.signCountText}>{installedSignCount}</Text>
        </Pressable>}
        {compactMode ? (
          <PipSkeletalAvatar
            clip={activeClip}
            playbackId={playbackId}
            playbackSpeed={playbackSpeed}
            continuePhrase={continuePhrase}
            renderMode={avatarRenderMode}
            onClipEnd={onSignEnd}
          />
        ) : (
          <SkeletalAvatar
            key={`full-avatar-${avatarLayoutEpoch}`}
            clip={activeClip}
            playbackId={playbackId}
            playbackSpeed={playbackSpeed}
            paused={playbackPaused}
            continuePhrase={continuePhrase}
            avatarZoom={avatarZoom}
            renderMode={avatarRenderMode}
            onClipEnd={onSignEnd}
            onReady={() => setAvatarReady(true)}
            onUnavailable={() => setAvatarReady(false)}
            onPlaybackDiagnostic={reportPlaybackDiagnostic}
          />
        )}
      </View>

      {!compactMode && <View style={styles.panel}>
        {availableListeningModes.length > 1 && (
          <Text style={styles.modeHeading}>{t('listener.translationMode')}</Text>
        )}
        {availableSignChangeCount > 0 && <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('listener.newSignsLabel', {count: availableSignChangeCount})}
          onPress={onManageSignLanguages}
          style={styles.signUpdateCard}
        >
          <View style={styles.signUpdateCopy}>
            <Text style={styles.signUpdateTitle}>
              {t('listener.newSignsTitle', {count: availableSignChangeCount})}
            </Text>
            <Text style={styles.signUpdateDetail}>{t('listener.newSignsDetail')}</Text>
          </View>
          <Text style={styles.signUpdateAction}>{t('listener.download')}</Text>
        </Pressable>}
        {availableListeningModes.length > 1 && <View style={styles.listeningModeControl}>
          {availableListeningModes.map(mode => {
            const selected = listeningMode === mode;
            const disabled = listening || playingSign || phraseFinalizing;
            const label = t(`listener.mode.${mode}.label`);
            const detail = t(`listener.mode.${mode}.detail`);
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{selected, disabled}}
                accessibilityLabel={`${label}. ${detail}`}
                disabled={disabled}
                onPress={() => chooseListeningMode(mode)}
                style={[
                  styles.listeningModeOption,
                  selected && styles.listeningModeOptionActive,
                  disabled && styles.listeningModeOptionDisabled,
                ]}
              >
                <Text style={[styles.listeningModeLabel, selected && styles.listeningModeLabelActive]}>
                  {label}
                </Text>
                <Text style={[styles.listeningModeDetail, selected && styles.listeningModeDetailActive]}>
                  {detail}
                </Text>
              </Pressable>
            );
          })}
        </View>}
        {Platform.OS !== 'android' && tutorialVisible && (
          <View style={styles.tutorialCard} accessibilityLabel={t('listener.tutorial.label')}>
            <View style={styles.tutorialHeader}>
              <Text style={styles.tutorialTitle}>{t('listener.tutorial.title')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('listener.tutorial.close')}
                onPress={dismissTutorial}
                style={styles.tutorialDismissButton}
              >
                <Text style={styles.tutorialDismissText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.tutorialText}>
              {t('listener.tutorial.instructions')}
            </Text>
            <Text style={styles.tutorialPointer}>{t('listener.tutorial.pointer')}</Text>
          </View>
        )}
        {Platform.OS !== 'android' && __DEV__ && <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reproducir la seña de prueba ADIÓS"
          disabled={!avatarReady || playingSign}
          onPress={() => {
            setPlannedLsc('ADIÓS · JSON LOCAL');
            startSign('ADIOS', false);
          }}
          style={[styles.adiosPreviewButton, (!avatarReady || playingSign) && styles.adiosPreviewButtonDisabled]}
        >
          <Text style={styles.adiosPreviewButtonText}>VER SEÑA ADIÓS</Text>
        </Pressable>}
        {(Platform.OS !== 'android' || androidAutoSignsAvailable) && <Pressable
          accessibilityRole="button"
          style={[styles.button, listening && styles.buttonActive, speechButtonDisabled && styles.buttonDisabled]}
          onPress={Platform.OS === 'android'
            ? (listening ? stopListening : startListening)
            : listeningMode === 'phrase'
              ? (listening ? finishPhraseListening : startPhraseListening)
              : (listening ? stopListening : startListening)}
          disabled={speechButtonDisabled}
        >
          {speechActionBusy
            ? <ActivityIndicator color="#07111F" />
            : <Text style={styles.buttonText}>
              {Platform.OS === 'android'
                ? (listening ? t('listener.stopListening') : t('listener.speak'))
                : listeningMode === 'phrase'
                ? (playingSign ? t('listener.replaying') : listening ? t('listener.finishPhrase') : t('listener.speak'))
                : listening ? t('listener.stopListening') : t('listener.activateMicrophone')}
            </Text>}
        </Pressable>}
        {accessPolicy.canUsePictureInPicture && <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('listener.openFloating')}
          disabled={!avatarReady || starting || phraseFinalizing}
          onPress={() => { enterFloatingMode().catch(() => undefined); }}
          style={[
            styles.floatingButton,
            (!avatarReady || starting || phraseFinalizing) && styles.floatingButtonDisabled,
          ]}
        >
          <Text style={[
            styles.floatingButtonText,
            (!avatarReady || starting || phraseFinalizing) && styles.floatingButtonTextDisabled,
          ]}>
            {t('listener.openFloatingAction')}
          </Text>
        </Pressable>}
        {Platform.OS === 'android' && androidAutoSignsAvailable ? (
          <View
            style={styles.liveListeningStatus}
            accessibilityLabel={starting || microphonePreparing
              ? t('listener.preparingMicrophone')
              : listening
                ? t('listener.liveListening')
                : t('listener.liveIdle')}
            accessibilityLiveRegion="polite"
          >
            <View
              style={[
                styles.liveListeningIndicator,
                listening && styles.liveListeningIndicatorActive,
                !listening && !starting && !microphonePreparing && styles.liveListeningIndicatorIdle,
              ]}
            />
            <Text style={styles.liveListeningText}>
              {starting || microphonePreparing
                ? t('listener.preparingMicrophone')
                : listening
                  ? t('listener.liveListening')
                  : t('listener.liveIdle')}
            </Text>
          </View>
        ) : Platform.OS === 'android' ? (
          <Text style={styles.status}>
            {t('listener.liveRequiresDownload')}
          </Text>
        ) : phraseFinalizing ? (
          <View style={styles.microphoneProgress} accessibilityLabel={t('listener.preparingTranslation')}>
            <ActivityIndicator size="small" color="#16D9D1" />
            <Text style={styles.microphoneProgressText}>{t('listener.preparingSign')}</Text>
          </View>
        ) : microphonePreparing ? (
          <View style={styles.microphoneProgress} accessibilityLabel={t('listener.preparingMicrophone')}>
            <ActivityIndicator size="small" color="#16D9D1" />
            <Text style={styles.microphoneProgressText}>{t('listener.preparingMicrophoneDetail')}</Text>
          </View>
        ) : (
          listening && <Text style={styles.status}>
            {listeningMode === 'phrase'
              ? t('listener.listeningFinish')
              : t('listener.continuousActive')}
          </Text>
        )}
        {Platform.OS === 'android' && androidAutoSignsAvailable && (
          <View style={styles.detectedWordsCard}>
            <Text
              accessibilityLiveRegion="polite"
              numberOfLines={3}
              ellipsizeMode="tail"
              style={styles.detectedWordsText}
            >
              {t('listener.detectedWords', {words: transcript || '—'})}
            </Text>
          </View>
        )}
        {!!errorMessage && (
          <Text style={styles.error}>
            {errorMessage}
          </Text>
        )}
        {Platform.OS === 'android' && isOfflineSpeechUnavailable(errorMessage) && (
          <View style={styles.permissionGuidance}>
            <Text style={styles.permissionGuidanceText}>
              La conexión se usa para descargar el idioma; después VOZUAL reconoce la voz sin enviar audio.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir ajustes de reconocimiento de voz sin conexión"
              style={styles.permissionSettingsButton}
              onPress={() => {
                pictureInPicture?.openSpeechSettings?.().catch(() => {
                  setErrorMessage('No fue posible abrir los ajustes de voz. Búscalos en la configuración de Android.');
                });
              }}
            >
              <Text style={styles.permissionSettingsButtonText}>CONFIGURAR VOZ SIN CONEXIÓN</Text>
            </Pressable>
          </View>
        )}
        {(microphonePermissionBlocked || notificationPermissionBlocked) && (
          <View style={styles.permissionGuidance}>
            {notificationPermissionBlocked && !microphonePermissionBlocked && (
              <Text style={styles.permissionGuidanceText}>
                La escucha funciona, pero debes permitir notificaciones para ver el botón DETENER de Android.
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir los ajustes de permisos de VOZUAL"
              style={styles.permissionSettingsButton}
              onPress={() => {
                Linking.openSettings().catch(() => {
                  setErrorMessage('No fue posible abrir los ajustes. Ábrelos desde la configuración de Android.');
                });
              }}
            >
              <Text style={styles.permissionSettingsButtonText}>ABRIR AJUSTES</Text>
            </Pressable>
          </View>
        )}
        {Platform.OS !== 'android' && transcript ? (
          <View
            testID={`listener-flow-${listenerFlowState}`}
            style={styles.recognizedCard}
          >
            <Text accessibilityLiveRegion="polite" style={styles.flowStatus}>
              {listenerFlowAccessibilityLabel(listenerFlowState)}
            </Text>
            {transcriptConfirmationVisible ? <>
              <Text style={styles.confirmationTitle}>{t('listener.confirmation.title')}</Text>
              <TextInput
                accessibilityLabel={t('listener.confirmation.inputLabel')}
                value={transcriptDraft}
                onChangeText={setTranscriptDraft}
                style={styles.transcriptInput}
                autoCapitalize="sentences"
                autoCorrect
              />
              <View style={styles.confirmationActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('listener.confirmation.cancelLabel')}
                  onPress={cancelTranscriptConfirmation}
                  style={styles.confirmationSecondary}
                >
                  <Text style={styles.confirmationSecondaryText}>{t('listener.confirmation.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('listener.confirmation.confirmLabel')}
                  onPress={confirmTranscript}
                  style={styles.confirmationPrimary}
                >
                  <Text style={styles.confirmationPrimaryText}>{t('listener.confirmation.confirm')}</Text>
                </Pressable>
              </View>
            </> : <>
              <Text style={styles.transcript} numberOfLines={1} ellipsizeMode="tail">
                {transcript}
              </Text>
              <Text style={styles.lscPlan} numberOfLines={1} ellipsizeMode="tail">
                {plannedLsc ? `LSC: ${plannedLsc}` : t('listener.lscEmpty')}
              </Text>
            </>}
          </View>
        ) : null}
        {ambiguousCandidates.length > 0 && (
          <View style={styles.ambiguityCard}>
            <Text style={styles.ambiguityTitle}>{t('listener.ambiguity.title')}</Text>
            <Text style={styles.ambiguityDetail}>{t('listener.ambiguity.detail')}</Text>
            {ambiguousCandidates.map(candidate => (
              <Pressable
                key={candidate.id}
                accessibilityRole="button"
                accessibilityLabel={t('listener.ambiguity.choiceLabel', {meaning: candidate.intendedMeaning})}
                onPress={() => handleText(ambiguousTranscript, true, candidate.id)}
                style={styles.ambiguityChoice}
              >
                <Text style={styles.ambiguityChoiceText}>{candidate.intendedMeaning}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {Platform.OS !== 'android' && <View style={styles.suggestionCard}>
          {phraseSuggestions.length > 0 ? (
            <>
            <View style={styles.suggestionHeader}>
              <Text style={styles.suggestionLabel}>{t('listener.recommendedPhrase')}</Text>
              <Text style={styles.suggestionCount}>{t('listener.possibleCount', {count: phraseSuggestions.length})}</Text>
            </View>
            <Text style={styles.suggestionText} numberOfLines={2} ellipsizeMode="tail">
              “{phraseSuggestion}”
            </Text>
            <Text style={styles.suggestionHint}>
              {t('listener.suggestionHint')}
            </Text>
            <View style={styles.suggestionButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('listener.nextSuggestionLabel')}
                onPress={showNextPhraseSuggestion}
                style={styles.suggestionButtonSecondary}
              >
                <Text style={styles.suggestionButtonSecondaryText}>{t('listener.nextSuggestion')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('listener.viewSuggestionLabel', {phrase: phraseSuggestion})}
                disabled={listening || playingSign}
                onPress={playSuggestedPhrase}
                style={[styles.suggestionButtonPrimary, (listening || playingSign) && styles.suggestionButtonDisabled]}
              >
                <Text style={styles.suggestionButtonPrimaryText}>{t('listener.viewInLsc')}</Text>
              </Pressable>
            </View>
            </>
          ) : (
            <>
              <Text style={styles.suggestionLabel}>{t('listener.recommendedPhrases')}</Text>
              <Text style={styles.suggestionEmptyText}>
                {t('listener.noSuggestions')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('listener.openLibraryLabel')}
                onPress={onManageSignLanguages}
                style={styles.suggestionButtonSecondary}
              >
                <Text style={styles.suggestionButtonSecondaryText}>{t('listener.openLibrary')}</Text>
              </Pressable>
            </>
          )}
        </View>}
      </View>}

      {!compactMode && <Modal
        animationType="fade"
        transparent
        visible={settingsVisible}
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={styles.settingsOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.close')}
            onPress={() => setSettingsVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.settingsSheet}>
            <View style={styles.settingsHeader}>
              <View>
                <Text style={styles.settingsTitle}>{t('settings.title')}</Text>
                <Text style={styles.settingsSubtitle}>{t('settings.subtitle')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.close')}
                onPress={() => setSettingsVisible(false)}
                style={styles.settingsCloseButton}
              >
                <Text style={styles.settingsCloseText}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.settingsLabel}>{t('settings.interfaceLanguage')}</Text>
            <View style={styles.settingsRenderModes}>
              {SUPPORTED_APP_LOCALES.map(candidate => (
                <Pressable
                  key={candidate}
                  accessibilityRole="button"
                  accessibilityState={{selected: locale === candidate}}
                  onPress={() => { setLocale(candidate).catch(() => undefined); }}
                  style={[styles.settingsRenderMode, locale === candidate && styles.settingsRenderModeActive]}
                >
                  <Text style={[styles.settingsRenderModeText, locale === candidate && styles.settingsRenderModeTextActive]}>
                    {t(`language.name.${candidate}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.settingsLanguageDetail}>{t('language.interface.detail')}</Text>

            <Text style={styles.settingsLabel}>{t('settings.representation')}</Text>
            <View style={styles.settingsRenderModes}>
              {AVATAR_RENDER_MODES.map(mode => (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{selected: avatarRenderMode === mode}}
                  onPress={() => setAvatarRenderMode(mode)}
                  style={[styles.settingsRenderMode, avatarRenderMode === mode && styles.settingsRenderModeActive]}
                >
                  <Text style={[styles.settingsRenderModeText, avatarRenderMode === mode && styles.settingsRenderModeTextActive]}>
                    {t(mode === 'points' ? 'settings.avatar.points' : 'settings.avatar.character')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.settingsLabel}>{t('settings.avatarSize')}</Text>
            <View style={styles.settingsZoomControl}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.zoomOut')}
                onPress={() => chooseAvatarZoom(-1)}
                disabled={avatarZoom <= AVATAR_ZOOM_MIN}
                style={[styles.settingsZoomButton, avatarZoom <= AVATAR_ZOOM_MIN && styles.avatarZoomButtonDisabled]}
              >
                <Text style={styles.settingsZoomButtonText}>−</Text>
              </Pressable>
              <Text style={styles.settingsZoomValue}>{Math.round(avatarZoom * 100)}%</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.zoomIn')}
                onPress={() => chooseAvatarZoom(1)}
                disabled={avatarZoom >= AVATAR_ZOOM_MAX}
                style={[styles.settingsZoomButton, avatarZoom >= AVATAR_ZOOM_MAX && styles.avatarZoomButtonDisabled]}
              >
                <Text style={styles.settingsZoomButtonText}>+</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.signLanguagesLabel')}
              onPress={() => {
                setSettingsVisible(false);
                onManageSignLanguages?.();
              }}
            >
              <Text style={styles.settingsLibraryCount}>
                {t('settings.signLanguages', {count: installedSignCount})}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.userGuideLabel')}
              onPress={() => {
                setSettingsVisible(false);
                setTutorialVisible(true);
              }}
              style={styles.settingsTutorialButton}
            >
              <Text style={styles.settingsTutorialButtonText}>{t('settings.userGuide')}</Text>
            </Pressable>

            <View style={styles.settingsDivider} />
            <Text style={styles.settingsLabel}>{t('settings.access')}</Text>
            <View style={styles.settingsAccessCard}>
              <Text style={styles.settingsAccessTitle}>{accessTitle}</Text>
              <Text style={styles.settingsAccessDetail}>
                {accessPolicy.consumedMinutes === 0
                  ? t('settings.noConsumedMinutes')
                  : t('settings.consumedMinutes', {count: accessPolicy.consumedMinutes})}
              </Text>
              <Text style={styles.settingsAccessExplanation}>
                {t('settings.minuteExplanation')}
              </Text>
              <Text style={styles.settingsAccessStatus}>
                {effectiveAccessConfig.monetizationEnabled
                  ? t('settings.remainingMinutes', {count: accessPolicy.remainingMinutes})
                  : launchAccessCopy}
              </Text>
              {billingSandboxEnabled && (
                <>
                  <Text style={styles.settingsSandboxLabel}>{t('settings.sandbox')}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.sandboxOpen')}
                    onPress={() => openBillingSandbox()}
                    style={styles.settingsPlusButton}
                  >
                    <Text style={styles.settingsPlusButtonText}>
                      {billingSandboxEntitlement.active ? t('settings.sandboxManage') : t('settings.sandboxTry')}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>

            <View style={styles.settingsDivider} />
            <Text style={styles.settingsLabel}>{t('settings.account')}</Text>
            <View style={styles.settingsAccountRow}>
              <View style={styles.settingsAccountCopy}>
                <Text style={styles.settingsAccountTitle} numberOfLines={1}>
                  {visibleAccountName}
                </Text>
                <Text style={styles.settingsAccountDetail} numberOfLines={1}>
                  {account
                    ? visibleAccountDetail
                    : t('settings.accountPrompt')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={account ? t('settings.signOut') : t('settings.activateAccount')}
                disabled={accountActionPending}
                onPress={() => {
                  if (account) {
                    onSignOut?.().catch(() => undefined);
                  } else {
                    setSettingsVisible(false);
                    onManageAccount?.();
                  }
                }}
                style={styles.settingsAccountButton}
              >
                <Text style={styles.settingsAccountButtonText}>
                  {account ? t('settings.signOutAction') : t('settings.activateAction')}
                </Text>
              </Pressable>
            </View>
            {account && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.deleteAccount')}
                disabled={accountActionPending}
                onPress={confirmAccountDeletion}
                style={styles.settingsDeleteAccountButton}
              >
                {accountActionPending
                  ? <ActivityIndicator color="#F06275" />
                  : <Text style={styles.settingsDeleteAccountText}>{t('settings.deleteAccountAction')}</Text>}
              </Pressable>
            )}
            {!!accountActionError && (
              <Text style={styles.settingsAccountError}>{accountActionError}</Text>
            )}
            {!!accountActionError && account && (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('settings.webDeletion')}
                onPress={() => openAccountResource(VOZUAL_ACCOUNT_DELETION_URL)}
              >
                <Text style={styles.settingsAccountLink}>{t('settings.webDeletionAction')}</Text>
              </Pressable>
            )}
            <View style={styles.settingsPolicyLinks}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('activation.openPrivacyLabel')}
                onPress={() => openAccountResource(VOZUAL_PRIVACY_POLICY_URL)}
              >
                <Text style={styles.settingsPolicyLink}>{t('settings.privacy')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('settings.webDeletion')}
                onPress={() => openAccountResource(VOZUAL_ACCOUNT_DELETION_URL)}
              >
                <Text style={styles.settingsPolicyLink}>{t('settings.deleteData')}</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.openSourceLicenses')}
              onPress={() => setLicensesVisible(true)}
              style={styles.settingsLicensesButton}
            >
              <Text style={styles.settingsPolicyLink}>{t('settings.openSourceLicenses')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>}
      <Modal
        animationType="slide"
        transparent
        visible={licensesVisible}
        onRequestClose={() => setLicensesVisible(false)}
      >
        <View style={styles.settingsOverlay}>
          <View style={styles.licensesSheet}>
            <View style={styles.settingsHeader}>
              <View>
                <Text style={styles.settingsTitle}>{t('settings.openSourceLicenses')}</Text>
                <Text style={styles.settingsSubtitle}>{t('settings.openSourceLicensesSubtitle')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.closeLicenses')}
                onPress={() => setLicensesVisible(false)}
                style={styles.settingsCloseButton}
              >
                <Text style={styles.settingsCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.licensesContent}>
              <Text style={styles.licenseName}>NVIDIA FastConformer Spanish ASR model</Text>
              <Text style={styles.licenseDetail}>{t('settings.licenseNvidia')}</Text>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://huggingface.co/nvidia/stt_es_fastconformer_hybrid_large_pc').catch(() => undefined)}>
                <Text style={styles.licenseLink}>{t('settings.licenseModelSource')}</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://creativecommons.org/licenses/by/4.0/').catch(() => undefined)}>
                <Text style={styles.licenseLink}>Creative Commons Attribution 4.0 (CC BY 4.0)</Text>
              </Pressable>

              <View style={styles.settingsDivider} />
              <Text style={styles.licenseName}>Sherpa‑ONNX</Text>
              <Text style={styles.licenseDetail}>{t('settings.licenseSherpa')}</Text>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE').catch(() => undefined)}>
                <Text style={styles.licenseLink}>Apache License 2.0</Text>
              </Pressable>

              <View style={styles.settingsDivider} />
              <Text style={styles.licenseName}>Silero VAD</Text>
              <Text style={styles.licenseDetail}>{t('settings.licenseSilero')}</Text>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://github.com/snakers4/silero-vad/blob/master/LICENSE').catch(() => undefined)}>
                <Text style={styles.licenseLink}>MIT License</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {billingSandboxEnabled && (
        <BillingSandboxSheet
          visible={billingSandboxVisible}
          entitlement={billingSandboxEntitlement}
          feedback={billingSandboxFeedback}
          onClose={() => setBillingSandboxVisible(false)}
          onPurchase={simulateBillingPurchase}
          onRestore={restoreBillingSandbox}
          onReset={resetBillingSandbox}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111F' },
  // App.tsx owns the system inset. Keeping a second SafeAreaView and adding
  // StatusBar.currentHeight here stacked the top inset on Android phones.
  header: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  logo: { color: '#F7F9FC', fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: '#16D9D1', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 5 },
  avatarCard: { flex: 1, margin: 16, borderRadius: 24, overflow: 'hidden', backgroundColor: '#202A38', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarCardCompact: { margin: 0, borderRadius: 0 },
  avatarSettingsButton: { position: 'absolute', left: 13, top: 13, zIndex: 3, height: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#102337D9', borderWidth: 1, borderColor: '#31506A' },
  avatarSettingsIcon: { color: '#D8E1EC', fontSize: 14, lineHeight: 17 },
  avatarSettingsText: { color: '#D8E1EC', fontSize: 8, fontWeight: '900', letterSpacing: 0.35 },
  avatarAccountButton: {borderColor: '#69DDD9', backgroundColor: '#15394BEF'},
  avatarAccountButtonText: {color: '#69DDD9'},
  avatarZoomButtonDisabled: { opacity: 0.38 },
  panel: { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 12 },
  modeHeading: { color: '#7F91A6', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginBottom: 7 },
  listeningModeControl: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  listeningModeOption: { flex: 1, minHeight: 40, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#31506A', backgroundColor: '#102337', alignItems: 'center', justifyContent: 'center' },
  listeningModeOptionActive: { borderColor: '#16D9D1', backgroundColor: '#15394B' },
  listeningModeOptionDisabled: { opacity: 0.62 },
  listeningModeLabel: { color: '#A9B8C9', fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },
  listeningModeLabelActive: { color: '#69DDD9' },
  listeningModeDetail: { color: '#7F91A6', fontSize: 8, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  listeningModeDetailActive: { color: '#D8E1EC' },
  headerSpeedControl: { alignItems: 'flex-end', marginLeft: 16 },
  speedLabel: { color: '#A9B8C9', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  speedOptions: { flexDirection: 'row', gap: 5 },
  speedOption: { minWidth: 40, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 9, backgroundColor: '#20344B', alignItems: 'center' },
  speedOptionActive: { backgroundColor: '#16D9D1' },
  speedOptionText: { color: '#D8E1EC', fontSize: 12, fontWeight: '800' },
  speedOptionTextActive: { color: '#07111F' },
  avatarSignCountBadge: { position: 'absolute', top: 14, right: 14, zIndex: 3, minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, backgroundColor: '#16D9D1', alignItems: 'center', justifyContent: 'center' },
  signCountText: { color: '#07111F', fontSize: 14, fontWeight: '900' },
  avatarSignCountHint: { position: 'absolute', right: 14, top: 52, borderRadius: 8, backgroundColor: '#102337', borderWidth: 1, borderColor: '#1A4960', paddingVertical: 7, paddingHorizontal: 10, zIndex: 3 },
  signCountHintText: { color: '#D8E1EC', fontSize: 11, fontWeight: '700' },
  tutorialCard: { marginTop: 8, marginBottom: 2, padding: 12, borderRadius: 12, backgroundColor: '#15394B', borderWidth: 1, borderColor: '#16D9D1' },
  tutorialHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tutorialTitle: { flex: 1, color: '#69DDD9', fontSize: 11, fontWeight: '900', letterSpacing: 0.35 },
  tutorialDismissButton: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#20344B', alignItems: 'center', justifyContent: 'center' },
  tutorialDismissText: { color: '#F7F9FC', fontSize: 19, lineHeight: 22 },
  tutorialText: { color: '#D8E1EC', fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 6 },
  tutorialPointer: { color: '#69DDD9', fontSize: 10, fontWeight: '900', letterSpacing: 0.25, textAlign: 'center', marginTop: 8 },
  button: { marginTop: 10, borderRadius: 14, backgroundColor: '#16D9D1', paddingVertical: 14, alignItems: 'center' },
  buttonActive: { backgroundColor: '#FF5470' },
  buttonDisabled: { opacity: 0.62 },
  buttonText: { color: '#07111F', fontWeight: '800', letterSpacing: 0.4 },
  adiosPreviewButton: { marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: '#69DDD9', backgroundColor: '#15394B', paddingVertical: 12, alignItems: 'center' },
  adiosPreviewButtonDisabled: { opacity: 0.45 },
  adiosPreviewButtonText: { color: '#69DDD9', fontWeight: '900', letterSpacing: 0.5 },
  floatingButton: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#16D9D1', paddingVertical: 11, alignItems: 'center' },
  floatingButtonDisabled: { borderColor: '#526174' },
  floatingButtonText: { color: '#16D9D1', fontWeight: '800', letterSpacing: 0.4 },
  floatingButtonTextDisabled: { color: '#7C899A' },
  status: { color: '#16D9D1', textAlign: 'center', fontSize: 11, fontWeight: '700', marginTop: 12 },
  liveListeningStatus: { minHeight: 24, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  liveListeningIndicator: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E4A83A' },
  liveListeningIndicatorActive: { backgroundColor: '#16D9D1', shadowColor: '#16D9D1', shadowOpacity: 0.8, shadowRadius: 6, elevation: 3 },
  liveListeningIndicatorIdle: { backgroundColor: '#7F91A6' },
  liveListeningText: { color: '#D8E1EC', textAlign: 'center', fontSize: 12, fontWeight: '800' },
  detectedWordsCard: { minHeight: 56, marginTop: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#102337', justifyContent: 'center', flexShrink: 0 },
  detectedWordsText: { color: '#D8E1EC', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  microphoneProgress: { height: 32, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  microphoneProgressText: { color: '#16D9D1', fontSize: 11, fontWeight: '800', letterSpacing: 0.25 },
  recognizedCard: { minHeight: 58, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#102337', justifyContent: 'center' },
  flowStatus: { color: '#86A6BF', textAlign: 'center', fontSize: 11, lineHeight: 15, marginBottom: 3 },
  transcript: { color: '#D8E1EC', textAlign: 'center', fontSize: 14, lineHeight: 18 },
  lscPlan: { color: '#69DDD9', textAlign: 'center', marginTop: 3, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  confirmationTitle: { color: '#69DDD9', textAlign: 'center', fontSize: 10, fontWeight: '900', letterSpacing: 0.25, lineHeight: 14 },
  transcriptInput: { color: '#F7F9FC', minHeight: 40, marginTop: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#31506A', borderRadius: 8, backgroundColor: '#07111F', fontSize: 14 },
  confirmationActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  confirmationPrimary: { flex: 1, minHeight: 34, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#16D9D1', alignItems: 'center', justifyContent: 'center' },
  confirmationPrimaryText: { color: '#07111F', fontSize: 10, fontWeight: '900', letterSpacing: 0.25 },
  confirmationSecondary: { flex: 1, minHeight: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#31506A', alignItems: 'center', justifyContent: 'center' },
  confirmationSecondaryText: { color: '#D8E1EC', fontSize: 10, fontWeight: '900', letterSpacing: 0.25 },
  ambiguityCard: { marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: '#15394B', borderWidth: 1, borderColor: '#16D9D1' },
  ambiguityTitle: { color: '#69DDD9', textAlign: 'center', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  ambiguityDetail: { color: '#D8E1EC', marginTop: 5, textAlign: 'center', fontSize: 12, lineHeight: 16 },
  ambiguityChoice: { minHeight: 36, marginTop: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#16D9D1', alignItems: 'center', justifyContent: 'center' },
  ambiguityChoiceText: { color: '#07111F', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  signUpdateCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: '#15394B', borderWidth: 1, borderColor: '#16D9D1' },
  signUpdateCopy: { flex: 1 },
  signUpdateTitle: { color: '#69DDD9', fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  signUpdateDetail: { color: '#D8E1EC', marginTop: 3, fontSize: 11, fontWeight: '700', lineHeight: 15 },
  signUpdateAction: { color: '#07111F', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#16D9D1', fontSize: 10, fontWeight: '900', letterSpacing: 0.25, overflow: 'hidden' },
  suggestionCard: { marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: '#102337', borderWidth: 1, borderColor: '#31506A' },
  suggestionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  suggestionLabel: { color: '#69DDD9', fontSize: 10, fontWeight: '900', letterSpacing: 0.45, lineHeight: 15 },
  suggestionCount: { color: '#A9B8C9', fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },
  suggestionText: { color: '#F7F9FC', marginTop: 4, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  suggestionHint: { color: '#A9B8C9', marginTop: 4, fontSize: 10, lineHeight: 14 },
  suggestionButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  suggestionButtonPrimary: { flex: 1, minHeight: 34, paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#16D9D1', alignItems: 'center', justifyContent: 'center' },
  suggestionButtonPrimaryText: { color: '#07111F', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  suggestionButtonSecondary: { alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: '#31506A', backgroundColor: '#20344B', alignItems: 'center', justifyContent: 'center' },
  suggestionButtonSecondaryText: { color: '#D8E1EC', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  suggestionButtonDisabled: { opacity: 0.48 },
  suggestionEmptyText: { color: '#A9B8C9', marginTop: 4, marginBottom: 10, fontSize: 12, lineHeight: 17 },
  error: { color: '#A9B8C9', textAlign: 'center', marginTop: 8, fontSize: 12 },
  permissionGuidance: { alignItems: 'center', marginTop: 8, gap: 7 },
  permissionGuidanceText: { color: '#A9B8C9', textAlign: 'center', fontSize: 11, lineHeight: 15 },
  permissionSettingsButton: { minHeight: 34, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#69DDD9', alignItems: 'center', justifyContent: 'center' },
  permissionSettingsButtonText: { color: '#69DDD9', fontSize: 10, fontWeight: '900', letterSpacing: 0.35 },
  draftWarning: { color: '#FBBF24', textAlign: 'center', marginTop: 8, fontSize: 12, fontWeight: '700' },
  settingsOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#020812A6' },
  settingsSheet: { margin: 16, padding: 20, borderRadius: 22, backgroundColor: '#102337', borderWidth: 1, borderColor: '#31506A' },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  settingsTitle: { color: '#F7F9FC', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  settingsSubtitle: { color: '#7F91A6', fontSize: 11, marginTop: 3 },
  settingsCloseButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#20344B', alignItems: 'center', justifyContent: 'center' },
  settingsCloseText: { color: '#D8E1EC', fontSize: 24, lineHeight: 27 },
  settingsLabel: { color: '#7F91A6', fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginBottom: 7 },
  settingsRenderModes: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  settingsRenderMode: { flex: 1, paddingVertical: 11, borderRadius: 11, backgroundColor: '#20344B', alignItems: 'center' },
  settingsRenderModeActive: { backgroundColor: '#16D9D1' },
  settingsRenderModeText: { color: '#D8E1EC', fontSize: 11, fontWeight: '900' },
  settingsRenderModeTextActive: { color: '#07111F' },
  settingsLanguageDetail: { color: '#7F91A6', fontSize: 9, lineHeight: 13, marginTop: -11, marginBottom: 18 },
  settingsZoomControl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 6, borderRadius: 14, backgroundColor: '#071829' },
  settingsZoomButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#20344B', alignItems: 'center', justifyContent: 'center' },
  settingsZoomButtonText: { color: '#F7F9FC', fontSize: 23, fontWeight: '700', lineHeight: 27 },
  settingsZoomValue: { color: '#F7F9FC', fontSize: 16, fontWeight: '900' },
  settingsLibraryCount: { color: '#69DDD9', fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 16 },
  settingsTutorialButton: { alignSelf: 'center', minHeight: 34, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1, borderColor: '#31506A', marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  settingsTutorialButtonText: { color: '#D8E1EC', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  settingsDivider: {height: 1, backgroundColor: '#31506A', marginVertical: 18},
  settingsAccessCard: {padding: 13, borderRadius: 12, backgroundColor: '#071829', borderWidth: 1, borderColor: '#31506A'},
  settingsAccessTitle: {color: '#F7F9FC', fontSize: 13, fontWeight: '900'},
  settingsAccessDetail: {color: '#A9B8C9', fontSize: 11, marginTop: 5},
  settingsAccessExplanation: {color: '#7F91A6', fontSize: 9, lineHeight: 13, marginTop: 4},
  settingsAccessStatus: {color: '#69DDD9', fontSize: 10, fontWeight: '800', marginTop: 5},
  settingsSandboxLabel: {color: '#FFE29A', fontSize: 8, fontWeight: '900', letterSpacing: 0.35, marginTop: 12},
  settingsPlusButton: {height: 38, marginTop: 7, borderRadius: 10, backgroundColor: '#69DDD9', alignItems: 'center', justifyContent: 'center'},
  settingsPlusButtonText: {color: '#07111F', fontSize: 10, fontWeight: '900', letterSpacing: 0.25},
  settingsAccountRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  settingsAccountCopy: {flex: 1},
  settingsAccountTitle: {color: '#F7F9FC', fontSize: 13, fontWeight: '800'},
  settingsAccountDetail: {color: '#7F91A6', fontSize: 10, lineHeight: 14, marginTop: 3},
  settingsAccountButton: {minWidth: 74, height: 38, paddingHorizontal: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#20344B', borderWidth: 1, borderColor: '#69DDD9'},
  settingsAccountButtonText: {color: '#69DDD9', fontSize: 10, fontWeight: '900', letterSpacing: 0.35},
  settingsDeleteAccountButton: {minHeight: 38, marginTop: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F06275'},
  settingsDeleteAccountText: {color: '#F06275', fontSize: 10, fontWeight: '900', letterSpacing: 0.35},
  settingsAccountError: {color: '#F8A6B1', fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 9},
  settingsAccountLink: {color: '#69DDD9', fontSize: 9, fontWeight: '900', textAlign: 'center', marginTop: 8},
  settingsPolicyLinks: {flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 15},
  settingsPolicyLink: {color: '#A9B8C9', fontSize: 9, fontWeight: '800', textDecorationLine: 'underline'},
  settingsLicensesButton: {alignItems: 'center', marginTop: 15},
  licensesSheet: {maxHeight: '78%', margin: 16, padding: 20, borderRadius: 22, backgroundColor: '#102337', borderWidth: 1, borderColor: '#31506A'},
  licensesContent: {paddingBottom: 8},
  licenseName: {color: '#EAF2FA', fontSize: 13, fontWeight: '800', marginTop: 8},
  licenseDetail: {color: '#A9B8C9', fontSize: 11, lineHeight: 17, marginTop: 6},
  licenseLink: {color: '#69DDD9', fontSize: 11, lineHeight: 17, textDecorationLine: 'underline', marginTop: 5},
});
