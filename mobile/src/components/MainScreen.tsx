import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Svg, { Circle, Line } from 'react-native-svg';
import { ManoSpeakIcon } from './ManoSpeakIcon';
import { useMediaPipeHolistic } from '../hooks/useMediaPipeHolistic';
import { TranslationService } from '../services/TranslationService';
import { TtsService } from '../services/TtsService';

export const MainScreen: React.FC = () => {
  const [modelLoading, setModelLoading] = useState(true);
  const [bufferSize, setBufferSize] = useState(0);
  const [translatedText, setTranslatedText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [currentLandmarks, setCurrentLandmarks] = useState<number[][] | null>(null);

  // Hook for camera integration and MediaPipe Holistic coordinates streaming
  const { hasPermission, requestPermission, frameProcessor, frameBuffer, rawLandmarks } = useMediaPipeHolistic(30);

  // Get front camera device
  const cameraDevice = useCameraDevice('front');

  // References to Services (preserved across renders)
  const translationServiceRef = useRef<TranslationService>(new TranslationService());
  const ttsServiceRef = useRef<TtsService>(new TtsService());

  useEffect(() => {
    // Simulate loading model on mount
    const initModel = async () => {
      try {
        await translationServiceRef.current.loadModel();
        setModelLoading(false);
      } catch (err) {
        console.error('Failed to load LSC dictionary models', err);
      }
    };
    initModel();
  }, []);

  // Frame update loop pulling from frame buffer to render skeleton overlay
  useEffect(() => {
    let active = true;
    const updateLoop = () => {
      if (!active) return;
      const size = frameBuffer.size();
      setBufferSize(size);
      
      requestAnimationFrame(updateLoop);
    };
    updateLoop();
    
    // Translation loop: Try to translate every 500ms
    const translationInterval = setInterval(() => {
      if (frameBuffer.size() >= 30 && !modelLoading) {
        runTranslation();
      }
    }, 500);
    
    return () => {
      active = false;
      clearInterval(translationInterval);
    };
  }, [frameBuffer, modelLoading]);

  const lastSpokenWordRef = useRef('');

  // Update translation text when buffer changes
  const runTranslation = async () => {
    try {
      const gloss = await translationServiceRef.current.translateFrameBuffer(frameBuffer);
      if (gloss && gloss !== '') {
        setTranslatedText(gloss);
      }
    } catch (err) {
      console.error('Translation error', err);
    }
  };

  // Automatically speak when a NEW translation is detected
  useEffect(() => {
    if (translatedText && translatedText !== '' && translatedText !== lastSpokenWordRef.current) {
      lastSpokenWordRef.current = translatedText;
      ttsServiceRef.current.speak(translatedText);
    }
  }, [translatedText]);

  // Helper to directly simulate a translated word to test the TTS engine
  const simulateTranslation = (word: string) => {
    setTranslatedText(word);
    // Si la palabra es la misma, el useEffect no se dispara, forzamos hablarla.
    if (word === lastSpokenWordRef.current) {
      ttsServiceRef.current.speak(word);
    }
  };

  const handleSpeak = async () => {
    if (!translatedText || translatedText === '') {
      return;
    }
    setSpeaking(true);
    await ttsServiceRef.current.speak(translatedText);
    setSpeaking(false);
  };

  const handleClear = () => {
    frameBuffer.clear();
    setBufferSize(0);
    setTranslatedText('');
  };

  // MediaPipe raw landmarks are in [0.0, 1.0] representing percentage of the image dimensions.
  // We simply multiply by 100 to get the CSS percentage.
  const mapX = (x: number) => `${Math.max(0, Math.min(100, x * 100))}%`;
  const mapY = (y: number) => `${Math.max(0, Math.min(100, y * 100))}%`;

  const renderSkeletonOverlay = () => {
    if (!rawLandmarks || rawLandmarks.length !== 543) {
      return null;
    }

    const landmarks = rawLandmarks;
    const isZero = (pt: number[]) => pt[0] === 0 && pt[1] === 0 && pt[2] === 0;

    // Define structural points
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];

    // Left hand landmarks (501 to 522)
    const leftHandPoints = landmarks.slice(501, 522);
    // Right hand landmarks (522 to 543)
    const rightHandPoints = landmarks.slice(522, 543);

    return (
      <Svg style={StyleSheet.absoluteFill}>
        {/* Render Torso / Arm Connections */}
        {!isZero(leftShoulder) && !isZero(rightShoulder) && (
          <Line
            x1={mapX(leftShoulder[0])} y1={mapY(leftShoulder[1])}
            x2={mapX(rightShoulder[0])} y2={mapY(rightShoulder[1])}
            stroke="#0EA5E9" strokeWidth="3"
          />
        )}
        {!isZero(leftShoulder) && !isZero(leftElbow) && (
          <Line
            x1={mapX(leftShoulder[0])} y1={mapY(leftShoulder[1])}
            x2={mapX(leftElbow[0])} y2={mapY(leftElbow[1])}
            stroke="#0EA5E9" strokeWidth="2.5"
          />
        )}
        {!isZero(leftElbow) && !isZero(leftWrist) && (
          <Line
            x1={mapX(leftElbow[0])} y1={mapY(leftElbow[1])}
            x2={mapX(leftWrist[0])} y2={mapY(leftWrist[1])}
            stroke="#0EA5E9" strokeWidth="2.5"
          />
        )}
        {!isZero(rightShoulder) && !isZero(rightElbow) && (
          <Line
            x1={mapX(rightShoulder[0])} y1={mapY(rightShoulder[1])}
            x2={mapX(rightElbow[0])} y2={mapY(rightElbow[1])}
            stroke="#0EA5E9" strokeWidth="2.5"
          />
        )}
        {!isZero(rightElbow) && !isZero(rightWrist) && (
          <Line
            x1={mapX(rightElbow[0])} y1={mapY(rightElbow[1])}
            x2={mapX(rightWrist[0])} y2={mapY(rightWrist[1])}
            stroke="#0EA5E9" strokeWidth="2.5"
          />
        )}

        {/* Render Left Hand Points */}
        {leftHandPoints.map((pt, idx) => !isZero(pt) ? (
          <Circle
            key={`lh-${idx}`}
            cx={mapX(pt[0])}
            cy={mapY(pt[1])}
            r="4"
            fill="#10B981"
          />
        ) : null)}

        {/* Render Right Hand Points */}
        {rightHandPoints.map((pt, idx) => !isZero(pt) ? (
          <Circle
            key={`rh-${idx}`}
            cx={mapX(pt[0])}
            cy={mapY(pt[1])}
            r="4"
            fill="#F43F5E"
          />
        ) : null)}

        {/* Render Face Outline points */}
        {landmarks.slice(75, 120).map((pt, idx) => !isZero(pt) ? (
          <Circle
            key={`face-${idx}`}
            cx={mapX(pt[0])}
            cy={mapY(pt[1])}
            r="2"
            fill="#38BDF8"
            opacity={0.7}
          />
        ) : null)}
      </Svg>
    );
  };

  return (
    <View style={styles.container}>
      {/* 1. Header Area */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <ManoSpeakIcon size={42} />
          <View style={styles.headerText}>
            <Text style={styles.title}>ManoSpeak</Text>
            <Text style={styles.subtitle}>Traductor LSC · Offline</Text>
          </View>
        </View>
      </View>

      {/* 2. Camera View & Overlay */}
      <View style={styles.cameraContainer}>
        {hasPermission && cameraDevice ? (
          <View style={StyleSheet.absoluteFill}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={cameraDevice}
              isActive={true}
              pixelFormat="rgb"
              frameProcessor={frameProcessor}
              onError={(error) => console.warn('Cámara no disponible (posible simulador):', error)}
            />
            {renderSkeletonOverlay()}
          </View>
        ) : (
          <View style={styles.cameraPlaceholder}>
            <Text style={styles.cameraText}>Acceso a Cámara Desactivado</Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Solicitar Permiso</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.statsOverlay}>
          <Text style={styles.statsText}>Buffer: {bufferSize} / 30 frames</Text>
          {modelLoading ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color="#38BDF8" />
              <Text style={styles.loaderText}>Cargando Diccionario LSC...</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>● Diccionario LSC Activo</Text>
          )}
        </View>
      </View>

      {/* 3. Translation Overlay Area at the Bottom */}
      <View style={styles.translationOverlay}>
        <Text style={styles.overlayLabel}>Traducción LSC:</Text>
        <View style={styles.textContainer}>
          {translatedText ? (
            <Text style={styles.translatedText}>{translatedText}</Text>
          ) : (
            <Text style={styles.placeholderText}>
              Inicie señas frente a la cámara para ver la traducción...
            </Text>
          )}
        </View>
      </View>

      {/* 4. Controls Console */}
      <View style={styles.console}>
        <Text style={styles.consoleLabel}>Simulador de Gestos LSC:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => simulateTranslation('Hola')}
          >
            <Text style={styles.btnText}>+ Seña: HOLA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => simulateTranslation('Gracias')}
          >
            <Text style={styles.btnText}>+ Seña: GRACIAS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => simulateTranslation('Colombia')}
          >
            <Text style={styles.btnText}>+ Seña: COLOMBIA</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.ttsButton, (!translatedText || speaking) && styles.disabledButton]}
            onPress={handleSpeak}
            disabled={!translatedText || speaking}
          >
            <Text style={styles.btnText}>
              {speaking ? 'Vocalizando...' : '🔊 Hablar Seña'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.btnText}>🧹 Limpiar Buffer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 16,
  },
  header: {
    marginTop: 24,
    marginBottom: 12,
    alignItems: 'center',
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    marginLeft: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  cameraContainer: {
    flex: 3,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#334155',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  cameraText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  permissionBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  statsOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statsText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loaderText: {
    color: '#94A3B8',
    fontSize: 11,
    marginLeft: 6,
  },
  statusText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  translationOverlay: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
    justifyContent: 'center',
  },
  overlayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  textContainer: {
    minHeight: 48,
    justifyContent: 'center',
  },
  translatedText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  console: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  consoleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  scroll: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  actionButton: {
    backgroundColor: '#0EA5E9',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginRight: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ttsButton: {
    flex: 1,
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  clearButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 8,
  },
  disabledButton: {
    backgroundColor: '#475569',
    opacity: 0.6,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
