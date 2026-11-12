import assert from 'node:assert/strict';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred, sourceModule, until} from './support.mjs';

export async function googleAccountsRefinement() {
  const sources = ['apps/app/src/runtime/google-workspace-return.ts', 'apps/app/src/runtime/google-accounts.ts', 'apps/app/src/runtime/gmail-mailbox.ts', 'specs/quint/refinement/services/google-accounts.mjs', 'specs/quint/refinement/services/support.mjs'];
  let driverHashes = captureInputs(sources);
  const capture = inputs => {
    sources.push(...inputs.filter(input => !sources.includes(input)));
    const next = captureInputs(sources);
    for (const [path, hash] of Object.entries(driverHashes)) assert.equal(next[path], hash, `Source changed before import: ${path}`);
    driverHashes = next;
  };
  const helpers = await sourceModule('apps/app/src/runtime/google-accounts.ts', {
    './gmail-background': 'export const retireGmailBackground=async()=>{};',
  }, capture);
  const returns = await sourceModule('apps/app/src/runtime/google-workspace-return.ts', {}, capture);
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const traces = [];
  try {
    for (const outcome of ['disconnected', 'still-connected', 'unconfirmed', 'lost-reply']) {
      const gate = deferred();
      let notifications = 0, disconnectCalls = 0, connecting = false, accepted = 0, consumed = false;
      const account = {connectionId: 'grant-A', connected: true, configured: true, label: 'fixture', reason: 'connected', grantedCapabilities: ['google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox', 'google.calendar.write']};
      const client = {
        async initiateGoogle() { connecting = true; await gate.promise; return 'https://accounts.example.invalid/authorize'; },
        async gmailAccounts() { if (disconnectCalls && outcome === 'unconfirmed') throw Error('offline readback'); return disconnectCalls && ['disconnected', 'lost-reply'].includes(outcome) ? [] : [account]; },
        async disconnectGmail() { disconnectCalls++; if (outcome === 'lost-reply') throw Error('response lost'); },
      };
      const binding = {client, sessionId: 'session-A', credentialId: 'credential-A'};
      const helper = helpers.createGoogleAccounts(binding, () => binding, () => { notifications++; });
      const trace = {name: `current Workspace return and ${outcome} readback`, expect: {'s.account': 0}, steps: []};
      const pending = helper.connect(new AbortController().signal);
      await until(() => connecting, 'authorization request');
      trace.steps.push({label: 'real current-owner helper requests the authorization URL', action: action('connect'), expect: {'s.returnMatched': accepted > 0}});
      gate.resolve(); assert.equal(await pending, 'https://accounts.example.invalid/authorize');
      const owner = {environment: 'production', userId: 'owner', organizationId: 'org', credentialId: 'credential-A', sessionId: 'session-A'};
      const watcher = returns.watchGoogleWorkspaceReturn({
        async subscribe() { return {remove() {}}; },
        async consume() { if (consumed) return {result: 'none'}; consumed = true; return {result: 'connected', connectionId: 'grant-A'}; },
      }, owner, () => owner, () => { accepted++; }, () => assert.fail('valid return refused'));
      await watcher.ready; watcher.close();
      trace.steps.push({label: 'current Workspace return requests account readback', action: action('appReturn', 1, true), expect: {'s.returnMatched': accepted === 1}});
      const rows = await helper.list(new AbortController().signal), selected = rows[0];
      trace.steps.push({label: 'only the actual account list supplies grants', action: action('readback', 1, true, true, true), expect: {'s.account': selected?.connectionId === 'grant-A' ? 1 : 0, 's.readGrant': selected.grantedCapabilities.includes('google.gmail.triage'), 's.calendarGrant': selected.grantedCapabilities.includes('google.calendar.write')}});
      const disconnecting = helper.disconnect('grant-A', new AbortController().signal);
      await until(() => disconnectCalls === 1, 'one remote revocation');
      trace.steps.push({label: 'remote privacy revocation runs once', action: action('disconnect'), expect: {'s.disconnectSent': disconnectCalls === 1}});
      const result = await disconnecting;
      const known = result.accounts !== null;
      const selectedStillConnected = (result.accounts ?? rows).some(row => row.connectionId === 'grant-A' && row.connected);
      trace.steps.push({
        label: 'provider readback preserves the outcome and observed rows',
        action: action('disconnectReadback', result.outcome, known),
        expect: {'s.disconnectOutcome': result.outcome, 's.disconnectRowsKnown': known,
          's.revoked': result.outcome === 'disconnected', 's.account': selectedStillConnected ? 1 : 0},
      });
      assert.equal(disconnectCalls, 1); assert.ok(notifications >= 1);
      traces.push(trace);
    }
    return await checkTraces({model: 'GoogleAccounts', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: ['Actual current-owner authorization and Workspace return consumers execute with controlled provider/native return ports.', 'Only current account-list readback grants capabilities. Native App Link parsing and delivery have separate Java traces.', 'Calendar cleanup, Inbox cache consumers and the installed provider remain separate integration obligations.']});
  } finally { globalThis.window = previousWindow; }
}
