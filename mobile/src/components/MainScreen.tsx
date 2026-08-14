import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { useMediaPipeHolistic } from '../hooks/useMediaPipeHolistic';
import {
  CalibrationService,
  CreatorCaptureConsent,
  DiagnosticCaptureMetadata,
  DiagnosticSpeed,
  MIN_EFFECTIVE_FPS,
} from '../services/CalibrationService';
import { TtsService } from '../services/TtsService';

const TARGET_GLOSS = 'HOLA';
const DIAGNOSTIC_STEPS: Array<{
  speed: DiagnosticSpeed;
  label: string;
  spokenLabel: string;
  detail: string;
}> = [
  {
    speed: 'natural',
    label: 'NATURAL',
    spokenLabel: 'velocidad normal',
    detail: 'Haz HOLA como lo harías normalmente.',
  },
  {
    speed: 'fast',
    label: 'RÁPIDA',
    spokenLabel: 'rápido',
    detail: 'Haz HOLA rápido, sin recortar el movimiento.',
  },
  {
    speed: 'slow',
    label: 'LENTA',
    spokenLabel: 'lentamente',
    detail: 'Haz HOLA lentamente y completa todo el movimiento.',
  },
];
const TARGET_SAMPLE_COUNT = DIAGNOSTIC_STEPS.length;

interface MainScreenProps {
  captureConsent: CreatorCaptureConsent;
  onExit: () => void;
}

export const MainScreen: React.FC<MainScreenProps> = ({ captureConsent, onExit }) => {
  const [collectedCount, setCollectedCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);
  const [countingDown, setCountingDown] = useState(false);
  const [countdownStep, setCountdownStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const captureHandledRef = useRef(false);
  const activeSpeedRef = useRef<DiagnosticSpeed | null>(null);
  // Voice-only session: one button press starts it; retries and the next speeds
  // chain automatically with spoken guidance (screen may not be visible).
  const autoSessionRef = useRef(false);
  const autoAttemptsRef = useRef(0);
  const calibrationServiceRef = useRef<CalibrationService | null>(null);
  const ttsServiceRef = useRef<TtsService | null>(null);
  const calibrationService =
    calibrationServiceRef.current ??
    (calibrationServiceRef.current = new CalibrationService());
  const ttsService = ttsServiceRef.current ?? (ttsServiceRef.current = new TtsService());
  const cameraDevice = useCameraDevice('front');
  // Request an explicit high-fps format: without it the HAL may pick a slow
  // mode (observed ~7.5 FPS on Pixel), which fails the low_fps quality gate.
  const cameraFormat = useCameraFormat(cameraDevice, [
    { fps: 30 },
    { videoResolution: { width: 640, height: 480 } },
  ]);
  const {
    hasPermission,
    requestPermission,
    frameProcessor,
    frameBuffer,
    rawFrameBuffer,
    handsDetected,
    frameCount,
    waitingForRelease,
    liveFps,
    captureEnabled,
    captureComplete,
    captureEndReason,
    captureTimestamps,
    captureDurationMs,
    processorTargetFps,
    timestampClock,
    startCapture,
    resetCapture,
  } = useMediaPipeHolistic(144);

  useEffect(() => {
    calibrationService
      .countSamples(TARGET_GLOSS)
      .then((count) => setCollectedCount(Math.min(count, TARGET_SAMPLE_COUNT)))
      .catch((error) => {
        console.error('Failed to count calibration samples', error);
        setSaveError('No fue posible leer las muestras guardadas.');
      })
      .finally(() => setLoadingCount(false));
  }, []);

  useEffect(() => {
    if (!captureComplete || !captureEndReason || captureHandledRef.current) return;
    captureHandledRef.current = true;
    void finishSample();
  }, [captureComplete, captureEndReason]);

  const finishSample = async () => {
    const activeSpeed = activeSpeedRef.current;
    const step = DIAGNOSTIC_STEPS.find((candidate) => candidate.speed === activeSpeed);
    setSaving(true);
    await ttsService.speak(`Terminó la muestra ${step?.label.toLowerCase() ?? ''}. Revisando.`);

    try {
      if (!captureEndReason) throw new Error('Capture end reason is missing.');
      if (!activeSpeed || !step) throw new Error('Diagnostic speed is missing.');
      const rawFrames = rawFrameBuffer.getFrames();
      const normalizedFrames = frameBuffer.getFrames();
      const quality = calibrationService.validateSample(
        rawFrames,
        normalizedFrames,
        captureTimestamps,
        captureEndReason,
        processorTargetFps,
      );
      if (!quality.valid) {
        // Full metric dump for channel debugging (frames excluded for size)
        console.log('[Calibration] Sample rejected:', JSON.stringify(quality));
        const message = qualityMessage(quality.reasons);
        setSaveError(message);
        resetCapture(false);
        await ttsService.speak(`${message} Vamos a intentarlo de nuevo.`);
        return;
      }
      const captureMetadata: DiagnosticCaptureMetadata = {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        cameraPosition: 'front',
        cameraDeviceId: cameraDevice?.id ?? 'unknown',
        rotationDegrees: Platform.OS === 'android' ? 270 : 0,
        horizontallyMirrored: Platform.OS === 'android',
        previewVisible: false,
        mediaPipeTasksVersion: Platform.OS === 'android' ? '0.10.20' : 'ios-bundled',
        processorTargetFps,
        timestampClock,
        landmarkLayout: 'pose33_left21_right21_face468',
        normalizer: 'shoulder_center_scale_clip_v1',
        purpose: 'creator_reference',
        consent: captureConsent,
      };
      await calibrationService.saveDiagnosticSample(
        TARGET_GLOSS,
        activeSpeed,
        rawFrames,
        normalizedFrames,
        captureTimestamps,
        captureEndReason,
        captureMetadata,
      );
      const nextCount = Math.min(collectedCount + 1, TARGET_SAMPLE_COUNT);
      setCollectedCount(nextCount);
      setSaveError('');
      resetCapture(true);
      activeSpeedRef.current = null;
      if (nextCount === TARGET_SAMPLE_COUNT) {
        await ttsService.speak(
          'Prueba técnica completa. Se guardaron las muestras normal, rápida y lenta para analizarlas.',
        );
      } else {
        const nextStep = DIAGNOSTIC_STEPS[nextCount];
        await ttsService.speak(
          `Muestra ${step.label.toLowerCase()} guardada. Ahora viene la ${nextStep.label.toLowerCase()}. Mantén las manos abajo.`,
        );
      }
    } catch (error) {
      console.error('Failed to save calibration sample', error);
      setSaveError('No se pudo guardar este ejemplo. Intenta nuevamente.');
      resetCapture(false);
      await ttsService.speak('No pude guardar el ejemplo. Intenta nuevamente.');
    } finally {
      setSaving(false);
      captureHandledRef.current = false;
    }
  };

  // Auto-chain the voice-only session: whenever the app is idle mid-session,
  // start the next capture (retry or next speed) without a button press.
  useEffect(() => {
    if (!autoSessionRef.current || complete) {
      autoSessionRef.current = autoSessionRef.current && !complete;
      return;
    }
    if (loadingCount || saving || countingDown || waitingForRelease || captureEnabled) return;
    if (autoAttemptsRef.current >= 9) {
      autoSessionRef.current = false;
      void ttsService.speak('Demasiados intentos. Pulsa grabar para continuar.');
      return;
    }
    const timer = setTimeout(() => {
      autoAttemptsRef.current += 1;
      void beginSample();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCount, saving, countingDown, waitingForRelease, captureEnabled, collectedCount, saveError]);

  const beginSample = async () => {
    if (
      loadingCount ||
      saving ||
      countingDown ||
      waitingForRelease ||
      captureEnabled ||
      collectedCount >= TARGET_SAMPLE_COUNT
    ) return;

    const step = DIAGNOSTIC_STEPS[collectedCount];
    activeSpeedRef.current = step.speed;
    setSaveError('');
    setCountingDown(true);
    setCountdownStep('PREPÁRATE');
    await ttsService.speak(
      `Muestra ${collectedCount + 1}. HOLA ${step.spokenLabel}. Manos abajo. Al oír ya, haz HOLA una vez y baja las manos al terminar.`,
    );
    await ttsService.speak('Ya.');
    startCapture();
    setCountdownStep('');
    setCountingDown(false);
  };

  const resetAllSamples = async () => {
    if (saving || countingDown || captureEnabled) return;
    try {
      await calibrationService.deleteSamples(TARGET_GLOSS);
      resetCapture(false);
      activeSpeedRef.current = null;
      setCollectedCount(0);
      setSaveError('');
      await ttsService.speak('Prueba reiniciada. La primera muestra será a velocidad normal.');
    } catch (error) {
      console.error('Failed to delete diagnostic samples', error);
      setSaveError('No fue posible borrar las muestras.');
      await ttsService.speak('No pude borrar las muestras.');
    }
  };

  const confirmReset = () => {
    Alert.alert(
      'Reiniciar prueba',
      'Se borrarán los puntos de referencia guardados localmente. No se guarda video.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => void resetAllSamples() },
      ],
    );
  };

  const exitCreatorCapture = () => {
    if (saving || countingDown || captureEnabled) return;
    resetCapture(false);
    onExit();
  };

  const complete = collectedCount >= TARGET_SAMPLE_COUNT;
  const currentStep = DIAGNOSTIC_STEPS[Math.min(collectedCount, TARGET_SAMPLE_COUNT - 1)];
  const buttonDisabled =
    loadingCount || saving || countingDown || waitingForRelease || captureEnabled || complete;
  const instruction = loadingCount
    ? 'Preparando la recolección'
    : complete
      ? 'Recolección completa'
      : saving
        ? 'Guardando el ejemplo'
        : waitingForRelease
          ? 'Retira las manos'
          : countingDown
            ? countdownStep || 'Prepárate'
            : captureEnabled && frameCount > 0
              ? 'Haz HOLA y luego baja las manos'
              : captureEnabled
                ? 'Haz HOLA ahora'
                : `HOLA · VELOCIDAD ${currentStep.label}`;
  const detail = complete
    ? 'Ahora se revisarán duración, velocidad, manos, hombros y movimiento.'
    : waitingForRelease
      ? 'Baja completamente las manos antes del siguiente ejemplo.'
      : captureEnabled
        ? `${currentStep.detail} Al terminar, baja completamente las manos.`
        : `${currentStep.detail} Pulsa el botón y espera a escuchar YA.`;

  return (
    <View style={styles.container}>
      {hasPermission && cameraDevice ? (
        <Camera
          style={styles.cameraPreview}
          device={cameraDevice}
          isActive={true}
          format={cameraFormat}
          fps={24}
          pixelFormat="rgb"
          frameProcessor={frameProcessor}
        />
      ) : (
        <View style={styles.permissionPanel}>
          <Text style={styles.permissionText}>Se necesita acceso a la cámara.</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.buttonText}>PERMITIR CÁMARA</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.header}>
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} />
        <View>
          <Text style={styles.brand}>VOZUAL</Text>
          <Text style={styles.phase}>CREADOR · REFERENCIA LOCAL</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.privacyStatus}>VISTA PREVIA LOCAL · NO SE GUARDA VIDEO</Text>
        <Text style={liveFps >= MIN_EFFECTIVE_FPS ? styles.fpsGood : styles.fpsBad}>
          CÁMARA · {liveFps.toFixed(1)} CUADROS/SEG{' '}
          {liveFps >= MIN_EFFECTIVE_FPS ? '✓' : `✗ (mínimo ${MIN_EFFECTIVE_FPS})`}
        </Text>
        <Text style={styles.counter}>
          MUESTRAS GUARDADAS · {collectedCount} DE {TARGET_SAMPLE_COUNT}
        </Text>
        {!complete ? (
          <Text style={styles.speedLabel}>
            MUESTRA {collectedCount + 1} · VELOCIDAD {currentStep.label}
          </Text>
        ) : null}
        <Text style={styles.instruction}>{instruction}</Text>
        <Text style={styles.detail}>{detail}</Text>

        <Text style={styles.frameStatus}>
          {captureEnabled
            ? frameCount > 0
              ? `GRABANDO · ${(captureDurationMs / 1000).toFixed(1)} s`
              : 'ESPERANDO LAS MANOS'
            : handsDetected
              ? 'MANOS DETECTADAS'
              : 'GRABACIÓN DETENIDA'}
        </Text>

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

        <TouchableOpacity
          style={[styles.primaryButton, buttonDisabled && styles.primaryButtonDisabled]}
          disabled={buttonDisabled}
          onPress={() => {
            autoSessionRef.current = true;
            autoAttemptsRef.current = 0;
            void beginSample();
          }}
        >
          <Text style={styles.buttonText}>
            {complete
              ? '3 MUESTRAS LISTAS PARA ANÁLISIS'
              : saving
                ? 'GUARDANDO...'
                : waitingForRelease
                  ? 'RETIRA LAS MANOS'
                  : countingDown
                    ? countdownStep
                    : `GRABAR HOLA ${currentStep.label}`}
          </Text>
        </TouchableOpacity>

        {collectedCount > 0 && !captureEnabled && !countingDown && !saving ? (
          <TouchableOpacity style={styles.resetButton} onPress={confirmReset}>
            <Text style={styles.resetButtonText}>BORRAR Y REINICIAR PRUEBA</Text>
          </TouchableOpacity>
        ) : null}
        {!captureEnabled && !countingDown && !saving ? (
          <TouchableOpacity style={styles.exitButton} onPress={exitCreatorCapture}>
            <Text style={styles.exitButtonText}>SALIR SIN GRABAR MÁS</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  cameraPreview: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  header: {
    position: 'absolute', top: 52, left: 24, right: 24,
    flexDirection: 'row', alignItems: 'center',
  },
  logo: { width: 44, height: 44, resizeMode: 'contain', marginRight: 12 },
  brand: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  phase: { color: '#00D5DF', fontSize: 10, fontWeight: '700', marginTop: 2 },
  panel: {
    position: 'absolute', left: 20, right: 20, bottom: 30,
    padding: 24, backgroundColor: '#151B2A', borderRadius: 8,
    borderWidth: 1, borderColor: '#2A3348',
  },
  counter: { color: '#00D5DF', fontSize: 13, fontWeight: '800', marginBottom: 14 },
  privacyStatus: { color: '#B7C0D4', fontSize: 10, fontWeight: '800', marginBottom: 8 },
  fpsGood: { color: '#5DDE7C', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  fpsBad: { color: '#FF7A7A', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  speedLabel: { color: '#FFCC66', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  instruction: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginBottom: 10 },
  detail: { color: '#B7C0D4', fontSize: 15, lineHeight: 22 },
  frameStatus: { color: '#8E99B0', fontSize: 12, marginTop: 24, marginBottom: 22 },
  error: { color: '#FF7A7A', fontSize: 13, marginBottom: 16 },
  primaryButton: {
    minHeight: 56, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#00B8C4', borderRadius: 8,
  },
  primaryButtonDisabled: { backgroundColor: '#394156' },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  resetButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  resetButtonText: { color: '#B7C0D4', fontSize: 12, fontWeight: '700' },
  exitButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  exitButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  permissionPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permissionText: { color: '#FFFFFF', fontSize: 16, marginBottom: 18 },
  permissionButton: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#00B8C4', borderRadius: 8 },
});

function qualityMessage(reasons: string[]): string {
  if (reasons.includes('too_short')) return 'La grabación fue demasiado corta.';
  if (reasons.includes('too_long')) return 'La grabación superó cinco segundos.';
  if (reasons.includes('missing_shoulders')) return 'No se detectaron bien los hombros.';
  if (reasons.includes('missing_hands')) return 'Se perdió la detección de las manos.';
  if (reasons.includes('low_fps')) return 'La cámara procesó muy pocos cuadros.';
  if (reasons.includes('large_frame_gap')) return 'La cámara perdió demasiados cuadros.';
  if (reasons.includes('invalid_normalization')) return 'Los datos normalizados no son válidos.';
  return 'La grabación no pasó la validación técnica.';
}
