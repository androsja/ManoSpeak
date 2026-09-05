import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
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
  listSignLanguages,
  selectSignLanguage,
  type PublishedSign,
  type SignLanguageStatus,
} from '../services/SignLanguageService';

type Props = {
  initialSetup: boolean;
  onContinue: (statuses: readonly SignLanguageStatus[]) => void;
};

const CATALOG_PAGE_SIZE = 100;
const LARGE_CATALOG_THRESHOLD = 100;
const ALL_CATEGORIES = 'all';
const INSTALLED_CATEGORY = 'installed';

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function SignLanguageLibraryScreen({initialSetup, onContinue}: Props) {
  const [languages, setLanguages] = useState<SignLanguageStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeLanguageId, setActiveLanguageId] = useState('');
  const [progress, setProgress] = useState(0);
  const [catalogLanguageId, setCatalogLanguageId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [visibleLimit, setVisibleLimit] = useState(CATALOG_PAGE_SIZE);

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

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setLanguages(await listSignLanguages());
    } catch {
      setError('No fue posible consultar las lenguas disponibles. Revisa tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setVisibleLimit(CATALOG_PAGE_SIZE); }, [category, search]);

  const install = async (language: SignLanguageStatus) => {
    setActiveLanguageId(language.id);
    setProgress(0);
    try {
      const changed = await installSignLanguageChanges(language, setProgress);
      await load();
      Alert.alert(
        'Biblioteca actualizada',
        `${changed} ${changed === 1 ? 'cambio aplicado' : 'cambios aplicados'} para ${language.name}. Esta lengua quedó activa.`,
      );
    } catch {
      Alert.alert('No se pudo descargar', 'Las señas no se instalaron. Intenta nuevamente.');
    } finally {
      setActiveLanguageId('');
      setProgress(0);
    }
  };

  const select = async (language: SignLanguageStatus) => {
    try {
      await selectSignLanguage(language.id);
      await load();
    } catch {
      Alert.alert('No se pudo seleccionar', 'Descarga al menos una seña de esta lengua primero.');
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
    const aliases = item.speechAliases.filter(alias => (
      alias.trim().toLocaleUpperCase('es-CO') !== item.gloss
    ));
    return (
      <View style={styles.signRow}>
        <View style={styles.signCopy}>
          <Text style={styles.signGloss}>{item.gloss}</Text>
          {aliases.length > 0 ? (
            <Text style={styles.signAliases} numberOfLines={2}>
              También reconoce: {aliases.join(', ')}
            </Text>
          ) : null}
          {item.categories.length > 0 ? (
            <Text style={styles.signCategories} numberOfLines={1}>
              {item.categories.join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={[
          styles.signStatus,
          installed && styles.signStatusInstalled,
          updateAvailable && styles.signStatusUpdate,
        ]}>
          <Text style={styles.signStatusText}>
            {updateAvailable ? 'ACTUALIZAR' : installed ? 'INSTALADA' : 'DISPONIBLE'}
          </Text>
        </View>
      </View>
    );
  };

  if (catalogLanguage) {
    return (
      <View style={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a lenguas de señas"
          onPress={() => setCatalogLanguageId('')}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ LENGUAS</Text>
        </Pressable>
        <Text style={styles.catalogTitle}>{catalogLanguage.name}</Text>
        <Text style={styles.catalogSummary}>
          {catalogLanguage.signs.length} señas y frases aprobadas · {catalogLanguage.installedSignCount} instaladas
        </Text>
        <TextInput
          accessibilityLabel="Buscar una seña o frase"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setSearch}
          placeholder="Buscar palabra o frase…"
          placeholderTextColor="#64748B"
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
        <ScrollView
          contentContainerStyle={styles.filters}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {[ALL_CATEGORIES, INSTALLED_CATEGORY, ...categories].map(value => {
            const selected = category === value;
            const label = value === ALL_CATEGORIES
              ? 'TODAS'
              : value === INSTALLED_CATEGORY
                ? 'INSTALADAS'
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
            ? 'Busca una palabra o elige una categoría'
            : `${matchingSigns.length} ${matchingSigns.length === 1 ? 'resultado' : 'resultados'}`
          }
          {!requiresDiscoveryChoice && matchingSigns.length > visibleSigns.length
            ? ` · mostrando ${visibleSigns.length}`
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
                ? 'Para encontrar algo rápidamente, escribe una palabra o selecciona una categoría.'
                : 'No encontramos una seña aprobada con esa búsqueda.'}
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
        {initialSetup ? 'Elige tus lenguas de señas' : 'Lenguas de señas'}
      </Text>
      <Text style={styles.description}>
        Vozual se instala sin movimientos de señas. Elige una lengua y descarga únicamente sus señas aprobadas. Las nuevas señas se agregan de forma independiente.
      </Text>

      {loading ? <ActivityIndicator color="#38BDF8" size="large" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && languages.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay lenguas publicadas.</Text>
      ) : null}

      {languages.map(language => {
        const downloading = activeLanguageId === language.id;
        const unavailable = language.signs.length === 0 && language.installedSignCount === 0;
        const current = language.selected && language.installedSignCount > 0 && language.changeCount === 0;
        const canSelect = language.installedSignCount > 0 && language.changeCount === 0 && !language.selected;
        const label = unavailable
          ? 'NO DISPONIBLE'
          : current
            ? 'EN USO'
            : canSelect
              ? 'USAR'
              : language.pendingSigns.length === 0 && language.removedSigns.length > 0
                ? `APLICAR ${language.changeCount} CAMBIO${language.changeCount === 1 ? '' : 'S'}`
            : language.installedSignCount > 0
              ? `DESCARGAR ${language.changeCount}`
              : `DESCARGAR ${language.signs.length}`;
        return (
          <View key={language.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.cardCopy}>
                <Text style={styles.packName}>{language.name}</Text>
                <Text style={styles.metadata}>
                  {language.region} · {language.signs.length} señas · {megabytes(language.totalSizeBytes)}
                </Text>
                {language.installedSignCount > 0 ? (
                  <Text style={styles.installed}>{language.installedSignCount} instaladas</Text>
                ) : null}
                {language.changeCount > 0 && language.installedSignCount > 0 ? (
                  <>
                    <Text style={styles.update}>
                      {language.changeCount} {language.changeCount === 1 ? 'cambio disponible' : 'cambios disponibles'}
                    </Text>
                    {language.pendingSigns.length > 0 ? (
                      <Text style={styles.pendingSigns} numberOfLines={2}>
                        Pendientes: {language.pendingSigns.map(sign => sign.gloss).join(', ')}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                {downloading ? (
                  <Text style={styles.progress}>Descargando · {Math.round(progress * 100)}%</Text>
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
              accessibilityLabel={`Ver señas y frases de ${language.name}`}
              disabled={language.signs.length === 0}
              onPress={() => openCatalog(language)}
              style={[styles.catalogButton, language.signs.length === 0 && styles.catalogButtonDisabled]}
            >
              <Text style={styles.catalogButtonText}>
                {language.signs.length === 0 ? 'SIN CONTENIDO PUBLICADO' : `VER ${language.signs.length} SEÑAS Y FRASES`}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {error ? (
        <TouchableOpacity style={styles.secondary} onPress={() => void load()}>
          <Text style={styles.secondaryText}>REINTENTAR</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={isSkipping ? styles.skipButton : styles.continueButton}
        onPress={() => onContinue(languages)}
      >
        <Text style={isSkipping ? styles.skipText : styles.continueText}>
          {isSkipping ? 'AHORA NO' : initialSetup ? 'CONTINUAR' : 'CERRAR'}
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
  catalogButton: {alignItems: 'center', borderColor: '#38BDF8', borderRadius: 10, borderWidth: 1, marginTop: 14, padding: 11},
  catalogButtonDisabled: {borderColor: '#475569', opacity: 0.65},
  catalogButtonText: {color: '#7DD3FC', fontSize: 12, fontWeight: '900'},
  backButton: {alignSelf: 'flex-start', marginBottom: 14, paddingVertical: 4},
  backButtonText: {color: '#7DD3FC', fontSize: 13, fontWeight: '900'},
  catalogTitle: {color: '#F8FAFC', fontSize: 26, fontWeight: '800'},
  catalogSummary: {color: '#94A3B8', fontSize: 14, lineHeight: 20, marginTop: 7},
  searchInput: {backgroundColor: '#1E293B', borderColor: '#334155', borderRadius: 12, borderWidth: 1, color: '#F8FAFC', fontSize: 16, marginTop: 20, paddingHorizontal: 15, paddingVertical: 13},
  filters: {gap: 8, paddingVertical: 12},
  filterChip: {backgroundColor: '#1E293B', borderColor: '#334155', borderRadius: 18, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 8},
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
  secondary: {alignItems: 'center', borderColor: '#38BDF8', borderRadius: 12, borderWidth: 1, padding: 14},
  secondaryText: {color: '#38BDF8', fontWeight: '800'},
  continueButton: {alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, marginTop: 'auto', padding: 16},
  continueText: {color: '#0F172A', fontWeight: '900'},
  skipButton: {alignItems: 'center', marginTop: 'auto', padding: 16},
  skipText: {color: '#CBD5E1', fontWeight: '800'},
});
