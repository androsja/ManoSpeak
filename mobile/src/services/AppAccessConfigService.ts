import {
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
} from '@react-native-firebase/remote-config';

export type AppAccessConfig = {
  activationRequired: boolean;
  googleAuthEnabled: boolean;
  appleAuthEnabled: boolean;
  monetizationEnabled: boolean;
  quotaEnforcementEnabled: boolean;
  freeTrialDays: number;
  freeMonthlyMinutes: number;
  freeAllSigns: boolean;
  pipRequiresPlus: boolean;
  phraseModeRequiresPlus: boolean;
  freeUsageMeasurement: 'active_translation_seconds';
  usageWarningMinutes: number[];
  googleWebClientId: string;
  supportEmail: string;
};

export const DEFAULT_APP_ACCESS_CONFIG: AppAccessConfig = {
  activationRequired: false,
  // Both native providers are configured in the Android and iOS projects.
  // Keep activation usable when Remote Config is temporarily unavailable;
  // account creation remains optional while activationRequired is false.
  googleAuthEnabled: true,
  appleAuthEnabled: true,
  monetizationEnabled: false,
  quotaEnforcementEnabled: false,
  freeTrialDays: 90,
  freeMonthlyMinutes: 60,
  freeAllSigns: true,
  pipRequiresPlus: true,
  phraseModeRequiresPlus: false,
  freeUsageMeasurement: 'active_translation_seconds',
  usageWarningMinutes: [15, 5, 1],
  // OAuth client identifiers are public configuration, not secrets. Keeping
  // the Firebase web client as a local fallback lets Google activation work
  // when Remote Config is offline or has not been deployed yet.
  googleWebClientId: '542813718733-ui3veq2qgcnvc510jqvdsrjuai2ktngn.apps.googleusercontent.com',
  supportEmail: 'androsjapps@gmail.com',
};

const REMOTE_DEFAULTS: Record<string, string | number | boolean> = {
  activation_required: DEFAULT_APP_ACCESS_CONFIG.activationRequired,
  auth_google_enabled: DEFAULT_APP_ACCESS_CONFIG.googleAuthEnabled,
  auth_apple_enabled: DEFAULT_APP_ACCESS_CONFIG.appleAuthEnabled,
  monetization_enabled: DEFAULT_APP_ACCESS_CONFIG.monetizationEnabled,
  quota_enforcement_enabled: DEFAULT_APP_ACCESS_CONFIG.quotaEnforcementEnabled,
  free_trial_days: DEFAULT_APP_ACCESS_CONFIG.freeTrialDays,
  free_monthly_minutes: DEFAULT_APP_ACCESS_CONFIG.freeMonthlyMinutes,
  free_all_signs: DEFAULT_APP_ACCESS_CONFIG.freeAllSigns,
  pip_requires_plus: DEFAULT_APP_ACCESS_CONFIG.pipRequiresPlus,
  phrase_mode_requires_plus: DEFAULT_APP_ACCESS_CONFIG.phraseModeRequiresPlus,
  free_usage_measurement: DEFAULT_APP_ACCESS_CONFIG.freeUsageMeasurement,
  usage_warning_minutes: JSON.stringify(DEFAULT_APP_ACCESS_CONFIG.usageWarningMinutes),
  google_web_client_id: DEFAULT_APP_ACCESS_CONFIG.googleWebClientId,
  support_email: DEFAULT_APP_ACCESS_CONFIG.supportEmail,
};

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

export function parseUsageWarningMinutes(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_APP_ACCESS_CONFIG.usageWarningMinutes;
    const values = parsed
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
      .map(value => Math.round(value));
    return Array.from(new Set(values)).sort((left, right) => right - left);
  } catch {
    return DEFAULT_APP_ACCESS_CONFIG.usageWarningMinutes;
  }
}

export async function loadAppAccessConfig(): Promise<AppAccessConfig> {
  try {
    const remoteConfig = getRemoteConfig();
    remoteConfig.defaultConfig = REMOTE_DEFAULTS;
    remoteConfig.settings = {
      fetchTimeoutMillis: 8_000,
      minimumFetchIntervalMillis: __DEV__ ? 0 : 60 * 60 * 1000,
    };
    await fetchAndActivate(remoteConfig);

    return {
      activationRequired: getBoolean(remoteConfig, 'activation_required'),
      // Internal builds must remain testable even if the deployed Remote
      // Config template is older than the native provider configuration.
      googleAuthEnabled: __DEV__ || getBoolean(remoteConfig, 'auth_google_enabled'),
      appleAuthEnabled: __DEV__ || getBoolean(remoteConfig, 'auth_apple_enabled'),
      monetizationEnabled: getBoolean(remoteConfig, 'monetization_enabled'),
      quotaEnforcementEnabled: getBoolean(remoteConfig, 'quota_enforcement_enabled'),
      freeTrialDays: positiveInteger(
        getNumber(remoteConfig, 'free_trial_days'),
        DEFAULT_APP_ACCESS_CONFIG.freeTrialDays,
      ),
      freeMonthlyMinutes: positiveInteger(
        getNumber(remoteConfig, 'free_monthly_minutes'),
        DEFAULT_APP_ACCESS_CONFIG.freeMonthlyMinutes,
      ),
      freeAllSigns: getBoolean(remoteConfig, 'free_all_signs'),
      pipRequiresPlus: getBoolean(remoteConfig, 'pip_requires_plus'),
      // Por frase is the free entry mode; Remote Config must not be able to
      // accidentally lock it behind Plus.
      phraseModeRequiresPlus: false,
      freeUsageMeasurement: 'active_translation_seconds',
      usageWarningMinutes: parseUsageWarningMinutes(
        getString(remoteConfig, 'usage_warning_minutes'),
      ),
      googleWebClientId: getString(remoteConfig, 'google_web_client_id').trim(),
      supportEmail: getString(remoteConfig, 'support_email').trim()
        || DEFAULT_APP_ACCESS_CONFIG.supportEmail,
    };
  } catch {
    // Firebase is intentionally optional until native configuration and the
    // providers have passed physical-device validation.
    return DEFAULT_APP_ACCESS_CONFIG;
  }
}
