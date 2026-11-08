/**
 * Alpha binding of the shared Eliza Cloud subscription entitlement client (issue #410, P-26).
 *
 * Verification of the signed short-lived entitlement, account binding, admission, background
 * refresh, expiry/outage states, Cloud refusal parsing with retry times and the owner-facing copy
 * live upstream in `@elizaos/cloud-sdk/subscription-entitlement`, projected from the pinned
 * checkout. Alpha supplies its product names and subscription-first presentation. Nothing here
 * selects a price, quota, allowance or limit; turns never read billing.
 */
import {
  allowanceText as sharedAllowanceText,
  describeSubscription as sharedDescribeSubscription,
  redeemFailureMessage as sharedRedeemFailureMessage,
  retryDuration,
  serviceLimitMessage as sharedServiceLimitMessage,
  subscriptionSummary as sharedSubscriptionSummary,
  type PlanAllowance,
  type ServiceLimit,
  type SubscriptionCopy,
  type SubscriptionDescription,
  type SubscriptionSummary,
  type SubscriptionView,
} from '../../../../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts';

import { formatMonthDay, formatTime } from '../prototype/locale-time.ts';
export * from '../../../../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts';

/** Alpha's names in shared copy; the service name is the configured deployment's. */
export function alphaSubscriptionCopy(serviceName = 'Cloud'): SubscriptionCopy {
  return { serviceName, productName: 'Alpha Phone', deviceNoun: 'phone' };
}
export function describeSubscription(view: SubscriptionView | null | undefined, serviceName = 'Cloud'): SubscriptionDescription {
  if (view?.kind === 'credits') return {
    headline: 'No active subscription',
    detail: 'Choose a monthly plan or enter a membership code.',
    manage: true,
    manageLabel: 'Choose a monthly plan',
  };
  return sharedDescribeSubscription(view, alphaSubscriptionCopy(serviceName));
}
export function allowanceText(allowance: PlanAllowance | null, now: number = Date.now(), serviceName = 'Cloud'): string {
  return sharedAllowanceText(allowance, now, alphaSubscriptionCopy(serviceName));
}
/** The shared reset time format (month, day, hour, minute). */
function clock(at: number): string {
  // Device locale and 12/24-hour choice, as every displayed time in Alpha.
  try {
    const date = new Date(at);
    return `${formatMonthDay(date)}, ${formatTime(date)}`;
  } catch {
    return new Date(at).toISOString();
  }
}
/**
 * Plan refusals in chat say the reason once. The purchase reassurance sits on the Manage card and
 * in the Settings plan detail, beside the plan action; plan, sign-in and Cloud stay distinct (P-43).
 */
export function serviceLimitMessage(limit: ServiceLimit | null, now: number = Date.now(), serviceName = 'Cloud'): string {
  const copy = alphaSubscriptionCopy(serviceName);
  if (limit?.kind === 'allowance-exhausted') {
    const reset = limit.resetsAt != null && limit.resetsAt > now
      ? ` It resets ${clock(limit.resetsAt)}.`
      : limit.retryAfterMs != null ? ` It resets in ${retryDuration(limit.retryAfterMs)}.` : '';
    return `Your plan's AI allowance for this period is used up.${reset} Local apps keep working.`;
  }
  if (limit?.kind === 'subscription-required') return `AI needs an active ${serviceName} plan. Local apps keep working.`;
  if (limit?.kind === 'billing-refused') {
    const reset = limit.resetsAt != null && limit.resetsAt > now ? ` ${serviceName} reports your plan allowance resets ${clock(limit.resetsAt)}.` : '';
    return `${serviceName} declined this AI request for your account's billing.${reset} ${copy.productName} did not retry your message. Local apps keep working.`;
  }
  return sharedServiceLimitMessage(limit, now, copy);
}
export function redeemFailureMessage(error: unknown, serviceName = 'Cloud'): string {
  return sharedRedeemFailureMessage(error, alphaSubscriptionCopy(serviceName));
}
export function subscriptionSummary(view: SubscriptionView | null | undefined, options: { planEndsAt?: number | null; lastLimit?: ServiceLimit | null; lastLimitAt?: number | null; now?: number; serviceName?: string } = {}): SubscriptionSummary {
  const { serviceName, ...rest } = options;
  return { ...sharedSubscriptionSummary(view, { ...rest, copy: alphaSubscriptionCopy(serviceName) }), ...describeSubscription(view, serviceName) };
}
