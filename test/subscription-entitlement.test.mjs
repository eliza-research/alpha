// Alpha's binding of the shared Eliza Cloud subscription entitlement client (#410). Verification,
// account binding, admission, refresh, expiry/outage and refusal parsing are tested with the module
// in elizaOS/eliza (packages/cloud/sdk/src/subscription-entitlement.test.mjs). These checks cover
// Alpha's copy binding, that no second implementation remains here, the account panel and that only
// admission and its background refresher read the entitlement. Plan names and numbers are synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeSubscription, planAdmission, readServiceLimit, redeemFailureMessage, serviceLimitMessage, subscriptionSummary,
  SubscriptionRedeemError, organizationCreditFromLimits,
} from '../apps/app/src/runtime/subscription-entitlement.ts';

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

test('Alpha binds its product name, the phone and the deployment name into the shared copy', () => {
  const rate = readServiceLimit({code: 'http', status: 429, data: {error: 'rate_limited', retryAfterSeconds: 42}}, NOW);
  assert.equal(serviceLimitMessage(rate, NOW), 'The AI request rate limit was reached. Try again in about 42 seconds. Alpha Phone did not retry your message.');
  // Plan refusals say the reason once; the purchase reassurance sits on the Manage card beside them.
  assert.equal(serviceLimitMessage(readServiceLimit({status: 402, data: {}}, NOW), NOW, 'Eliza Cloud'), 'Billing declined');
  assert.equal(serviceLimitMessage({kind: 'billing-refused', retryAfterMs: null, resetsAt: NOW + 3600000}, NOW, 'Eliza Cloud'), 'Billing declined');
  assert.equal(serviceLimitMessage({kind: 'allowance-exhausted', retryAfterMs: 45 * 60000, resetsAt: null}, NOW), 'Limit reached · resets in about 45 minutes');
  assert.match(serviceLimitMessage({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: NOW + 86400000}, NOW), /^Limit reached · resets .+$/);
  assert.equal(serviceLimitMessage({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: NOW - 1}, NOW), 'Limit reached');
  assert.equal(serviceLimitMessage({kind: 'subscription-required', retryAfterMs: null, resetsAt: null}, NOW, 'Eliza Cloud'), 'Plan needed');
  for (const kind of ['allowance-exhausted', 'subscription-required', 'billing-refused'])
    assert.doesNotMatch(serviceLimitMessage({kind, retryAfterMs: null, resetsAt: null}, NOW), /purchased/i, kind);
  const none = describeSubscription({kind: 'inactive', planName: null, status: 'none', source: 'entitlement'}, 'Eliza Cloud');
  assert.equal(none.detail, 'Alpha Phone needs an active Eliza Cloud plan. Redeem a subscription code or choose a plan in Eliza Cloud. Nothing is purchased automatically, and your data on this phone is kept.');
  const creditDescription=describeSubscription({kind: 'credits', source: 'billing-limits'}, 'Eliza Cloud');
  assert.equal(creditDescription.headline, 'No plan');
  assert.equal(creditDescription.detail, '');
  assert.equal(creditDescription.manageLabel, 'Choose plan');
  assert.match(redeemFailureMessage(new SubscriptionRedeemError('account'), 'Eliza Cloud'), /^Eliza Cloud could not apply a code/);
  const summary = subscriptionSummary({kind: 'active', planName: 'Synthetic plan', status: 'active', allowance: {unit: 'usd_micros', granted: 100, remaining: 50, periodStart: NOW - 1, resetsAt: NOW + 86400000}, expiresAt: NOW + 1000, refreshFailed: false},
    {lastLimit: rate, lastLimitAt: NOW, now: NOW, serviceName: 'Eliza Cloud'});
  assert.match(summary.allowance, /^50% of this billing period's plan allowance is left\./);
  assert.match(summary.limit, /Alpha Phone did not retry your message\.$/);
  assert.equal(planAdmission({kind: 'credits', source: 'billing-limits'}), 'admit');
});

test('the organization credit balance is read only from an exact, fresh billing snapshot', () => {
  const at = new Date(NOW - 1000).toISOString();
  const snapshot = value => ({success: true, data: {schemaVersion: 2, v2: {balance: {status: 'available', source: 'organizations', observedAt: at, value: {revision: '7', balance: {unit: 'usd', currency: 'USD', value}}}}}});
  assert.deepEqual(organizationCreditFromLimits(snapshot('12.5'), NOW), {state: 'funded', usd: '12.5', observedAt: NOW - 1000});
  assert.equal(organizationCreditFromLimits(snapshot('0.000'), NOW).state, 'zero');
  for (const bad of [snapshot('-1'), snapshot('1e3'), {success: true, data: {schemaVersion: 1}}, null])
    assert.equal(organizationCreditFromLimits(bad, NOW).state, 'unavailable');
  assert.equal(organizationCreditFromLimits(snapshot('5'), NOW + 400000).state, 'unavailable', 'a stale observation is not shown');
});
