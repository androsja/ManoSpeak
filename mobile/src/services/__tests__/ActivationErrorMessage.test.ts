jest.mock('../ActivationService', () => ({
  ActivationCancelledError: class ActivationCancelledError extends Error {},
  NoActivationAccountError: class NoActivationAccountError extends Error {},
}));

import {
  ActivationCancelledError,
  NoActivationAccountError,
} from '../ActivationService';
import {
  messageForAccountDeletionError,
  messageForActivationError,
} from '../ActivationErrorMessage';

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

describe('messageForAccountDeletionError', () => {
  it('makes cancellation and an already closed session explicit', () => {
    expect(messageForAccountDeletionError(new ActivationCancelledError())).toContain(
      'cancelaste',
    );
    expect(messageForAccountDeletionError(new NoActivationAccountError())).toContain(
      'ya no está activa',
    );
  });

  it('does not claim deletion succeeded after network or permission failures', () => {
    expect(messageForAccountDeletionError({code: 'firestore/unavailable'})).toContain(
      'sigue activa',
    );
    expect(messageForAccountDeletionError({code: 'firestore/permission-denied'})).toContain(
      'solicitud web',
    );
  });
});
