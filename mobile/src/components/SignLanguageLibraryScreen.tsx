import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  filterPublishedSigns,
  installSignLanguageChanges,
  type InstalledPhrase,
  listSignLanguages,
  listVersionedJsonReleaseLanguages,
  selectSignLanguage,
  type PublishedSign,
  type SignLanguageStatus,
} from '../services/SignLanguageService';
import {playableLscPhraseSuggestions} from '../services/LscPhraseAssetCatalogService';
import {useI18n} from '../i18n/I18n';

type Props = {
  initialSetup: boolean;
  onContinue: (statuses: readonly SignLanguageStatus[]) => void;
  onSelectedLanguageChange?: (languageId: string) => Promise<void>;
};

const CATALOG_PAGE_SIZE = 100;
const LARGE_CATALOG_THRESHOLD = 100;
const ALL_CATEGORIES = 'all';
const INSTALLED_CATEGORY = 'installed';

function normalizedGloss(gloss: string): string {
  return gloss.trim().toLocaleUpperCase('es-CO');
}

/** Returns downloaded remote phrases whose complete sequence is available locally. */
export function recommendedPhrasesForInstalledLibrary(
  phrases: readonly Pick<InstalledPhrase, 'spanish' | 'glossSequence'>[],
  signs: readonly Pick<PublishedSign, 'gloss'>[],
): string[] {
  const availableGlosses = new Set(signs.map(sign => normalizedGloss(sign.gloss)));
  return phrases
    .filter(phrase => phrase.glossSequence.every(gloss => availableGlosses.has(normalizedGloss(gloss))))
    .map(phrase => phrase.spanish);
}

export function handleLibraryBack(
  catalogLanguageId: string,
  closeCatalog: () => void,
  closeLibrary: () => void,
): boolean {
  if (catalogLanguageId) {
    closeCatalog();
  } else {
    closeLibrary();
  }
  return true;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function SignLanguageLibraryScreen({initialSetup, onContinue, onSelectedLanguageChange}: Props) {
  const {t} = useI18n();
  const [languages, setLanguages] = useState<SignLanguageStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeLanguageId, setActiveLanguageId] = useState('');
  const [activeSignId, setActiveSignId] = useState('');
  const [progress, setProgress] = useState(0);
  const [catalogLanguageId, setCatalogLanguageId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [visibleLimit, setVisibleLimit] = useState(CATALOG_PAGE_SIZE);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const catalogLanguage = languages.find(language => language.id === catalogLanguageId);
  const installedSignIds = useMemo(
    () => new Set(catalogLanguage?.installedSigns.map(sign => sign.id) ?? []),
    [catalogLanguage],
  );
  const categories = useMemo(() => Array.from(new Set(
    (catalogLanguage?.signs ?? []).flatMap(sign => sign.categories),
  )).sort((left, right) => left.localeCompare(right)), [catalogLanguage]);
  const matchingSigns = useMemo(() => {
    const searched = filterPublishedSigns(catalogLanguage?.signs ?? [], search);
    if (category === INSTALLED_CATEGORY) {
      return searched.filter(sign => installedSignIds.has(sign.id));
    }
    if (category !== ALL_CATEGORIES) {
      return searched.filter(sign => sign.categories.includes(category));
    }
    return searched;
  }, [catalogLanguage, category, installedSignIds, search]);
  const requiresDiscoveryChoice = Boolean(
    catalogLanguage
    && catalogLanguage.signs.length > LARGE_CATALOG_THRESHOLD
    && !search.trim()
    && category === ALL_CATEGORIES,
  );
  const visibleSigns = requiresDiscoveryChoice
    ? []
    : matchingSigns.slice(0, visibleLimit);
  const pendingSignIds = useMemo(
    () => new Set(catalogLanguage?.pendingSigns.map(sign => sign.id) ?? []),
    [catalogLanguage],
  );
  const possiblePhrases = useMemo(() => {
    const language = languages.find(candidate => candidate.selected) ?? languages[0];
    return playableLscPhraseSuggestions(language?.installedSigns ?? []);
  }, [languages]);
  const possiblePhrase = possiblePhrases.length > 0
    ? possiblePhrases[suggestionIndex % possiblePhrases.length]
    : t('library.noPhrases');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const availableLanguages = initialSetup
        ? await listVersionedJsonReleaseLanguages()
        : await listSignLanguages();
      setLanguages(availableLanguages);
    } catch {
      setError(t('library.loadError'));
    } finally {
      setLoading(false);
    }
  }, [initialSetup, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVisibleLimit(CATALOG_PAGE_SIZE); }, [category, search]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => (
      handleLibraryBack(
        catalogLanguageId,
        () => setCatalogLanguageId(''),
        () => onContinue(languages),
      )
    ));
    return () => subscription.remove();
  }, [catalogLanguageId, languages, onContinue]);

  const install = async (language: SignLanguageStatus) => {
    setActiveLanguageId(language.id);
    setActiveSignId('');
    setProgress(0);
    try {
      const changed = await installSignLanguageChanges(language, setProgress);
      try {
        await onSelectedLanguageChange?.(language.id);
      } catch {
        // The local selection remains usable while the account profile syncs later.
      }
      await load();
      if (initialSetup) {
        onContinue(await listVersionedJsonReleaseLanguages());
        return;
      }
      Alert.alert(
        t('library.updated.title'),
        t('library.updated.detail', {count: changed, language: language.name}),
      );
    } catch {
      Alert.alert(t('library.downloadError.title'), t('library.downloadError.detail'));
    } finally {
      setActiveLanguageId('');
      setProgress(0);
    }
  };

  const installOneSign = async (language: SignLanguageStatus, sign: PublishedSign) => {
    if (!language.pendingSigns.some(pending => pending.id === sign.id)) return;
    setActiveLanguageId(language.id);
    setActiveSignId(sign.id);
    setProgress(0);
    try {
      const selectedSignStatus: SignLanguageStatus = {
        ...language,
        pendingSigns: language.pendingSigns.filter(pending => pending.id === sign.id),
        removedSigns: [],
        pendingPhrases: [],
        removedPhrases: [],
        pendingSizeBytes: sign.sizeBytes,
      };
      await installSignLanguageChanges(selectedSignStatus, setProgress);
      try {
        await onSelectedLanguageChange?.(language.id);
      } catch {
        // The local selection remains usable while the account profile syncs later.
      }
      await load();
      if (initialSetup) {
        onContinue(await listVersionedJsonReleaseLanguages());
        return;
      }
      Alert.alert(
        t('library.updated.title'),
        t('library.updated.detail', {count: 1, language: language.name}),
      );
    } catch (downloadError) {
      console.error(`Failed to download sign ${sign.gloss}`, downloadError);
      Alert.alert(t('library.downloadError.title'), t('library.downloadError.detail'));
    } finally {
      setActiveLanguageId('');
      setActiveSignId('');
      setProgress(0);
    }
  };

  const select = async (language: SignLanguageStatus) => {
    try {
      await selectSignLanguage(language.id);
      try {
        await onSelectedLanguageChange?.(language.id);
      } catch {
        // The local selection remains usable while the account profile syncs later.
      }
      await load();
    } catch {
      Alert.alert(t('library.selectError.title'), t('library.selectError.detail'));
    }
  };

  const hasInstalledSigns = languages.some(language => language.installedSignCount > 0);
  const isSkipping = initialSetup && !hasInstalledSigns;

  const openCatalog = (language: SignLanguageStatus) => {
    setSearch('');
    setCategory(ALL_CATEGORIES);
    setVisibleLimit(CATALOG_PAGE_SIZE);
    setCatalogLanguageId(language.id);
  };

  const categoryLabel = (value: string): string =>
    value.replace(/_/g, ' ').toLocaleUpperCase('es-CO');

  const renderSign = ({item}: {item: PublishedSign}) => {
    const installed = installedSignIds.has(item.id);
    const updateAvailable = installed && pendingSignIds.has(item.id);
    const canInstall = pendingSignIds.has(item.id);
    const downloading = activeLanguageId === catalogLanguage?.id && activeSignId === item.id;
    const aliases = item.speechAliases.filter(alias => (
      alias.trim().toLocaleUpperCase('es-CO') !== item.gloss
    ));
    return (
      <View style={styles.signRow}>
        <View style={styles.signCopy}>
          <Text style={styles.signGloss}>{item.gloss}</Text>
          {aliases.length > 0 ? (
            <Text style={styles.signAliases} numberOfLines={2}>
              {t('library.alsoRecognizes', {aliases: aliases.join(', ')})}
            </Text>
          ) : null}
          {item.categories.length > 0 ? (
            <Text style={styles.signCategories} numberOfLines={1}>
              {item.categories.join(' · ')}
            </Text>
          ) : null}
        </View>
        {canInstall ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${updateAvailable ? t('library.action.updateOne') : t('library.action.downloadOne')} ${item.gloss}`}
            disabled={activeLanguageId !== ''}
            onPress={() => {
              if (catalogLanguage) installOneSign(catalogLanguage, item).catch(() => undefined);
            }}
            style={[styles.signAction, activeLanguageId !== '' && styles.disabled]}
          >
            <Text style={styles.signActionText}>
              {downloading
                ? t('library.downloading', {progress: Math.round(progress * 100)})
                : updateAvailable ? t('library.action.updateOne') : t('library.action.downloadOne')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.signStatus, styles.signStatusInstalled]}>
            <Text style={styles.signStatusText}>{t('library.status.installed')}</Text>
          </View>
        )}
      </View>
    );
  };

  if (catalogLanguage) {
    return (
      <View style={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('library.backLabel')}
          onPress={() => setCatalogLanguageId('')}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>{t('library.back')}</Text>
        </Pressable>
        <Text style={styles.catalogTitle}>{catalogLanguage.name}</Text>
        <Text style={styles.catalogSummary}>
          {t('library.resourcesSummary', {
            published: catalogLanguage.signs.length,
            installed: catalogLanguage.installedSignCount,
          })}
        </Text>
        <Text style={styles.reviewNotice}>
          {t('library.reviewNotice')}
        </Text>
        <TextInput
          accessibilityLabel={t('library.searchLabel')}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setSearch}
          placeholder={t('library.searchPlaceholder')}
          placeholderTextColor="#64748B"
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
        <ScrollView
          contentContainerStyle={styles.filters}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroller}
        >
          {[ALL_CATEGORIES, INSTALLED_CATEGORY, ...categories].map(value => {
            const selected = category === value;
            const label = value === ALL_CATEGORIES
              ? t('library.filter.all')
              : value === INSTALLED_CATEGORY
                ? t('library.filter.installed')
                : categoryLabel(value);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected}}
                key={value}
                onPress={() => setCategory(value)}
                style={[styles.filterChip, selected && styles.filterChipSelected]}
              >
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.resultCount}>
          {requiresDiscoveryChoice
            ? t('library.discoveryPrompt')
            : t('library.resultCount', {count: matchingSigns.length})
          }
          {!requiresDiscoveryChoice && matchingSigns.length > visibleSigns.length
            ? t('library.showing', {count: visibleSigns.length})
            : ''}
        </Text>
        <FlatList
          data={visibleSigns}
          initialNumToRender={18}
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.id}
          ListEmptyComponent={(
            <Text style={styles.noResults}>
              {requiresDiscoveryChoice
                ? t('library.empty.discovery')
                : t('library.empty.results')}
            </Text>
          )}
          maxToRenderPerBatch={24}
          removeClippedSubviews
          renderItem={renderSign}
          onEndReached={() => {
            if (visibleLimit < matchingSigns.length) {
              setVisibleLimit(limit => limit + CATALOG_PAGE_SIZE);
            }
          }}
          onEndReachedThreshold={0.4}
          style={styles.signList}
          windowSize={7}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>VOZUAL</Text>
      <Text style={styles.title}>
        {initialSetup ? t('library.initialTitle') : t('library.title')}
      </Text>
      <Text style={styles.description}>
        {t('library.description')}
      </Text>

      {loading ? <ActivityIndicator color="#38BDF8" size="large" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && languages.length === 0 ? (
        <Text style={styles.empty}>
          {t('library.empty.catalog')}
        </Text>
      ) : null}

      {languages.map(language => {
        const downloading = activeLanguageId === language.id;
        const unavailable = language.signs.length === 0 && language.installedSignCount === 0;
        const current = language.selected && language.installedSignCount > 0 && language.changeCount === 0;
        const canSelect = language.installedSignCount > 0 && language.changeCount === 0 && !language.selected;
        const downloadLabel = initialSetup && language.pendingSigns.length === 1
          ? t('library.action.downloadGloss', {gloss: language.pendingSigns[0].gloss})
          : language.installedSignCount > 0
            ? t('library.action.download', {count: language.changeCount})
            : t('library.action.download', {count: language.signs.length});
        const label = unavailable
          ? t('library.action.unavailable')
          : current
            ? t('library.action.current')
            : canSelect
              ? t('library.action.use')
              : language.pendingSigns.length === 0 && language.removedSigns.length > 0
                ? t('library.action.applyChanges', {count: language.changeCount})
            : downloadLabel;
        return (
          <View key={language.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.cardCopy}>
                <Text style={styles.packName}>{language.name}</Text>
                <Text style={styles.metadata}>
                  {t('library.metadata', {
                    region: language.region,
                    count: language.signs.length,
                    size: megabytes(language.totalSizeBytes),
                  })}
                </Text>
                {language.installedSignCount > 0 ? (
                  <Text style={styles.installed}>{t('library.installedCount', {count: language.installedSignCount})}</Text>
                ) : null}
                {language.changeCount > 0 && language.installedSignCount > 0 ? (
                  <>
                    <Text style={styles.update}>
                      {t('library.availableChanges', {count: language.changeCount})}
                    </Text>
                    {language.pendingSigns.length > 0 ? (
                      <Text style={styles.pendingSigns} numberOfLines={2}>
                        {t('library.pending', {signs: language.pendingSigns.map(sign => sign.gloss).join(', ')})}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                {downloading ? (
                  <Text style={styles.progress}>{t('library.downloading', {progress: Math.round(progress * 100)})}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.action, (downloading || unavailable || current) && styles.disabled]}
                disabled={downloading || unavailable || current}
                onPress={() => void (canSelect ? select(language) : install(language))}
              >
                <Text style={styles.actionText}>{downloading ? '…' : label}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              accessibilityLabel={t('library.openCatalogLabel', {language: language.name})}
              disabled={language.signs.length === 0}
              onPress={() => openCatalog(language)}
              style={[styles.catalogButton, language.signs.length === 0 && styles.catalogButtonDisabled]}
            >
              <Text style={styles.catalogButtonText}>
                {language.signs.length === 0
                  ? t('library.noPublishedContent')
                  : t('library.openCatalog', {count: language.signs.length})}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {!loading && !error && languages.length > 0 ? (
        <View style={styles.suggestionCard}>
          <Text style={styles.suggestionEyebrow}>{t('library.tryPhrase')}</Text>
          <Text style={styles.suggestionPhrase}>“{possiblePhrase}”</Text>
          <Text style={styles.suggestionHint}>{t('library.phraseHint')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('library.nextPhraseLabel')}
            onPress={() => setSuggestionIndex(index => index + 1)}
            style={styles.suggestionButton}
          >
            <Text style={styles.suggestionButtonText}>{t('library.nextPhrase')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <TouchableOpacity
        style={isSkipping ? styles.skipButton : styles.continueButton}
        onPress={() => onContinue(languages)}
      >
        <Text style={isSkipping ? styles.skipText : styles.continueText}>
          {isSkipping ? t('library.skip') : initialSetup ? t('library.continue') : t('library.close')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0F172A', padding: 24, paddingTop: 48},
  brand: {color: '#38BDF8', fontSize: 15, fontWeight: '900', letterSpacing: 4, marginBottom: 18},
  title: {color: '#F8FAFC', fontSize: 28, fontWeight: '800', marginBottom: 12},
  description: {color: '#CBD5E1', fontSize: 16, lineHeight: 23, marginBottom: 28},
  card: {backgroundColor: '#1E293B', borderRadius: 16, marginBottom: 12, padding: 16},
  cardTop: {alignItems: 'center', flexDirection: 'row'},
  cardCopy: {flex: 1, paddingRight: 10},
  packName: {color: '#F8FAFC', fontSize: 18, fontWeight: '800'},
  metadata: {color: '#94A3B8', fontSize: 13, marginTop: 5},
  installed: {color: '#7DD3FC', fontSize: 13, marginTop: 7},
  update: {color: '#FBBF24', fontSize: 13, fontWeight: '700', marginTop: 7},
  pendingSigns: {color: '#FDE68A', fontSize: 12, marginTop: 4},
  progress: {color: '#38BDF8', fontSize: 13, marginTop: 7},
  action: {backgroundColor: '#0284C7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11},
  disabled: {backgroundColor: '#475569'},
  actionText: {color: '#FFFFFF', fontSize: 12, fontWeight: '900'},
  signAction: {alignItems: 'center', backgroundColor: '#0284C7', borderRadius: 10, justifyContent: 'center', marginLeft: 10, minHeight: 42, paddingHorizontal: 12, minWidth: 100},
  signActionText: {color: '#FFFFFF', fontSize: 11, fontWeight: '900', textAlign: 'center'},
  catalogButton: {alignItems: 'center', borderColor: '#38BDF8', borderRadius: 10, borderWidth: 1, marginTop: 14, padding: 11},
  catalogButtonDisabled: {borderColor: '#475569', opacity: 0.65},
  catalogButtonText: {color: '#7DD3FC', fontSize: 12, fontWeight: '900'},
  backButton: {alignSelf: 'flex-start', marginBottom: 14, paddingVertical: 4},
  backButtonText: {color: '#7DD3FC', fontSize: 13, fontWeight: '900'},
  catalogTitle: {color: '#F8FAFC', fontSize: 26, fontWeight: '800'},
  catalogSummary: {color: '#94A3B8', fontSize: 14, lineHeight: 20, marginTop: 7},
  reviewNotice: {color: '#FBBF24', fontSize: 12, lineHeight: 18, marginTop: 8},
  searchInput: {backgroundColor: '#1E293B', borderColor: '#334155', borderRadius: 12, borderWidth: 1, color: '#F8FAFC', fontSize: 16, marginTop: 20, paddingHorizontal: 15, paddingVertical: 13},
  filterScroller: {flexGrow: 0, marginTop: 10, maxHeight: 42},
  filters: {alignItems: 'center', gap: 8, paddingRight: 12},
  filterChip: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#1E293B', borderColor: '#334155', borderRadius: 18, borderWidth: 1, height: 36, justifyContent: 'center', paddingHorizontal: 13},
  filterChipSelected: {backgroundColor: '#155E75', borderColor: '#38BDF8'},
  filterChipText: {color: '#94A3B8', fontSize: 11, fontWeight: '800'},
  filterChipTextSelected: {color: '#E0F2FE'},
  resultCount: {color: '#94A3B8', fontSize: 12, fontWeight: '700', marginBottom: 9},
  signList: {flex: 1},
  signRow: {alignItems: 'center', borderBottomColor: '#243247', borderBottomWidth: 1, flexDirection: 'row', minHeight: 82, paddingVertical: 12},
  signCopy: {flex: 1, paddingRight: 12},
  signGloss: {color: '#F8FAFC', fontSize: 16, fontWeight: '800'},
  signAliases: {color: '#CBD5E1', fontSize: 12, lineHeight: 17, marginTop: 4},
  signCategories: {color: '#64748B', fontSize: 11, marginTop: 4, textTransform: 'uppercase'},
  signStatus: {backgroundColor: '#334155', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7},
  signStatusInstalled: {backgroundColor: '#155E75'},
  signStatusUpdate: {backgroundColor: '#92400E'},
  signStatusText: {color: '#F8FAFC', fontSize: 10, fontWeight: '900'},
  noResults: {color: '#94A3B8', fontSize: 15, lineHeight: 22, paddingVertical: 28, textAlign: 'center'},
  error: {color: '#FCA5A5', fontSize: 15, marginBottom: 18},
  empty: {color: '#94A3B8', fontSize: 15, marginBottom: 18},
  suggestionCard: {backgroundColor: '#17243A', borderColor: '#28415D', borderRadius: 16, borderWidth: 1, marginTop: 'auto', marginBottom: 14, padding: 16},
  suggestionEyebrow: {color: '#38BDF8', fontSize: 11, fontWeight: '900', letterSpacing: 1},
  suggestionPhrase: {color: '#F8FAFC', fontSize: 20, fontWeight: '800', marginTop: 9},
  suggestionHint: {color: '#94A3B8', fontSize: 12, marginTop: 6},
  suggestionButton: {alignSelf: 'flex-start', borderColor: '#38BDF8', borderRadius: 9, borderWidth: 1, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8},
  suggestionButtonText: {color: '#7DD3FC', fontSize: 11, fontWeight: '900'},
  secondary: {alignItems: 'center', borderColor: '#38BDF8', borderRadius: 12, borderWidth: 1, padding: 14},
  secondaryText: {color: '#38BDF8', fontWeight: '800'},
  continueButton: {alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, marginTop: 'auto', padding: 16},
  continueText: {color: '#0F172A', fontWeight: '900'},
  skipButton: {alignItems: 'center', marginTop: 'auto', padding: 16},
  skipText: {color: '#CBD5E1', fontWeight: '800'},
});
