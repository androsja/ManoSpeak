jest.mock('../ActivationService', () => ({
  ActivationCancelledError: class ActivationCancelledError extends Error {},
}));

import {ActivationCancelledError} from '../ActivationService';
import {messageForActivationError} from '../ActivationErrorMessage';

describe('messageForActivationError', () => {
  it('does not show an error after user cancellation', () => {
    expect(messageForActivationError(new ActivationCancelledError())).toBe('');
  });

  it('distinguishes configuration failures from connectivity failures', () => {
    expect(messageForActivationError({code: 'DEVELOPER_ERROR'})).toContain(
      'validarse con Google',
    );
    expect(messageForActivationError({code: 'NETWORK_ERROR'})).toContain(
      'Revisa Internet',
    );
  });

  it('keeps an optional diagnostic code for support', () => {
    expect(messageForActivationError({code: 'auth/internal-error'})).toContain(
      'auth/internal-error',
    );
  });

  it('explains a missing local Google configuration', () => {
    expect(messageForActivationError(new Error(
      'Google activation is not configured yet.',
    ))).toContain('todavía no está configurado');
  });
});
