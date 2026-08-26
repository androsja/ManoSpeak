import {resolveAccessPolicy} from '../AccessPolicyService';
import {DEFAULT_APP_ACCESS_CONFIG} from '../AppAccessConfigService';

jest.mock('@react-native-firebase/remote-config', () => ({}));

const usage = {
  periodId: '2026-08',
  consumedSeconds: 55 * 60,
  updatedAt: '2026-08-25T00:00:00.000Z',
};

describe('AccessPolicyService', () => {
  it('keeps every feature available before monetization launches', () => {
    const policy = resolveAccessPolicy(DEFAULT_APP_ACCESS_CONFIG, usage);
    expect(policy.accessLabel).toBe('Gratis durante el lanzamiento');
    expect(policy.canUsePictureInPicture).toBe(true);
    expect(policy.canUsePhraseMode).toBe(true);
    expect(policy.quotaBlocked).toBe(false);
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
    expect(plusPolicy.quotaBlocked).toBe(false);
    expect(plusPolicy.canUsePictureInPicture).toBe(true);
  });
});
