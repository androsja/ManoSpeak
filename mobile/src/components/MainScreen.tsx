import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Image } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Svg, { Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useMediaPipeHolistic } from '../hooks/useMediaPipeHolistic';
import { TranslationService } from '../services/TranslationService';
import { TtsService } from '../services/TtsService';

export const MainScreen: React.FC = () => {
  const [modelLoading, setModelLoading] = useState(true);
  const [bufferSize, setBufferSize] = useState(0);
  const [translatedText, setTranslatedText] = useState('');
  const [speaking, setSpeaking] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Hook for camera integration and MediaPipe Holistic coordinates streaming
  const { hasPermission, requestPermission, frameProcessor, frameBuffer } = useMediaPipeHolistic(30);
  const cameraDevice = useCameraDevice('front');
  const translationServiceRef = useRef<TranslationService>(new TranslationService());
  const ttsServiceRef = useRef<TtsService>(new TtsService());

  useEffect(() => {
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

  useEffect(() => {
    let active = true;
    const updateLoop = () => {
      if (!active) return;
      setBufferSize(frameBuffer.size());
      requestAnimationFrame(updateLoop);
    };
    updateLoop();
    
    const translationInterval = setInterval(() => {
      if (frameBuffer.size() >= 30 && !modelLoading) runTranslation();
    }, 500);
    
    return () => {
      active = false;
      clearInterval(translationInterval);
    };
  }, [frameBuffer, modelLoading]);

  const lastSpokenWordRef = useRef('');

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

  useEffect(() => {
    if (translatedText && translatedText !== '' && translatedText !== lastSpokenWordRef.current) {
      lastSpokenWordRef.current = translatedText;
      ttsServiceRef.current.speak(translatedText);
      triggerTextAnimation();
    }
  }, [translatedText]);

  const triggerTextAnimation = () => {
    fadeAnim.setValue(0);
    slideAnim.setValue(20);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 6, useNativeDriver: true })
    ]).start();
  };

  const simulateTranslation = (word: string) => {
    setTranslatedText(word);
    if (word === lastSpokenWordRef.current) ttsServiceRef.current.speak(word);
    triggerTextAnimation();
  };

  const handleSpeak = async () => {
    if (!translatedText || translatedText === '') return;
    setSpeaking(true);
    await ttsServiceRef.current.speak(translatedText);
    setSpeaking(false);
  };

  const handleClear = () => {
    frameBuffer.clear();
    setBufferSize(0);
    setTranslatedText('');
    fadeAnim.setValue(0);
  };

  const mapX = (x: number) => `${Math.max(0, Math.min(100, x * 100))}%`;
  const mapY = (y: number) => `${Math.max(0, Math.min(100, y * 100))}%`;



  return (
    <View style={styles.container}>
      {hasPermission && cameraDevice ? (
        <View style={StyleSheet.absoluteFill}>
          <Camera
            style={StyleSheet.absoluteFill}
            device={cameraDevice}
            isActive={true}
            pixelFormat="rgb"
            frameProcessor={frameProcessor}
          />

          <View style={styles.vignette} />
        </View>
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.cameraText}>Camera Access Required</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.btnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Header */}
      <View style={styles.header}>
        <Image source={require('../../assets/images/logo.png')} style={{ width: 42, height: 42, resizeMode: 'contain' }} />
        <View style={styles.headerText}>
          <Text style={styles.title}>VOZUAL</Text>
          <View style={styles.badgeContainer}>
            <View style={[styles.statusDot, modelLoading ? styles.dotLoading : styles.dotActive]} />
            <Text style={styles.subtitle}>{modelLoading ? 'Initializing Neural Engine...' : 'Live Translation Active'}</Text>
          </View>
        </View>
      </View>

      {/* Glassmorphism Floating UI */}
      <View style={styles.glassPanel}>
        <View style={styles.translationSection}>
          <Text style={styles.overlayLabel}>Live Decoder</Text>
          <View style={styles.textContainer}>
            {translatedText ? (
              <Animated.Text style={[styles.translatedText, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
                {translatedText}
              </Animated.Text>
            ) : (
              <Text style={styles.placeholderText}>Signing will appear here...</Text>
            )}
          </View>
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.btnCyan]} onPress={() => simulateTranslation('Hola')}>
            <Text style={styles.btnActionText}>HOLA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.btnPurple]} onPress={() => simulateTranslation('Gracias')}>
            <Text style={styles.btnActionText}>GRACIAS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.btnCyan]} onPress={() => simulateTranslation('Colombia')}>
            <Text style={styles.btnActionText}>COLOMBIA</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.statsText}>Memory Buffer: {bufferSize}/30</Text>
          <View style={styles.miniControls}>
            <TouchableOpacity style={styles.miniBtn} onPress={handleSpeak}>
              <Text style={styles.miniBtnText}>🔊</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} onPress={handleClear}>
              <Text style={styles.miniBtnText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 15, 25, 0.4)',
  },
  header: {
    position: 'absolute',
    top: 50,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerText: {
    marginLeft: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  dotActive: { backgroundColor: '#00F0FF', shadowColor: '#00F0FF', shadowOpacity: 0.8, shadowRadius: 4 },
  dotLoading: { backgroundColor: '#F5A623' },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  glassPanel: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(20, 25, 40, 0.65)',
    borderRadius: 30,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  translationSection: {
    marginBottom: 20,
  },
  overlayLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00F0FF',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 8,
  },
  textContainer: {
    minHeight: 60,
    justifyContent: 'center',
  },
  translatedText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 240, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  placeholderText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
  },
  btnCyan: {
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    borderColor: 'rgba(0, 240, 255, 0.3)',
  },
  btnPurple: {
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    borderColor: 'rgba(138, 43, 226, 0.3)',
  },
  btnActionText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 16,
  },
  statsText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  miniControls: {
    flexDirection: 'row',
  },
  miniBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  miniBtnText: {
    fontSize: 16,
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraText: {
    color: '#FFF',
    marginBottom: 20,
  },
  permissionBtn: {
    backgroundColor: '#8A2BE2',
    padding: 12,
    borderRadius: 12,
  },
  btnText: {
    color: '#FFF',
    fontWeight: '700',
  }
});
