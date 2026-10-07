/**
 * Server-side usage metering. The original prototype kept the daily counter in
 * the user's own UserProperties, where any user could reset it; here the
 * counter lives with the service and is keyed by the verified Google `sub`.
 *
 * The store is an interface so the in-memory implementation (fine for a
 * single instance) can be swapped for Redis/Postgres/Firestore when scaling
 * out — quota state must be shared across instances in that case.
 */

export interface UsageStore {
  /** Atomically add `n` to today's counter for the user and return the new value. */
  increment(userId: string, dateKey: string, n?: number): Promise<number>;
  get(userId: string, dateKey: string): Promise<number>;
}

/** UTC day bucket — independent of server timezone so it can't drift or be gamed by TZ tricks. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class InMemoryUsageStore implements UsageStore {
  private counters = new Map<string, number>();
  private lastSweepDay = '';

  private key(userId: string, dateKey: string): string {
    return `${dateKey}|${userId}`;
  }

  /** Drop counters from previous days so memory doesn't grow unbounded. */
  private sweep(dateKey: string): void {
    if (this.lastSweepDay === dateKey) return;
    this.lastSweepDay = dateKey;
    for (const key of this.counters.keys()) {
      if (!key.startsWith(`${dateKey}|`)) this.counters.delete(key);
    }
  }

  async increment(userId: string, dateKey: string, n = 1): Promise<number> {
    this.sweep(dateKey);
    const key = this.key(userId, dateKey);
    const next = (this.counters.get(key) ?? 0) + n;
    this.counters.set(key, next);
    return next;
  }

  async get(userId: string, dateKey: string): Promise<number> {
    return this.counters.get(this.key(userId, dateKey)) ?? 0;
  }
}
