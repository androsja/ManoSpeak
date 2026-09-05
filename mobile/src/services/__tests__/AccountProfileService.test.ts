const mockCollection = jest.fn((_firestore: unknown, ..._segments: string[]) => ({
  path: 'usage/account-123/periods',
}));
const mockDeleteDoc = jest.fn();
const mockDoc = jest.fn((_firestore: unknown, ...segments: string[]) => ({
  path: segments.join('/'),
}));
const mockGetDocsFromServer = jest.fn();
const mockGetFirestore = jest.fn(() => ({name: 'firestore'}));
const mockWaitForPendingWrites = jest.fn();

jest.mock('@react-native-firebase/firestore', () => ({
  collection: (...args: [unknown, ...string[]]) => mockCollection(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  doc: (...args: [unknown, ...string[]]) => mockDoc(...args),
  getDoc: jest.fn(),
  getDocsFromServer: (...args: unknown[]) => mockGetDocsFromServer(...args),
  getFirestore: () => mockGetFirestore(),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  waitForPendingWrites: (...args: unknown[]) => mockWaitForPendingWrites(...args),
}));

import {deleteAccountCloudData} from '../AccountProfileService';

describe('deleteAccountCloudData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocsFromServer.mockResolvedValue({
      docs: [{ref: {path: 'usage/account-123/periods/2026-09'}}],
    });
    mockDeleteDoc.mockResolvedValue(undefined);
    mockWaitForPendingWrites.mockResolvedValue(undefined);
  });

  it('deletes profile, access, usage root, and every usage period', async () => {
    await deleteAccountCloudData(' account-123 ');

    expect(mockCollection).toHaveBeenCalledWith(
      {name: 'firestore'},
      'usage',
      'account-123',
      'periods',
    );
    expect(mockDeleteDoc.mock.calls.map(([reference]) => reference.path)).toEqual([
      'usage/account-123/periods/2026-09',
      'users/account-123',
      'access/account-123',
      'usage/account-123',
    ]);
    expect(mockWaitForPendingWrites).toHaveBeenCalledWith({name: 'firestore'});
  });

  it('fails closed before queued deletes when the server cannot be reached', async () => {
    mockGetDocsFromServer.mockRejectedValue(new Error('offline'));

    await expect(deleteAccountCloudData('account-123')).rejects.toThrow('offline');
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockWaitForPendingWrites).not.toHaveBeenCalled();
  });
});
