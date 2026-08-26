import React, {useEffect, useState} from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import {AccountActivationScreen} from './src/components/AccountActivationScreen';
import { ListenerScreen } from './src/components/ListenerScreen';
import {
  DEFAULT_APP_ACCESS_CONFIG,
  loadAppAccessConfig,
  type AppAccessConfig,
} from './src/services/AppAccessConfigService';
import {
  closeActivationSession,
  observeActivationAccount,
  type ActivationAccount,
} from './src/services/ActivationService';
import {ensureAccountProfile} from './src/services/AccountProfileService';

export default function App() {
  const [accessConfig, setAccessConfig] = useState<AppAccessConfig>(DEFAULT_APP_ACCESS_CONFIG);
  const [account, setAccount] = useState<ActivationAccount | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = observeActivationAccount(nextAccount => {
        if (!mounted) return;
        setAccount(nextAccount);
        setAccountReady(true);
        if (nextAccount) setActivationOpen(false);
      });
    } catch {
      // Account activation remains optional until the native providers are
      // enabled remotely and have passed physical-device validation.
      setAccountReady(true);
    }
    loadAppAccessConfig().then(config => {
      if (mounted) setAccessConfig(config);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    // Profile synchronization is best-effort until the Firestore database and
    // rules are deployed. It never blocks translation or account activation.
    ensureAccountProfile(account).catch(() => undefined);
  }, [account]);

  const activationIsRequired = accessConfig.activationRequired && accountReady && !account;
  if (activationOpen || activationIsRequired) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <AccountActivationScreen
          config={accessConfig}
          canClose={!activationIsRequired}
          onClose={() => setActivationOpen(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ListenerScreen
        account={account}
        accessConfig={accessConfig}
        onManageAccount={() => setActivationOpen(true)}
        onSignOut={() => closeActivationSession()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
