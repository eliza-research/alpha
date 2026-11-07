import { test, expect as baseExpect, type Page } from '@playwright/test';
// Every test here loads the whole development app at least once (several reload it, open a second tab
// or connect a profile), and the composer's saved draft is restored from IndexedDB after each load.
// Under four workers on a loaded machine a load has taken 10-30s and a restore more than the 5s
// default, so the timeouts are explicit: 90s per test, 15s per expectation. What is expected is
// unchanged; only how long the page may take to get there.
test.describe.configure({timeout:90_000});
const expect=baseExpect.configure({timeout:15_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});

// Real composer, draft store and connection controller. Only the Android IPC boundary and a
// remote agent are synthetic, in-page fixtures; nothing leaves the page.
const REMOTE = 'https://agent.example.test';
type Mode = 'expires' | 'post-fails';

async function remoteAgent(page: Page, mode: Mode) {
  await page.addInitScript(({ remote, mode }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    // An expiring session lets the composer refuse before any request carries the message. It lapses
    // only when the test moves the page clock past it (ten minutes on), never while a slow load is
    // still connecting: a 25s wall-clock lifetime ran out before the first load finished under load.
    const expiresAt = Date.now() + (mode === 'expires' ? 600_000 : 86_400_000);
    store.set('remote:' + remote, JSON.stringify({ origin: remote, token: 'remote-session-token', identityId: 'fixture-owner', sessionId: 'remote-session-token', expiresAt }));
    try { if (!sessionStorage.getItem('dispatch-seeded')) { sessionStorage.setItem('dispatch-seeded', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'remote', origin: remote })); } } catch { /* covered elsewhere */ }
    const f = w.dispatchFixture = { posts: 0, historyReads: 0, created: false, ready: false, expiresAt, store };
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
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'dispatch-fixture' };
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
        if (path === '/api/agents') { f.ready = true; return ok({ agents: [{ id: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', name: 'Dispatch fixture', status: 'running' }] }); }
        if (path === '/api/client-devices/register') return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
        if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
        if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
        if (path === '/api/conversations' && input.method === 'POST') { f.created = true; return ok({ conversation: { id: 'fixture-chat', title: 'Alpha Phone' } }); }
        if (path === '/api/conversations' && input.method === 'GET') return ok({ conversations: f.created ? [{ id: 'fixture-chat', title: 'Alpha Phone' }] : [] });
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
          // Record each POST's message identity: a reconciliation repeats the same clientMessageId
          // and body (the agent returns the durable outcome for that key); a resend would not.
          f.posts++; const body = JSON.parse(input.body || '{}'); (f.messageIds ||= []).push(body.clientMessageId ?? null); (f.bodies ||= []).push(JSON.stringify(body));
          return { status: 502, data: { error: 'upstream reset' } };
        }
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'GET') {
          f.historyReads++;
          return ok({ messages: [{ id: 'u1', role: 'user', text: 'Was this delivered?' }, { id: 'a1', role: 'assistant', text: 'Yes, your message arrived. Here is the reply.' }] });
        }
        return { status: 404, data: {} };
      },
    };
  }, { remote: REMOTE, mode });
}
// The home composer and the conversation sheet each render one visible composer textbox.
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const bindingKey = (page: Page) => page.evaluate(async () => {
  const { connectionController } = await import('/src/runtime/connection-ui.tsx');
  return connectionController.assistantDraftBinding(new AbortController().signal);
});
async function savedDraft(page: Page, key?: string) {
  const binding = key ?? await bindingKey(page);
  return page.evaluate(async binding => {
    const { assistantDraftStore } = await import('/src/runtime/assistant-draft-store.ts');
    return (await (await assistantDraftStore(binding)).read())?.text ?? null;
  }, binding);
}

test('without a connection the chooser opens and the message returns to the composer', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })); } });
  await page.goto('/');
  await composer(page).fill('Keep this unsent message');
  await expect.poll(() => savedDraft(page), { timeout: 15_000 }).toBe('Keep this unsent message');
  await composer(page).press('Enter');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await expect(composer(page)).toHaveValue('Keep this unsent message');
  // The text simply comes back: no line under the composer and no toast (owner, 2026-11-03).
  await expect(page.getByText('Your message is back in the composer')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Assistant draft status', exact: true })).toHaveCount(0);
  // The unsent bubble is removed; the durable draft was never cleared.
  expect(await page.evaluate(text => [...document.querySelectorAll('[data-alpha-layer="conversation"] div')].filter(d => !d.querySelector('textarea') && d.textContent === text).length, 'Keep this unsent message')).toBe(0);
  expect(await savedDraft(page)).toBe('Keep this unsent message');
  await page.reload();
  await expect(composer(page)).toHaveValue('Keep this unsent message');
});

// The lapsed session is retired, so the composer leaves that owner's binding before the refusal
// settles: the text stays saved, unmarked, in its own conversation's slot (never moved into the next
// binding, which may belong to another owner or agent) and nothing is sent.
test('a transport refusal before dispatch keeps the text in its own conversation and sends nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await remoteAgent(page, 'expires');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).dispatchFixture.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
  await composer(page).fill('Do not lose this');
  await expect.poll(() => savedDraft(page), { timeout: 15_000 }).toBe('Do not lose this');
  // Let the paired session lapse: the transport refuses before it creates or posts anything.
  const left = await page.evaluate(() => (window as any).dispatchFixture.expiresAt + 250 - Date.now());
  expect(left).toBeGreaterThan(0);
  await page.clock.fastForward(left);
  expect(await page.evaluate(() => Date.now() > (window as any).dispatchFixture.expiresAt + 250)).toBe(true);
  const key = await bindingKey(page);
  await composer(page).press('Enter');
  // The expired session is retired and the chooser opens; the message never left the phone.
  await expect(page.locator('.alpha-connection')).toBeVisible();
  await expect(page.getByText('Not sent. Your message was kept as a draft in its own conversation.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close connection settings', exact: true }).first().click();
  await expect(composer(page)).toHaveValue('');
  expect(await savedDraft(page, key)).toBe('Do not lose this');
  expect(await page.evaluate(() => { const f = (window as any).dispatchFixture; return { posts: f.posts, created: f.created }; })).toEqual({ posts: 0, created: false });
});

test('a failure after dispatch says the reply could not finish and never resends', async ({ page }) => {
  await remoteAgent(page, 'post-fails');
  await page.goto('/');
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
  await composer(page).fill('Was this delivered?');
  await expect.poll(() => savedDraft(page), { timeout: 15_000 }).toBe('Was this delivered?');
  const key = await bindingKey(page);
  await composer(page).press('Enter');
  await expect(page.getByText('Sorry, I couldn’t finish that reply.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
  // The message may have been received, so it is not offered again as a draft.
  await expect(composer(page)).toHaveValue('');
  await expect.poll(() => savedDraft(page, key)).toBe('');
  // One logical send: the transport may reconcile a dropped response once by repeating the identical
  // request under the same clientMessageId, which the agent deduplicates. It never sends a new message.
  const sent = await page.evaluate(() => { const f = (window as any).dispatchFixture; return { posts: f.posts, ids: [...new Set(f.messageIds)], bodies: [...new Set(f.bodies)] }; });
  expect(sent.posts).toBeGreaterThanOrEqual(1); expect(sent.posts).toBeLessThanOrEqual(2);
  expect(sent.ids).toHaveLength(1); expect(typeof sent.ids[0]).toBe('string'); expect(sent.bodies).toHaveLength(1);
  // The Check saved conversation card and its history read were removed, so the click-to-check step
  // that ended this test is gone with them.
});
