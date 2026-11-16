import {deriveListenerFlowState, listenerFlowAccessibilityLabel} from '../ListenerFlowState';

const idle = {
  listening: false,
  starting: false,
  phraseFinalizing: false,
  transcriptConfirmationVisible: false,
  ambiguousCandidateCount: 0,
  playingSign: false,
  microphonePermissionBlocked: false,
  notificationPermissionBlocked: false,
  hasError: false,
};

describe('listener flow state', () => {
  it('exposes every normal and recovery state deterministically', () => {
    expect(deriveListenerFlowState(idle)).toBe('idle');
    expect(deriveListenerFlowState({...idle, listening: true})).toBe('listening');
    expect(deriveListenerFlowState({...idle, starting: true})).toBe('resolving');
    expect(deriveListenerFlowState({...idle, transcriptConfirmationVisible: true})).toBe('confirming-transcript');
    expect(deriveListenerFlowState({...idle, ambiguousCandidateCount: 2})).toBe('choosing-meaning');
    expect(deriveListenerFlowState({...idle, playingSign: true})).toBe('playing');
    expect(deriveListenerFlowState({...idle, hasError: true})).toBe('recoverable-error');
  });

  it('gives permission and user-confirmation states precedence over playback', () => {
    expect(deriveListenerFlowState({...idle, playingSign: true, transcriptConfirmationVisible: true}))
      .toBe('confirming-transcript');
    expect(deriveListenerFlowState({...idle, playingSign: true, microphonePermissionBlocked: true}))
      .toBe('permission-blocked');
  });

  it('provides a concise Spanish accessibility status for each state', () => {
    expect(listenerFlowAccessibilityLabel('confirming-transcript'))
      .toBe('Revisa y confirma la transcripción.');
  });
});
