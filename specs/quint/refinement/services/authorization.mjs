import {serviceInputs} from './source-inputs.mjs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {checkEntitlement, clearEntitlementKeyCache, EntitlementRefresher, ENTITLEMENT_AUDIENCE, ENTITLEMENT_TYPE, planAdmission} from '../../../../apps/app/src/runtime/subscription-entitlement.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred, until} from './support.mjs';

const base = 1800000000000;
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const plan = view => view.kind === 'active' ? (view.status === 'past_due' ? 'past-due' : 'active')
  : view.kind === 'inactive' ? (view.status === 'none' ? 'no-plan' : 'inactive')
  : view.kind === 'unavailable' ? (view.reason === 'invalid' ? 'invalid' : 'unavailable') : view.kind;
const admitted = view => ['admit', 'admit-with-warning'].includes(planAdmission(view));

export async function authorizationRefinement(extraSources = []) {
  const sources = ['apps/app/src/runtime/subscription-entitlement.ts', 'specs/quint/refinement/services/authorization.mjs', 'specs/quint/refinement/services/support.mjs'];
  const inputs = serviceInputs([...sources, ...extraSources]);
  const driverHashes = captureInputs(inputs);
  const pair = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const key = {...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid: 'refinement-key'};
  const sign = async status => {
    const claims = {iss: 'https://fixture.invalid', aud: ENTITLEMENT_AUDIENCE, sub: 'user', org: 'org', jti: 'one',
      iat: base / 1000, exp: base / 1000 + 100, plan: {id: 'fixture', name: 'Fixture', status}, services: ['inference'], allowance: null};
    const input = `${encoded({alg: 'ES256', typ: ENTITLEMENT_TYPE, kid: key.kid})}.${encoded(claims)}`;
    const signature = await webcrypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, pair.privateKey, Buffer.from(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`;
  };
  const traces = [];
  for (const mode of ['active', 'past_due', 'canceled', 'snapshot', 'credits', 'signed-none-credits', 'signed-none-active', 'outage']) {
    clearEntitlementKeyCache();
    let views = [], calls = [], now = base;
    const wait = deferred();
    const token = ['active', 'past_due', 'canceled'].includes(mode) ? await sign(mode)
      : mode.startsWith('signed-none') ? await sign('none') : null;
    const source = {
      issuer: 'https://fixture.invalid', audience: ENTITLEMENT_AUDIENCE,
      async entitlement() { calls.push('entitlement'); await wait.promise; if (mode === 'outage') throw Error('offline'); return token; },
      async entitlementKeys() { calls.push('keys'); return [key]; },
      async fallbackPlan() { calls.push('fallback'); return mode.includes('credits')
        ? {status: 'none', planName: null, periodEnd: null, billingMode: 'organization-credits'}
        : {status: 'active', planName: 'Fixture', periodEnd: null}; },
    };
    const timers = [];
    const refresher = new EntitlementRefresher({check: signal => checkEntitlement(source, {userId: 'user', organizationId: 'org'}, signal, () => now),
      onView: view => views.push(view), timers: {now: () => now, setTimeout: (run, delay) => { const timer = {run, delay}; timers.push(timer); return timer; }, clearTimeout: () => {}}});
    const trace = {name: `real entitlement source ${mode}`, expect: {'s.plan': views.length ? plan(views.at(-1)) : 'unknown'}, steps: []};
    refresher.refreshNow();
    trace.steps.push({label: 'refresh owns an actual pending source promise', action: action('beginRefresh'), expect: {'s.refresh': refresher.controller ? 'pending' : 'idle'}});
    wait.resolve(); await until(() => views.length === 1 && refresher.controller === null, 'entitlement result');
    let transitions;
    if (mode === 'outage') transitions = action('refreshOutage');
    else if (mode === 'snapshot' || mode === 'credits') transitions = [action('noSignedToken'), action('snapshotReply', plan(views[0]))];
    else if (mode.startsWith('signed-none')) transitions = [action('signedNoPlan'), action('snapshotReply', mode.endsWith('credits') ? 'credits' : 'active')];
    else transitions = action('refreshReply', plan(views[0]));
    trace.steps.push({label: 'actual signed or fallback result', action: transitions, expect: {'s.plan': plan(views[0]), inferenceAdmitted: admitted(views[0]), 's.refresh': refresher.controller ? 'pending' : 'idle'}});
    if (mode === 'snapshot' || mode === 'credits') {
      source.entitlement = async () => { throw Error('refresh offline'); };
      refresher.refreshNow(); await until(() => views.length === 2 && refresher.controller === null, 'fallback outage');
      trace.steps.push({label: 'fallback outage withdraws current admission', action: [action('beginRefresh'), action('refreshOutage')], expect: {'s.plan': plan(views.at(-1)), inferenceAdmitted: admitted(views.at(-1)), 's.failures': refresher.failures}});
    }
    if (mode === 'active') {
      source.entitlement = async () => { throw Error('refresh offline'); };
      refresher.refreshNow(); await until(() => views.length === 2 && refresher.controller === null, 'signed outage');
      trace.steps.push({label: 'unexpired signed admission survives refresh outage', action: [action('beginRefresh'), action('refreshOutage')], expect: {'s.plan': plan(views.at(-1)), inferenceAdmitted: admitted(views.at(-1)), 's.failures': refresher.failures}});
      now += 100000;
      timers.at(-1).run(); await until(() => views.some(view => view.kind === 'expired'), 'signed expiry');
      trace.steps.push({label: 'signed lifetime boundary expires the view', action: [action('tick'), action('tick')], expect: {'s.plan': plan(views.at(-1)), inferenceAdmitted: admitted(views.at(-1))}});
    }
    refresher.stop(); assert.equal(refresher.controller, null);
    traces.push(trace);
  }
  return checkTraces({model: 'ServiceAuthorization', sources: inputs, driverHashes, traces, scope: 'bounded-component', assumptions: ['Actual WebCrypto validates synthetic signed entitlements. Real source and timer ports determine views.', 'Two abstract ticks represent the observed signed-expiry boundary.', 'Managed-service routing and backend authorization need a separate adapter; these traces cover entitlement admission and refresh.']});
}
