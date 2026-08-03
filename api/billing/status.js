/**
 * Subscription status for the signed-in caller — drives the pricing UI.
 * The project admin always reads as subscribed.
 */
import { admin } from 'hatchable';
import { getSubscription, isActive, isTrialing, pricing, checkoutUrl, PRODUCT_NAME } from 'lib/billing.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const isAdmin = await admin.check(req);
  const email = req.member?.email ?? null;
  const sub = isAdmin ? null : await getSubscription(email);

  return res.json({
    product: PRODUCT_NAME,
    pricing: pricing(),
    subscribed: isAdmin || isActive(sub) || isTrialing(sub),
    trialing: !isAdmin && isTrialing(sub),
    admin: isAdmin,
    email,
    plan: sub?.plan ?? (isAdmin ? 'owner' : 'none'),
    status: isAdmin ? 'owner' : (sub?.status ?? 'none'),
    currentPeriodEnd: sub?.current_period_end ?? null,
    trialEnd: sub?.trial_end ?? null,
    checkoutUrls: {
      single: checkoutUrl('single'),
      multi: checkoutUrl('multi'),
    },
  });
}
