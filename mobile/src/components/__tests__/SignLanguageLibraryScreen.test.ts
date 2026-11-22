jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: {alert: jest.fn()},
  BackHandler: {addEventListener: jest.fn()},
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {create: (styles: unknown) => styles},
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));

jest.mock('../../services/SignLanguageService', () => ({}));

import {
  handleLibraryBack,
  recommendedPhrasesForInstalledLibrary,
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
});
