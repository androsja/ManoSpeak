import React, {useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {AppAccessConfig} from '../services/AppAccessConfigService';
import {
  activateWithApple,
  activateWithGoogle,
} from '../services/ActivationService';
import {
  activationErrorDetails,
  messageForActivationError,
} from '../services/ActivationErrorMessage';

type AccountActivationScreenProps = {
  config: AppAccessConfig;
  canClose: boolean;
  onClose: () => void;
};

export function AccountActivationScreen({
  config,
  canClose,
  onClose,
}: AccountActivationScreenProps) {
  const [workingProvider, setWorkingProvider] = useState<'google' | 'apple' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const hasProvider = config.googleAuthEnabled
    || (Platform.OS === 'ios' && config.appleAuthEnabled);

  const activate = async (provider: 'google' | 'apple') => {
    setWorkingProvider(provider);
    setErrorMessage('');
    try {
      if (provider === 'google') {
        await activateWithGoogle(config.googleWebClientId);
      } else {
        await activateWithApple();
      }
      onClose();
    } catch (error) {
      const details = activationErrorDetails(error);
      console.warn('[VOZUAL activation]', {
        provider,
        code: details.code,
        message: details.message,
      });
      setErrorMessage(messageForActivationError(error));
    } finally {
      setWorkingProvider(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.brandBlock}>
        <Text style={styles.brand}>VOZUAL</Text>
        <Text style={styles.subtitle}>TRADUCTOR DE HABLA A LSC</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>✓</Text>
        </View>
        <Text style={styles.title}>Activa tu cuenta gratis</Text>
        <Text style={styles.description}>
          Guarda tu acceso, el uso mensual y las futuras ventajas Plus. Activar la cuenta no genera ningún cobro.
        </Text>

        {config.googleAuthEnabled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continuar con Google"
            disabled={workingProvider !== null}
            onPress={() => activate('google')}
            style={({pressed}) => [styles.providerButton, pressed && styles.buttonPressed]}
          >
            {workingProvider === 'google'
              ? <ActivityIndicator color="#07111F" />
              : <Text style={styles.providerButtonText}>CONTINUAR CON GOOGLE</Text>}
          </Pressable>
        )}

        {Platform.OS === 'ios' && config.appleAuthEnabled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continuar con Apple"
            disabled={workingProvider !== null}
            onPress={() => activate('apple')}
            style={({pressed}) => [styles.appleButton, pressed && styles.buttonPressed]}
          >
            {workingProvider === 'apple'
              ? <ActivityIndicator color="#F7F9FC" />
              : <Text style={styles.appleButtonText}>CONTINUAR CON APPLE</Text>}
          </Pressable>
        )}

        {!hasProvider && (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingTitle}>ACTIVACIÓN EN PREPARACIÓN</Text>
            <Text style={styles.pendingText}>
              Estamos terminando la conexión segura con Google y Apple. La traducción sigue disponible mientras tanto.
            </Text>
          </View>
        )}

        {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        {canClose && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Usar VOZUAL gratis sin cuenta"
            disabled={workingProvider !== null}
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>USAR GRATIS SIN CUENTA</Text>
          </Pressable>
        )}

        <Text style={styles.privacy}>
          No se realiza ningún cobro al activar. VOZUAL tampoco guarda el audio ni las frases que dices.
        </Text>
        <Text style={styles.support}>Soporte: {config.supportEmail}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: '#07111F',
  },
  brandBlock: {marginBottom: 28},
  brand: {color: '#F7F9FC', fontSize: 34, fontWeight: '900', letterSpacing: 1},
  subtitle: {color: '#69DDD9', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginTop: 5},
  card: {padding: 24, borderRadius: 24, backgroundColor: '#102337', borderWidth: 1, borderColor: '#31506A'},
  iconCircle: {width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#69DDD9'},
  icon: {color: '#07111F', fontSize: 27, fontWeight: '900'},
  title: {color: '#F7F9FC', fontSize: 26, fontWeight: '900', marginTop: 18},
  description: {color: '#A9B8C9', fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 24},
  providerButton: {height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#69DDD9', marginBottom: 12},
  providerButtonText: {color: '#07111F', fontSize: 14, fontWeight: '900', letterSpacing: 0.4},
  appleButton: {height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#020812', marginBottom: 12, borderWidth: 1, borderColor: '#52677E'},
  appleButtonText: {color: '#F7F9FC', fontSize: 14, fontWeight: '900', letterSpacing: 0.4},
  pendingBox: {padding: 16, borderRadius: 14, backgroundColor: '#071829', borderWidth: 1, borderColor: '#31506A'},
  pendingTitle: {color: '#69DDD9', fontSize: 11, fontWeight: '900', letterSpacing: 0.6},
  pendingText: {color: '#A9B8C9', fontSize: 14, lineHeight: 20, marginTop: 7},
  error: {color: '#F06275', textAlign: 'center', fontSize: 13, lineHeight: 18, marginTop: 10},
  closeButton: {height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#69DDD9', marginTop: 14},
  closeButtonText: {color: '#69DDD9', fontSize: 13, fontWeight: '900'},
  privacy: {color: '#7F91A6', textAlign: 'center', fontSize: 11, lineHeight: 16, marginTop: 20},
  support: {color: '#7F91A6', textAlign: 'center', fontSize: 10, marginTop: 7},
  buttonPressed: {opacity: 0.76},
});
