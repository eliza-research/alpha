// Synthetic CloudProtocol exercise of the subscription plan gate routes (#410): code redemption,
// the billing snapshot fallback and the hosted plan page. A fake native transport answers in the
// shapes of elizaOS/eliza PR #36125; nothing leaves this process. This is not evidence of a real
// Cloud account, a real code, staging or a device.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
if (!process.execArgv.includes('--experimental-transform-types')) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--experimental-transform-types', process.argv[1]], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
const { CloudProtocol, CloudProtocolError, planManagementUrl } = await import('../apps/app/src/runtime/cloud-protocol.ts');
const { SubscriptionRedeemError } = await import('../apps/app/src/runtime/subscription-entitlement.ts');

const CODE = 'abcd-efgh-jkmn-pqrs';
const credential = { credentialId: '11111111-1111-4111-8111-111111111111', token: 'synthetic-cloud-key', expiresAt: Date.now() + 600_000 };
const store = { read: async () => ({ ...credential }), write: async () => {}, clear: async () => {} };
function client(answer, opened = []) {
  const calls = [];
  const request = async input => {
    calls.push({ url: input.url, method: input.method, body: input.body, authorization: input.headers.Authorization });
    return answer(input, calls.length);
  };
  return { calls, opened, cloud: new CloudProtocol('production', request, store, async url => { opened.push(url); }) };
}
const granted = { status: 200, data: { success: true, replayed: false, grant: { id: 'g1', planKey: 'plus_monthly', startsAt: '2026-10-13T00:00:00.000Z', endsAt: '2027-04-14T00:00:00.000Z', revoked: false, paidPlanTakesPrecedence: false }, entitlement: { plan: { id: 'plus_monthly', name: 'Plus', status: 'active' }, source: 'grant', effectiveUntil: '2027-04-14T00:00:00.000Z' } } };
const signal = () => new AbortController().signal;
const refused = async (promise, code) => assert.rejects(promise, error => error instanceof SubscriptionRedeemError && error.code === code && !String(error.message).includes('ABCD') && !JSON.stringify(error).includes('ABCD'));

// Success: one POST to the exact route with the normalized code, the caller's key and the bearer.
{
  const { cloud, calls } = client(() => granted);
  const result = await cloud.redeemSubscriptionCode(`  ${CODE} `, 'submission-key-0001', signal());
  assert.deepEqual(result, { planEndsAt: Date.parse('2027-04-14T00:00:00.000Z'), replayed: false, grantEndsAt: Date.parse('2027-04-14T00:00:00.000Z'), paidPlanTakesPrecedence: false, planName: 'Plus' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.eliza.app/api/v1/subscription/redeem');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].authorization, 'Bearer synthetic-cloud-key');
  assert.deepEqual(calls[0].body, { code: 'ABCDEFGHJKMNPQRS', idempotencyKey: 'submission-key-0001' });
}
// Replay of an earlier submission is the original grant, and a paid plan's precedence is reported.
{
  const { cloud } = client(() => ({ status: 200, data: { ...granted.data, replayed: true, grant: { ...granted.data.grant, paidPlanTakesPrecedence: true }, entitlement: null } }));
  const result = await cloud.redeemSubscriptionCode(CODE, 'submission-key-0002', signal());
  assert.equal(result.replayed, true);
  assert.equal(result.paidPlanTakesPrecedence, true);
  assert.equal(result.planName, null);
}
// Revoked replays grant nothing, and the effective paid window is distinct from the grant window.
{
 const revoked=client(()=>({status:200,data:{...granted.data,replayed:true,grant:{...granted.data.grant,revoked:true}}}));
 await refused(revoked.cloud.redeemSubscriptionCode(CODE,'submission-revoked',signal()),'invalid');
 const paid=client(()=>({status:200,data:{...granted.data,grant:{...granted.data.grant,paidPlanTakesPrecedence:true},entitlement:{...granted.data.entitlement,effectiveUntil:'2027-05-01T00:00:00.000Z'}}}));
 assert.equal((await paid.cloud.redeemSubscriptionCode(CODE,'submission-paid',signal())).planEndsAt,Date.parse('2027-05-01T00:00:00.000Z'));
}
// Transport failure (the request may have arrived): exactly one replay with the same key.
{
  const { cloud, calls } = client((_input, n) => { if (n === 1) throw new Error('Connection request failed'); return granted; });
  await cloud.redeemSubscriptionCode(CODE, 'submission-key-0003', signal());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.idempotencyKey, calls[1].body.idempotencyKey);
  const failing = client(() => { throw new Error('Connection request failed'); });
  await refused(failing.cloud.redeemSubscriptionCode(CODE, 'submission-key-0004', signal()), 'unavailable');
  assert.equal(failing.calls.length, 2, 'never more than one replay');
}
// HTTP refusals are never retried and map to generic, code-free outcomes.
for (const [status, data, code] of [
  [400, { success: false, error: 'This subscription code cannot be redeemed.', code: 'invalid_subscription_code' }, 'invalid'],
  [400, { success: false, code: 'validation_error' }, 'invalid'],
  [409, { success: false, code: 'subscription_grant_already_redeemed' }, 'already-redeemed'],
  [409, { success: false, code: 'idempotency_conflict' }, 'invalid'],
  [403, { success: false, code: 'access_denied' }, 'account'],
  [503, { success: false, code: 'service_unavailable' }, 'unavailable'],
  [404, {}, 'unavailable'],
  [500, { success: false, code: 'internal_error' }, 'unavailable'],
]) {
  const { cloud, calls } = client(() => ({ status, data }));
  await refused(cloud.redeemSubscriptionCode(CODE, 'submission-key-0005', signal()), code);
  assert.equal(calls.length, 1, `${status} ${data.code} is not retried`);
}
// Rate limit: the retry time comes from the 429 body (native clients read no headers).
{
  const { cloud } = client(() => ({ status: 429, data: { success: false, code: 'rate_limit_exceeded', retryAfter: 840, retryAfterSeconds: 840 } }));
  await assert.rejects(cloud.redeemSubscriptionCode(CODE, 'submission-key-0006', signal()), error => error instanceof SubscriptionRedeemError && error.code === 'rate-limited' && error.retryAfterMs === 840_000);
}
// An expired sign-in stays a sign-in failure, never a code failure.
{
  const { cloud } = client(() => ({ status: 401, data: {} }));
  await assert.rejects(cloud.redeemSubscriptionCode(CODE, 'submission-key-0007', signal()), error => error instanceof CloudProtocolError && error.status === 401);
}
// Text that cannot be a code is refused locally with the same generic answer: nothing is sent.
{
  const { cloud, calls } = client(() => granted);
  for (const text of ['', 'short', 'ABCD-EFGH-JKMN-PQR!']) await refused(cloud.redeemSubscriptionCode(text, 'submission-key-0008', signal()), 'invalid');
  await assert.rejects(cloud.redeemSubscriptionCode(CODE, 'bad key', signal()), TypeError);
  assert.equal(calls.length, 0);
}
// A malformed success body is not reported as redeemed.
{
  const { cloud } = client(() => ({ status: 200, data: { success: true } }));
  await refused(cloud.redeemSubscriptionCode(CODE, 'submission-key-0009', signal()), 'unavailable');
}

// Entitlement route absent: the billing snapshot fallback, then unknown.
{
  const limits = { status: 200, data: { success: true, data: { schemaVersion: 2, v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'past_due', currentPeriodEnd: '2026-11-12T00:00:00.000Z' } } } } } };
  const { cloud, calls } = client(input => new URL(input.url).pathname === '/api/v1/billing/limits' ? limits : { status: 404, data: {} });
  assert.equal(await cloud.subscriptionEntitlement(signal()), null);
  assert.deepEqual(await cloud.billingFallbackPlan(signal()), { status: 'past_due', planName: 'Plus', periodEnd: Date.parse('2026-11-12T00:00:00.000Z') });
  assert.deepEqual(calls.map(call => [call.method, new URL(call.url).pathname]), [['GET', '/api/v1/subscription/entitlement'], ['GET', '/api/v1/billing/limits']]);
  const absent = client(() => ({ status: 404, data: {} }));
  assert.equal(await absent.cloud.billingFallbackPlan(signal()), null);
  const outage = client(() => ({ status: 503, data: {} }));
  await assert.rejects(outage.cloud.billingFallbackPlan(signal()), error => error instanceof CloudProtocolError && error.status === 503);
  assert.equal(typeof cloud.creditBalance, 'undefined', 'the credit balance check is retired');
}
// Choose a plan opens exactly the allowlisted hosted page, nothing else.
{
  const opened = [];
  const { cloud, calls } = client(() => granted, opened);
  await cloud.openSubscriptionManagement(signal());
  assert.deepEqual(opened, ['https://cloud.eliza.app/cloud/billing']);
  assert.equal(calls.length, 0);
  assert.equal(planManagementUrl('production'), 'https://cloud.eliza.app/cloud/billing');
  assert.equal(planManagementUrl('staging'), 'https://cloud-staging.eliza.app/cloud/billing');
  const stagingOpened = [];
  await new CloudProtocol('staging', async () => granted, store, async url => { stagingOpened.push(url); }).openSubscriptionManagement(signal());
  assert.deepEqual(stagingOpened, ['https://cloud-staging.eliza.app/cloud/billing']);
}
// Staging QA reaches the staging API authority for every plan route.
{
  const calls = [];
  const staging = new CloudProtocol('staging', async input => { calls.push(input.url); return granted; }, store, async () => {});
  await staging.redeemSubscriptionCode(CODE, 'submission-key-0010', signal());
  assert.deepEqual(calls, ['https://api-staging.eliza.app/api/v1/subscription/redeem']);
  assert.equal(staging.entitlementIssuer, 'https://api-staging.eliza.app');
}
console.log('PASS: subscription redemption (success, replay, transport replay with the same key, generic refusals, rate limit, sign-in), billing snapshot fallback and the exact plan page');
