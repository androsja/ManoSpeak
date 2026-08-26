import RNFS from 'react-native-fs';

const BILLING_SANDBOX_PATH = `${RNFS.DocumentDirectoryPath}/vozual-billing-sandbox.json`;
const ANONYMOUS_ACCOUNT_ID = 'anonymous';

export type BillingPlan = 'monthly' | 'annual';

export type BillingSandboxEntitlement = {
  active: boolean;
  plan: BillingPlan | null;
  purchasedAt: string | null;
  expiresAt: string | null;
};

type BillingSandboxLedger = Record<string, BillingSandboxEntitlement>;

let updateQueue = Promise.resolve<unknown>(undefined);

export function billingSandboxAccountId(uid?: string | null): string {
  return uid?.trim() || ANONYMOUS_ACCOUNT_ID;
}

export function emptyBillingSandboxEntitlement(): BillingSandboxEntitlement {
  return {
    active: false,
    plan: null,
    purchasedAt: null,
    expiresAt: null,
  };
}

export function createBillingSandboxEntitlement(
  plan: BillingPlan,
  date = new Date(),
): BillingSandboxEntitlement {
  const expiresAt = new Date(date);
  if (plan === 'monthly') expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 1);
  else expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return {
    active: true,
    plan,
    purchasedAt: date.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function normalizeBillingSandboxEntitlement(
  value: BillingSandboxEntitlement | undefined,
  date = new Date(),
): BillingSandboxEntitlement {
  if (!value?.active || !value.expiresAt) return emptyBillingSandboxEntitlement();
  if (Date.parse(value.expiresAt) <= date.getTime()) return emptyBillingSandboxEntitlement();
  return value;
}

async function readLedger(): Promise<BillingSandboxLedger> {
  try {
    const raw = await RNFS.readFile(BILLING_SANDBOX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as BillingSandboxLedger : {};
  } catch {
    return {};
  }
}

export async function loadBillingSandboxEntitlement(
  uid?: string | null,
  date = new Date(),
): Promise<BillingSandboxEntitlement> {
  const ledger = await readLedger();
  return normalizeBillingSandboxEntitlement(ledger[billingSandboxAccountId(uid)], date);
}

export function activateBillingSandboxEntitlement(
  uid: string | null | undefined,
  plan: BillingPlan,
  date = new Date(),
): Promise<BillingSandboxEntitlement> {
  const operation = updateQueue.then(async () => {
    const ledger = await readLedger();
    const entitlement = createBillingSandboxEntitlement(plan, date);
    ledger[billingSandboxAccountId(uid)] = entitlement;
    await RNFS.writeFile(BILLING_SANDBOX_PATH, JSON.stringify(ledger), 'utf8');
    return entitlement;
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}

export function clearBillingSandboxEntitlement(
  uid?: string | null,
): Promise<BillingSandboxEntitlement> {
  const operation = updateQueue.then(async () => {
    const ledger = await readLedger();
    delete ledger[billingSandboxAccountId(uid)];
    await RNFS.writeFile(BILLING_SANDBOX_PATH, JSON.stringify(ledger), 'utf8');
    return emptyBillingSandboxEntitlement();
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
