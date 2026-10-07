import { describe, expect, it } from 'vitest';
import { InMemoryUsageStore, utcDateKey } from '../src/services/usage.js';

describe('utcDateKey', () => {
  it('buckets by UTC day regardless of server timezone', () => {
    expect(utcDateKey(new Date('2026-07-02T23:59:59Z'))).toBe('2026-07-02');
    expect(utcDateKey(new Date('2026-07-03T00:00:01Z'))).toBe('2026-07-03');
  });
});

describe('InMemoryUsageStore', () => {
  it('increments per user per day and supports refunds', async () => {
    const store = new InMemoryUsageStore();
    expect(await store.increment('alice', '2026-07-02')).toBe(1);
    expect(await store.increment('alice', '2026-07-02')).toBe(2);
    expect(await store.increment('bob', '2026-07-02')).toBe(1);
    expect(await store.increment('alice', '2026-07-02', -1)).toBe(1);
    expect(await store.get('alice', '2026-07-02')).toBe(1);
  });

  it('keeps days separate and sweeps old days when a new day starts', async () => {
    const store = new InMemoryUsageStore();
    await store.increment('alice', '2026-07-02');
    expect(await store.get('alice', '2026-07-03')).toBe(0);
    await store.increment('alice', '2026-07-03'); // triggers sweep of 07-02
    expect(await store.get('alice', '2026-07-02')).toBe(0);
    expect(await store.get('alice', '2026-07-03')).toBe(1);
  });
});
