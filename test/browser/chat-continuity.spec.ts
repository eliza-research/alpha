import { test, expect, type Page } from '@playwright/test';

// Real composer, draft store, shell adapter and connection controller. Only the Android IPC
// boundary and a remote agent are synthetic, in-page fixtures; nothing leaves the page and no
// model is called. This is browser source evidence, not emulator or device acceptance.
const REMOTE = 'https://agent.example.test';
const ROOM = '99999999-8888-4777-8666-555555555555';
type Options = { holdIdentity?: boolean; createFails?: boolean; createHangs?: boolean; createLimited?: boolean; abortRoute?: boolean; abortResult?: boolean; long?: boolean; assistantEntry?: boolean };

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
      release: null as null | ((text: string) => void), assistantClosed: 0,
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
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        // With `assistantEntry`, sessionStorage chooses whether this renderer is AlphaAssistActivity's.
        ...(options.assistantEntry ? [{ name: 'DailyApps', methods: methods(['surfaceInfo', 'closeAssistant']) }] : []),
      ],
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'continuity-fixture' };
        if (plugin === 'DailyApps' && method === 'surfaceInfo') return { developmentBuild: true, assistant: sessionStorage.getItem('continuity-assistant') === '1' };
        if (plugin === 'DailyApps' && method === 'closeAssistant') { f.assistantClosed++; return {}; }
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
async function savedDraft(page: Page, key?: string) {
  const binding = key ?? await bindingKey(page);
  return page.evaluate(async binding => {
    const { assistantDraftStore } = await import('/src/runtime/assistant-draft-store.ts');
    return (await (await assistantDraftStore(binding)).read())?.text ?? null;
  }, binding);
}
async function connected(page: Page, options: Options = {}) {
  await remoteAgent(page, options);
  await page.goto('/');
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
}
async function typeDraft(page: Page, text: string) {
  await composer(page).fill(text);
  await expect.poll(() => savedDraft(page), { timeout: 15_000 }).toBe(text);
}
const MAY_FINISH = 'The agent may still finish this reply. Alpha Phone will check once and show it here if it does.';
const UNKNOWN = 'Your message may have reached the agent. Check before sending it again.';
const UNSETTLED = 'This message may already have been sent. Check the conversation before sending it again.';

// A restart (the process dies) while a posted message waits for its reply: the device copy of the
// sent text is marked as sending, so the next start never offers it as a draft. It is shown for
// review, and keeping the empty composer clears only that copy. Nothing is posted again. The
// conversation already exists, so the restart reopens the same draft slot (a new chat's first
// message is covered by the next two tests).
test('a restart while a message is in flight offers it for review, never as a draft, and posts nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Start the conversation');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await fixture(page, f => { f.release('Started.'); f.finish('Started.'); });
  await expect(conversation(page).getByText('Started.', { exact: true })).toHaveCount(1);
  await expect(stop(page)).toHaveCount(0);
  await typeDraft(page, 'In flight when the app stopped');
  const key = await bindingKey(page);
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
  const status = page.getByRole('status', { name: 'Assistant draft status', exact: true });
  await expect(status).toHaveText(UNSETTLED, { timeout: 20_000 });
  await expect(composer(page)).toHaveValue('');
  expect(await bindingKey(page)).toBe(key);
  expect(await savedDraft(page, key)).toBe('In flight when the app stopped');
  await page.getByRole('button', { name: 'Replace saved draft with this text', exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect.poll(() => savedDraft(page, key)).toBe('');
  await expect(composer(page)).toHaveValue('');
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 0, creates: 0 });
});

// A new chat's first message is held in the "no conversation yet" slot, and its send creates and
// selects the conversation. No warmup send: the restart opens that new conversation, and the held
// message is offered for review there (not only when a later new chat opens). Sending stays
// refused until it is reviewed, and nothing is posted or created again.
async function firstSendRestart(page: Page, text: string) {
  await connected(page);
  await typeDraft(page, text);
  const slot = await bindingKey(page);
  expect(JSON.parse(slot)[3]).toBeNull();
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => ({ posts: f.posts, creates: f.creates })), { timeout: 15_000 }).toEqual({ posts: 1, creates: 1 });
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 20_000 });
  const status = page.getByRole('status', { name: 'Assistant draft status', exact: true });
  await expect(status).toHaveText(UNSETTLED, { timeout: 20_000 });
  await expect(composer(page)).toHaveValue('');
  const key = await bindingKey(page);
  expect(JSON.parse(key)[3]).toBe('fixture-chat');
  expect(await savedDraft(page, slot)).toBe(text);
  // Enter while the review is open sends nothing.
  await composer(page).fill('Not before the review');
  await composer(page).press('Enter');
  await composer(page).fill('');
  return { slot, key, status };
}

test('a restart during a new chat\'s first message offers it on the conversation it created and posts nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const { slot, key, status } = await firstSendRestart(page, 'First message when the app stopped');
  await page.getByRole('button', { name: 'Replace saved draft with this text', exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect.poll(() => savedDraft(page, slot)).toBe('');
  // The composer is now the conversation's own draft.
  await typeDraft(page, 'Next words for the conversation');
  expect(await savedDraft(page, key)).toBe('Next words for the conversation');
  expect(await savedDraft(page, slot)).toBe('');
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 0, creates: 0 });
});

test('restoring a new chat\'s first message after a restart moves it into the conversation\'s draft without sending it', async ({ page }) => {
  test.setTimeout(120_000);
  const { slot, key, status } = await firstSendRestart(page, 'Restore this first message');
  await page.getByRole('button', { name: 'Restore saved draft', exact: true }).click();
  await expect(composer(page)).toHaveValue('Restore this first message');
  await expect(page.getByRole('button', { name: 'Restore saved draft', exact: true })).toHaveCount(0);
  await expect.poll(() => savedDraft(page, key), { timeout: 15_000 }).toBe('Restore this first message');
  // Only once the conversation holds it is the "no conversation yet" copy cleared.
  await expect.poll(() => savedDraft(page, slot), { timeout: 15_000 }).toBe('');
  await page.waitForTimeout(1_000);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 0, creates: 0 });
});

// The ACTION_ASSIST surface (AlphaAssistActivity) and the app are two renderers over the same device
// draft slot of a conversation: words typed in either open in the other, Close keeps them, and
// nothing is sent. A reload with the other entry stands in for the other Activity's renderer.
test('the assistant surface and the app share the conversation draft through Close', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page, { assistantEntry: true });
  await typeDraft(page, 'Started in the app');
  const key = await bindingKey(page);
  await page.evaluate(() => sessionStorage.setItem('continuity-assistant', '1'));
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/alpha-assistant-surface/);
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(composer(page)).toHaveValue('Started in the app', { timeout: 20_000 });
  expect(await bindingKey(page)).toBe(key);
  await composer(page).fill('Finished in the assistant');
  await expect.poll(() => savedDraft(page, key)).toBe('Finished in the assistant');
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await expect.poll(() => fixture(page, f => f.assistantClosed)).toBe(1);
  expect(await savedDraft(page, key)).toBe('Finished in the assistant');
  await page.evaluate(() => sessionStorage.setItem('continuity-assistant', '0'));
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('html')).not.toHaveClass(/alpha-assistant-surface/);
  await expect(composer(page)).toHaveValue('Finished in the assistant', { timeout: 20_000 });
  expect(await fixture(page, f => f.posts)).toBe(0);
});

test('an offline failure before the message is posted keeps the text and a later send posts it once', async ({ page }) => {
  test.setTimeout(90_000);
  await connected(page, { createFails: true });
  await typeDraft(page, 'Keep this while offline');
  const key = await bindingKey(page);
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.creates)).toBe(1);
  await expect(composer(page)).toHaveValue('Keep this while offline');
  // The text simply comes back: no line under the composer and no toast (owner, 2026-11-03).
  await expect(page.getByText('Your message is back in the composer')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Assistant draft status', exact: true })).toHaveCount(0);
  // Nothing carrying the message left the phone, so no unknown-outcome claim and no reconciliation.
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates, reads: f.historyReads }))).toEqual({ posts: 0, creates: 1, reads: 0 });
  expect(await savedDraft(page, key)).toBe('Keep this while offline');
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
  expect(await savedDraft(page)).toBe('Stopped before sending');
});

test('Stop says the agent may still finish, discards the late reply and reconciles once without resending', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Please finish anyway');
  const key = await bindingKey(page);
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  // The honest state is shown in the chat itself, not only in Agent connection.
  await expect(conversation(page).getByText(MAY_FINISH, { exact: true })).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await expect.poll(() => savedDraft(page, key)).toBe('');
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
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
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
  expect(await savedDraft(page, key)).toBe('Unsent across navigation');
  await page.reload();
  await expect.poll(() => fixture(page, f => f.ready), { timeout: 30_000 }).toBe(true);
  await expect(composer(page)).toHaveValue('Unsent across navigation', { timeout: 30_000 });
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
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
  expect(await fixture(page, f => ({ posts: f.posts, creates: f.creates }))).toEqual({ posts: 0, creates: 1 });
  expect(await savedDraft(page)).toBe('Rate limited before sending');
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

test('a check that reported its result keeps that statement, with no Check saved conversation card, when another message is sent', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page);
  await typeDraft(page, 'Still thinking');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(1);
  await stop(page).click();
  await expect(conversation(page).getByText(NOT_FINISHED, { exact: true })).toHaveCount(1, { timeout: 40_000 });
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
  await typeDraft(page, 'Another message');
  await composer(page).press('Enter');
  await expect.poll(() => fixture(page, f => f.posts), { timeout: 15_000 }).toBe(2);
  // The check did run; the chat must not now claim that it did not.
  await expect(conversation(page).getByText(NOT_CHECKED)).toHaveCount(0);
  await expect(conversation(page).getByText(NOT_FINISHED, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
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
// That is the current behaviour: AlphaClient.setViewContext (runtime/alpha-client.ts) aborts the
// foreground request whenever the view context's revision moves. Whether a view change should stop a
// reply at all, or let it finish while refusing only the actions bound to the old screen, is an open
// owner question (docs/decisions.md, "Open engineering question: a view change during a reply");
// this test pins the current answer until it is decided.
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


for(const edit of [false,true])test(`initial identity admission never transfers a restored offline draft${edit?' with edits':''}`,async({page})=>{
 // Two loads (the first and a reload) on the development server; under load one reload alone took the 30s default.
 test.setTimeout(90_000);
 await remoteAgent(page,{holdIdentity:true});await page.goto('/');await expect.poll(()=>fixture(page,f=>!!f.heldIdentity)).toBe(true);
 await page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');const store=await assistantDraftStore(JSON.stringify(['offline']));await store.save(await store.read(),'Earlier offline private words');});
 await page.reload();await expect.poll(()=>fixture(page,f=>!!f.heldIdentity)).toBe(true);await expect(composer(page)).toHaveValue('Earlier offline private words');if(edit)await composer(page).fill('Earlier offline private words with new edits');
 await fixture(page,f=>f.heldIdentity());await expect.poll(()=>fixture(page,f=>f.ready)).toBe(true);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(composer(page)).toHaveValue('');
 expect(await savedDraft(page,JSON.stringify(['offline']))).toContain('Earlier offline private words');expect(await savedDraft(page)).toBeNull();expect(await fixture(page,f=>f.posts)).toBe(0);
});

test('fresh startup typing never overwrites the verified owner saved draft',async({page})=>{
 await remoteAgent(page,{holdIdentity:true});await page.goto('/');await expect.poll(()=>fixture(page,f=>!!f.heldIdentity)).toBe(true);
 const key=JSON.stringify([REMOTE,'fixture-owner','6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11',null]);await page.evaluate(async key=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');const store=await assistantDraftStore(key);await store.save(await store.read(),'Existing verified-owner draft');},key);
 await composer(page).fill('Fresh words while connecting');await fixture(page,f=>f.heldIdentity());await expect.poll(()=>fixture(page,f=>f.ready)).toBe(true);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await expect(composer(page)).toHaveValue('Fresh words while connecting');await expect(page.getByRole('status',{name:'Assistant draft status',exact:true})).toContainText('A saved draft is available');expect(await savedDraft(page,key)).toBe('Existing verified-owner draft');expect(await fixture(page,f=>f.posts)).toBe(0);
});


test('fresh startup draft stays with owner A after a verified switch to owner B',async({page})=>{
 await remoteAgent(page,{holdIdentity:true});await page.goto('/');await expect.poll(()=>fixture(page,f=>!!f.heldIdentity)).toBe(true);
 await composer(page).fill('Fresh startup words for owner A');await fixture(page,f=>f.heldIdentity());await expect.poll(()=>fixture(page,f=>f.ready)).toBe(true);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(composer(page)).toHaveValue('Fresh startup words for owner A');
 const ownerA=await bindingKey(page);await expect.poll(()=>savedDraft(page,ownerA)).toBe('Fresh startup words for owner A');
 await page.evaluate(async remote=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.disconnect();(window as any).continuity.ownerId='fixture-owner-b';await(window as any).Capacitor.nativePromise('AlphaConnection','secureWrite',{slot:'remote:'+remote,value:JSON.stringify({origin:remote,token:'remote-session-token',identityId:'fixture-owner-b',sessionId:'remote-session-token',expiresAt:Date.now()+86_400_000})});await c.pair('remote',remote,'');},REMOTE);
 await expect.poll(()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');return c.getSnapshot().session?.ownerId;})).toBe('fixture-owner-b');await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(composer(page)).toHaveValue('');expect(await bindingKey(page)).not.toBe(ownerA);expect(await savedDraft(page,ownerA)).toBe('Fresh startup words for owner A');expect(await savedDraft(page)).toBeNull();expect(await fixture(page,f=>f.posts)).toBe(0);
});
