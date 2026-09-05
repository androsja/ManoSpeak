import RNFS from 'react-native-fs';

const USAGE_PATH = `${RNFS.DocumentDirectoryPath}/vozual-usage.json`;
const ANONYMOUS_ACCOUNT_ID = 'anonymous';

export type UsagePeriod = {
  periodId: string;
  consumedSeconds: number;
  updatedAt: string;
};

type UsageLedger = Record<string, UsagePeriod>;

let updateQueue = Promise.resolve<unknown>(undefined);

export function usagePeriodId(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function usageAccountId(uid?: string | null): string {
  return uid?.trim() || ANONYMOUS_ACCOUNT_ID;
}

export function emptyUsagePeriod(date = new Date()): UsagePeriod {
  return {
    periodId: usagePeriodId(date),
    consumedSeconds: 0,
    updatedAt: date.toISOString(),
  };
}

export function applyUsageDelta(
  current: UsagePeriod,
  seconds: number,
  date = new Date(),
): UsagePeriod {
  const periodId = usagePeriodId(date);
  const baseSeconds = current.periodId === periodId ? current.consumedSeconds : 0;
  const safeDelta = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return {
    periodId,
    consumedSeconds: Math.max(0, Math.round(baseSeconds)) + safeDelta,
    updatedAt: date.toISOString(),
  };
}

async function readLedger(): Promise<UsageLedger> {
  try {
    const raw = await RNFS.readFile(USAGE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as UsageLedger : {};
  } catch {
    return {};
  }
}

export async function loadLocalUsage(
  uid?: string | null,
  date = new Date(),
): Promise<UsagePeriod> {
  const ledger = await readLedger();
  const current = ledger[usageAccountId(uid)];
  if (!current || current.periodId !== usagePeriodId(date)) return emptyUsagePeriod(date);
  return applyUsageDelta(current, 0, date);
}

export function recordActiveTranslationSeconds(
  uid: string | null | undefined,
  seconds: number,
  date = new Date(),
): Promise<UsagePeriod> {
  const operation = updateQueue.then(async () => {
    const ledger = await readLedger();
    const accountId = usageAccountId(uid);
    const current = ledger[accountId] ?? emptyUsagePeriod(date);
    const next = applyUsageDelta(current, seconds, date);
    ledger[accountId] = next;
    await RNFS.writeFile(USAGE_PATH, JSON.stringify(ledger), 'utf8');
    return next;
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}

export function clearLocalUsage(uid: string): Promise<void> {
  const accountId = uid.trim();
  if (!accountId) return Promise.reject(new Error('An account identifier is required.'));

  const operation = updateQueue.then(async () => {
    const ledger = await readLedger();
    delete ledger[accountId];
    if (Object.keys(ledger).length > 0) {
      await RNFS.writeFile(USAGE_PATH, JSON.stringify(ledger), 'utf8');
      return;
    }
    if (await RNFS.exists(USAGE_PATH)) await RNFS.unlink(USAGE_PATH);
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
