import {Platform} from 'react-native';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type User,
} from '@react-native-firebase/auth';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import {appleAuth} from '@invertase/react-native-apple-authentication';

export type ActivationProvider = 'google.com' | 'apple.com';

export type ActivationAccount = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string | null;
  providerIds: ActivationProvider[];
};

export class ActivationCancelledError extends Error {
  constructor() {
    super('Activation was cancelled.');
    this.name = 'ActivationCancelledError';
  }
}

function toActivationAccount(user: User): ActivationAccount {
  const providerIds = user.providerData
    .map(provider => provider.providerId)
    .filter((providerId): providerId is ActivationProvider => (
      providerId === 'google.com' || providerId === 'apple.com'
    ));

  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    createdAt: user.metadata.creationTime ?? null,
    providerIds,
  };
}

export function observeActivationAccount(
  listener: (account: ActivationAccount | null) => void,
): () => void {
  return onAuthStateChanged(getAuth(), user => {
    listener(user ? toActivationAccount(user) : null);
  });
}

export async function activateWithGoogle(webClientId: string): Promise<ActivationAccount> {
  if (!webClientId) {
    throw new Error('Google activation is not configured yet.');
  }

  GoogleSignin.configure({webClientId});
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
  }

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new ActivationCancelledError();
  }
  if (!response.data.idToken) {
    throw new Error('Google did not return an identity token.');
  }

  const tokens = await GoogleSignin.getTokens();
  if (!tokens.accessToken) {
    throw new Error('Google did not return an access token.');
  }

  const credential = GoogleAuthProvider.credential(
    response.data.idToken,
    tokens.accessToken,
  );
  const result = await signInWithCredential(getAuth(), credential);
  return toActivationAccount(result.user);
}

export async function activateWithApple(): Promise<ActivationAccount> {
  if (Platform.OS !== 'ios' || !appleAuth.isSupported) {
    throw new Error('Apple activation is not available on this device.');
  }

  const response = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
  });
  if (!response.identityToken || !response.nonce) {
    throw new Error('Apple did not return the required identity token.');
  }

  const credential = new OAuthProvider('apple.com').credential({
    idToken: response.identityToken,
    rawNonce: response.nonce,
  });
  const result = await signInWithCredential(getAuth(), credential);
  return toActivationAccount(result.user);
}

export async function closeActivationSession(): Promise<void> {
  await signOut(getAuth());
  await GoogleSignin.signOut().catch(() => undefined);
}
