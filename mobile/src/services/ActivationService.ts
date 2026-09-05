import {Platform} from 'react-native';
import {
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  revokeToken,
  signInWithCredential,
  signOut,
  type User,
} from '@react-native-firebase/auth';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import {appleAuth} from '@invertase/react-native-apple-authentication';
import {deleteAccountCloudData} from './AccountProfileService';
import {clearLocalUsage} from './UsageMeterService';

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

export class NoActivationAccountError extends Error {
  constructor() {
    super('There is no active VOZUAL account.');
    this.name = 'NoActivationAccountError';
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

async function reauthenticateForDeletion(
  user: User,
  webClientId: string,
): Promise<{provider: ActivationProvider; appleAuthorizationCode?: string}> {
  const providerIds = user.providerData.map(provider => provider.providerId);
  if (providerIds.includes('google.com')) {
    if (!webClientId) throw new Error('Google activation is not configured yet.');
    GoogleSignin.configure({webClientId});
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new ActivationCancelledError();
    const tokens = await GoogleSignin.getTokens();
    if (!response.data.idToken || !tokens.accessToken) {
      throw new Error('Google did not return the credentials required for deletion.');
    }
    await reauthenticateWithCredential(
      user,
      GoogleAuthProvider.credential(response.data.idToken, tokens.accessToken),
    );
    return {provider: 'google.com'};
  }

  if (providerIds.includes('apple.com') && Platform.OS === 'ios' && appleAuth.isSupported) {
    const response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
    });
    if (!response.identityToken || !response.nonce || !response.authorizationCode) {
      throw new Error('Apple did not return the credentials required for deletion.');
    }
    await reauthenticateWithCredential(
      user,
      new OAuthProvider('apple.com').credential({
        idToken: response.identityToken,
        rawNonce: response.nonce,
      }),
    );
    return {
      provider: 'apple.com',
      appleAuthorizationCode: response.authorizationCode,
    };
  }

  throw new Error('The account provider cannot be confirmed on this device.');
}

/**
 * Deletes cloud profile/access/usage data, private local usage, and finally
 * the Firebase Authentication account. Reauthentication happens first so a
 * stale session cannot leave cloud data behind after Authentication deletion.
 */
export async function deleteActivationAccount(webClientId: string): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new NoActivationAccountError();

  const reauthentication = await reauthenticateForDeletion(user, webClientId);
  await deleteAccountCloudData(user.uid);
  await clearLocalUsage(user.uid);
  if (reauthentication.provider === 'apple.com' && reauthentication.appleAuthorizationCode) {
    await revokeToken(auth, reauthentication.appleAuthorizationCode);
  }
  await deleteUser(user);
  if (reauthentication.provider === 'google.com') {
    await GoogleSignin.revokeAccess().catch(() => undefined);
  }
}
