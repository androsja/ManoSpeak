import type {AppAccessConfig} from './AppAccessConfigService';
import type {UsagePeriod} from './UsageMeterService';

export type AccessPolicy = {
  accessLabel: string;
  consumedMinutes: number;
  remainingMinutes: number;
  quotaBlocked: boolean;
  canUsePictureInPicture: boolean;
  canUsePhraseMode: boolean;
};

export function resolveAccessPolicy(
  config: AppAccessConfig,
  usage: UsagePeriod,
  hasPlusEntitlement = false,
): AccessPolicy {
  const consumedMinutes = Math.floor(Math.max(0, usage.consumedSeconds) / 60);
  const remainingMinutes = Math.max(0, config.freeMonthlyMinutes - consumedMinutes);
  const paidAccessActive = config.monetizationEnabled && hasPlusEntitlement;
  const quotaBlocked = config.monetizationEnabled
    && config.quotaEnforcementEnabled
    && !paidAccessActive
    && remainingMinutes <= 0;

  return {
    accessLabel: config.monetizationEnabled
      ? paidAccessActive ? 'VOZUAL Plus' : 'Plan gratuito'
      : 'Gratis durante el lanzamiento',
    consumedMinutes,
    remainingMinutes,
    quotaBlocked,
    canUsePictureInPicture: !config.monetizationEnabled
      || !config.pipRequiresPlus
      || paidAccessActive,
    canUsePhraseMode: !config.monetizationEnabled
      || !config.phraseModeRequiresPlus
      || paidAccessActive,
  };
}
