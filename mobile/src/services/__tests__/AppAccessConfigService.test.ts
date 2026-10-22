import {
  DEFAULT_APP_ACCESS_CONFIG,
  parseUsageWarningMinutes,
} from '../AppAccessConfigService';

jest.mock('@react-native-firebase/remote-config', () => ({}));

describe('AppAccessConfigService', () => {
  it('normalizes warning thresholds from Remote Config', () => {
    expect(parseUsageWarningMinutes('[1, 15, 5, 5, -3]')).toEqual([15, 5, 1]);
  });

  it('keeps safe defaults when Remote Config returns invalid JSON', () => {
    expect(parseUsageWarningMinutes('invalid')).toEqual([15, 5, 1]);
  });

  it('keeps Google activation configured when Remote Config is unavailable', () => {
    expect(DEFAULT_APP_ACCESS_CONFIG.googleAuthEnabled).toBe(true);
    expect(DEFAULT_APP_ACCESS_CONFIG.googleWebClientId).toMatch(
      /\.apps\.googleusercontent\.com$/,
    );
  });

  it('rolls out premium translation surfaces with Plus required by default', () => {
    expect(DEFAULT_APP_ACCESS_CONFIG.continuousModeEnabled).toBe(true);
    expect(DEFAULT_APP_ACCESS_CONFIG.continuousModeRequiresPlus).toBe(true);
    expect(DEFAULT_APP_ACCESS_CONFIG.pictureInPictureEnabled).toBe(true);
    expect(DEFAULT_APP_ACCESS_CONFIG.pipRequiresPlus).toBe(true);
  });
});
