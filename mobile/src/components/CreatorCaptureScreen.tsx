import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CreatorCaptureConsent } from '../services/CalibrationService';
import { MainScreen } from './MainScreen';

type CreatorStep = 'introduction' | 'consent' | 'capture';

export const CreatorCaptureScreen: React.FC = () => {
  const [step, setStep] = useState<CreatorStep>('introduction');
  const [understood, setUnderstood] = useState(false);
  const [consent, setConsent] = useState<CreatorCaptureConsent | null>(null);

  const acceptConsent = () => {
    if (!understood) return;
    setConsent({
      version: 'creator_capture_consent_v1',
      acceptedAt: new Date().toISOString(),
      scope: 'avatar_animation_reference',
      localOnly: true,
      trainingEligible: false,
    });
    setStep('capture');
  };

  if (step === 'capture' && consent) {
    return <MainScreen captureConsent={consent} onExit={() => setStep('introduction')} />;
  }

  if (step === 'consent') {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>MODO CREADOR</Text>
        <Text style={styles.title}>Antes de grabar</Text>
        <Text style={styles.body}>
          La cámara se usará únicamente cuando continúes. Verás una vista previa para encuadrar
          rostro, hombros y ambas manos. La aplicación guarda puntos de movimiento localmente,
          no video ni audio.
        </Text>
        <Text style={styles.body}>
          Esta toma será referencia para animar el avatar. No se usa para entrenamiento ni se
          comparte. Podrás borrar todas las tomas desde el siguiente paso.
        </Text>
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: understood }}
          style={[styles.checkbox, understood && styles.checkboxChecked]}
          onPress={() => setUnderstood((value) => !value)}
        >
          <Text style={styles.checkboxText}>{understood ? '✓' : '○'} Entiendo y acepto esta toma local.</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={!understood}
          style={[styles.primaryButton, !understood && styles.primaryButtonDisabled]}
          onPress={acceptConsent}
        >
          <Text style={styles.primaryButtonText}>ACEPTAR Y ABRIR CÁMARA</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => setStep('introduction')}>
          <Text style={styles.secondaryButtonText}>CANCELAR</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>MANOSPEAK · CREADOR</Text>
      <Text style={styles.title}>Crea una referencia de seña</Text>
      <Text style={styles.body}>
        Para la primera prueba haremos HOLA. Ubícate frente a la cámara, con buena luz, el rostro
        visible y las dos manos completas dentro del encuadre. Empieza y termina con las manos abajo.
      </Text>
      <Text style={styles.body}>
        Tendrás una toma natural, una rápida y una lenta. Puedes repetir o borrar las tomas cuando
        quieras. La cámara no se activa hasta que aceptes explícitamente.
      </Text>
      <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={() => setStep('consent')}>
        <Text style={styles.primaryButtonText}>PREPARAR TOMA DE HOLA</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#0B0F19' },
  eyebrow: { color: '#00D5DF', fontSize: 12, fontWeight: '800', marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginBottom: 18 },
  body: { color: '#C8D0E0', fontSize: 16, lineHeight: 24, marginBottom: 16 },
  checkbox: { padding: 16, borderWidth: 1, borderColor: '#45506A', borderRadius: 8, marginBottom: 16 },
  checkboxChecked: { borderColor: '#00D5DF', backgroundColor: '#132C36' },
  checkboxText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  primaryButton: { minHeight: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00B8C4', borderRadius: 8 },
  primaryButtonDisabled: { backgroundColor: '#394156' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryButtonText: { color: '#B7C0D4', fontSize: 13, fontWeight: '700' },
});
