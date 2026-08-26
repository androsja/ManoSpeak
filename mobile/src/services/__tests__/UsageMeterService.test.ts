import {
  applyUsageDelta,
  emptyUsagePeriod,
  usageAccountId,
  usagePeriodId,
} from '../UsageMeterService';

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
}));

describe('UsageMeterService', () => {
  it('uses a stable UTC month identifier', () => {
    expect(usagePeriodId(new Date('2026-08-31T23:59:59Z'))).toBe('2026-08');
  });

  it('resets consumed seconds when a new month begins', () => {
    const august = applyUsageDelta(
      emptyUsagePeriod(new Date('2026-08-01T00:00:00Z')),
      125,
      new Date('2026-08-25T12:00:00Z'),
    );
    const september = applyUsageDelta(august, 5, new Date('2026-09-01T00:00:00Z'));
    expect(september.periodId).toBe('2026-09');
    expect(september.consumedSeconds).toBe(5);
  });

  it('never subtracts usage and separates anonymous use', () => {
    const period = applyUsageDelta(emptyUsagePeriod(), -20);
    expect(period.consumedSeconds).toBe(0);
    expect(usageAccountId()).toBe('anonymous');
    expect(usageAccountId(' user-1 ')).toBe('user-1');
  });
});
