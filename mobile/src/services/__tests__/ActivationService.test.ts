const mockGetAuth = jest.fn();
const mockOnAuthStateChanged = jest.fn();
const mockSignInWithCredential = jest.fn();
const mockSignOut = jest.fn();
const mockDeleteUser = jest.fn();
const mockReauthenticateWithCredential = jest.fn();
const mockRevokeToken = jest.fn();
const mockGoogleCredential = jest.fn((_idToken: string, _accessToken: string) => ({
  providerId: 'google.com',
}));
const mockGoogleConfigure = jest.fn();
const mockGoogleHasPlayServices = jest.fn();
const mockGoogleSignIn = jest.fn();
const mockGoogleGetTokens = jest.fn();
const mockGoogleSignOut = jest.fn();
const mockGoogleRevokeAccess = jest.fn();
const mockDeleteAccountCloudData = jest.fn();
const mockClearLocalUsage = jest.fn();

jest.mock('@react-native-firebase/auth', () => ({
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  getAuth: () => mockGetAuth(),
  GoogleAuthProvider: {
    credential: (...args: [string, string]) => mockGoogleCredential(...args),
  },
  OAuthProvider: jest.fn().mockImplementation(() => ({credential: jest.fn()})),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  reauthenticateWithCredential: (...args: unknown[]) => mockReauthenticateWithCredential(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
  signInWithCredential: (...args: unknown[]) => mockSignInWithCredential(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockGoogleConfigure(...args),
    getTokens: (...args: unknown[]) => mockGoogleGetTokens(...args),
    hasPlayServices: (...args: unknown[]) => mockGoogleHasPlayServices(...args),
    revokeAccess: (...args: unknown[]) => mockGoogleRevokeAccess(...args),
    signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
    signOut: (...args: unknown[]) => mockGoogleSignOut(...args),
  },
  isSuccessResponse: (response: {type?: string}) => response.type === 'success',
}));

jest.mock('@invertase/react-native-apple-authentication', () => ({
  appleAuth: {
    isSupported: false,
    Operation: {LOGIN: 'login'},
    Scope: {FULL_NAME: 'full-name', EMAIL: 'email'},
    performRequest: jest.fn(),
  },
}));

jest.mock('../AccountProfileService', () => ({
  deleteAccountCloudData: (...args: unknown[]) => mockDeleteAccountCloudData(...args),
}));

jest.mock('../UsageMeterService', () => ({
  clearLocalUsage: (...args: unknown[]) => mockClearLocalUsage(...args),
}));

import {
  ActivationCancelledError,
  activateWithGoogle,
  closeActivationSession,
  deleteActivationAccount,
  NoActivationAccountError,
  observeActivationAccount,
} from '../ActivationService';

const user = {
  uid: 'account-123',
  email: 'person@example.com',
  displayName: 'Person',
  photoURL: null,
  metadata: {creationTime: '2026-09-05T00:00:00Z'},
  providerData: [{providerId: 'google.com'}],
};

describe('activation account lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockReturnValue({currentUser: user});
    mockGoogleHasPlayServices.mockResolvedValue(true);
    mockGoogleSignIn.mockResolvedValue({type: 'success', data: {idToken: 'id-token'}});
    mockGoogleGetTokens.mockResolvedValue({accessToken: 'access-token'});
    mockSignInWithCredential.mockResolvedValue({user});
    mockSignOut.mockResolvedValue(undefined);
    mockGoogleSignOut.mockResolvedValue(null);
  });

  it('creates a Firebase session from a user-initiated Google result', async () => {
    const account = await activateWithGoogle('web-client-id');

    expect(mockSignInWithCredential).toHaveBeenCalledWith(
      {currentUser: user},
      {providerId: 'google.com'},
    );
    expect(account).toEqual({
      uid: 'account-123',
      email: 'person@example.com',
      displayName: 'Person',
      photoURL: null,
      createdAt: '2026-09-05T00:00:00Z',
      providerIds: ['google.com'],
    });
  });

  it('maps persisted and revoked Firebase sessions through the observer', () => {
    const unsubscribe = jest.fn();
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(user);
      callback(null);
      return unsubscribe;
    });
    const listener = jest.fn();

    expect(observeActivationAccount(listener)).toBe(unsubscribe);
    expect(listener.mock.calls[0][0].uid).toBe('account-123');
    expect(listener.mock.calls[1][0]).toBeNull();
  });

  it('closes Firebase and provider sessions without blocking on provider cleanup', async () => {
    mockGoogleSignOut.mockRejectedValue(new Error('already revoked'));

    await expect(closeActivationSession()).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalledWith({currentUser: user});
    expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('deleteActivationAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockReturnValue({currentUser: user});
    mockGoogleHasPlayServices.mockResolvedValue(true);
    mockGoogleSignIn.mockResolvedValue({type: 'success', data: {idToken: 'id-token'}});
    mockGoogleGetTokens.mockResolvedValue({accessToken: 'access-token'});
    mockReauthenticateWithCredential.mockResolvedValue({user});
    mockDeleteAccountCloudData.mockResolvedValue(undefined);
    mockClearLocalUsage.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    mockGoogleRevokeAccess.mockResolvedValue(null);
  });

  it('reauthenticates before deleting cloud, local, and Authentication data', async () => {
    await deleteActivationAccount('web-client-id');

    expect(mockGoogleConfigure).toHaveBeenCalledWith({webClientId: 'web-client-id'});
    expect(mockGoogleCredential).toHaveBeenCalledWith('id-token', 'access-token');
    expect(mockReauthenticateWithCredential).toHaveBeenCalledWith(
      user,
      {providerId: 'google.com'},
    );
    expect(mockDeleteAccountCloudData).toHaveBeenCalledWith('account-123');
    expect(mockClearLocalUsage).toHaveBeenCalledWith('account-123');
    expect(mockDeleteUser).toHaveBeenCalledWith(user);
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(1);

    const calls = [
      mockReauthenticateWithCredential,
      mockDeleteAccountCloudData,
      mockClearLocalUsage,
      mockDeleteUser,
      mockGoogleRevokeAccess,
    ].map(mock => mock.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((left, right) => left - right));
  });

  it('keeps the account active when cloud data cannot be confirmed deleted', async () => {
    mockDeleteAccountCloudData.mockRejectedValue(new Error('network unavailable'));

    await expect(deleteActivationAccount('web-client-id')).rejects.toThrow('network unavailable');
    expect(mockClearLocalUsage).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  it('does not delete anything when identity confirmation is cancelled', async () => {
    mockGoogleSignIn.mockResolvedValue({type: 'cancelled'});

    await expect(deleteActivationAccount('web-client-id')).rejects.toBeInstanceOf(
      ActivationCancelledError,
    );
    expect(mockDeleteAccountCloudData).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('reports an already signed-out account without touching stored data', async () => {
    mockGetAuth.mockReturnValue({currentUser: null});

    await expect(deleteActivationAccount('web-client-id')).rejects.toBeInstanceOf(
      NoActivationAccountError,
    );
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
    expect(mockDeleteAccountCloudData).not.toHaveBeenCalled();
  });
});
