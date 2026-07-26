/**
 * Plan catalogue.
 *
 * Quotas and prices live here rather than being read back from Stripe on every
 * request: a plan lookup sits in the hot path of every parse, and a network
 * round-trip to Stripe there would add latency and a second failure mode to an
 * endpoint that otherwise depends on nothing.
 *
 * `priceId` is read from the environment so the same code runs against Stripe
 * test and live mode without a rebuild.
 */

export type PlanId = 'starter' | 'growth' | 'scale';

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in USD cents. */
  amount: number;
  /** Parses included per calendar month. */
  quota: number;
  /** Requests per minute, to keep one customer from starving the others. */
  rateLimit: number;
}

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: 'starter', name: 'Starter', amount: 1900, quota: 1_000, rateLimit: 60 },
  growth: { id: 'growth', name: 'Growth', amount: 4900, quota: 5_000, rateLimit: 120 },
  scale: { id: 'scale', name: 'Scale', amount: 14900, quota: 25_000, rateLimit: 300 },
};

/** Anonymous demo allowance, per IP per day, used by the website's live demo. */
export const DEMO_DAILY_LIMIT = 10;

/**
 * Map a Stripe price ID to a plan.
 *
 * Returns `undefined` for an unrecognised price so the webhook can record the
 * event and alert rather than silently provisioning an unlimited key.
 */
export function planForPrice(priceId: string, env: PriceEnv): Plan | undefined {
  if (priceId && priceId === env.STRIPE_PRICE_STARTER) return PLANS.starter;
  if (priceId && priceId === env.STRIPE_PRICE_GROWTH) return PLANS.growth;
  if (priceId && priceId === env.STRIPE_PRICE_SCALE) return PLANS.scale;
  return undefined;
}

export interface PriceEnv {
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_SCALE?: string;
}

export function planById(id: string): Plan | undefined {
  return PLANS[id as PlanId];
}
