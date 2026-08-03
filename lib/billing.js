/**
 * 1st Bookkeeper-In-A-Box — Monthly Subscription Billing
 *
 * Two clean monthly tiers:
 *   • Single Location Plan: $199/month (14-day trial, card required upfront)
 *   • Multi-Location Plan:  $149/month per location (2+ locations, 14-day trial)
 *
 * The paywall gates operator routes: the project admin (owner) always
 * passes; signed-in members need an active subscription row. Payment
 * collection runs through Stripe Checkout Sessions — set
 * STRIPE_SINGLE_PAYMENT_LINK and STRIPE_MULTI_PAYMENT_LINK (hosted
 * checkout URLs) and STRIPE_WEBHOOK_SECRET (activates subscriptions
 * automatically via /api/billing/webhook). Until Stripe is wired, the
 * admin can comp accounts manually via /api/billing/grant.
 */
import { db, admin } from 'hatchable';

export const PRODUCT_NAME = '1st Bookkeeper-In-A-Box';

export const PLANS = {
  single: {
    id: 'single',
    label: 'Single Location',
    amount: 199,
    currency: 'USD',
    interval: 'month',
    trialDays: 14,
    description: '$199/month — 1 location, all features, AI Guide included.',
  },
  multi: {
    id: 'multi',
    label: 'Multi-Location',
    amount: 149,
    currency: 'USD',
    interval: 'month',
    perUnit: 'location',
    minLocations: 2,
    trialDays: 14,
    description: '$149/month per location (2+ locations) — volume discount.',
  },
};

export function pricing() {
  return {
    product: PRODUCT_NAME,
    plans: PLANS,
  };
}

export function checkoutUrl(plan = 'single') {
  const e = globalThis.process?.env ?? {};
  if (plan === 'multi') return e.STRIPE_MULTI_PAYMENT_LINK ?? e.STRIPE_PAYMENT_LINK ?? null;
  return e.STRIPE_SINGLE_PAYMENT_LINK ?? e.STRIPE_PAYMENT_LINK ?? null;
}

export async function getSubscription(email) {
  if (!email) return null;
  const r = await db.query('SELECT * FROM subscriptions WHERE email = lower($1)', [email]);
  return r.rows[0] ?? null;
}

export function isActive(sub) {
  if (!sub || sub.status !== 'active') return false;
  if (sub.current_period_end === null || sub.current_period_end === undefined) return true;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

export function isTrialing(sub) {
  if (!sub || sub.status !== 'trialing') return false;
  if (sub.trial_end === null || sub.trial_end === undefined) return false;
  return new Date(sub.trial_end).getTime() > Date.now();
}

/**
 * Paywall gate. Returns true when the caller may proceed (project admin, or
 * member with an active/trialing subscription); otherwise sends 402 Payment
 * Required with pricing and checkout links and returns false.
 */
export async function requireSubscription(req, res) {
  if (await admin.check(req)) return true;

  const email = req.member?.email;
  const sub = await getSubscription(email);
  if (isActive(sub) || isTrialing(sub)) return true;

  res.status(402).json({
    error: 'subscription_required',
    product: PRODUCT_NAME,
    pricing: pricing(),
    message: 'This feature requires an active subscription to ' + PRODUCT_NAME + '.',
    checkoutUrls: {
      single: checkoutUrl('single'),
      multi: checkoutUrl('multi'),
    },
  });
  return false;
}

/** Upsert an active subscription (webhook + admin grant path). */
export async function activateSubscription(email, fields = {}) {
  await db.query(
    'INSERT INTO subscriptions (email, status, plan, stripe_customer_id, stripe_subscription_id, current_period_end) ' +
      'VALUES (lower($1), $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (email) DO UPDATE SET status = $2, ' +
      'plan = COALESCE($3, subscriptions.plan), ' +
      'stripe_customer_id = COALESCE($4, subscriptions.stripe_customer_id), ' +
      'stripe_subscription_id = COALESCE($5, subscriptions.stripe_subscription_id), ' +
      'current_period_end = COALESCE($6, subscriptions.current_period_end), updated_at = now()',
    [email, fields.status ?? 'active', fields.plan ?? 'single', fields.stripeCustomerId ?? null, fields.stripeSubscriptionId ?? null, fields.currentPeriodEnd ?? null],
  );
}

/** Cancel by email. Returns true if a row was updated. */
export async function cancelSubscription(email) {
  const r = await db.query(
    "UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE email = lower($1) RETURNING id",
    [email],
  );
  return r.rows.length > 0;
}

/** Cancel by Stripe subscription id (subscription.deleted webhook). */
export async function cancelByStripeId(stripeSubscriptionId) {
  const r = await db.query(
    "UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE stripe_subscription_id = $1 RETURNING id",
    [stripeSubscriptionId],
  );
  return r.rows.length > 0;
}
