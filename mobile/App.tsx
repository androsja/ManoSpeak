import React, {useEffect, useState} from 'react';
import {AppState, StatusBar, StyleSheet} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {AccountActivationScreen} from './src/components/AccountActivationScreen';
import { ListenerScreen } from './src/components/ListenerScreen';
import {
  DEFAULT_APP_ACCESS_CONFIG,
  loadAppAccessConfig,
  type AppAccessConfig,
} from './src/services/AppAccessConfigService';
import {
  closeActivationSession,
  deleteActivationAccount,
  observeActivationAccount,
  type ActivationAccount,
} from './src/services/ActivationService';
import {ensureAccountProfile} from './src/services/AccountProfileService';
import {loadPlusEntitlement} from './src/services/AccountAccessService';
import {SignLanguageLibraryScreen} from './src/components/SignLanguageLibraryScreen';
import {
  completeSignLanguageSetup,
  dismissSignLanguageChanges,
  hasCompletedSignLanguageSetup,
  installedPhrasesForSelectedLanguage,
  installedSignsForSelectedLanguage,
  listSignLanguages,
  type InstalledPhrase,
  type InstalledSign,
  unpromptedSignChangeCount,
} from './src/services/SignLanguageService';
import {I18nProvider} from './src/i18n/I18n';

function AppContent() {
  const [accessConfig, setAccessConfig] = useState<AppAccessConfig>(DEFAULT_APP_ACCESS_CONFIG);
  const [account, setAccount] = useState<ActivationAccount | null>(null);
  const [hasPlusEntitlement, setHasPlusEntitlement] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryCheckComplete, setLibraryCheckComplete] = useState(false);
  const [initialLibrarySetup, setInitialLibrarySetup] = useState(false);
  const [availableSigns, setAvailableSigns] = useState<InstalledSign[]>([]);
  const [availablePhrases, setAvailablePhrases] = useState<InstalledPhrase[]>([]);
  const [availableSignChangeCount, setAvailableSignChangeCount] = useState(0);

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
    let mounted = true;
    const refreshSignUpdateNotice = async () => {
      try {
        const available = await listSignLanguages();
        if (mounted) setAvailableSignChangeCount(unpromptedSignChangeCount(available));
      } catch {
        // Existing local packages remain usable while offline.
      }
    };
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') void refreshSignUpdateNotice();
    });
    Promise.all([
      installedSignsForSelectedLanguage(),
      installedPhrasesForSelectedLanguage(),
      hasCompletedSignLanguageSetup(),
    ])
      .then(async ([installed, phrases, setupComplete]) => {
        if (!mounted) return;
        setAvailableSigns(installed);
        setAvailablePhrases(phrases);
        const firstSetup = installed.length === 0 && !setupComplete;
        setInitialLibrarySetup(firstSetup);
        if (firstSetup) {
          setLibraryOpen(true);
          return;
        }
        await refreshSignUpdateNotice();
      })
      .catch(() => {
        // A catalogue outage must not prevent an already configured app from
        // opening. The library screen offers an explicit retry during setup.
      })
      .finally(() => {
        if (mounted) setLibraryCheckComplete(true);
      });
    return () => {
      mounted = false;
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    // Profile synchronization is best-effort until the Firestore database and
    // rules are deployed. It never blocks translation or account activation.
    ensureAccountProfile(account).catch(() => undefined);
  }, [account]);

  useEffect(() => {
    let mounted = true;
    if (!account) {
      setHasPlusEntitlement(false);
      return () => { mounted = false; };
    }
    const refreshEntitlement = () => {
      loadPlusEntitlement(account.uid)
        .then(active => {
          if (mounted) setHasPlusEntitlement(active);
        })
        .catch(() => {
          if (mounted) setHasPlusEntitlement(false);
        });
    };
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') refreshEntitlement();
    });
    refreshEntitlement();
    return () => {
      mounted = false;
      appStateSubscription.remove();
    };
  }, [account]);

  const activationIsRequired = accessConfig.activationRequired && accountReady && !account;
  if (!libraryCheckComplete) return null;
  if (libraryOpen) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SignLanguageLibraryScreen
          initialSetup={initialLibrarySetup}
          onContinue={statuses => {
            void (async () => {
              try {
                await dismissSignLanguageChanges(statuses);
                await completeSignLanguageSetup();
                const [signs, phrases] = await Promise.all([
                  installedSignsForSelectedLanguage(),
                  installedPhrasesForSelectedLanguage(),
                ]);
                setAvailableSigns(signs);
                setAvailablePhrases(phrases);
                setAvailableSignChangeCount(0);
              } finally {
                setLibraryOpen(false);
                setInitialLibrarySetup(false);
              }
            })();
          }}
        />
      </SafeAreaView>
    );
  }
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
        hasPlusEntitlement={hasPlusEntitlement}
        onManageAccount={() => setActivationOpen(true)}
        installedSigns={availableSigns}
        installedPhrases={availablePhrases}
        availableSignChangeCount={availableSignChangeCount}
        onManageSignLanguages={() => {
          setInitialLibrarySetup(false);
          setLibraryOpen(true);
        }}
        onSignOut={() => closeActivationSession()}
        onDeleteAccount={() => deleteActivationAccount(accessConfig.googleWebClientId)}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
