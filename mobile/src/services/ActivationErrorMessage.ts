import {ActivationCancelledError} from './ActivationService';

type ActivationErrorShape = {
  code?: unknown;
  message?: unknown;
};

export function activationErrorDetails(error: unknown): {
  code: string;
  message: string;
} {
  const shapedError = error as ActivationErrorShape;
  return {
    code: typeof shapedError?.code === 'string' ? shapedError.code : '',
    message: error instanceof Error ? error.message : String(error ?? ''),
  };
}

export function messageForActivationError(error: unknown): string {
  if (error instanceof ActivationCancelledError) return '';
  const {code, message} = activationErrorDetails(error);
  const diagnostic = `${code} ${message}`.toLowerCase();

  if (diagnostic.includes('network') || diagnostic.includes('timed out')) {
    return 'No pudimos conectarnos. Revisa Internet y vuelve a intentarlo.';
  }
  if (diagnostic.includes('not configured yet')) {
    return 'Google todavía no está configurado en esta instalación. Puedes continuar gratis y volver a intentarlo después.';
  }
  if (
    diagnostic.includes('developer_error')
    || diagnostic.includes('auth/invalid-credential')
    || diagnostic.includes('auth/operation-not-allowed')
    || code === '10'
  ) {
    return 'Esta instalación aún no pudo validarse con Google. VOZUAL sigue disponible gratis sin cuenta.';
  }
  if (diagnostic.includes('play services')) {
    return 'Google Play Services necesita actualizarse antes de activar la cuenta.';
  }
  if (diagnostic.includes('account-exists-with-different-credential')) {
    return 'Ese correo ya usa otro método de acceso. Intenta con el proveedor utilizado anteriormente.';
  }
  return code
    ? `No pudimos activar la cuenta (${code}). Puedes seguir usando VOZUAL gratis.`
    : 'No pudimos activar la cuenta. Puedes seguir usando VOZUAL gratis e intentarlo después.';
}
