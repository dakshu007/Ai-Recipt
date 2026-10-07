/**
 * Plan entitlements. The prototype's `isPro` flag lived in the user's own
 * UserProperties (self-service pro, effectively). Here the plan is owned by
 * the backend and only changes through verified Stripe webhook events.
 *
 * Keyed by verified email (lowercased) because that's what Stripe Checkout
 * knows about the customer. Swap the store for a database in multi-instance
 * deployments — plan state must survive restarts before charging real money.
 */

export type Plan = 'free' | 'pro';

export interface EntitlementStore {
  getPlan(email: string): Promise<Plan>;
  setPlan(email: string, plan: Plan): Promise<void>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class InMemoryEntitlementStore implements EntitlementStore {
  private plans = new Map<string, Plan>();

  async getPlan(email: string): Promise<Plan> {
    return this.plans.get(normalizeEmail(email)) ?? 'free';
  }

  async setPlan(email: string, plan: Plan): Promise<void> {
    this.plans.set(normalizeEmail(email), plan);
  }
}
