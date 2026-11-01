// Alpha's binding of the shared Eliza Cloud subscription entitlement client (#410). Verification,
// account binding, admission, refresh, expiry/outage and refusal parsing are tested with the module
// in elizaOS/eliza (packages/cloud/sdk/src/subscription-entitlement.test.mjs). These checks cover
// Alpha's copy binding, that no second implementation remains here, the account panel and that only
// admission and its background refresher read the entitlement. Plan names and numbers are synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {
  describeSubscription, planAdmission, readServiceLimit, redeemFailureMessage, serviceLimitMessage, subscriptionSummary,
  SubscriptionRedeemError, organizationCreditFromLimits,
} from '../apps/app/src/runtime/subscription-entitlement.ts';

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const USER = '22222222-2222-4222-8222-222222222222';

test('Alpha binds its product name, the phone and the deployment name into the shared copy', () => {
  const rate = readServiceLimit({code: 'http', status: 429, data: {error: 'rate_limited', retryAfterSeconds: 42}}, NOW);
  assert.equal(serviceLimitMessage(rate, NOW), 'The AI request rate limit was reached. Try again in about 42 seconds. Alpha Phone did not retry your message.');
  assert.match(serviceLimitMessage(readServiceLimit({status: 402, data: {}}, NOW), NOW, 'Eliza Cloud'), /^Eliza Cloud declined this AI request for your account's billing\. Check your account in Settings\. Alpha Phone did not retry your message, and nothing is purchased automatically\./);
  const none = describeSubscription({kind: 'inactive', planName: null, status: 'none', source: 'entitlement'}, 'Eliza Cloud');
  assert.equal(none.detail, 'Alpha Phone needs an active Eliza Cloud plan. Redeem a subscription code or choose a plan in Eliza Cloud. Nothing is purchased automatically, and your data on this phone is kept.');
  assert.equal(describeSubscription({kind: 'credits', source: 'billing-limits'}, 'Eliza Cloud').manageLabel, 'Manage billing in Eliza Cloud');
  assert.match(redeemFailureMessage(new SubscriptionRedeemError('account'), 'Eliza Cloud'), /^Eliza Cloud could not apply a code/);
  const summary = subscriptionSummary({kind: 'active', planName: 'Synthetic plan', status: 'active', allowance: {unit: 'usd_micros', granted: 100, remaining: 50, periodStart: NOW - 1, resetsAt: NOW + 86400000}, expiresAt: NOW + 1000, refreshFailed: false},
    {lastLimit: rate, lastLimitAt: NOW, now: NOW, serviceName: 'Eliza Cloud'});
  assert.match(summary.allowance, /^50% of this billing period's plan allowance is left\./);
  assert.match(summary.limit, /Alpha Phone did not retry your message\.$/);
  assert.equal(planAdmission({kind: 'credits', source: 'billing-limits'}), 'admit');
});

test('Alpha keeps no second entitlement implementation: it re-exports the projected upstream client', () => {
  const binding = fs.readFileSync('apps/app/src/runtime/subscription-entitlement.ts', 'utf8');
  assert.match(binding, /^export \* from '\.\.\/\.\.\/\.\.\/\.\.\/\.eliza\/client-features\/packages\/cloud\/sdk\/src\/subscription-entitlement\.ts';$/m);
  for (const duplicate of [/subtle\.verify/, /class EntitlementRefresher/, /function readServiceLimit/, /function checkEntitlement/, /eliza-entitlement\+jwt/])
    assert.doesNotMatch(binding, duplicate);
  assert.ok(fs.readFileSync('scripts/prepare-client-features.mjs', 'utf8').includes("'packages/cloud/sdk/src/subscription-entitlement.ts',"));
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

test('the approved Membership & credits sheet adds the plan allowance and the latest Cloud limit read-only', async () => {
  const {subscriptionSummary: sharedSummary, serviceLimitNextChange, alphaSubscriptionCopy} = await import('../apps/app/src/runtime/subscription-entitlement.ts');
  // The sheet renders through the projected shared hook (elizaOS/eliza#38105), evaluated as shipped.
  const hookSource = fs.readFileSync('.eliza/client-features/packages/ui/src/components/settings/cloud-subscription-summary.tsx', 'utf8');
  const hookCompiled = transformSync(hookSource.replace(/^import [\s\S]*?;\n/gm, '').replaceAll('export ', ''), {loader: 'tsx', jsxFactory: 'React.createElement'}).code;
  const useCloudSubscriptionSummary = new Function('React', 'useEffect', 'useState', 'subscriptionSummary', 'serviceLimitNextChange', hookCompiled + ';return useCloudSubscriptionSummary;')(React, React.useEffect, React.useState, sharedSummary, serviceLimitNextChange);
  const source = fs.readFileSync('apps/app/src/runtime/cloud-membership-ui.tsx', 'utf8');
  const compiled = transformSync(source.replace(/^import .*;\n/gm, '').replaceAll('export ', ''), {loader: 'tsx', jsxFactory: 'React.createElement'}).code;
  const Controls = new Function('React', 'useEffect', 'useId', 'useRef', 'useState', 'useCloudSubscriptionSummary', 'alphaSubscriptionCopy', compiled + ';return CloudMembershipControls;')(React, React.useEffect, React.useId, React.useRef, React.useState, useCloudSubscriptionSummary, alphaSubscriptionCopy);
  const render = props => renderToStaticMarkup(React.createElement(Controls, {balance: 'member', busy: false, email: 'owner@example.invalid', serviceName: 'Eliza Cloud', onRedeem: async () => true, onAddFunds() {}, onRefresh() {}, ...props}));
  const active = render({plan: {kind: 'active', planName: 'Synthetic plan', status: 'active', allowance: {unit: 'usd_micros', granted: 100, remaining: 25, periodStart: Date.now() - 1000, resetsAt: Date.now() + 86400000}, expiresAt: Date.now() + 1000, refreshFailed: false},
    endsAt: Date.now() + 10 * 86400000, lastLimit: {kind: 'rate-limited', retryAfterMs: 60000, resetsAt: null, observedAt: Date.now()}, credits: {usd: '9', observedAt: Date.now()}});
  assert.match(active, /Synthetic plan/);
  assert.match(active, /25% of this billing period&#x27;s plan allowance is left/);
  assert.match(active, /Ends .+ days left/);
  assert.match(active, /<dt>AI requests<\/dt><dd role="status">The AI request rate limit was reached\. Try again in about (59|60) seconds\./);
  // The approved sheet: exact credits with Refresh, Add credits, then the code entry behind one action.
  assert.match(active, /<dt>Available credits<\/dt>/);
  assert.match(active, /\$9\.00<span class="alpha-membership-currency">USD/);
  assert.match(active, />Add credits</);
  assert.match(active, />Enter membership code</);
  const credits = render({balance: 'funded', plan: {kind: 'credits', source: 'billing-limits'}, credits: {usd: '1234.5', observedAt: Date.now()}});
  assert.match(credits, /\$1,234\.50/);
  assert.match(credits, /No active membership/);
  assert.doesNotMatch(credits, /plan allowance|AI requests/, 'no allowance or limit line without a reported allowance or a current limit');
  const none = render({balance: 'zero', plan: {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'}});
  assert.match(none, /Add credits or enter a membership code to ask Alpha\./);
  // After Cloud declined a turn for billing the sheet says so, above the same two actions.
  const refused = render({balance: 'funded', refused: true, plan: {kind: 'credits', source: 'billing-limits'}, credits: {usd: '0.02', observedAt: Date.now()}});
  assert.match(refused, /Eliza Cloud declined your last AI request for billing\. Add credits or enter a membership code, then send again\./);
  assert.match(refused, />Add credits</);
  assert.match(refused, />Enter membership code</);
  // A lapsed limit is not shown.
  const lapsed = render({plan: {kind: 'credits', source: 'billing-limits'}, lastLimit: {kind: 'rate-limited', retryAfterMs: 1000, resetsAt: null, observedAt: Date.now() - 120000}});
  assert.doesNotMatch(lapsed, /AI requests/);
  // The section renders again only when a shown wait ends or a reset passes (bounded), never every second.
  // The timing is the shared serviceLimitNextChange (covered upstream); these are the sheet's cases.
  const change = (limit, now) => serviceLimitNextChange(limit, limit.observedAt, now);
  const at = 1_000_000_000_000;
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 60000, resetsAt: null, observedAt: at - 20000}, at), 40000);
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 60000, resetsAt: at + 5000, observedAt: at}, at), 5000);
  assert.equal(change({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: at + 30 * 86400000, observedAt: at}, at), 3600000, 'a far reset never overflows a timer');
  assert.equal(change({kind: 'billing-refused', retryAfterMs: null, resetsAt: null, observedAt: at - 59900}, at), 1000);
  assert.equal(change({kind: 'rate-limited', retryAfterMs: 1000, resetsAt: at - 1, observedAt: at - 5000}, at), null, 'nothing is scheduled for a lapsed limit');
  // The re-render timer is the shared hook's; Alpha keeps no copy of it.
  assert.match(source, /const summary=useCloudSubscriptionSummary\(plan,\{planEndsAt:endsAt\?\?null,lastLimit:lastLimit\?\?null,copy:alphaSubscriptionCopy\(serviceName\)\}\);/);
  assert.doesNotMatch(source, /serviceLimitNextChange|setTimeout/);
  assert.match(hookSource, /const nextChange =\s+summary\.limit && lastLimit\s+\? serviceLimitNextChange\(lastLimit, lastLimit\.observedAt, now\)\s+: null;\s+useEffect\(\(\) => \{\s+if \(nextChange === null\) return;\s+const timer = setTimeout\(\(\) => tick\(\(value\) => value \+ 1\), nextChange\);/);
  const ui = fs.readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
  assert.match(ui, /lastLimit=\{snapshot\.fundingRefused&&snapshot\.lastServiceLimit\?\.kind==='billing-refused'\?null:snapshot\.lastServiceLimit\} refused=\{!!snapshot\.fundingRefused\} serviceName=\{serviceName\}/, 'the sheet receives the latest Cloud limit; a billing refusal is said once, by the sheet');
  assert.match(ui, /className="serif">Membership &amp; credits<\/h1>/);
});

test('a resident turn failure forwards its own reset fields and records the latest Cloud limit for the account panel', () => {
  const ui = fs.readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
  assert.match(ui, /readServiceLimit\(\{ failureKind: 'failureKind' in reply \? reply\.failureKind : undefined, terminalFailure: 'terminalFailure' in reply \? reply\.terminalFailure : undefined, resetAt: timing\.resetAt, retryAfterSeconds: timing\.retryAfterSeconds \}\)/);
  const failure = ui.slice(ui.indexOf('function replyFailure('), ui.indexOf("if(kind==='rate_limited')return new AlphaClientError"));
  assert.match(failure, /if\(limit\)update\(\{lastServiceLimit:\{\.\.\.limit,observedAt:Date\.now\(\)\},\.\.\.\(funding\?\{fundingRefused:true,membershipDismissed:false\}:\{\}\)\}\);/);
  // A billing refusal of a signed-in account answers once and offers the Membership & credits sheet.
  assert.match(failure, /const funding=limit\?\.kind==='billing-refused'&&!!state\.cloudAccount;/);
  assert.match(failure, /fundingRefusedReply\(cloudServiceName\(cloud\.environment\)\)\),\{failureKind:kind\?\?limit\.kind,serviceLimit:limit\.kind,planAction:'funding'\}/);
  assert.match(ui.slice(ui.indexOf('function detachService()'), ui.indexOf('async function verifyService')), /lastServiceLimit:null/);
  assert.match(ui, /lastLimit=\{snapshot\.fundingRefused&&snapshot\.lastServiceLimit\?\.kind==='billing-refused'\?null:snapshot\.lastServiceLimit\}/);
  // A limit seen on one account never appears for another, and it ends once AI gets through again.
  assert.match(ui.slice(ui.indexOf('async function verifyService'), ui.indexOf('let pendingBillingReview')), /\.\.\.\(!same\?\{[^}]*lastServiceLimit:null/);
  assert.match(ui.slice(ui.indexOf('  async residentRedeem('), ui.indexOf("update({redeemNotice:redeemSuccessMessage(result)});")), /redeemed=true;[\s\S]*lastServiceLimit:null/);
  assert.match(ui.slice(ui.indexOf('  async send('), ui.indexOf('export function ConnectionChooser')), /if\(!failed&&\(state\.lastServiceLimit\|\|state\.fundingRefused\)\)update\(\{lastServiceLimit:null,fundingRefused:false\}\);/);
  // A request-level 429 that reads as a Cloud limit is recorded too; a refusal before the turn is the agent being busy.
  assert.match(ui.slice(ui.indexOf('  async send('), ui.indexOf('export function ConnectionChooser')), /const limit = refused \? null : readServiceLimit\(error\);\s+if \(limit\) update\(\{ lastServiceLimit: \{ \.\.\.limit, observedAt: Date\.now\(\) \} \}\);/);
});

test('only admission and its background refresher read the entitlement; turns and local speech never do', () => {
  const ui = fs.readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
  const admission = ui.slice(ui.indexOf('async function admitCloudResident'), ui.indexOf('async function connectResident'));
  const explicitRefresh=ui.slice(ui.indexOf('async function refreshMembershipBalance'),ui.indexOf('function clearPersonalSetup'));
  assert.ok(admission.includes('checkEntitlement('));
  assert.equal(ui.split('checkEntitlement(').length, admission.split('checkEntitlement(').length + explicitRefresh.split('checkEntitlement(').length - 1, 'checkEntitlement is called only during admission or explicit/background refresh');
  // Every Cloud detach stops background refresh; the send path never reads billing.
  const detach = ui.slice(ui.indexOf('function detachService()'), ui.indexOf('async function verifyService'));
  assert.match(detach, /^function detachService\(\) \{ stopEntitlementRefresh\(\);/);
  assert.match(ui.slice(ui.indexOf('function stopEntitlementRefresh'), ui.indexOf('function detachService()')), /entitlementRefresher\?\.stop\(\);entitlementRefresher=null;/);
  const send = ui.slice(ui.indexOf('  async send('), ui.indexOf('export function ConnectionChooser'));
  assert.ok(send.length > 1000, 'send path located');
  assert.doesNotMatch(send, /creditBalance|legacyAccountUsable|billingFallbackPlan|redeemSubscriptionCode|entitlementSource|subscriptionEntitlement|ENTITLEMENT_PATH|credits\/balance|subscription\/entitlement/);
  const importers = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(path); else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && /subscription-entitlement/.test(fs.readFileSync(path, 'utf8'))) importers.push(path); } };
  walk('apps/app/src');
  // The upstream plugin-maps device provider reads Cloud Maps limits with this shared reader.
  assert.deepEqual(importers.sort(), ['apps/app/src/maps/cloud-maps.ts', 'apps/app/src/prototype/settings-adapter.ts', 'apps/app/src/runtime/cloud-membership-ui.tsx', 'apps/app/src/runtime/cloud-protocol.ts', 'apps/app/src/runtime/cloud-voice.ts', 'apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/runtime/diagnostics-export.ts', 'apps/app/src/runtime/subscription-entitlement.ts']);
  for (const [file, typeOnly, names] of [
    ['apps/app/src/maps/cloud-maps.ts', false, ['readServiceLimit']],
    // A Cloud speech 429 reads as the shared limit with its retry time (cloud-voice-limit.ts).
    ['apps/app/src/runtime/cloud-voice.ts', false, ['readServiceLimit', 'retryDuration', 'type ServiceLimit']],
    ['apps/app/src/prototype/settings-adapter.ts', false, ['planAdmission']],
    ['apps/app/src/runtime/diagnostics-export.ts', true, ['PlanAdmission', 'PlanStatus', 'SubscriptionView']],
    ['apps/app/src/runtime/cloud-membership-ui.tsx', false, ['alphaSubscriptionCopy', 'type ServiceLimit', 'type SubscriptionView']],
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    const imports = [...text.matchAll(/import(\s+type)?\s*\{([^}]+)\}\s*from\s*['"][^'"]*subscription-entitlement(?:\.ts)?['"]/g)];
    assert.deepEqual(imports.map(match => ({typeOnly: !!match[1], names: match[2].split(',').map(name => name.trim())})), [{typeOnly, names}], `${file} imports only pure presentation or types, never an entitlement fetch`);
  }
  // The production account panel no longer offers a credit balance or top-up.
  for (const file of ['apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/prototype/settings-adapter.ts', 'apps/app/src/runtime/cloud-voice.ts', 'apps/app/src/runtime/voice-selection.ts']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /Add credits|Credits available|Check credits|residentTopUp|openTopUp|uses credits|uses its credits|needs credits/, file);
  }
});


test('Settings retains unknown, expired, inactive and credit-funded admission states', () => {
  const ui = fs.readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
  const start = ui.indexOf('  residentPlanSettings(){');
  const end = ui.indexOf('\n  },', start);
  assert.ok(start >= 0 && end > start, 'actual Settings summary method located');
  const summarize = new Function('state', 'residentCloudFlow', 'describeSubscription', 'subscriptionSummary', 'readPlanAdmission', 'CLOUD_KEY_EXPIRY_WARNING_MS', 'cloudServiceName', 'cloud',
    `return ({${ui.slice(start, end + 5)}}).residentPlanSettings();`);
  const account = {email:'qa@example.invalid', userId:USER};
  const snapshot = {cloudAccount:account, residentPlanNotice:'needs-plan', residentInference:'unavailable'};
  const read = overrides => summarize({...snapshot, ...overrides}, () => true, describeSubscription, subscriptionSummary, () => null, 86400000, () => 'Nebula', {environment:'production'});
  for (const reason of ['outage', 'not-published', 'invalid']) {
    const result = read({residentSubscription:{kind:'unavailable', reason}});
    assert.equal(result.plan, 'Plan status unavailable', reason);
    assert.equal(result.status, null, reason);
    assert.equal(result.inference, 'Unavailable · Cloud status unconfirmed', reason);
  }
  const expired = read({residentSubscription:{kind:'expired', planName:'Previously verified plan'}});
  assert.equal(expired.plan, 'Previously verified plan');
  assert.equal(expired.status, null);
  assert.doesNotMatch(expired.inference, /needs a plan/);
  for (const [status, planName, headline] of [['none', null, 'No active plan'], ['canceled', 'Synthetic plan', 'Synthetic plan has ended']]) {
    const result = read({residentSubscription:{kind:'inactive', status, planName, source:'billing-limits'}});
    assert.equal(result.plan, headline);
    assert.equal(result.status, status);
    assert.equal(result.inference, 'Unavailable · check Cloud account');
  }
  const credits = read({residentSubscription:{kind:'credits', source:'billing-limits'}, residentPlanNotice:null, residentInference:'cloud'});
  assert.equal(credits.plan, 'Nebula credits');
  assert.equal(credits.inference, 'Nebula');
  const active = read({residentSubscription:{kind:'active', planName:'Synthetic plan', status:'active', allowance:null, expiresAt:NOW, refreshFailed:false}, residentPlanNotice:null, residentInference:'cloud'});
  assert.equal(active.plan, 'Synthetic plan');
  assert.equal(active.status, 'active');
  assert.equal(read({residentSubscription:null, residentPlanNotice:null}).plan, 'Checking plan…');
  assert.equal(read({cloudAccount:null, residentSubscription:null, residentPlanNotice:null}).plan, 'Not signed in');
  const offline = read({cloudAccount:null, residentSubscription:{kind:'unavailable', reason:'outage'}, residentPlanNotice:'offline'});
  assert.equal(offline.plan, 'Offline');
  assert.equal(offline.inference, 'Unavailable · Cloud unreachable');
  assert.equal(summarize(snapshot, () => false, describeSubscription, subscriptionSummary, () => null, 86400000), null);
  // The Settings plan page shows the allowance Cloud reports and the latest limit with its remaining wait, never a balance.
  const allowance = {unit:'usd_micros', granted:100, remaining:40, periodStart:Date.now() - 1000, resetsAt:Date.now() + 86400000};
  const limited = read({residentSubscription:{kind:'active', planName:'Synthetic plan', status:'active', allowance, expiresAt:Date.now() + 60000, refreshFailed:false}, residentPlanNotice:null, residentInference:'cloud',
    lastServiceLimit:{kind:'rate-limited', retryAfterMs:120000, resetsAt:null, observedAt:Date.now() - 40000}});
  assert.match(limited.allowance, /^40% of this billing period's plan allowance is left\./);
  assert.match(limited.limit, /^The AI request rate limit was reached\. Try again in about (79|80) seconds\. Alpha Phone did not retry your message\.$/);
  const lapsed = read({residentSubscription:{kind:'active', planName:'Synthetic plan', status:'active', allowance:null, expiresAt:Date.now() + 60000, refreshFailed:false}, residentPlanNotice:null, residentInference:'cloud',
    lastServiceLimit:{kind:'rate-limited', retryAfterMs:1000, resetsAt:null, observedAt:Date.now() - 5000}});
  assert.equal(lapsed.allowance, null, 'no allowance row without a reported allowance');
  assert.equal(lapsed.limit, null, 'a wait that has passed is not shown');
  const credit = read({residentSubscription:{kind:'credits', source:'billing-limits'}, residentPlanNotice:null, residentInference:'cloud'});
  assert.equal(credit.allowance, null);
  assert.equal(read({cloudAccount:null, residentSubscription:null, residentPlanNotice:null, lastServiceLimit:{kind:'rate-limited', retryAfterMs:60000, resetsAt:null, observedAt:Date.now()}}).limit, null, 'no limit is shown without an account');
  const settings = fs.readFileSync('apps/app/src/prototype/settings-adapter.ts', 'utf8');
  assert.match(settings, /if\(plan\.allowance\)rows\.push\(info\('Plan allowance',plan\.allowance\)\);/);
  assert.match(settings, /if\(plan\.limit\)rows\.push\(info\('AI requests',plan\.limit\)\);/);
});


