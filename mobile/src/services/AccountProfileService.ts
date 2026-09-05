import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  waitForPendingWrites,
} from '@react-native-firebase/firestore';
import type {ActivationAccount} from './ActivationService';

/**
 * Stores only account-facing profile fields. Entitlements and authoritative
 * usage are intentionally excluded because only trusted server code may own
 * them.
 */
export async function ensureAccountProfile(account: ActivationAccount): Promise<void> {
  const reference = doc(getFirestore(), 'users', account.uid);
  const snapshot = await getDoc(reference);
  const profile = {
    email: account.email,
    displayName: account.displayName,
    providers: account.providerIds,
    country: 'CO',
    selectedSignLanguage: 'lsc-co',
    lastSeenAt: serverTimestamp(),
  };

  if (snapshot.exists()) {
    await setDoc(reference, profile, {merge: true});
    return;
  }

  await setDoc(reference, {
    ...profile,
    createdAt: serverTimestamp(),
  });
}

/**
 * Removes every cloud document currently associated with a VOZUAL account.
 * The server-backed read and pending-write barrier deliberately make account
 * deletion fail while offline instead of deleting Authentication first and
 * potentially stranding Firestore data that the user can no longer access.
 */
export async function deleteAccountCloudData(uid: string): Promise<void> {
  const accountId = uid.trim();
  if (!accountId) throw new Error('No account identifier is available for deletion.');

  const firestore = getFirestore();
  const periods = await getDocsFromServer(
    collection(firestore, 'usage', accountId, 'periods'),
  );
  const references = [
    ...periods.docs.map(snapshot => snapshot.ref),
    doc(firestore, 'users', accountId),
    doc(firestore, 'access', accountId),
    doc(firestore, 'usage', accountId),
  ];

  await Promise.all(references.map(reference => deleteDoc(reference)));
  await waitForPendingWrites(firestore);
}
