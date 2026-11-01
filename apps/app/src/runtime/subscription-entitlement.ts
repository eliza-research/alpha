/**
 * Alpha binding of the shared Eliza Cloud subscription entitlement client (issue #410, P-26).
 *
 * Verification of the signed short-lived entitlement, account binding, admission, background
 * refresh, expiry/outage states, Cloud refusal parsing with retry times and the owner-facing copy
 * live upstream in `@elizaos/cloud-sdk/subscription-entitlement`, projected from the pinned
 * checkout. Alpha supplies only its product name and the noun for local data. Nothing here
 * selects a price, quota, allowance or limit; turns never read billing.
 */
import {
  allowanceText as sharedAllowanceText,
  describeSubscription as sharedDescribeSubscription,
  redeemFailureMessage as sharedRedeemFailureMessage,
  serviceLimitMessage as sharedServiceLimitMessage,
  subscriptionSummary as sharedSubscriptionSummary,
  type PlanAllowance,
  type ServiceLimit,
  type SubscriptionCopy,
  type SubscriptionDescription,
  type SubscriptionSummary,
  type SubscriptionView,
} from '../../../../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts';

export * from '../../../../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts';

/** Alpha's names in shared copy; the service name is the configured deployment's. */
export function alphaSubscriptionCopy(serviceName = 'Cloud'): SubscriptionCopy {
  return { serviceName, productName: 'Alpha Phone', deviceNoun: 'phone' };
}
export function describeSubscription(view: SubscriptionView | null | undefined, serviceName = 'Cloud'): SubscriptionDescription {
  return sharedDescribeSubscription(view, alphaSubscriptionCopy(serviceName));
}
export function allowanceText(allowance: PlanAllowance | null, now: number = Date.now(), serviceName = 'Cloud'): string {
  return sharedAllowanceText(allowance, now, alphaSubscriptionCopy(serviceName));
}
export function serviceLimitMessage(limit: ServiceLimit | null, now: number = Date.now(), serviceName = 'Cloud'): string {
  return sharedServiceLimitMessage(limit, now, alphaSubscriptionCopy(serviceName));
}
export function redeemFailureMessage(error: unknown, serviceName = 'Cloud'): string {
  return sharedRedeemFailureMessage(error, alphaSubscriptionCopy(serviceName));
}
export function subscriptionSummary(view: SubscriptionView | null | undefined, options: { planEndsAt?: number | null; lastLimit?: ServiceLimit | null; lastLimitAt?: number | null; now?: number; serviceName?: string } = {}): SubscriptionSummary {
  const { serviceName, ...rest } = options;
  return sharedSubscriptionSummary(view, { ...rest, copy: alphaSubscriptionCopy(serviceName) });
}
