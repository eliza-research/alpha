// SignInChooser traces replayed against the shipped sign-in controller: beginSignIn, signInGoogle,
// signInEmail, resendSignInCode, verifySignInCode and Back (cancelSignIn, cancel, close) over the
// real step slot, sliced from connection-ui.tsx. The sign-in host, the key store and Cloud are
// held ports; the sign-in screen's React components are not rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelTraces, replayTraces, repositoryRoot, settle} from '../specs/quint/refinement/services/identity-comms-traces.mjs';
import {signInController} from './fixtures/connection-sign-in-slice.mjs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const MODEL = {path: 'specs/quint/application/SignInChooser.qnt', module: 'SignInChooser'};
const model = readFileSync(`${repositoryRoot}${MODEL.path}`, 'utf8');
const SCENARIOS = [...model.matchAll(/^\s*run (\w+Test)\s*=/gm)].map(match => match[1]);
const WITNESSES = [...model.matchAll(/^\s*val (\w+Witness)\s*=/gm)].map(match => match[1]);

// The code form's submit handler: it is the form, not the controller, that withholds a code that
// can no longer be verified.
const form = readFileSync(`${repositoryRoot}apps/app/src/runtime/cloud-sign-in-ui.tsx`, 'utf8');
const guard = /\n( {2}const stale = view\.step === 'code' && view\.stale === true;\n {2}const submitCode = \(event: FormEvent\) => \{[^\n]*\};)\n/.exec(form);
assert.ok(guard, 'the code form decides whether a code is submitted');
const submitCode = new Function('view', 'busy', 'ready', 'actions', 'code', `${stripTypeScriptTypes(guard[1])}\nsubmitCode({preventDefault() {}});`);

// The key read beside the Google hand-off exists only on a host without a commit boundary, and is
// compared while that attempt waits.
const project = s => ({step: s.step, error: s.error, operation: s.operation, attempt: s.attempt, attempts: s.attempts, stale: s.stale, prefill: s.prefill,
  commitBoundary: s.commitBoundary, storedKey: s.storedKey, adoptedKey: s.adoptedKey, priorKey: s.operation === 'google' && !s.commitBoundary ? s.priorKey : 0,
  hostCommitted: s.hostCommitted, adoptedByBack: s.adoptedByBack});

function create() {
  const {box, port, controller} = signInController({platform: 'browser'});
  let adoptedByBack = false, adoptedKey = 0;
  const failure = tag => Object.assign(Error(tag), {tag}), refusal = (code, tag) => Object.assign(new port.CloudSignInError(code), {tag});
  const started = () => ({attemptId: port.nextAttempt(), resendAt: 0, expiresAt: Date.now() + 600000});
  const ends = async action => { action(); port.resending = false; await settle(); adoptedKey = Math.max(adoptedKey, port.adoptedKey); };
  async function back() {
    await controller.cancelSignIn(); await settle();
    // Back over a key the host had already stored signs in with it.
    if (box.state.signIn === null && box.state.message === 'Signed in' && box.state.residentSavedCredential) { adoptedByBack = true; adoptedKey = port.storedKey; port.committed = false; box.state.message = ''; }
  }
  return {
    hostBoundary(boundary) { port.client.googleCancellationSupported = boundary; },
    // The owner opens the account sign-in; readiness answers and the method choice is shown.
    async openChooser() { box.update({purpose: 'cloud-account'}); void controller.beginSignIn(); await settle(); port.release({google: true, phone: false, email: true}); await settle(); },
    async tapGoogle() { port.committed = false; void controller.signInGoogle(); await settle(); },
    hostCommitsKey() { port.storedKey++; port.committed = true; },
    googleEnds: outcome => ends(() => {
      if (outcome === 'signed-in') { port.committed = false; port.release({status: 'signed-in'}); }
      else if (outcome === 'mfa') port.release({status: 'mfa', environment: 'production', attemptId: port.nextAttempt(), method: 'totp', expiresAt: Date.now() + 600000});
      else port.fail(failure('failed'));
    }),
    backDuringGoogle: back,
    async submitAddress() { port.resending = false; void controller.signInEmail('owner@example.test'); await settle(); },
    sendEnds: accepted => ends(() => accepted ? port.release(started()) : port.fail(failure('send-failed'))),
    async resend() { port.resending = true; void controller.resendSignInCode(); await settle(); },
    resendEnds: accepted => ends(() => accepted ? port.release(started()) : port.fail(failure('resend-failed'))),
    async verify() { submitCode(box.state.signIn, box.state.busy, true, {verify: code => void controller.verifySignInCode(code)}, {current: {value: '123456'}}); await settle(); },
    verifyEnds: outcome => ends(() => {
      const onCode = box.state.signIn.step === 'code';
      if (outcome === 'signed-in') { port.storedKey++; port.release({status: 'signed-in'}); }
      else if (outcome === 'mfa') port.release({status: 'mfa', method: 'totp', expiresAt: Date.now() + 600000});
      else if (outcome === 'wrong') port.fail(refusal('invalid-code', 'wrong-code'));
      // Only the emailed code can be sent again; on the second verification an exhausted code is a plain failure.
      else if (outcome === 'spent') port.fail(refusal('attempts-exhausted', onCode ? 'spent' : 'failed'));
      else port.fail(failure('failed'));
    }),
    back,
    observe() {
      const view = box.state.signIn, prior = box.googleSignInPrior;
      assert.equal(!!box.operation, port.held !== 'none', 'the slot is held exactly while a step is in flight');
      return {step: view?.step ?? 'closed', error: box.state.error || 'none', operation: port.held, attempt: view?.attemptId ?? 0, attempts: port.attempts,
        stale: view?.stale === true, prefill: view?.step === 'choose' && !!view.email, commitBoundary: port.client.googleCancellationSupported,
        storedKey: port.storedKey, adoptedKey,
        priorKey: port.held === 'google' && !port.client.googleCancellationSupported ? Number(prior?.credentialId?.replace('key-', '') ?? 0) : 0,
        hostCommitted: port.committed, adoptedByBack};
    },
  };
}

test('the sign-in screen follows SignInChooser scenarios, witnesses and random walks', {timeout: 240000}, async () => {
  assert.ok(SCENARIOS.length >= 9 && WITNESSES.length >= 5);
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model in which Back over a stored key showed the method choice is refused.
  const hidden = state => state.adoptedByBack ? {...project(state), step: 'choose'} : project(state);
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'backAfterCommitAdoptsKeyTest'), create, {project: hidden}), /backAfterCommitAdoptsKeyTest step/);
  for (const action of ['hostBoundary', 'openChooser', 'tapGoogle', 'hostCommitsKey', 'googleEnds', 'backDuringGoogle', 'submitAddress', 'sendEnds', 'resend', 'resendEnds', 'verify', 'verifyEnds', 'back'])
    assert.ok(receipt.actions[action] > 0, action);
});
