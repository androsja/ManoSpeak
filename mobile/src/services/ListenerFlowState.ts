/**
 * Single, priority-ordered view of the listener flow. The UI keeps detailed
 * data (draft, candidates and queue) separately, but must expose exactly one
 * recoverable state to assistive technology at a time.
 */
export type ListenerFlowState =
  | 'idle'
  | 'permission-blocked'
  | 'listening'
  | 'resolving'
  | 'confirming-transcript'
  | 'choosing-meaning'
  | 'playing'
  | 'recoverable-error';

export type ListenerFlowInput = {
  listening: boolean;
  starting: boolean;
  phraseFinalizing: boolean;
  transcriptConfirmationVisible: boolean;
  ambiguousCandidateCount: number;
  playingSign: boolean;
  microphonePermissionBlocked: boolean;
  notificationPermissionBlocked: boolean;
  hasError: boolean;
};

export function deriveListenerFlowState(input: ListenerFlowInput): ListenerFlowState {
  if (input.microphonePermissionBlocked || input.notificationPermissionBlocked) {
    return 'permission-blocked';
  }
  if (input.transcriptConfirmationVisible) return 'confirming-transcript';
  if (input.ambiguousCandidateCount > 0) return 'choosing-meaning';
  if (input.starting || input.phraseFinalizing) return 'resolving';
  if (input.playingSign) return 'playing';
  if (input.listening) return 'listening';
  if (input.hasError) return 'recoverable-error';
  return 'idle';
}

export function listenerFlowAccessibilityLabel(state: ListenerFlowState): string {
  const labels: Record<ListenerFlowState, string> = {
    idle: 'Listo para escuchar.',
    'permission-blocked': 'Se requiere permiso para continuar.',
    listening: 'Escuchando.',
    resolving: 'Preparando la traducción.',
    'confirming-transcript': 'Revisa y confirma la transcripción.',
    'choosing-meaning': 'Elige el significado de la frase.',
    playing: 'Reproduciendo la interpretación disponible.',
    'recoverable-error': 'Hay un problema recuperable. Revisa las indicaciones.',
  };
  return labels[state];
}
