import {
  doc,
  getDoc,
  getFirestore,
} from '@react-native-firebase/firestore';

type TimestampLike = {
  toMillis?: () => number;
  toDate?: () => Date;
};

function expiryMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const timestamp = value as TimestampLike;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime();
  return null;
}

export function hasActivePlusEntitlement(
  data: unknown,
  now = new Date(),
): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const access = data as {plan?: unknown; entitlementExpiresAt?: unknown};
  const expiresAt = expiryMillis(access.entitlementExpiresAt);
  return access.plan === 'plus'
    && expiresAt !== null
    && expiresAt > now.getTime();
}

/**
 * Reads the server-owned access document. Firestore rules prevent the mobile
 * client from granting or extending its own paid entitlement.
 */
export async function loadPlusEntitlement(uid: string): Promise<boolean> {
  const accountId = uid.trim();
  if (!accountId) return false;
  const snapshot = await getDoc(doc(getFirestore(), 'access', accountId));
  return snapshot.exists() && hasActivePlusEntitlement(snapshot.data());
}
