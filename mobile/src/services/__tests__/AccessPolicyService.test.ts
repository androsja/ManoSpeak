import {resolveAccessPolicy} from '../AccessPolicyService';
import {DEFAULT_APP_ACCESS_CONFIG} from '../AppAccessConfigService';

jest.mock('@react-native-firebase/remote-config', () => ({}));

const usage = {
  periodId: '2026-08',
  consumedSeconds: 55 * 60,
  updatedAt: '2026-08-25T00:00:00.000Z',
};

describe('AccessPolicyService', () => {
  it('keeps Plus features disabled for free users on both platforms', () => {
    const policy = resolveAccessPolicy(DEFAULT_APP_ACCESS_CONFIG, usage);
    expect(policy.accessLabel).toBe('Gratis durante el lanzamiento');
    expect(policy.canUsePictureInPicture).toBe(false);
    expect(policy.canUsePhraseMode).toBe(true);
    expect(policy.canUseContinuousMode).toBe(false);
    expect(policy.quotaBlocked).toBe(false);
  });

  it('enables rolled-out Plus features for a paid user', () => {
    const policy = resolveAccessPolicy(DEFAULT_APP_ACCESS_CONFIG, usage, true);
    expect(policy.accessLabel).toBe('VOZUAL Plus');
    expect(policy.canUsePictureInPicture).toBe(true);
    expect(policy.canUseContinuousMode).toBe(true);
  });

  it('keeps a feature disabled for everyone when its rollout switch is off', () => {
    const policy = resolveAccessPolicy({
      ...DEFAULT_APP_ACCESS_CONFIG,
      continuousModeEnabled: false,
      pictureInPictureEnabled: false,
    }, usage, true);
    expect(policy.canUsePictureInPicture).toBe(false);
    expect(policy.canUseContinuousMode).toBe(false);
  });

  it('applies Plus feature rules only after monetization is enabled', () => {
    const config = {
      ...DEFAULT_APP_ACCESS_CONFIG,
      monetizationEnabled: true,
      quotaEnforcementEnabled: true,
      freeMonthlyMinutes: 50,
    };
    const freePolicy = resolveAccessPolicy(config, usage);
    const plusPolicy = resolveAccessPolicy(config, usage, true);
    expect(freePolicy.quotaBlocked).toBe(true);
    expect(freePolicy.canUsePictureInPicture).toBe(false);
    expect(freePolicy.canUseContinuousMode).toBe(false);
    expect(plusPolicy.quotaBlocked).toBe(false);
    expect(plusPolicy.canUsePictureInPicture).toBe(true);
    expect(plusPolicy.canUseContinuousMode).toBe(true);
  });
});
