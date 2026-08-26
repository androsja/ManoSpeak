import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
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
