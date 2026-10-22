import {SUPPORTED_APP_LOCALES, translate} from '../I18n';

describe('internationalization catalogue', () => {
  it('supports the published interface locales', () => {
    expect(SUPPORTED_APP_LOCALES).toEqual(['es-CO', 'en-US']);
  });

  it('keeps interface language independent from Colombian Spanish voice and LSC', () => {
    expect(translate('en-US', 'language.interface.detail')).toBe(
      'Voice and sign language remain Colombian Spanish (LSC).',
    );
    expect(translate('es-CO', 'language.interface.detail')).toBe(
      'La voz y las señas siguen en español colombiano (LSC).',
    );
  });

  it('formats singular and plural messages consistently in both locales', () => {
    expect(translate('es-CO', 'library.availableChanges', {count: 1})).toBe(
      '1 cambio disponible',
    );
    expect(translate('en-US', 'library.availableChanges', {count: 2})).toBe(
      '2 changes available',
    );
  });

  it('interpolates dynamic values without exposing raw tokens', () => {
    expect(translate('en-US', 'activation.support', {email: 'support@example.com'})).toBe(
      'Support: support@example.com',
    );
  });
});
