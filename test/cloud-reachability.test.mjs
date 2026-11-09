// tst-alphaphone-1-036: a failed Cloud identity read detaches the sign-in and requires a new one
// only when Cloud refused the credential. Every other answer is offline, so the shared 7-day
// offline rule applies. Runs the shipped classifiers and the shared resident binding controller.
// Evidence class: unit test with synthetic errors; no Cloud, transport or device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudUnreachable, CloudIdentityUnreachable, identityReadRefused} from '../apps/app/src/runtime/subscription-entitlement.ts';
import {CloudResidentBindingController, CloudResidentBindingError} from '../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';

// The shapes Alpha's transports produce, without loading the Capacitor-bound modules.
class CloudProtocolError extends Error {
  constructor(code, status) { super(`Cloud ${code}${status ? ` (${status})` : ''}`); this.name = 'CloudProtocolError'; this.code = code; this.status = status; }
}
/** A Capacitor plugin rejection: a message and an optional code (AlphaConnectionPlugin sends a debug code or none). */
const nativeRejection = (message, code) => Object.assign(new Error(message), code === undefined ? {} : {code});
const http = status => new CloudProtocolError('http', status);

const refusals = [
  ['HTTP 401', http(401)],
  ['expired credential', new CloudProtocolError('expired')],
  ['no stored credential', new CloudProtocolError('credentials-missing')],
  ['account changed during the read', new CloudProtocolError('account-changed')],
  ['shared account-changed fence', new CloudResidentBindingError('account-changed')],
];
const offline = [
  ...[301, 302, 400, 403, 404, 408, 410, 429, 500, 502, 503].map(status => [`HTTP ${status}`, http(status)]),
  ['response Alpha did not understand', new CloudProtocolError('invalid-response')],
  ['native transport failure', nativeRejection('Connection request failed', 'ALPHA_TRANSPORT:IDENTITY:CONNECT:0:java.net.UnknownHostException')],
  ['native transport failure in a release build', nativeRejection('Connection request failed')],
  ['plugin destroyed', nativeRejection('Connection closed')],
  ['duplicate request id', nativeRejection('Request already active')],
  ['request cancelled natively', nativeRejection('Request cancelled')],
  ['secure storage read', nativeRejection('Secure storage read failed')],
  ['plain TypeError from fetch', new TypeError('Failed to fetch')],
];

test('only a 401 or an explicit credential code refuses the identity read', () => {
  for (const [name, error] of refusals) assert.equal(identityReadRefused(error), true, name);
  for (const [name, error] of offline) assert.equal(identityReadRefused(error), false, name);
  for (const value of [undefined, null, 'Unauthorized', 401]) assert.equal(identityReadRefused(value), false, String(value));
});

test('plan reads keep their narrower outage rule; a wrapped identity read is always unreachable', () => {
  const rows = [
    [http(408), true], [http(429), true], [http(500), true], [http(503), true],
    [http(401), false], [http(403), false], [http(404), false], [new CloudProtocolError('invalid-response'), false],
    [nativeRejection('Connection request failed'), true], [nativeRejection('Connection timed out'), true], [nativeRejection('Request cancelled'), true],
    [nativeRejection('Connection closed'), false], [new DOMException('Cancelled', 'AbortError'), false], ['Connection request failed', false],
    [new CloudIdentityUnreachable(nativeRejection('Connection closed')), true],
  ];
  for (const [error, unreachable] of rows) assert.equal(cloudUnreachable(error), unreachable, String(error?.message ?? error));
});

// Alpha's identity port (connection-ui residentBindingController.verifyIdentity) with the same ports
// the phone passes; only the Cloud read is synthetic.
function admission(identityError, {recent = false} = {}) {
  const row = {credentialId: 'credential-1', userId: 'user-1', organizationId: null};
  return new CloudResidentBindingController('production', {
    readCredential: async () => ({credentialId: 'credential-1'}),
    verifyIdentity: async signal => {
      try { throw identityError; } catch (error) { signal.throwIfAborted(); throw identityReadRefused(error) ? error : new CloudIdentityUnreachable(error); }
    },
    checkPlan: async () => { throw Error('unreachable: identity fails first'); },
    bindProvider: async () => {}, clearProvider: async () => {},
    readAdmission: () => recent ? {version: 1, environment: 'production', ...row, status: 'active', planName: 'Pilot', verifiedAt: Date.now() - 1000, endsAt: null} : null,
    writeAdmission() {},
    isUnreachable: cloudUnreachable,
    isSignInRejected: () => false,
  }).admit(new AbortController().signal);
}

test('an identity read that Cloud did not refuse keeps a recent plan under the offline rule', async () => {
  for (const [name, error] of offline) {
    const result = await admission(error, {recent: true});
    assert.deepEqual([result.reason, result.binding], ['offline', 'kept'], name);
    assert.equal((await admission(error)).binding, 'unbound', `${name} without a recent plan`);
  }
  for (const [name, error] of refusals) {
    const result = await admission(error, {recent: true});
    assert.equal(result.binding, 'unbound', name);
    assert.equal(result.reason, error instanceof CloudResidentBindingError ? 'account-changed' : 'sign-in-rejected', name);
  }
});
