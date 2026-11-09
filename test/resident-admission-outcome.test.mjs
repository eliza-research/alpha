// tst-alphaphone-1-039: what the phone does with each resident admission outcome (binding, plan
// view, detach, offline grace, sign-in), run on the shipped mapping rather than its source text.
// Evidence class: unit test of the pure mapping; the shared controller's own rules have their tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {residentAdmissionOutcome} from '../apps/app/src/runtime/subscription-entitlement.ts';
import {CloudResidentBindingError} from '../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';

const identity = {credentialId: 'credential-1', userId: 'user-1', organizationId: null};
const active = {kind: 'active', status: 'active', planName: 'Pilot', source: 'entitlement'};
const inactive = {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'};
const outage = {kind: 'unavailable', reason: 'outage'};
const cleared = {residentPlanNotice: null, residentSubscription: null, planEndsAt: null};
const refused = Object.assign(new Error('Cloud http (401)'), {code: 'http', status: 401});
const fence = new CloudResidentBindingError('account-changed');
const recent = {endsAt: 1_900_000_000_000};

test('each admission outcome maps to one binding, plan view and sign-in step', () => {
  const rows = [
    ['signed out with a connection', {binding: 'unbound', reason: 'signed-out'}, {attached: true},
      {binding: 'unbound', view: {residentSavedCredential: false, ...cleared}, signIn: 'required', detach: true}],
    ['signed out, nothing attached', {binding: 'unbound', reason: 'signed-out'}, {},
      {binding: 'unbound', view: {residentSavedCredential: false, ...cleared}, signIn: 'required', detach: false}],
    ['offline with a plan verified this week keeps the binding', {binding: 'kept', reason: 'offline', recent}, {attached: true},
      {binding: 'kept', view: {residentPlanNotice: 'offline', residentSubscription: outage, planEndsAt: recent.endsAt}}],
    ['offline without a recent plan', {binding: 'unbound', reason: 'offline', recent: null}, {},
      {binding: 'unbound', view: {residentPlanNotice: 'offline', residentSubscription: outage, planEndsAt: null}}],
    ['identity refused before it was read', {binding: 'unbound', reason: 'sign-in-rejected', error: refused}, {attached: true},
      {binding: 'unbound', view: cleared, signIn: 'rejected', detach: true, forgetPlan: true}],
    ['plan read refused for the verified account', {binding: 'unbound', reason: 'sign-in-rejected', identity, error: refused}, {attached: true, verified: true},
      {binding: 'unbound', view: cleared, signIn: 'rejected', detach: true, forgetPlan: true}],
    ['plan read refused after a newer sign-in took the connection', {binding: 'unbound', reason: 'sign-in-rejected', identity, error: refused}, {attached: true, verified: false},
      {binding: 'unbound', view: cleared, signIn: 'rejected', detach: false, forgetPlan: true}],
    ['the shared fence: a newer credential replaced this one', {binding: 'unbound', reason: 'account-changed', identity, error: fence}, {attached: true, verified: true},
      {binding: 'unbound', view: cleared, signIn: 'account-changed', detach: false, forgetPlan: false}],
    ['account changed before the identity was read', {binding: 'unbound', reason: 'account-changed', error: fence}, {attached: true},
      {binding: 'unbound', view: cleared, signIn: 'account-changed', detach: false, forgetPlan: false}],
    ['plan unreadable', {binding: 'unbound', reason: 'plan-unavailable', identity, error: new Error('malformed')}, {attached: true, verified: true},
      {binding: 'unbound', view: {residentPlanNotice: 'needs-plan', residentSubscription: outage, planEndsAt: null}}],
    ['no plan opens nothing', {binding: 'unbound', reason: 'needs-plan', identity, plan: {view: inactive}}, {attached: true, verified: true},
      {binding: 'unbound', view: {residentSubscription: inactive, residentPlanNotice: 'needs-plan', planEndsAt: null}}],
    ['admitted plan', {binding: 'cloud', reason: 'admitted', identity, plan: {view: active}, endsAt: recent.endsAt}, {attached: true, verified: true},
      {binding: 'cloud', view: {residentSubscription: active, residentPlanNotice: null, planEndsAt: recent.endsAt}}],
  ];
  for (const [name, admission, connection, expected] of rows)
    assert.deepEqual(residentAdmissionOutcome(admission, {attached: false, verified: false, ...connection}), expected, name);
});

test('no outcome stops the agent: every reason leaves a binding and only sign-in reasons ask to sign in', () => {
  for (const reason of ['signed-out', 'offline', 'sign-in-rejected', 'account-changed', 'plan-unavailable', 'needs-plan', 'admitted']) {
    const outcome = residentAdmissionOutcome({binding: 'unbound', reason, identity, plan: {view: inactive}}, {attached: true, verified: true});
    assert.ok(['cloud', 'unbound', 'kept'].includes(outcome.binding), reason);
    assert.equal(!!outcome.signIn, ['signed-out', 'sign-in-rejected', 'account-changed'].includes(reason), reason);
  }
});
