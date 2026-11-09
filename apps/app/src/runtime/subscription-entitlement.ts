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
  isEntitlementSignInFailure,
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
import { CloudResidentBindingError, type ResidentAdmission } from '../../../../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';
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
/** A Cloud identity read that failed without Cloud refusing the credential (identityReadRefused). */
export class CloudIdentityUnreachable extends Error {
  constructor(cause: unknown) {
    super('Cloud could not be reached', { cause });
    this.name = 'CloudIdentityUnreachable';
  }
}
/** A Cloud outage or no network: not a refusal of the account or the plan. The transports reject
 * with these messages and no stable code; a Cloud HTTP answer is unreachable only for 408, 429 or 5xx. */
export function cloudUnreachable(error: unknown): boolean {
  if (error instanceof CloudIdentityUnreachable) return true;
  if (!(error instanceof Error) || error.name === 'AbortError') return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (error.name === 'CloudProtocolError') return code === 'http' && typeof status === 'number' && (status === 408 || status === 429 || status >= 500);
  return /^(Connection request failed|Connection timed out|Request cancelled)$/.test(error.message);
}
/** Cloud refused the saved credential while reading its identity: a 401 or an explicit credential
 * code, the shared entitlement client's rule. Any other failed read (an edge 403 or 404, a redirect,
 * a transport or secure-storage rejection) is not a refusal. */
export function identityReadRefused(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 401 || code === 'expired' || code === 'credentials-missing' || code === 'account-changed';
}
/**
 * What the phone does with a resident admission (the shared controller's reason): the inference
 * binding, the plan view, and whether the sign-in is detached, its offline grace forgotten or the
 * owner asked to sign in. Never whether the agent runs. `attached`: a Cloud connection is held;
 * `verified`: it is the account this admission verified.
 */
export type ResidentAdmissionOutcome = {
  binding: ResidentAdmission['binding'];
  view: { residentPlanNotice: 'offline' | 'needs-plan' | null; residentSubscription: SubscriptionView | null; planEndsAt: number | null; residentSavedCredential?: false };
  signIn?: 'required' | 'rejected' | 'account-changed';
  detach?: boolean;
  forgetPlan?: boolean;
};
export function residentAdmissionOutcome(admission: ResidentAdmission<SubscriptionView>, connection: { attached: boolean; verified: boolean }): ResidentAdmissionOutcome {
  const outage: SubscriptionView = { kind: 'unavailable', reason: 'outage' };
  switch (admission.reason) {
    case 'signed-out':
      // First run or signed out: sign-in is required, and the agent runs meanwhile without Cloud inference.
      return { binding: 'unbound', view: { residentSavedCredential: false, residentSubscription: null, residentPlanNotice: null, planEndsAt: null }, signIn: 'required', detach: connection.attached };
    case 'offline':
      // A plan verified recently for this sign-in keeps its binding; nothing is said about it.
      return { binding: admission.binding, view: { residentPlanNotice: 'offline', residentSubscription: outage, planEndsAt: admission.recent?.endsAt ?? null } };
    case 'sign-in-rejected':
    case 'account-changed': {
      // The shared controller's own account-changed fence (a newer credential replaced this one) is
      // not a refusal of this sign-in: it never detaches and leaves the plan grace to the newer one.
      // Before the identity was verified only a rejected read of this sign-in detaches it.
      const fence = admission.error instanceof CloudResidentBindingError;
      const rejected = admission.reason === 'sign-in-rejected';
      const detach = !admission.identity ? rejected && connection.attached : !fence && isEntitlementSignInFailure(admission.error) && connection.verified;
      return { binding: 'unbound', view: { residentPlanNotice: null, residentSubscription: null, planEndsAt: null }, signIn: rejected ? 'rejected' : 'account-changed', detach, forgetPlan: rejected && !fence };
    }
    case 'plan-unavailable':
      return { binding: 'unbound', view: { residentPlanNotice: 'needs-plan', residentSubscription: outage, planEndsAt: null } };
    case 'needs-plan':
      // The plan notice offers Redeem code / Choose a plan / Check plan again; nothing is bound.
      return { binding: 'unbound', view: { residentSubscription: admission.plan?.view ?? null, residentPlanNotice: 'needs-plan', planEndsAt: null } };
    case 'admitted':
      return { binding: 'cloud', view: { residentSubscription: admission.plan?.view ?? null, residentPlanNotice: null, planEndsAt: admission.endsAt ?? null } };
  }
}
