// Alpha's binding of the shared Eliza Cloud subscription entitlement client (#410). Verification,
// account binding, admission, refresh, expiry/outage and refusal parsing are tested with the module
// in elizaOS/eliza (packages/cloud/sdk/src/subscription-entitlement.test.mjs). These checks cover
// Alpha's copy binding, that no second implementation remains here, the account panel and that only
// admission and its background refresher read the entitlement. Plan names and numbers are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
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


test('the subscription sheet leads with the plan and reports its allowance and latest Cloud limit read-only', async () => {
  const {subscriptionSummary: sharedSummary, serviceLimitNextChange, alphaSubscriptionCopy} = await import('../apps/app/src/runtime/subscription-entitlement.ts');
  // The sheet renders through the projected shared hook (elizaOS/eliza#38105), evaluated as shipped.
  const hookSource = fs.readFileSync('.eliza/client-features/packages/ui/src/components/settings/cloud-subscription-summary.tsx', 'utf8');
  const hookCompiled = transformSync(hookSource.replace(/^import [\s\S]*?;\n/gm, '').replaceAll('export ', ''), {loader: 'tsx', jsxFactory: 'React.createElement'}).code;
  const useCloudSubscriptionSummary = new Function('React', 'useEffect', 'useState', 'subscriptionSummary', 'serviceLimitNextChange', hookCompiled + ';return useCloudSubscriptionSummary;')(React, React.useEffect, React.useState, sharedSummary, serviceLimitNextChange);
  const source = fs.readFileSync('apps/app/src/runtime/cloud-membership-ui.tsx', 'utf8');
  const compiled = transformSync(source.replace(/^import .*;\n/gm, '').replaceAll('export ', ''), {loader: 'tsx', jsxFactory: 'React.createElement'}).code;
  Object.assign(globalThis, new Function('React', transformSync(fs.readFileSync('apps/app/src/runtime/status-ui.tsx', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export ', ''), {loader: 'tsx', jsxFactory: 'React.createElement'}).code + ';return {Busy,StatusDot};')(React), {iconStyle: () => ({})});
  const Controls = new Function('React', 'useEffect', 'useId', 'useRef', 'useState', 'useCloudSubscriptionSummary', 'alphaSubscriptionCopy', compiled + ';return CloudMembershipControls;')(React, React.useEffect, React.useId, React.useRef, React.useState, useCloudSubscriptionSummary, alphaSubscriptionCopy);
  const render = props => renderToStaticMarkup(React.createElement(Controls, {balance: 'member', busy: false, email: 'owner@example.invalid', serviceName: 'Eliza Cloud', onRedeem: async () => true, onManagePlan() {}, onRefresh() {}, ...props}));
  const active = render({plan: {kind: 'active', planName: 'Synthetic plan', status: 'active', allowance: {unit: 'usd_micros', granted: 100, remaining: 25, periodStart: Date.now() - 1000, resetsAt: Date.now() + 86400000}, expiresAt: Date.now() + 1000, refreshFailed: false},
    endsAt: Date.now() + 10 * 86400000, lastLimit: {kind: 'rate-limited', retryAfterMs: 60000, resetsAt: null, observedAt: Date.now()}});
  assert.match(active, /Synthetic plan/);
  assert.match(active, /25% of this billing period&#x27;s plan allowance is left/);
  assert.match(active, /\d+d left/);
  assert.match(active, /<dt>Limit<\/dt><dd role="status">The AI request rate limit was reached\. Try again in about (59|60) seconds\./);
  assert.match(active, /aria-label="Balance and membership"/);
  assert.match(active, /<dt>Plan<\/dt>/);
  assert.match(active, />Plan</);
  assert.doesNotMatch(active, /Available credits|Add credits|\bUSD\b/);
  assert.match(active, />Code</);
  const credits = render({balance: 'funded', plan: {kind: 'credits', source: 'billing-limits'}});
  assert.match(credits, /No plan/);
  assert.match(credits, />Choose plan</);
  assert.doesNotMatch(credits, /Available credits|Add credits|\bUSD\b/);
  assert.doesNotMatch(credits, /plan allowance|<dt>Limit/, 'no allowance or limit line without a reported allowance or a current limit');
  const none = render({balance: 'zero', plan: {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'}});
  assert.doesNotMatch(none, /Choose a plan or enter a membership code to ask Alpha\./);
  // After Cloud declined a turn for billing the sheet says so, above the same two actions.
  const refused = render({balance: 'funded', refused: true, plan: {kind: 'credits', source: 'billing-limits'}});
  assert.match(refused, /Billing declined/);
  assert.match(refused, />Choose plan</);
  assert.match(refused, />Code</);
  // A lapsed limit is not shown.
  const lapsed = render({plan: {kind: 'credits', source: 'billing-limits'}, lastLimit: {kind: 'rate-limited', retryAfterMs: 1000, resetsAt: null, observedAt: Date.now() - 120000}});
  assert.doesNotMatch(lapsed, /<dt>Limit/);
  // The section renders again only when a shown wait ends or a reset passes (bounded), never every second.
  // The timing is the shared serviceLimitNextChange (covered upstream); these are the sheet's cases.
  const change = (limit, now) => serviceLimitNextChange(limit, limit.observedAt, now);
  const at = 1_000_000_000_000;
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 60000, resetsAt: null, observedAt: at - 20000}, at), 40000);
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 60000, resetsAt: at + 5000, observedAt: at}, at), 5000);
  assert.equal(change({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: at + 30 * 86400000, observedAt: at}, at), 3600000, 'a far reset never overflows a timer');
  assert.equal(change({kind: 'billing-refused', retryAfterMs: null, resetsAt: null, observedAt: at - 59900}, at), 1000);
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 1000, resetsAt: at - 1, observedAt: at - 5000}, at), null, 'nothing is scheduled for a lapsed limit');
});
