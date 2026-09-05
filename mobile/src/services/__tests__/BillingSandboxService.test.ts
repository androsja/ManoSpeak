const mockFiles = new Map<string, string>();

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  readFile: jest.fn((path: string) => {
    const value = mockFiles.get(path);
    return value === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(value);
  }),
  writeFile: jest.fn((path: string, value: string) => {
    mockFiles.set(path, value);
    return Promise.resolve();
  }),
}));

import {
  activateBillingSandboxEntitlement,
  billingSandboxAccountId,
  clearBillingSandboxEntitlement,
  createBillingSandboxEntitlement,
  loadBillingSandboxEntitlement,
  normalizeBillingSandboxEntitlement,
} from '../BillingSandboxService';

describe('BillingSandboxService', () => {
  beforeEach(() => mockFiles.clear());

  it('keeps sandbox purchases separated by account', async () => {
    await activateBillingSandboxEntitlement(
      'user-a',
      'monthly',
      new Date('2026-08-25T12:00:00Z'),
    );

    expect((await loadBillingSandboxEntitlement('user-a', new Date('2026-09-01T00:00:00Z'))).active).toBe(true);
    expect((await loadBillingSandboxEntitlement('user-b', new Date('2026-09-01T00:00:00Z'))).active).toBe(false);
    expect(billingSandboxAccountId()).toBe('anonymous');
  });

  it('creates monthly and annual expirations without charging a store', () => {
    const date = new Date('2026-08-10T10:00:00Z');
    expect(createBillingSandboxEntitlement('monthly', date).expiresAt).toBe('2026-09-10T10:00:00.000Z');
    expect(createBillingSandboxEntitlement('annual', date).expiresAt).toBe('2027-08-10T10:00:00.000Z');
  });

  it('expires and clears local sandbox access', async () => {
    const entitlement = createBillingSandboxEntitlement(
      'monthly',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(normalizeBillingSandboxEntitlement(entitlement, new Date('2026-09-02T00:00:00Z')).active).toBe(false);

    await activateBillingSandboxEntitlement('user-a', 'annual');
    await clearBillingSandboxEntitlement('user-a');
    expect((await loadBillingSandboxEntitlement('user-a')).active).toBe(false);
  });
});
