import type {AppAccessConfig} from './AppAccessConfigService';
import type {UsagePeriod} from './UsageMeterService';

export type AccessPolicy = {
  accessLabel: string;
  consumedMinutes: number;
  remainingMinutes: number;
  quotaBlocked: boolean;
  canUsePictureInPicture: boolean;
  canUsePhraseMode: boolean;
  canUseContinuousMode: boolean;
};

export function resolveAccessPolicy(
  config: AppAccessConfig,
  usage: UsagePeriod,
  hasPlusEntitlement = false,
): AccessPolicy {
  const consumedMinutes = Math.floor(Math.max(0, usage.consumedSeconds) / 60);
  const remainingMinutes = Math.max(0, config.freeMonthlyMinutes - consumedMinutes);
  // A trusted entitlement remains authoritative even while new purchases are
  // disabled remotely. Remote Config controls rollout, never paid identity.
  const paidAccessActive = hasPlusEntitlement;
  const quotaBlocked = config.monetizationEnabled
    && config.quotaEnforcementEnabled
    && !paidAccessActive
    && remainingMinutes <= 0;

  return {
    accessLabel: paidAccessActive
      ? 'VOZUAL Plus'
      : config.monetizationEnabled ? 'Plan gratuito' : 'Gratis durante el lanzamiento',
    consumedMinutes,
    remainingMinutes,
    quotaBlocked,
    canUsePictureInPicture: config.pictureInPictureEnabled && (
      !config.pipRequiresPlus
      || paidAccessActive
    ),
    canUsePhraseMode: !config.monetizationEnabled
      || !config.phraseModeRequiresPlus
      || paidAccessActive,
    canUseContinuousMode: config.continuousModeEnabled && (
      !config.continuousModeRequiresPlus || paidAccessActive
    ),
  };
}
