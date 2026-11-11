import { test, expect, type Page } from '@playwright/test';

// Upstream escalation notices in a restored and a live conversation. Real composer, shell adapter
// and connection controller; only the Android IPC boundary and a remote agent are in-page
// fixtures. Nothing leaves the page and no model is called. This is browser source evidence, not
// emulator or device acceptance. The collapse rules are pinned in test/system-notice-collapse.test.mjs;
// chat-system-notices.production.spec.ts proves this case on the resident agent.
const REMOTE = 'https://agent.example.test';
const UPSTREAM_RUNTIME = 'Eliza needs attention. Check the connected host\'s diagnostics before trying again.';
const UPSTREAM_MODEL = 'Eliza cannot respond yet. Configure a model provider on the connected host in Settings.';
const ALPHA_MODEL = 'No AI provider · Open Settings';
const ALPHA_RUNTIME = 'Agent error · Send again';
const ALPHA_BACKGROUND = 'Agent degraded';
type Row = { role: 'user' | 'assistant'; text: string };

async function remoteAgent(page: Page, rows: Row[]) {
  await page.addInitScript(({ remote, rows }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    const expiresAt = Date.now() + 86_400_000;
    store.set('remote:' + remote, JSON.stringify({ origin: remote, token: 'remote-session-token', identityId: 'fixture-owner', sessionId: 'remote-session-token', expiresAt }));
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'remote', origin: remote }));
    // The phone last had this conversation open, so the start restores its history.
    localStorage.setItem('alpha.connection.conversations.v1', JSON.stringify({ [JSON.stringify([remote, 'fixture-owner', '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11'])]: 'fixture-chat' }));
    const history = rows.map((row, index) => ({ id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`, ...row, timestamp: 1_000 + index }));
    const f = w.notices = { ready: false, historyReads: 0, posts: 0, release: null as null | ((text: string) => void) };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['list', 'get']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
      ],
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'notices-fixture' };
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin !== 'AlphaConnection') throw Error('Unexpected native operation');
        if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
        if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); return { status: 'saved' }; }
        if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
        if (method === 'secureRemove') { store.delete(input.slot); return {}; }
        if (method !== 'request') return {};
        const url = new URL(input.url), ok = (data: unknown) => ({ status: 200, data }), path = url.pathname;
        if (url.origin !== remote || input.headers?.Authorization !== 'Bearer remote-session-token') return { status: 401, data: {} };
        if (path === '/api/auth/me') return ok({ identity: { kind: 'owner', id: 'fixture-owner', displayName: 'Owner' }, session: { kind: 'machine', id: 'remote-session-token', expiresAt }, access: { role: 'OWNER', mode: 'session' } });
        if (path === '/api/agents') { f.ready = true; return ok({ agents: [{ id: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', name: 'Notices fixture', status: 'running' }] }); }
        if (path === '/api/client-devices/register') return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
        if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
        if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
        if (path === '/api/conversations' && input.method === 'GET') return ok({ conversations: [{ id: 'fixture-chat', title: 'Alpha Phone' }] });
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'GET') { f.historyReads++; return ok({ messages: history.slice(-200) }); }
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
          const body = JSON.parse(input.body || '{}');
          f.posts++; history.push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() });
          return new Promise(resolve => { f.release = (text: string) => { f.release = null; history.push({ id: crypto.randomUUID(), role: 'assistant', text, timestamp: Date.now() + 1 }); resolve(ok({ text, agentName: 'Notices fixture' })); }; });
        }
        return { status: 404, data: {} };
      },
    };
  }, { remote: REMOTE, rows });
}
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const fixture = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.notices)`) as Promise<T>;
async function connected(page: Page, rows: Row[]) {
  await remoteAgent(page, rows);
  await page.goto('/');
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => fixture(page, f => f.historyReads), { timeout: 20_000 }).toBeGreaterThan(0);
}
const notice: Row = { role: 'assistant', text: UPSTREAM_RUNTIME };

test('notices after an unanswered message collapse to one owner-facing notice, which a later reply retires', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, [{ role: 'user', text: 'Hello agent' }, { role: 'assistant', text: 'Hello back' }, { role: 'user', text: 'Still there?' }, notice, notice, notice, notice]);
  await expect(conversation(page).getByText('Still there?', { exact: true })).toHaveCount(1, { timeout: 20_000 });
  await expect(conversation(page).getByText(ALPHA_RUNTIME, { exact: true })).toHaveCount(1);
  await expect(conversation(page).getByText(UPSTREAM_RUNTIME, { exact: true })).toHaveCount(0);
  await composer(page).fill('Try again');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => f.release('Here now.'));
  await expect(conversation(page).getByText('Here now.', { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await expect(conversation(page).getByText(ALPHA_RUNTIME, { exact: true })).toHaveCount(0);
});

test('a combined notice after an unanswered message gives one send-again step', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, [{ role: 'user', text: 'Hello agent' }, { role: 'assistant', text: `${UPSTREAM_MODEL}\n---\n${UPSTREAM_RUNTIME}` }]);
  await expect(conversation(page).getByText('Hello agent', { exact: true })).toHaveCount(1, { timeout: 20_000 });
  await expect(conversation(page)).toContainText(ALPHA_MODEL);
  await expect(conversation(page)).toContainText(ALPHA_BACKGROUND);
  await expect(conversation(page)).not.toContainText(ALPHA_RUNTIME);
  expect((await conversation(page).innerText()).split(ALPHA_MODEL).length-1).toBe(1);
  expect((await conversation(page).innerText()).match(/send again/gi)).toBeNull();
});
