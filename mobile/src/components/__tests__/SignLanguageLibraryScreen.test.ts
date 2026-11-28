jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: {alert: jest.fn()},
  Animated: {
    Value: jest.fn(() => ({interpolate: jest.fn()})),
    View: 'Animated.View',
    loop: jest.fn(() => ({start: jest.fn(), stop: jest.fn()})),
    sequence: jest.fn(),
    timing: jest.fn(),
  },
  BackHandler: {addEventListener: jest.fn()},
  Easing: {inOut: jest.fn(), out: jest.fn(), ease: jest.fn()},
  FlatList: 'FlatList',
  Platform: {OS: 'ios'},
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {create: (styles: unknown) => styles},
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));

jest.mock('../../services/SignLanguageService', () => ({}));
jest.mock('../../services/AndroidSpeechModelService', () => ({ensureAndroidSpeechModel: jest.fn()}));

import {
  describeInstallProgress,
  handleLibraryBack,
  possibleLibraryPhrases,
  recommendedPhrasesForInstalledLibrary,
  resolveInitialSetupProgress,
} from '../SignLanguageLibraryScreen';

describe('SignLanguageLibraryScreen Android Back behavior', () => {
  test('returns from the catalogue to the language list before closing the library', () => {
    const closeCatalog = jest.fn();
    const closeLibrary = jest.fn();

    expect(handleLibraryBack('lsc-co', closeCatalog, closeLibrary)).toBe(true);
    expect(closeCatalog).toHaveBeenCalledTimes(1);
    expect(closeLibrary).not.toHaveBeenCalled();
  });

  test('closes the language list through the same continuation path as its button', () => {
    const closeCatalog = jest.fn();
    const closeLibrary = jest.fn();

    expect(handleLibraryBack('', closeCatalog, closeLibrary)).toBe(true);
    expect(closeCatalog).not.toHaveBeenCalled();
    expect(closeLibrary).toHaveBeenCalledTimes(1);
  });

  test('shows remote downloaded phrases only when every required sign is installed', () => {
    const suggestions = recommendedPhrasesForInstalledLibrary([{
      spanish: 'Yo quiero comer carne.',
      glossSequence: ['YO', 'QUERER', 'COMER', 'CARNE'],
    }, {
      spanish: 'Yo quiero comer.',
      glossSequence: ['YO', 'QUERER', 'COMER'],
    }, {
      spanish: 'Hola, ¿cómo estás?',
      glossSequence: ['HOLA', '¿CÓMO ESTÁS?'],
    }], [
      {gloss: 'YO'},
      {gloss: 'QUERER'},
      {gloss: 'COMER'},
      {gloss: 'CARNE'},
      {gloss: 'HOLA'},
    ]);

    expect(suggestions).toContain('Yo quiero comer carne.');
    expect(suggestions).toContain('Yo quiero comer.');
    expect(suggestions).not.toContain('Yo quiero agua.');
    expect(suggestions).not.toContain('Hola, ¿cómo estás?');
  });

  test('falls back to Firebase release phrases when signs are already installed locally', () => {
    const suggestions = possibleLibraryPhrases({
      installedSigns: [{gloss: 'HOLA'}, {gloss: 'GRACIAS'}] as never,
      installedPhrases: [],
      phrases: [
        {spanish: 'Hola, gracias.', glossSequence: ['HOLA', 'GRACIAS']},
        {spanish: 'Hola, amigo.', glossSequence: ['HOLA', 'AMIGO']},
      ] as never,
    });

    expect(suggestions).toEqual(['Hola, gracias.']);
  });

  test('describes each library download stage and sign gloss clearly', () => {
    const t = (key: string, params?: Record<string, string | number>) => (
      `${key}:${JSON.stringify(params ?? {})}`
    );

    const downloading = describeInstallProgress({
      fraction: 0.4,
      stage: 'downloading',
      currentGloss: 'HOLA',
      completedSigns: 8,
      totalSigns: 17,
    }, t as never);
    expect(downloading.stageLabel).toContain('library.install.stage.downloading');
    expect(downloading.stageLabel).toContain('HOLA');
    expect(downloading.counterLabel).toContain('8');
    expect(downloading.activeStepIndex).toBe(0);

    const verifying = describeInstallProgress({
      fraction: 0.6,
      stage: 'verifying',
      currentGloss: 'GRACIAS',
      completedSigns: 9,
      totalSigns: 17,
    }, t as never);
    expect(verifying.stageLabel).toContain('library.install.stage.verifying');
    expect(verifying.activeStepIndex).toBe(1);

    const phrases = describeInstallProgress({
      fraction: 0.96,
      stage: 'phrases',
      completedSigns: 17,
      totalSigns: 17,
    }, t as never);
    expect(phrases.stageLabel).toContain('library.install.stage.phrases');
    expect(phrases.activeStepIndex).toBe(2);

    const saving = describeInstallProgress({
      fraction: 1,
      stage: 'saving',
      completedSigns: 17,
      totalSigns: 17,
    }, t as never);
    expect(saving.stageLabel).toContain('library.install.stage.saving');
    expect(saving.activeStepIndex).toBe(3);
  });

  test('never stalls at 100% on Android while voice download or final verification is still running', () => {
    const t = (key: string, params?: Record<string, string | number>) => (
      `${key}:${JSON.stringify(params ?? {})}`
    );

    const voiceDownloading = resolveInitialSetupProgress({
      signsProgress: 1,
      signsDone: true,
      voiceProgress: 50,
      voiceDone: false,
      finalizing: false,
      isAndroid: true,
      t: t as never,
    });
    expect(voiceDownloading.percent).toBeLessThan(99);
    expect(voiceDownloading.stageLabel).toContain('library.install.stage.voiceDownloading');
    expect(voiceDownloading.activeStepIndex).toBe(3);

    const voiceVerifying = resolveInitialSetupProgress({
      signsProgress: 1,
      signsDone: true,
      voiceProgress: 99,
      voiceDone: false,
      finalizing: false,
      isAndroid: true,
      t: t as never,
    });
    expect(voiceVerifying.percent).toBeLessThan(99);
    expect(voiceVerifying.stageLabel).toContain('library.install.stage.voiceVerifying');

    const finalizing = resolveInitialSetupProgress({
      signsProgress: 1,
      signsDone: true,
      voiceProgress: 100,
      voiceDone: true,
      finalizing: true,
      isAndroid: true,
      t: t as never,
    });
    expect(finalizing.percent).toBe(99);
    expect(finalizing.stageLabel).toContain('library.install.stage.finalizing');
  });
});
