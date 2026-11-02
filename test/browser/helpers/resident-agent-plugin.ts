import type {Page} from '@playwright/test';
import {installNativeNavigationFixture} from './native-navigation-protocol';

/**
 * Test-boundary model of the Android resident `Agent` Capacitor plugin, never product code.
 *
 * Call `await installResidentAgentPlugin(page)` before the spec's own fixture script, then call
 * `window.createResidentAgentPlugin(...)` from it. The model covers what the real
 * AlphaLocalAgentPlugin always exposes besides the spec's own request routing:
 * - optional, explicit read-only providerStatus capability for fixtures that start the resident;
 *   provider-specific fixtures keep their own responses unless they opt in;
 * - Capacitor's Plugin base addListener/removeListener (native `callback` methods, so the
 *   fixture's Capacitor global must use the returned `nativeCallback`);
 * - subscribeViewEvents/unsubscribeViewEvents for the renderer's alphaViewEvent feed;
 * - the agent routes the resident renderer reaches once it is subscribed, through the shared
 *   native navigation protocol: GET /api/client-devices/context, answered with the identity the
 *   device registered with (#651's committed-enrollment read), and committed-view reporting.
 */
export async function installResidentAgentPlugin(page: Page) {
  await page.addInitScript(installNativeNavigationFixture);
  await page.addInitScript(defineResidentAgentPlugin);
}

function defineResidentAgentPlugin() {
  // `unexpected` lets a spec collect contract violations in the list it already asserts empty.
  (window as any).createResidentAgentPlugin = (options: {owner: () => string; agentId: string; unexpected?: string[]; providerStatus?: {provider: 'elizacloud'|'cerebras'; configured: boolean; selected?: boolean; model?: string; voiceConfigured?: boolean}}) => {
    const listeners = new Map<string, {eventName: string; callback: (value: unknown) => void}>();
    const state = {subscriptions: [] as string[], unsubscribed: [] as string[], unexpected: options.unexpected ?? [] as string[]};
    const protocol = (window as any).createNativeNavigationFixture(options.owner, options.agentId, state);
    let nextCallback = 0;
    return {
      state,
      /** Agent header: the spec's own promise methods plus the plugin's listener and view-event methods. */
      methods(names: string[]) {
        return [
          ...[...names, 'subscribeViewEvents', 'unsubscribeViewEvents', ...(options.providerStatus && !names.includes('providerStatus') ? ['providerStatus'] : [])].map(name => ({name, rtype: 'promise'})),
          {name: 'addListener', rtype: 'callback'},
          {name: 'removeListener', rtype: 'callback'},
        ];
      },
      /** Capacitor.nativeCallback for a fixture whose only callback-typed methods are the Agent listener pair. */
      nativeCallback(plugin: string, method: string, input: any, callback: (value: unknown) => void) {
        if (plugin === 'Agent' && method === 'addListener') {
          const callbackId = 'agent-listener-' + ++nextCallback;
          listeners.set(callbackId, {eventName: input?.eventName, callback});
          return callbackId;
        }
        if (plugin === 'Agent' && method === 'removeListener') { listeners.delete(input?.callbackId); return ''; }
        state.unexpected.push(plugin + '.' + method);
        throw Error('Unexpected native callback operation');
      },
      /** Answers an Agent promise call the model owns, or returns undefined for the spec to route. */
      answer(method: string, input: any): unknown {
        // Explicit capability only: provider-setting specs without this option keep
        // their own provider response and malformed/refusal controls.
        if (method === 'providerStatus' && options.providerStatus) return {...options.providerStatus};
        if (method === 'subscribeViewEvents') {
          if (typeof input?.subscriptionId !== 'string' || input?.ownerId !== options.owner() || typeof input?.clientId !== 'string') {
            state.unexpected.push('Agent.subscribeViewEvents');
            throw Error('Invalid view event subscription');
          }
          state.subscriptions.push(input.subscriptionId);
          return {subscriptionId: input.subscriptionId};
        }
        if (method === 'unsubscribeViewEvents') { state.unsubscribed.push(input?.subscriptionId); return {}; }
        if (method !== 'request') return undefined;
        const headers = input.headers ?? {};
        // Observe (never answer) registration so the context read reports the enrolled identity.
        if (input.path === '/api/client-devices/register' && headers['X-Eliza-Device-Id']) protocol.register(headers);
        let body: unknown;
        try { body = input.body ? JSON.parse(input.body) : undefined; } catch { body = input.body; }
        const result = protocol.request(input.method ?? 'GET', input.path, body, headers, input.ownerId);
        return result && {status: result.status, body: JSON.stringify(result.data)};
      },
      /** Delivers an alphaViewEvent frame to the renderer's registered listeners. */
      emitViewEvent(value: unknown) {
        for (const listener of listeners.values()) if (listener.eventName === 'alphaViewEvent') listener.callback(value);
      },
    };
  };
}
