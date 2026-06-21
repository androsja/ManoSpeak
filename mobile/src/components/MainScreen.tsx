import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { FrameBuffer } from '../services/FrameBuffer';
import { TranslationService } from '../services/TranslationService';
import { TtsService } from '../services/TtsService';

export const MainScreen: React.FC = () => {
  const [modelLoading, setModelLoading] = useState(true);
  const [bufferSize, setBufferSize] = useState(0);
  const [translatedText, setTranslatedText] = useState('');
  const [speaking, setSpeaking] = useState(false);

  // References to Services (preserved across renders)
  const frameBufferRef = useRef<FrameBuffer>(new FrameBuffer(30));
  const translationServiceRef = useRef<TranslationService>(new TranslationService());
  const ttsServiceRef = useRef<TtsService>(new TtsService());

  useEffect(() => {
    // Simulate loading model on mount
    const initModel = async () => {
      try {
        await translationServiceRef.current.loadModel();
        setModelLoading(false);
      } catch (err) {
        console.error('Failed to load PhonSSM model', err);
      }
    };
    initModel();
  }, []);

  // Update translation text when buffer changes
  const runTranslation = async () => {
    try {
      const gloss = await translationServiceRef.current.translateFrameBuffer(
        frameBufferRef.current
      );
      setTranslatedText(gloss);
    } catch (err) {
      console.error('Translation error', err);
    }
  };

  // Helper to add a mock gesture frame (representing MediaPipe output)
  const addMockFrameForSign = (value: number) => {
    const frame: number[][] = [];
    for (let i = 0; i < 543; i++) {
      frame.push([value, value, value]);
    }
    try {
      frameBufferRef.current.addFrame(frame);
      setBufferSize(frameBufferRef.current.size());
      runTranslation();
    } catch (err) {
      console.error(err);
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
    frameBufferRef.current.clear();
    setBufferSize(0);
    setTranslatedText('');
  };

  return (
    <View style={styles.container}>
      {/* 1. Header Area */}
      <View style={styles.header}>
        <Text style={styles.title}>ManoSpeak</Text>
        <Text style={styles.subtitle}>Traductor LSC Offline</Text>
      </View>

      {/* 2. Live Camera Stream Frame (Placeholder) */}
      <View style={styles.cameraFrame}>
        <View style={styles.cameraOverlay}>
          <Text style={styles.cameraText}>[ Vista de Cámara MediaPipe Activa ]</Text>
          <Text style={styles.statsText}>
            Buffer Temporal: {bufferSize} / 30 frames
          </Text>
          {modelLoading ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.loaderText}>Cargando phonssm_quant.tflite...</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>● Modelo PhonSSM Cargado</Text>
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
        <Text style={styles.consoleLabel}>Simulador de Gestos MediaPipe:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => addMockFrameForSign(0.0)} // hola recipe (sum = 0)
          >
            <Text style={styles.btnText}>+ Seña: HOLA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => addMockFrameForSign(1.0 / (543 * 3))} // gracias recipe (sum = 1)
          >
            <Text style={styles.btnText}>+ Seña: GRACIAS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => addMockFrameForSign(5.0 / (543 * 3))} // colombia recipe (sum = 5)
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
    backgroundColor: '#0F172A', // Deep slate dark mode
    padding: 16,
  },
  header: {
    marginTop: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#38BDF8', // Sky blue primary
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  cameraFrame: {
    flex: 3,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#334155',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cameraOverlay: {
    alignItems: 'center',
    padding: 16,
  },
  cameraText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  statsText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  loaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loaderText: {
    color: '#94A3B8',
    fontSize: 12,
    marginLeft: 8,
  },
  statusText: {
    color: '#10B981', // Emerald green online indicator
    fontSize: 12,
    fontWeight: '700',
  },
  translationOverlay: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
    justifyContent: 'center',
  },
  overlayLabel: {
    fontSize: 12,
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
    fontSize: 14,
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
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  scroll: {
    flexDirection: 'row',
    marginBottom: 16,
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
