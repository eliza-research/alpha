import assert from 'node:assert/strict';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred, sourceModule, until} from './support.mjs';

export async function googleAccountsRefinement() {
  const sources = ['apps/app/src/runtime/google-connect-flow.ts', 'apps/app/src/runtime/google-accounts.ts', 'apps/app/src/runtime/gmail-mailbox.ts', 'specs/quint/refinement/services/google-accounts.mjs', 'specs/quint/refinement/services/support.mjs'];
  const driverHashes = captureInputs(sources);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false;
  globalThis.window = window; globalThis.document = document;
  const traces = [];
  try {
    for (const outcome of ['disconnected', 'still-connected', 'unconfirmed', 'lost-reply']) {
      const gate = deferred();
      let callback, state, notifications = 0, disconnectCalls = 0;
      const account = {connectionId: 'grant-A', connected: true, configured: true, label: 'fixture', reason: 'connected', grantedCapabilities: ['google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox', 'google.calendar.write']};
      const client = {
        async initiateGoogle(_signal, _calendar, _gmail, redirect) { state = new URL(redirect).searchParams.get('state'); return 'https://accounts.example.invalid/authorize'; },
        async gmailAccounts() { if (disconnectCalls && outcome === 'unconfirmed') throw Error('offline readback'); return disconnectCalls && ['disconnected', 'lost-reply'].includes(outcome) ? [] : [account]; },
        async disconnectGmail() { disconnectCalls++; if (outcome === 'lost-reply') throw Error('response lost'); },
      };
      const binding = {client, sessionId: 'session-A', credentialId: 'credential-A'};
      globalThis.__quintGooglePorts = {binding, onReturn: fn => { callback = fn; return () => { callback = null; }; }, open: () => gate.promise};
      const stubs = {
        './connection-ui': 'export const connectionController={getCloudClient:()=>globalThis.__quintGooglePorts.binding,openCloudAccount:()=>{},rejectCloudSession:()=>{}};',
        './native-connection': 'export const googleConnectReturnUrl=async()=>"https://fixture.invalid/return"; export const onGoogleConnectReturn=fn=>globalThis.__quintGooglePorts.onReturn(fn); export const openConnectionBrowser=()=>globalThis.__quintGooglePorts.open();',
        './gmail-background': 'export const retireGmailBackground=()=>({settled:async()=>{}});',
      };
      const flow = await sourceModule('apps/app/src/runtime/google-connect-flow.ts', stubs);
      const helpers = await sourceModule('apps/app/src/runtime/google-accounts.ts', {'./gmail-background': stubs['./gmail-background']});
      const changed = () => { notifications++; }; window.addEventListener(helpers.GOOGLE_ACCOUNTS_CHANGED, changed);
      const trace = {name: `connect and ${outcome} readback`, expect: {'s.phase': flow.googleConnect.getSnapshot(), 's.account': 0}, steps: []};
      const connecting = flow.googleConnect.start(); await until(() => state && callback, 'Google return handler');
      trace.steps.push({label: 'real connect flow awaits browser return', action: action('connect'), expect: {'s.phase': flow.googleConnect.getSnapshot()}});
      callback({state: 'foreign', result: 'connected'});
      trace.steps.push({label: 'foreign callback leaves actual flow waiting', action: action('appReturn', 0, true), expect: {'s.phase': flow.googleConnect.getSnapshot()}});
      callback({state, result: 'connected'}); gate.resolve(); await connecting;
      const helper = helpers.createGoogleAccounts(binding, () => globalThis.__quintGooglePorts.binding, changed);
      const rows = await helper.list(new AbortController().signal);
      const selected = rows[0];
      trace.steps.push({label: 'matching return prompts real account readback', action: [action('appReturn', 1, true), action('readback', 1, true, true, true)], expect: {'s.phase': flow.googleConnect.getSnapshot(), 's.account': selected?.connectionId === 'grant-A' ? 1 : 0, 's.readGrant': selected.grantedCapabilities.includes('google.gmail.triage'), 's.calendarGrant': selected.grantedCapabilities.includes('google.calendar.write')}});
      const disconnecting = helper.disconnect('grant-A', new AbortController().signal);
      await until(() => disconnectCalls === 1, 'one remote revocation');
      trace.steps.push({label: 'remote revocation is issued once', action: action('disconnect'), expect: {'s.disconnectSent': disconnectCalls === 1}});
      const result = await disconnecting;
      trace.steps.push({label: 'real readback distinguishes confirmed and unknown outcomes', action: action('disconnectReadback', result.outcome === 'disconnected'), expect: {'s.revoked': result.outcome === 'disconnected', 's.account': result.outcome === 'disconnected' ? 0 : rows.length}});
      assert.equal(disconnectCalls, 1); assert.ok(notifications >= 1);
      window.removeEventListener(helpers.GOOGLE_ACCOUNTS_CHANGED, changed);
      traces.push(trace);
    }
    return await checkTraces({model: 'GoogleAccounts', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: ['Browser/App Link delivery and provider responses are controlled external ports; connect/disconnect and readback execute the real source.', 'Account-list results supply the observed connection and capabilities. Inbox cache invalidation is covered by its separate adapter.', 'Native background retirement is a resolved external port here and needs native notice lifecycle evidence.']});
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.__quintGooglePorts; }
}
