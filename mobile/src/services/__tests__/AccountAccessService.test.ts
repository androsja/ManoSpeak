const mockDoc = jest.fn((_firestore: unknown, ...segments: string[]) => ({
  path: segments.join('/'),
}));
const mockGetDoc = jest.fn();
const mockGetFirestore = jest.fn(() => ({name: 'firestore'}));

jest.mock('@react-native-firebase/firestore', () => ({
  doc: (...args: [unknown, ...string[]]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getFirestore: () => mockGetFirestore(),
}));

import {
  hasActivePlusEntitlement,
  loadPlusEntitlement,
} from '../AccountAccessService';

describe('AccountAccessService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts only a non-expired server Plus entitlement', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    expect(hasActivePlusEntitlement({
      plan: 'plus',
      entitlementExpiresAt: '2026-11-08T12:00:00.000Z',
    }, now)).toBe(true);
    expect(hasActivePlusEntitlement({
      plan: 'plus',
      entitlementExpiresAt: '2026-09-08T12:00:00.000Z',
    }, now)).toBe(false);
    expect(hasActivePlusEntitlement({
      plan: 'free',
      entitlementExpiresAt: '2026-11-08T12:00:00.000Z',
    }, now)).toBe(false);
  });

  it('reads the signed-in account access document', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        plan: 'plus',
        entitlementExpiresAt: {toMillis: () => Date.now() + 60_000},
      }),
    });

    await expect(loadPlusEntitlement(' account-123 ')).resolves.toBe(true);
    expect(mockDoc).toHaveBeenCalledWith(
      {name: 'firestore'},
      'access',
      'account-123',
    );
  });

  it('fails closed when the access document does not exist', async () => {
    mockGetDoc.mockResolvedValue({exists: () => false});
    await expect(loadPlusEntitlement('account-123')).resolves.toBe(false);
  });
});
