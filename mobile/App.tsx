import React, {useEffect, useRef, useState} from 'react';
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
import {ensureAccountProfile, updateSelectedSignLanguage} from './src/services/AccountProfileService';
import {loadPlusEntitlement} from './src/services/AccountAccessService';
import {SignLanguageLibraryScreen} from './src/components/SignLanguageLibraryScreen';
import {
  completeSignLanguageSetup,
  dismissSignLanguageChanges,
  hasCompletedSignLanguageSetup,
  installedPhrasesForSelectedLanguage,
  installedSignsForSelectedLanguage,
  listVersionedJsonReleaseLanguages,
  selectedSignLanguageId,
  type InstalledPhrase,
  type InstalledSign,
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
  const initialSetupPending = useRef(true);
  const allowJsonReleaseChecks = useRef(false);

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
    let syncInFlight: Promise<void> | undefined;
    const syncJsonRelease = (): Promise<void> => {
      if (syncInFlight) return syncInFlight;
      syncInFlight = (async () => {
        try {
          const [installed, phrases, statuses] = await Promise.all([
            installedSignsForSelectedLanguage(),
            installedPhrasesForSelectedLanguage(),
            listVersionedJsonReleaseLanguages(),
          ]);
          if (!mounted) return;
          setAvailableSigns(installed);
          setAvailablePhrases(phrases);
          const pendingJsonCount = statuses.reduce((total, status) => (
            total + status.pendingSigns.filter(sign => sign.motionFormat === 'legacy-json-v2').length
          ), 0);
          setAvailableSignChangeCount(pendingJsonCount);
        } catch (error) {
          console.warn('[Sign release] Failed to check for published JSON updates.', error);
          const [installed, phrases] = await Promise.all([
            installedSignsForSelectedLanguage(),
            installedPhrasesForSelectedLanguage(),
          ]).catch(() => [[], []] as [InstalledSign[], InstalledPhrase[]]);
          if (!mounted) return;
          setAvailableSigns(installed);
          setAvailablePhrases(phrases);
        }
      })().finally(() => {
        syncInFlight = undefined;
      });
      return syncInFlight;
    };
    const refreshSignUpdateNotice = async () => {
      await syncJsonRelease();
    };
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active'
          && !initialSetupPending.current
          && allowJsonReleaseChecks.current) void refreshSignUpdateNotice();
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
        initialSetupPending.current = firstSetup;
        allowJsonReleaseChecks.current = installed.length > 0;
        setInitialLibrarySetup(firstSetup);
        if (firstSetup) {
          setLibraryOpen(true);
          return;
        }
        if (installed.length > 0) await syncJsonRelease();
      })
      .catch(() => {
        // Existing local signs remain available while Firebase is offline.
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
    selectedSignLanguageId()
      .then(languageId => ensureAccountProfile(account, languageId))
      .catch(() => undefined);
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
          onSelectedLanguageChange={account
            ? languageId => updateSelectedSignLanguage(account.uid, languageId)
            : undefined}
          onContinue={statuses => {
            void (async () => {
              try {
                await dismissSignLanguageChanges(statuses);
                await completeSignLanguageSetup();
                const [signs, phrases] = await Promise.all([
                  installedSignsForSelectedLanguage(),
                  installedPhrasesForSelectedLanguage(),
                ]);
                initialSetupPending.current = false;
                allowJsonReleaseChecks.current = signs.length > 0;
                setAvailableSigns(signs);
                setAvailablePhrases(phrases);
                const pendingJsonCount = statuses.reduce((total, status) => (
                  total + status.pendingSigns.filter(
                    sign => sign.motionFormat === 'legacy-json-v2',
                  ).length
                ), 0);
                setAvailableSignChangeCount(pendingJsonCount);
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
