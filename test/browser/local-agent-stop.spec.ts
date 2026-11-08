import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import { test, expect } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// Real rendered connection UI/controller; only the native IPC boundary is synthetic.
// No runtime, provider key, model request or external account is used.
// Decision P-43: Stop is replaced by Restart; the agent is never left stopped.
for (const scenario of ['confirmed', 'incomplete-timeout'] as const) {
  test(`Restart local agent waits for native shutdown, then starts again: ${scenario}`, async ({ page }) => {
    await installResidentAgentPlugin(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.androidBridge = {};
      const store = new Map();
      w.stopFixture = { starts: 0, stops: 0, polls: 0, status: { state: 'stopping', serviceActive: true, socketListening: true }, unexpected: [] as string[] };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      const agent = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId: 'fixture-agent', providerStatus: {provider: 'elizacloud', configured: false} });
      w.Capacitor = {
        PluginHeaders: [
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
          { name: 'Agent', methods: agent.methods(['getStatus', 'start', 'stop', 'request']) },
          { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite','secureCompareExchange', 'secureRemove', 'cancel', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
          { name: 'AlphaActionJournal', methods: methods(['list']) },
          { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        ],
        nativeCallback: agent.nativeCallback,
        nativePromise: async (plugin: string, method: string, input: any) => {
          const f = w.stopFixture;
          if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if (plugin === 'Agent') {
            const owned = agent.answer(method, input); if (owned) return owned;
            if (method === 'getStatus') {
              if (f.stops) { f.polls++; return { packaged: true, ...f.status }; }
              return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
            }
            if (method === 'start') { f.starts++; return { state: 'ready' }; }
            if (method === 'stop') { f.stops++; return { state: 'stopping' }; }
            if (method === 'request') {
              // Connected Notes and Calendar mount read-only source checks alongside the agent.
              // This shutdown fixture supplies no source data and admits no write operation.
              if (input.method === 'GET' && (input.path === '/api/notes/state' || /^\/api\/lifeops\/calendar\/(feed|calendars|next-context)\?/.test(input.path))) return { status: 503, body: '{}' };
              let body: any;
              if (input.path === '/api/auth/me') body = { identity: { kind: 'owner', id: 'fixture-owner' }, access: { role: 'OWNER', mode: 'session' } };
              else if (input.path === '/api/agents') body = { agents: [{ id: 'fixture-agent', name: 'Resident fixture', status: 'running' }] };
              else if (input.path === '/api/client-devices/register') body = { installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] };
              else if (input.path === '/api/conversations') body = { conversations: [] };
              else if (input.path === '/api/client-devices/proposals') body = { proposals: [] };
              else if (input.path === '/api/workflow/status') body = { status: 'unavailable' };
              else { f.unexpected.push(input.path); throw Error('Unexpected local request'); }
              return { status: 200, body: JSON.stringify(body) };
            }
          }
          if (plugin === 'AlphaConnection') {
            if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
            if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
            if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
            if (method === 'secureRemove') { store.delete(input.slot); return {}; }
            if (['cancel', 'addListener', 'removeListener', 'pauseNotificationCollection'].includes(method)) return {};
          }
          if (plugin === 'AlphaActionJournal' && method === 'list') return { entries: [] };
          if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'fixture' };
          f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation');
        },
      };
    });
    await page.goto('/');
    if (!await page.locator('.alpha-connection-scrim').isVisible())
      await openConnectionDiagnostics(page);
    let chooser = page.locator('.alpha-connection');
    await chooser.getByRole('button', { name: 'Start local agent', exact: true }).click();
    await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Agent connection/ }).click();
    chooser = page.locator('.alpha-connection');
    const stop = chooser.getByRole('button', { name: 'Restart local agent', exact: true });
    await expect(stop).toBeEnabled();
    await page.clock.install();
    await stop.click();
    await expect(chooser.getByText('Restarting your agent…', { exact: true })).toBeVisible();
    await expect(stop).toBeDisabled();
    await expect(chooser.getByText('Local agent stopped.', { exact: true })).toHaveCount(0);
    if (scenario === 'confirmed') {
      for (const status of [
        { state: 'stopped' },
        { state: 'stopped', serviceActive: true, socketListening: false },
        { state: 'stopped', serviceActive: false, socketListening: true },
      ]) {
        await page.evaluate(status => { (window as any).stopFixture.status = status; }, status);
        await page.clock.runFor(400);
        await expect(stop).toBeDisabled();
        await expect(chooser.getByText('Resident fixture', { exact: true })).toBeVisible();
        await expect(chooser.getByText('Local agent stopped.', { exact: true })).toHaveCount(0);
      }
      await page.evaluate(() => { (window as any).stopFixture.status = { state: 'stopped', serviceActive: false, socketListening: false }; });
      await page.clock.runFor(400);
      // Confirmed shutdown is followed at once by a new start; the dialog closes on the new session.
      // The fake clock also drives the new start's timers.
      for (let tick = 0; tick < 40 && await page.evaluate(() => (window as any).stopFixture.starts) < 2; tick++) await page.clock.runFor(500);
      await expect.poll(() => page.evaluate(() => (window as any).stopFixture.starts)).toBe(2);
      await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
    } else {
      await page.evaluate(() => { (window as any).stopFixture.status = { state: 'stopped' }; });
      await page.clock.runFor(30_100);
      await expect(chooser.getByText('Shutdown is still pending. Check local agent status before starting again.', { exact: true })).toBeVisible();
      await expect(stop).toBeEnabled();
      await expect(chooser.getByText('Resident fixture', { exact: true })).toBeVisible();
      await expect(chooser.getByText('Local agent stopped.', { exact: true })).toHaveCount(0);
    }
    const fixture = await page.evaluate(() => (window as any).stopFixture);
    expect(fixture.starts).toBe(scenario === 'confirmed' ? 2 : 1); expect(fixture.stops).toBe(1); expect(fixture.polls).toBeGreaterThan(1); expect(fixture.unexpected).toEqual([]);
    expect(await page.evaluate(() => (window as any).residentAgent.state.unexpected)).toEqual([]);
  });
}
