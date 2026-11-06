import { test, expect, type Page } from '@playwright/test';

// Real composer, draft store, shell adapter and connection controller. Only the Android IPC
// boundary and a remote agent are synthetic, in-page fixtures; nothing leaves the page and no
// model is called. This is browser source evidence, not emulator or device acceptance.
const REMOTE = 'https://agent.example.test';
const ROOM = '99999999-8888-4777-8666-555555555555';
type Options = { holdIdentity?: boolean; createFails?: boolean; createHangs?: boolean; createLimited?: boolean; abortRoute?: boolean; abortResult?: boolean; long?: boolean };

async function remoteAgent(page: Page, options: Options = {}) {
  await page.addInitScript(({ remote, room, options }) => {
    const w = window as any;
    w.androidBridge = {};
    // Stands in for Android secure storage, which survives a reload of the page.
    let saved: [string, string][] = [];
    try { saved = JSON.parse(sessionStorage.getItem('continuity-store') || '[]'); } catch { /* fixture only */ }
    const store = new Map<string, string>(saved);
    const keep = () => { try { sessionStorage.setItem('continuity-store', JSON.stringify([...store])); } catch { /* fixture only */ } };
    const expiresAt = Date.now() + 86_400_000;
    store.set('remote:' + remote, JSON.stringify({ origin: remote, token: 'remote-session-token', identityId: 'fixture-owner', sessionId: 'remote-session-token', expiresAt }));
    // The agent's own state survives a page reload; the phone's visible chat does not.
    let agent: { created: boolean; history: any[] } = { created: false, history: [] };
    try {
      if (!sessionStorage.getItem('continuity-seeded')) {
        sessionStorage.setItem('continuity-seeded', '1');
        localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'remote', origin: remote }));
        if (options.long) agent.history = Array.from({ length: 230 }, (_, index) => ({ id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`, role: index % 2 ? 'assistant' : 'user', text: `Synthetic message ${index}`, timestamp: 1_000 + index }));
      } else agent = JSON.parse(sessionStorage.getItem('continuity-agent') || 'null') ?? agent;
    } catch { /* storage failures are covered elsewhere */ }
    const persist = () => { try { sessionStorage.setItem('continuity-agent', JSON.stringify(agent)); } catch { /* fixture only */ } };
    const f = w.continuity = {
      ownerId: 'fixture-owner', posts: 0, creates: 0, aborts: 0, historyReads: 0, pageReads: 0, ready: false, messageIds: [] as unknown[],
      createFails: !!options.createFails, createHangs: !!options.createHangs, createLimited: !!options.createLimited, abortResult: !!options.abortResult,
      holdReads: false, identityReleased:false, heldIdentity:null as null|(()=>void), lists: 0, heldRead: null as null | (() => void), heldList: null as null | (() => void),
      release: null as null | ((text: string) => void),
      /** The agent finishes the held turn and persists its reply, whether or not the phone still listens. */
      finish(text: string) { const user = [...agent.history].reverse().find(item => item.role === 'user'); agent.history.push({ id: crypto.randomUUID(), role: 'assistant', text, timestamp: Date.now() + 1, replyToMessageId: user?.id }); persist(); },
    };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['list', 'get']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'DeviceApps', methods: methods(['buildInfo']) },
      ],
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'DeviceApps') return { launcher: false, version: 'continuity-fixture' };
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin !== 'AlphaConnection') throw Error('Unexpected native operation');
        if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
        if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); keep(); return { status: 'saved' }; }
        if (method === 'secureWrite') { store.set(input.slot, input.value); keep(); return {}; }
        if (method === 'secureRemove') { store.delete(input.slot); keep(); return {}; }
        if (method !== 'request') return {};
        const url = new URL(input.url), ok = (data: unknown) => ({ status: 200, data }), path = url.pathname;
        if (url.origin !== remote || input.headers?.Authorization !== 'Bearer remote-session-token') return { status: 401, data: {} };
        if (path === '/api/auth/me' && options.holdIdentity && !f.identityReleased) await new Promise<void>(resolve=>{f.heldIdentity=()=>{f.identityReleased=true;resolve();};});
        if (path === '/api/auth/me') return ok({ identity: { kind: 'owner', id: f.ownerId, displayName: 'Owner' }, session: { kind: 'machine', id: 'remote-session-token', expiresAt }, access: { role: 'OWNER', mode: 'session' } });
        if (path === '/api/agents') { f.ready = true; return ok({ agents: [{ id: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', name: 'Continuity fixture', status: 'running' }] }); }
        if (path === '/api/client-devices/register') return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
        if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
        if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
        if (path === '/api/conversations' && input.method === 'POST') {
          f.creates++;
          // Offline: the request never completes, so no conversation exists and nothing was posted.
          if (f.createFails) throw Error('Network unavailable');
          if (f.createHangs) return new Promise(() => {});
          if (f.createLimited) return { status: 429, data: {} };
          const id = agent.created ? 'fixture-chat-2' : 'fixture-chat';
          agent.created = true; persist();
          return ok({ conversation: { id, title: 'Alpha Phone' } });
        }
        if (path === '/api/conversations' && input.method === 'GET' && f.holdReads) { f.lists++; await new Promise<void>(resolve => { f.heldList = resolve; }); }
        if (path === '/api/conversations' && input.method === 'GET') return ok({ conversations: agent.created ? [{ id: 'fixture-chat', title: 'Alpha Phone', ...(options.abortRoute ? { roomId: room } : {}) }] : [] });
        if (path === `/api/turns/${room}/abort` && input.method === 'POST') { f.aborts++; return options.abortRoute ? ok({ aborted: f.abortResult, roomId: room }) : { status: 404, data: {} }; }
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
          const body = JSON.parse(input.body || '{}');
          f.posts++; f.messageIds.push(body.clientMessageId ?? null);
          agent.history.push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() }); persist();
          // Held until the test lets the agent answer over the still-open request.
          return new Promise(resolve => { f.release = (text: string) => { f.release = null; resolve(ok({ text, agentName: 'Continuity fixture' })); }; });
        }
        if (path === '/api/conversations/fixture-chat/messages' && input.method === 'GET') {
          if (!url.searchParams.has('before')) { f.historyReads++; if (f.holdReads) await new Promise<void>(resolve => { f.heldRead = resolve; }); return ok({ messages: agent.history.slice(-200) }); }
          f.pageReads++;
          const before = Number(url.searchParams.get('before')), beforeId = url.searchParams.get('beforeId') || '';
          const older = agent.history.filter(item => item.timestamp < before || (item.timestamp === before && item.id < beforeId));
          return ok({ messages: older.slice(-200), hasMore: older.length > 200 });
        }
        return { status: 404, data: {} };
      },
    };
  }, { remote: REMOTE, room: ROOM, options });
}
// The home composer and the conversation sheet each render one visible composer textbox.
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const fixture = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.continuity)`) as Promise<T>;
const stop = (page: Page) => page.getByRole('button', { name: 'Stop reply', exact: true });
const bindingKey = (page: Page) => page.evaluate(async () => {
  const { connectionController } = await import('/src/runtime/connection-ui.tsx');
  return connectionController.assistantDraftBinding(new AbortController().signal);
});
async function connected(page: Page, options: Options = {}) {
  await remoteAgent(page, options);
  await page.goto('/');
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
}
async function typeDraft(page: Page, text: string) {
  await composer(page).fill(text);
  await expect(composer(page)).toHaveValue(text);
}
const MAY_FINISH = 'The agent may still finish this reply. Alpha Phone will check once and show it here if it does.';
const UNKNOWN = 'Your message may have reached the agent. Check before sending it again.';

test('an offline failure before the message is posted keeps the text and a later send posts it once', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, { createFails: true });
  await typeDraft(page, 'Keep this while offline');
  await composer(page).press('Enter');
  await expect(page.getByText('Not sent. Your message is back in the composer.', { exact: true }).first()).toBeVisible();
  await expect(composer(page)).toHaveValue('Keep this while offline');
  // Nothing carrying the message left the phone, so no unknown-outcome claim and no reconciliation.
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check for reply/ })).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates, reads: f.historyReads }))).toEqual({ posts: 0, creates: 1, reads: 0 });
  // Back online: only the person's own second Send posts the message, exactly once.
  await fixture(page, f => { f.createFails = false; });
  await expect(stop(page)).toHaveCount(0);
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => f.release('Delivered once.'));
  await expect(conversation(page).getByText('Delivered once.', { exact: true })).toHaveCount(1);
  await expect(composer(page)).toHaveValue('');
  expect(await fixture(page, f => ({ posts: f.posts, ids: new Set(f.messageIds).size }))).toEqual({ posts: 1, ids: 1 });
});

test('Stop before the message is posted returns the text and never contacts the agent about it', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, { createHangs: true, abortRoute: true });
  await typeDraft(page, 'Stopped before sending');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.creates), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(composer(page)).toHaveValue('Stopped before sending');
  await expect(page.getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, aborts: f.aborts }))).toEqual({ posts: 0, aborts: 0 });
});

test('Stop says the agent may still finish, discards the late reply and reconciles once without resending', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Please finish anyway');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  // The honest state is shown in the chat itself, not only in Agent connection.
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  // The agent answers on the closed request and persists the reply: the late transport reply is discarded.
  await fixture(page, f => { f.release('Finished after Stop'); f.finish('Finished after Stop'); });
  await expect(conversation(page).getByText('Finished after Stop', { exact: true })).toHaveCount(0);
  expect(await fixture(page, f => f.historyReads)).toBe(0);
  // One reconciliation read later shows it exactly once.
  await expect(conversation(page).getByText('Finished after Stop', { exact: true })).toHaveCount(1, { timeout: 40_000 });
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
  await expect(conversation(page).getByText('Please finish anyway', { exact: true })).toHaveCount(1);
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, reads: f.historyReads, ids: new Set(f.messageIds).size }))).toEqual({ posts: 1, reads: 1, ids: 1 });
});

test('Stop asks the agent to cancel exactly once and reports a confirmed cancel in the chat', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page, { abortRoute: true, abortResult: true });
  await typeDraft(page, 'Please stop this one');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText('The agent cancelled this reply. Alpha Phone will check once in case it had already finished.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(conversation(page).getByText('The agent stopped this reply.', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(conversation(page).getByText(/Alpha Phone will check once/)).toHaveCount(0);
  await expect(conversation(page).getByText('Please stop this one', { exact: true })).toHaveCount(1);
  expect(await fixture(page, f => ({ posts: f.posts, aborts: f.aborts, reads: f.historyReads }))).toEqual({ posts: 1, aborts: 1, reads: 1 });
});

test('a new message after Stop retires the pending check and says so; nothing is resent', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page);
  await typeDraft(page, 'First question');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  await typeDraft(page, 'Second question');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
  await expect(conversation(page).getByText(/The stopped reply was not checked because another message was sent\./)).toHaveCount(1);
  await fixture(page, f => f.release('Answer to the second question'));
  await expect(conversation(page).getByText('Answer to the second question', { exact: true })).toHaveCount(1);
  // Two messages the person sent, two distinct identities, no automatic history replacement.
  expect(await fixture(page, f => ({ posts: f.posts, ids: new Set(f.messageIds).size, reads: f.historyReads }))).toEqual({ posts: 2, ids: 2, reads: 0 });
  await expect(conversation(page).getByText('First question', { exact: true })).toHaveCount(1);
});

test('a new conversation after Stop retires the check; the stopped reply never replaces the new chat', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Asked in the first conversation');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  const selected = () => page.evaluate(async () => {
    const { connectionController } = await import('/src/runtime/connection-ui.tsx');
    const { history, replyNotice } = connectionController.getSnapshot();
    return { conversation: history?.conversationId, messages: history?.messages.length, replyNotice };
  });
  await page.evaluate(async () => { const { connectionController } = await import('/src/runtime/connection-ui.tsx'); await connectionController.newConversation(); });
  await expect.poll(selected, { timeout: 15_000 }).toEqual({ conversation: 'fixture-chat-2', messages: 0, replyNotice: '' });
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
  // The first conversation's reply lands on the agent; the pending check would have fired by now.
  await fixture(page, f => { f.release('Reply for the first conversation'); f.finish('Reply for the first conversation'); });
  await page.waitForTimeout(17_000);
  await expect(conversation(page).getByText('Reply for the first conversation', { exact: true })).toHaveCount(0);
  await expect(conversation(page).getByText('Asked in the first conversation', { exact: true })).toHaveCount(0);
  expect(await selected()).toEqual({ conversation: 'fixture-chat-2', messages: 0, replyNotice: '' });
  expect(await fixture(page, f => ({ posts: f.posts, reads: f.historyReads }))).toEqual({ posts: 1, reads: 0 });
});

test('pressing Send twice dispatches one message', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page);
  await typeDraft(page, 'Only once please');
  const box = composer(page);
  await box.focus();
  // Two key presses with no wait between them, as a fast double tap delivers them.
  await Promise.all([page.keyboard.press('Enter'), page.keyboard.press('Enter')]);
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await expect(page.getByText('Review local draft storage before sending.', { exact: true })).toHaveCount(0);
  await fixture(page, f => f.release('One reply.'));
  await expect(conversation(page).getByText('One reply.', { exact: true })).toHaveCount(1);
  await expect(conversation(page).getByText('Only once please', { exact: true })).toHaveCount(1);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 1, creates: 1 });
});

test('disconnecting the agent mid-reply never shows the old reply or a recovery offer for a different agent', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page);
  await typeDraft(page, 'Asked the first agent');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await page.evaluate(async () => { const { connectionController } = await import('/src/runtime/connection-ui.tsx'); await connectionController.disconnect(); });
  await expect.poll(() => page.evaluate(async () => { const { connectionController } = await import('/src/runtime/connection-ui.tsx'); return connectionController.getSnapshot().session; }), { timeout: 15_000 }).toBeNull();
  await fixture(page, f => f.release?.('Late reply for the old agent'));
  await page.locator('.alpha-connection').getByRole('button', { name: 'Close connection settings', exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
  // The interruption is stated once; the old turn's text, reply and recovery offer never appear under the new owner.
  await expect(conversation(page).getByText(/^Request cancelled\./)).toHaveCount(1);
  // The message was posted before the owner changed: the notice says it may have arrived, so it is not blindly resent.
  await expect(conversation(page).getByText(/Your message may have reached the previous agent connection\. Check its saved conversations before sending it again\.$/)).toHaveCount(1);
  for (const text of ['Asked the first agent', 'Late reply for the old agent', UNKNOWN, MAY_FINISH]) await expect(conversation(page).getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check for reply/ })).toHaveCount(0);
  await expect(stop(page)).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, reads: f.historyReads }))).toEqual({ posts: 1, reads: 0 });
});

test('reconnecting restores the saved remote conversation with older pages; the draft survives Home, Back and a keyboard resize', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page, { long: true });
  await typeDraft(page, 'Newest question');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => { f.release('Newest answer'); f.finish('Newest answer'); });
  await expect(conversation(page).getByText('Newest answer', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  // Restored from the agent on connect: the recent window plus one older page, oldest first, once each.
  await expect.poll(() => fixture(page, f => ({ reads: f.historyReads, pages: f.pageReads })), { timeout: 30_000 }).toEqual({ reads: 1, pages: 1 });
  const restored = () => page.evaluate(async () => {
    const { connectionController } = await import('/src/runtime/connection-ui.tsx');
    const history = connectionController.getSnapshot().history;
    return history && { automatic: history.automatic, count: history.messages.length, first: history.messages[0].text, last: history.messages.at(-1)!.text, conversation: history.conversationId };
  });
  await expect.poll(restored, { timeout: 20_000 }).toEqual({ automatic: true, count: 232, first: 'Synthetic message 0', last: 'Newest answer', conversation: 'fixture-chat' });
  expect(await fixture(page, f => f.posts)).toBe(0);
  await typeDraft(page, 'Unsent across navigation');
  const key = await bindingKey(page);
  expect(JSON.parse(key).at(-1)).toBe('fixture-chat');
  await page.evaluate(() => { window.dispatchEvent(new Event('launcher-home')); window.dispatchEvent(new Event('alpha-back', { cancelable: true })); });
  await expect(composer(page)).toHaveValue('Unsent across navigation');
  // A soft keyboard shrinks the viewport: the composer stays on screen with the same text.
  await page.setViewportSize({ width: 412, height: 520 });
  await expect(composer(page)).toHaveValue('Unsent across navigation');
  await expect(composer(page)).toBeInViewport();
  await page.setViewportSize({ width: 412, height: 915 });
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  // Unsent text is not kept across a reload.
  await expect(composer(page)).toHaveValue('', { timeout: 30_000 });
  // Nothing was sent by restoring, navigating, resizing or reloading.
  expect(await fixture(page, f => f.posts)).toBe(0);
  await expect.poll(restored, { timeout: 30_000 }).toMatchObject({ count: 232, conversation: 'fixture-chat' });
});

const NOT_CHECKED = /The stopped reply was not checked because another message was sent\./;
const NOT_FINISHED = 'The agent had not finished the stopped reply when Alpha Phone checked. Load conversations later to see it.';
const LOAD_TO_SEE = 'Load this conversation from Agent connection to see whether the stopped reply finished.';

test('a rate limit before the message is posted keeps the text instead of reporting an unknown outcome', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, { createLimited: true });
  await typeDraft(page, 'Rate limited before sending');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Rate limited before sending', { timeout: 15_000 });
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check for reply/ })).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 0, creates: 1 });
});

test('Stop is offered before the first reply chunk of a later message in the same conversation', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page);
  await typeDraft(page, 'First message');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => f.release('First answer'));
  await expect(conversation(page).getByText('First answer', { exact: true })).toHaveCount(1);
  // The conversation already exists, so nothing but the held post happens before the first chunk.
  await typeDraft(page, 'Second message');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  await expect(stop(page)).toBeVisible({ timeout: 5_000 });
  await stop(page).click();
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  expect(await fixture(page, f => ({ posts: f.posts, ids: new Set(f.messageIds).size }))).toEqual({ posts: 2, ids: 2 });
});

test('a confirmed stop of one turn is never repeated as the outcome of a later stopped turn', async ({ page }) => {
  test.setTimeout(150_000);
  await connected(page, { abortRoute: true, abortResult: true });
  await typeDraft(page, 'Stop the first');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText('The agent stopped this reply.', { exact: true })).toHaveCount(1, { timeout: 40_000 });
  await typeDraft(page, 'Stop the second');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  await stop(page).click();
  await expect(conversation(page).getByText(/Alpha Phone will check once/)).toHaveCount(1, { timeout: 15_000 });
  // A third message retires the second turn's check before it ran: its outcome is unknown, not "stopped".
  await typeDraft(page, 'A third message');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(3);
  await expect(conversation(page).getByText(NOT_CHECKED)).toHaveCount(1);
  await expect(conversation(page).getByText('The agent stopped this reply.', { exact: true })).toHaveCount(1);
  expect(await fixture(page, f => ({ aborts: f.aborts, reads: f.historyReads }))).toEqual({ aborts: 2, reads: 1 });
});

test('a check that reported its result keeps that statement and its offer when another message is sent', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Still thinking');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText(NOT_FINISHED, { exact: true })).toHaveCount(1, { timeout: 40_000 });
  await expect(page.getByRole('button', { name: /^Check for reply/ })).toHaveCount(1);
  await typeDraft(page, 'Another message');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  // The check did run; the chat must not now claim that it did not.
  await expect(conversation(page).getByText(NOT_CHECKED)).toHaveCount(0);
  await expect(conversation(page).getByText(NOT_FINISHED, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Check for reply/ })).toHaveCount(1);
  expect(await fixture(page, f => f.historyReads)).toBe(1);
});

test('a check overtaken by another connection operation says so instead of promising a check forever', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Overtaken check');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  await fixture(page, f => { f.holdReads = true; });
  await expect.poll(() => fixture(page, f => f.historyReads), { timeout: 40_000 }).toBe(1);
  // The person opens the conversation list while the single read is still in flight.
  await page.evaluate(async () => { const { connectionController } = await import('/src/runtime/connection-ui.tsx'); void connectionController.listHistory(); });
  await expect.poll(() => fixture(page, f => f.lists), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => { f.holdReads = false; f.heldRead(); });
  await expect(conversation(page).getByText(LOAD_TO_SEE, { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
  await fixture(page, f => f.heldList());
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, reads: f.historyReads }))).toEqual({ posts: 1, reads: 1 });
});

test('Stop is offered while an agent has not produced its first chunk, and a late first chunk is discarded', async ({ page }) => {
  test.setTimeout(90_000);
  // A directly attached transport whose reply stays silent: nothing but the pending request can show Stop.
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
  await page.goto('/');
  const box = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
  await box.waitFor();
  await page.evaluate(async () => {
    const { alphaClient } = await import('/src/runtime/alpha-client.ts');
    const w = window as any; w.silent = { posts: 0 };
    alphaClient.attachVerifiedTransport({ session: { ownerId: 'fixture-owner', agentId: 'fixture-agent', sessionId: 'fixture-session', origin: 'https://fixture.example' },
      send: ({ onText }: any) => { w.silent.posts++; w.silent.emit = onText; return new Promise(() => {}); },
      execute: async () => { throw Error('No action may execute'); },
    });
  });
  await box.fill('Silent agent');
  await box.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).silent.posts), { timeout: 15_000 }).toBe(1);
  await expect(stop(page)).toBeVisible({ timeout: 5_000 });
  await stop(page).click();
  await expect(stop(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).silent.emit('Late first chunk'));
  await expect(conversation(page).getByText('Late first chunk', { exact: true })).toHaveCount(0);
  // This transport is attached below the shell's dispatch tracking, so only Stop itself is asserted here;
  // the outcome after Stop is covered by the connection-backed tests above.
  expect(await page.evaluate(() => (window as any).silent.posts)).toBe(1);
});

// Back and HOME during a reply. Collapsing the chat (Back from full to sheet, HOME while Home is the
// current app) is not a Stop: the reply keeps arriving and is shown once. HOME from another app
// changes the screen the turn was asked from, which is an explicit Stop with its one reconciliation.
for (const step of ['Back from full to sheet', 'HOME on Home'] as const) {
  test(`${step} during a reply keeps it: the finished reply appears once and nothing is resent`, async ({ page }) => {
    test.setTimeout(90_000);
    await connected(page);
    await typeDraft(page, `Keep replying after ${step}`);
    await composer(page).press('Enter');
    await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
    await expect(stop(page)).toBeVisible();
    if (step === 'Back from full to sheet') {
      await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Shrink chat', exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));
      await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
      await expect(conversation(page)).toHaveAttribute('aria-hidden', 'true');
    }
    // The reply arrives on the still-open request and brings the conversation sheet back.
    await fixture(page, f => { f.finish('Finished while collapsed'); f.release('Finished while collapsed'); });
    await expect(conversation(page).getByText('Finished while collapsed', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText(`Keep replying after ${step}`, { exact: true })).toHaveCount(1);
    await expect(page.getByText(MAY_FINISH, { exact: true })).toHaveCount(0);
    await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(await fixture(page, f => ({ posts: f.posts, aborts: f.aborts, reads: f.historyReads }))).toEqual({ posts: 1, aborts: 0, reads: 0 });
  });
}

test('HOME from another app during a reply is a Stop: one cancel, the reconciliation statement, and no resend', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page, { abortRoute: true });
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await typeDraft(page, 'Asked from Notes');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  await expect.poll(() => fixture(page, f => f.aborts)).toBe(1);
  // The agent finishes anyway; the late transport reply is discarded and the one check shows it once.
  await fixture(page, f => { f.release('Finished after HOME'); f.finish('Finished after HOME'); });
  await expect(conversation(page).getByText('Finished after HOME', { exact: true })).toHaveCount(1, { timeout: 40_000 });
  await expect(conversation(page).getByText('Asked from Notes', { exact: true })).toHaveCount(1);
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, aborts: f.aborts, reads: f.historyReads }))).toEqual({ posts: 1, aborts: 1, reads: 1 });
});


test('typing during initial identity verification survives Minimize and admission', async({page})=>{
 await remoteAgent(page,{holdIdentity:true});await page.goto('/');await expect.poll(()=>fixture(page,f=>!!f.heldIdentity)).toBe(true);
 await composer(page).pressSequentially('Typed before identity is restored');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await expect(conversation(page)).toHaveAttribute('aria-hidden','true');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(composer(page)).toHaveValue('Typed before identity is restored');await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await expect(conversation(page)).toHaveAttribute('aria-hidden','true');
 await fixture(page,f=>f.heldIdentity());await expect.poll(()=>fixture(page,f=>f.ready)).toBe(true);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(conversation(page)).toHaveAttribute('aria-hidden','true');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(composer(page)).toHaveValue('Typed before identity is restored');expect(await fixture(page,f=>f.posts)).toBe(0);
});


