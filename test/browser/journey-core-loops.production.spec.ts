import {installNativeNavigationFixture} from './helpers/native-navigation-protocol';
import {selectCalendarSource} from './helpers/browser-calendar';
import {selectLegacyNotes} from './helpers/legacy-notes';
import {seedCompletedAccessSetup} from './flag-off-android';
// Core loops A–F and J01–J05 on the FLAG-OFF bundle (the bytes the distribution APKs package).
//
// The journey-*.spec.ts files run the development profile: development agent, development device
// actions, development mailbox, development vault and development scheduler. None of those exist
// in this build. These tests state what the shipped renderer does instead, per loop:
//  - on Android (the Capacitor bridge is replaced by an in-page stub, as the other
//    *.production.spec.ts files do) with a funded Eliza Cloud account and the resident agent, and
//  - in the web build, signed out.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The stub is not the
// native plugins, the resident runtime, Eliza Cloud, Android Clock, a WebView or a device. A pass
// says the shipped renderer takes the real path or shows an honest unavailable state; it never
// says the native side of that path works. See docs/core-loop-audit.md.
import { test, expect, type Page } from '@playwright/test';
import {completeAccessSetup} from './flag-off-android';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const SELECTION = 'alpha.connection.selection.v1';
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const button = (page: Page, name: string) => name==='Inbox'
  ? page.getByRole('button', { name, exact: true }).and(page.locator('[data-mobile-shell-tile]'))
  : page.getByRole('button', { name, exact: true });
/** No mock, fixture or development surface, whatever the loop. */
async function expectNoDevelopmentSurface(page: Page) {
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
  await expect(button(page, 'Device controls')).toHaveCount(0);
  await expect(page.getByText(/Development (connections|device actions|reply|provider)/)).toHaveCount(0);
}
/** Aborts and records every request that leaves the preview server (test-owned hosts excepted). */
async function fenceNetwork(page: Page, allowed: string[] = []) {
  const foreign: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    // Closed public-imagery fixture: never allow a real external request or coordinate leak.
    if(route.request().method()==='GET'&&url.href==='https://tiles.openfreemap.org/styles/bright')return route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}});
    if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol) || allowed.includes(url.hostname)) return route.fallback();
    foreign.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  return foreign;
}

/** Production Android as the renderer sees it: funded Cloud account, packaged resident agent that
 * keeps its conversations across a page reload, an intercepted Clock handoff and a native browser
 * whose pages are synthetic (no WebView loads anything). `voice` adds the native recorder whose
 * Cloud transcription returns that text, retained note audio, native reminders and one writable
 * device calendar; `signedOut` starts with no Cloud sign-in. */
async function android(page: Page, options: { clock?: 'opened' | 'unavailable' | 'unknown'; voice?: string; signedOut?: boolean } = {}) {
  await page.addInitScript(installNativeNavigationFixture);
  await page.addInitScript(({ options }) => {
    const w = window as any; w.androidBridge = {};
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5', agentId = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
    const kept = (key: string, initial: unknown) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? initial; } catch { return initial; } };
    // Keystore-backed slots and the resident agent's own store both survive a reload of the page.
    const slots: Record<string, string> = kept('core-loops-slots', options.signedOut ? {} : { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 86_400_000 }) });
    // What the native side keeps across a reload: scheduled reminders and device calendar rows.
    const device: { reminders: any[]; events: any[] } = kept('core-loops-device', { reminders: [], events: [] });
    const agent: { conversations: { id: string; title: string }[]; history: Record<string, any[]> } = kept('core-loops-agent', { conversations: [], history: {} });
    const persist = () => { sessionStorage.setItem('core-loops-slots', JSON.stringify(slots)); sessionStorage.setItem('core-loops-agent', JSON.stringify(agent)); sessionStorage.setItem('core-loops-device', JSON.stringify(device)); };
    const f = w.coreLoops = { calls: [] as string[], posts: [] as string[], views: [] as string[], conversations: [] as string[], bodies: [] as string[], replies: [] as string[], streams: 0, cancelled: 0, aborts: 0, clock: [] as unknown[], hold: false, release: null as null | (() => void), unexpected: [] as string[],
      // AlphaBrowser: tabs the renderer created, with the address and navigation number each one
      // committed; `excerpt` is what reviewQuestion returns, and `questions` records its arguments.
      browser: { tabs: {} as Record<string, { session: string; url: string; navigation: number }>, sequence: 0, created: [] as string[], navigations: [] as string[], questions: [] as unknown[], excerpt: '', title: 'Harbour report' },
      // Commits a navigation of a tab, as WebView does after it loads a page (or the page navigates itself).
      commit: (tab: string, url: string) => {}, slots, device,
      // The native recorder and Cloud transcription, and every reminder or calendar write this page asked for.
      voice: { starts: 0, stops: 0, transcriptions: [] as any[], saved: [] as any[] }, writes: { reminders: [] as any[], events: [] as any[] } };
    const listeners: Array<{ plugin: string; event: string; callback: (value: unknown) => void }> = [];
    const emit = (streamId: string, event: unknown) => listeners.filter(l => l.plugin === 'Agent' && l.event === 'alphaAgentStream').forEach(l => l.callback({ streamId, event }));
    f.commit = (tab: string, url: string) => {
      const b = f.browser, row = b.tabs[tab]; row.url = url; row.navigation++;
      const state = { session: row.session, id: tab, sequence: ++b.sequence, url, title: b.title, loading: false, committed: true, error: '', navigation: row.navigation, canBack: row.navigation > 1, canForward: false, private: false };
      listeners.filter(l => l.plugin === 'AlphaBrowser' && l.event === 'stateChanged').forEach(l => l.callback(state));
    };
    const data = (streamId: string, value: unknown) => emit(streamId, { type: 'chunk', dataBase64: btoa('data: ' + JSON.stringify(value) + '\n\n') });
    let fixtureNavigation: any;
    const navigation=()=>fixtureNavigation??=(window as any).createNativeNavigationFixture(id,agentId,f);
    const request = (method: string, path: string, body: any, headers: Record<string, string>, owner?: unknown): { status: number; data: unknown } => {
      const ok = (value: unknown) => ({ status: 200, data: value });
      const navigationResult=navigation().request(method,path,body,headers,owner);if(navigationResult)return navigationResult;
      // Mounted canonical views probe these sources; this native fixture provides none.
      if (method === 'GET' && ['/api/notes/state', '/api/lifeops/calendar/feed', '/api/lifeops/calendar/calendars', '/api/lifeops/calendar/next-context'].includes(path.split('?')[0])) return { status: 503, data: { error: 'Canonical records unavailable in this fixture' } };
      if (path === '/api/auth/me') return ok({ identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Alpha', status: 'running' }] });
      if (path === '/api/client-devices/register') navigation().register(headers);
      if (path === '/api/client-devices/register') return ok({ installationId: headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
      if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
      if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
      if (path === '/api/conversations' && method === 'POST') { const row = { id: 'resident-chat-' + (agent.conversations.length + 1), title: String(body.title || 'Alpha Phone') }; agent.conversations.push(row); agent.history[row.id] = []; persist(); return ok({ conversation: row }); }
      if (path === '/api/conversations') return ok({ conversations: agent.conversations });
      const history = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path.split('?')[0]);
      if (history && method === 'GET') return ok({ messages: (agent.history[history[1]] || []).slice(-200) });
      if (/^\/api\/turns\/[^/]+\/abort$/.test(path)) { f.aborts++; return { status: 404, data: {} }; }
      f.unexpected.push(method + ' ' + path); return { status: 404, data: {} };
    };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const withListeners = (names: string[]) => [...promise(names), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }];
    w.Capacitor = {
      PluginHeaders: [
        { name: 'ElizaSystem', methods: promise(['getBuildInfo']) },
        { name: 'DailyApps', methods: withListeners(['surfaceInfo', 'clockHandoff', ...(options.voice ? ['listReminders', 'scheduleReminder', 'pendingReminderTap'] : [])]) },
        { name: 'Agent', methods: withListeners(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus', 'requestStream', 'cancelStream']) },
        { name: 'AlphaConnection', methods: promise(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
        { name: 'AlphaActionJournal', methods: promise(['list', 'get']) },
        { name: 'AlphaNotifications', methods: promise(['status', 'crossAppStatus']) },
        { name: 'AlphaVoiceCloud', methods: options.voice || options.signedOut ? withListeners(['checkPermissions', 'startRecording', 'stopRecording', 'getRecordingMetrics', 'cancelRecording', 'transcribeRecording', 'localSpeechStatus', 'transcribeLocalRecording', 'saveRecording', 'cancel', 'synthesize', 'play', 'stopPlayback']) : promise(['checkPermissions']) },
        ...(options.voice ? [{ name: 'AlphaNoteAudio', methods: promise(['play', 'stop', 'state', 'describe']) },
          { name: 'AlphaCalendar', methods: withListeners(['list', 'requestAccess', 'pendingCreations', 'listAlerts', 'save', 'acknowledgeCreation']) }] : []),
        { name: 'AlphaBrowser', methods: withListeners(['create', 'navigate', 'present', 'close', 'command', 'bookmarks', 'setBookmark', 'browsingState', 'saveBrowsingState', 'cancelReading', 'reviewQuestion']) },
      ],
      nativeCallback: (plugin: string, method: string, input: any, callback: (value: unknown) => void) => { if (method === 'addListener') listeners.push({ plugin, event: input?.eventName, callback }); return String(listeners.length); },
      nativePromise: async (plugin: string, method: string, input: any) => {
        f.calls.push(plugin + '.' + method);
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: true, version: 'core-loops' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') {
          const v = f.voice;
          if (method === 'checkPermissions') return { microphone: 'granted' };
          if (method === 'startRecording') { v.starts++; return { recordingId: 'recording-' + v.starts, maxDurationMs: 59000 }; }
          if (method === 'getRecordingMetrics') return { recordingId: input.recordingId, peak: 0.4, rms: 0.2 };
          if (method === 'stopRecording') { v.stops++; return { recordingId: 'recording-' + v.starts, durationMs: 3000 }; }
          // Eliza Cloud transcription, answered for the signed-in account only.
          if (method === 'transcribeRecording') { v.transcriptions.push(structuredClone(input)); if (input.environment !== 'production' || input.credentialId !== id) throw Error('Wrong synthetic Cloud account'); return { text: options.voice, local: false }; }
          // On-device speech (P-43): the native libelizainference voice host answers status and batch ASR.
          if (method === 'localSpeechStatus') return options.voice ? { ready: true, playback: true, execution: 'device', provider: 'fused-paradee-asr' } : { ready: false, playback: false, execution: 'device', provider: 'fused-paradee-asr' };
          if (method === 'transcribeLocalRecording') { v.transcriptions.push(structuredClone(input)); return { text: options.voice, local: true, execution: 'device', provider: 'fused-paradee-asr' }; }
          if (method === 'saveRecording') { const audio = { audioId: input.recordingId, noteId: input.noteId, durationMs: 3000, transcript: input.transcript }; v.saved.push(audio); return audio; }
          if (['cancelRecording', 'cancel', 'stopPlayback'].includes(method)) return {};
        }
        if (plugin === 'AlphaNoteAudio') {
          if (method === 'describe') return f.voice.saved.find((audio: any) => audio.audioId === input.audioId) ?? { audioId: input.audioId, noteId: '', durationMs: 3000, transcript: '' };
          if (method === 'state') return { playing: false, positionMs: 0 };
          return {};
        }
        if (plugin === 'AlphaCalendar') {
          // One writable device calendar; rows are what CalendarProvider holds after a save.
          if (method === 'requestAccess') return { status: 'granted' };
          if (method === 'list') return { status: 'ready', calendars: [{ id: '7', name: 'Personal', writable: true, account: 'owner@example.invalid', local: false }],
            events: device.events.filter((row: any) => row.end > input.begin && row.begin < input.end), truncated: false };
          if (method === 'pendingCreations') return { status: 'ready', creations: [] };
          if (method === 'listAlerts') return { items: [] };
          if (method === 'save') { f.writes.events.push(structuredClone(input)); const row = { id: String(100 + device.events.length), calendarId: input.calendarId, title: input.title, body: input.body, location: input.location, begin: input.begin, end: input.end, allDay: false, recurring: false }; device.events.push(row); persist(); return { status: 'saved', id: row.id, creationId: input.creationId }; }
          if (method === 'acknowledgeCreation') return { status: 'acknowledged' };
        }
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin === 'DailyApps') {
          if (method === 'surfaceInfo') return { developmentBuild: false, assistant: false, ...(options.voice ? { reminderTimingVersion: 2 } : {}) };
          if (method === 'listReminders') return { reminders: structuredClone(device.reminders) };
          if (method === 'pendingReminderTap') return {};
          // Android keeps the reminder and schedules its alert inexactly; one with no alert stays pending.
          if (method === 'scheduleReminder') {
            f.writes.reminders.push(structuredClone(input));
            const silent = input.alertMinutes === null, status = silent ? 'pending' : 'scheduled', mode = silent ? 'none' : 'inexact';
            device.reminders.push({ id: input.id, title: input.title, body: input.body ?? '', at: input.at, dueAt: input.dueAt, alertMinutes: input.alertMinutes, ...(input.recurrence ? { recurrence: input.recurrence } : {}), status, mode, occurrenceId: input.id + ':' + input.at, createdAt: Date.now() }); persist();
            return { status, id: input.id, mode };
          }
          f.clock.push(input);
          if (options.clock === 'unknown') return { action: input.action, status: 'unknown', message: 'Clock result is unknown. Check Clock before repeating the request.' };
          return options.clock === 'unavailable' ? { action: input.action, status: 'unavailable', message: 'No Clock app can handle this request.' }
            : { action: input.action, status: 'opened', message: 'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.' };
        }
        if (plugin === 'Agent') {
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'providerStatus') return { provider: 'elizacloud', configured: true, model: 'cerebras/qwen-3.8-27b' };
          if (method === 'request') { const result = request(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {}, input.ownerId); return { status: result.status, body: JSON.stringify(result.data) }; }
          if (method === 'cancelStream') { f.cancelled++; return {}; }
          if (method === 'requestStream') {
            // The resident agent records the user turn, then streams its reply over native IPC.
            const conversation = /^\/api\/conversations\/([^/]+)\/messages\/stream$/.exec(input.path)![1], body = JSON.parse(input.body), streamId = input.streamId as string;
            f.streams++; f.posts.push(String(body.text).split('[USER MESSAGE]\n').pop()); f.views.push(String(body.metadata?.clientDevice?.context?.view ?? '')); f.conversations.push(conversation); f.bodies.push(input.body);
            agent.history[conversation].push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() }); persist();
            const reply = f.replies.shift() ?? 'Resident reply ' + f.streams;
            const finish = () => {
              agent.history[conversation].push({ id: crypto.randomUUID(), role: 'assistant', text: reply, timestamp: Date.now() + 1 }); persist();
              data(streamId, { type: 'token', text: reply }); data(streamId, { type: 'done', fullText: reply, agentName: 'Alpha' }); emit(streamId, { type: 'complete' });
            };
            setTimeout(() => { emit(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } }); if (f.hold) f.release = finish; else finish(); }, 0);
            return { streamId };
          }
          return {};
        }
        if (plugin === 'AlphaBrowser') {
          const b = f.browser;
          if (method === 'bookmarks' || method === 'setBookmark') return { urls: [] };
          // Nothing saved: a cold start opens one new tab.
          if (method === 'browsingState') return { history: [], tabs: [] };
          if (['saveBrowsingState', 'present', 'cancelReading', 'close', 'command'].includes(method)) return {};
          if (method === 'create') { b.created.push(input.id); b.tabs[input.id] = { session: input.session, url: '', navigation: 0 }; return {}; }
          // Only a synthetic public page "loads"; the stub commits it after the call returns.
          if (method === 'navigate') { b.navigations.push(input.url); setTimeout(() => f.commit(input.id, input.url), 0); return {}; }
          if (method === 'reviewQuestion') { b.questions.push(structuredClone(input)); const tab = b.tabs[input.id]; if (!tab || tab.url !== input.url || tab.navigation !== input.navigation) throw Error('Page changed'); return { text: b.excerpt }; }
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: slots[input.slot] ?? null };
          if (method === 'secureWrite') { slots[input.slot] = input.value; persist(); return {}; }
          if (method === 'secureRemove') { delete slots[input.slot]; persist(); return {}; }
          if (method === 'secureCompareExchange') { if ((slots[input.slot] ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) delete slots[input.slot]; else slots[input.slot] = input.value; persist(); return { status: 'saved' }; }
          if (method === 'request') {
            const url = new URL(input.url);
            if (url.origin !== 'https://api.eliza.app') throw Error('Connection request failed');
            if (url.pathname === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
            if (url.pathname === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
            if (url.pathname === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
            return { status: 404, data: {} };
          }
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation ' + plugin + '.' + method);
      },
    };
  }, { options });
}
/** READ-ONLY: the web build's saved calendar document (the browser document store in IndexedDB). */
const storedEvents = (page: Page) => page.evaluate(async () => !(await indexedDB.databases()).some(row => row.name === 'alpha.browser.documents.v1') ? [] : new Promise<any[]>((resolve, reject) => {
  // Opened only once it exists: opening first would create it without the store's own upgrade.
  const open = indexedDB.open('alpha.browser.documents.v1');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('documents')) { db.close(); resolve([]); return; }
    const read = db.transaction('documents', 'readonly').objectStore('documents').get('alpha.browser.calendar.v1');
    // The record holds the domain envelope, whose value is the calendar document's own bytes.
    read.onsuccess = () => { db.close(); const value = read.result?.raw ? JSON.parse(read.result.raw).value : null; resolve(value ? JSON.parse(value).events : []); };
    read.onerror = () => { db.close(); reject(read.error); };
  };
}));
const native = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.coreLoops)`) as Promise<T>;
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
/** A funded resident account connects by itself; no Welcome dialog and no chooser remain. */
async function residentHome(page: Page) {
  await page.goto('/');
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await expect(button(page, 'Notes')).toBeVisible();
  await completeAccessSetup(page);
}

test('loop A on Android: the resident agent answers, the conversation follows across apps, Stop is honest and a restart restores it without any development control', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  // The signed-in account configures inference for the resident agent; Cloud is never the agent runtime.
  const startup = await native(page, f => f.calls.filter((call: string) => call.startsWith('Agent.')));
  expect(startup.indexOf('Agent.configureCloudProvider')).toBeGreaterThan(-1);
  expect(startup.indexOf('Agent.configureCloudProvider')).toBeLessThan(startup.indexOf('Agent.start'));
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual({ kind: 'resident' });
  await expectNoDevelopmentSurface(page);
  await expect(button(page, 'Talk')).toBeVisible();

  const ask = page.getByRole('textbox', { name: 'Ask Alpha', exact: true }), message = page.getByRole('textbox', { name: 'Message Alpha', exact: true });
  await ask.fill('Flag-off first request'); await ask.press('Enter');
  await expect(bubble(page, 'Flag-off first request')).toHaveCount(1);
  await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  expect(await native(page, f => f.posts)).toEqual(['Flag-off first request']);

  // The same conversation is open from Notes, Calendar and Browser, and a message sent from Notes
  // and one sent from Browser both join it.
  const shown = ['Flag-off first request', 'Resident reply 1'];
  for (const app of ['Notes', 'Calendar', 'Browser']) {
    await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    await button(page, app).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', app.toLowerCase());
    await button(page, 'Open conversation').click();
    for (const text of shown) await expect(bubble(page, text)).toHaveCount(1);
    if (app === 'Calendar') continue;
    const sent = `Flag-off ${app.toLowerCase()} request`;
    await message.fill(sent); await message.press('Enter');
    shown.push(sent, `Resident reply ${shown.length / 2 + 1}`);
    for (const text of shown) await expect(bubble(page, text)).toHaveCount(1);
  }
  // Opening Browser asked only for its saved bookmarks and tabs; no page was created or loaded.
  expect(await native(page, f => [f.browser.created, f.browser.navigations])).toEqual([[], []]);
  // Stop while the resident agent holds its reply: the stream is cancelled, the chat says the agent may
  // still finish, the text is not returned for a blind resend and nothing is posted again.
  await native(page, f => { f.hold = true; });
  await message.fill('Flag-off stopped request'); await message.press('Enter');
  await expect(bubble(page, 'Flag-off stopped request')).toHaveCount(1);
  const stop = button(page, 'Stop reply');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.locator('[data-alpha-layer="conversation"]').getByText('The agent may still finish this reply. Alpha Phone will check once and show it here if it does.', { exact: true })).toHaveCount(1);
  await expect(message).toHaveValue('');
  await expect.poll(() => native(page, f => f.cancelled)).toBeGreaterThan(0);
  expect(await native(page, f => f.posts)).toEqual(['Flag-off first request', 'Flag-off notes request', 'Flag-off browser request', 'Flag-off stopped request']);
  // The resident agent finishes anyway; the one automatic check shows its reply exactly once.
  await native(page, f => { f.hold = false; f.release(); });
  await expect(bubble(page, 'Resident reply 4')).toHaveCount(1, { timeout: 60_000 });
  await expect(bubble(page, 'Flag-off stopped request')).toHaveCount(1);
  expect(await native(page, f => f.streams)).toBe(4);
  // Each request carried the screen it was sent from as its current-turn context, and every one
  // went to the same resident conversation.
  expect(await native(page, f => f.views)).toEqual(['home', 'notes', 'browser', 'browser']);
  const conversations = await native(page, f => f.conversations) as string[];
  expect(conversations).toHaveLength(4);
  expect(new Set(conversations).size).toBe(1);

  // Restart: the saved conversation comes back by itself. There is no "Load conversations" step here.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await button(page, 'Open conversation').click();
  for (const text of [...shown, 'Flag-off stopped request', 'Resident reply 4']) await expect(bubble(page, text)).toHaveCount(1, { timeout: 30_000 });
  // Restoring reads history; it posts nothing.
  expect(await native(page, f => f.streams)).toBe(0);
  // The connection names the agent and where it runs, and no credential is rendered anywhere.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Settings').click();
  await expect(page.getByRole('button', { name: 'Agent connection', exact: true })).toContainText('Alpha');
  await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  const account = page.getByRole('region', { name: 'Settings',exact:true });
  await expect(account).toContainText('Running on this device');
  await expect(account.getByText('Eliza Cloud',{exact:true})).toBeVisible();
  await account.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await page.getByRole('button',{name:'Eliza Cloud account & plan',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out of Eliza Cloud',exact:true})).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('synthetic-cloud-key');
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

for (const outcome of ['opened', 'unavailable'] as const) {
  test(`loop C on Android: a reviewed alarm is one Clock handoff and never a saved alarm (${outcome})`, async ({ page }) => {
    test.setTimeout(120_000);
    await android(page, { clock: outcome });
    await residentHome(page);
    await button(page, 'Calendar').click();
    await button(page, 'Clock alarms').click();
    const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
    await expect(clock).toContainText('Alarms are managed by your installed Clock app. Check the result there after every request.');
    // The browser build's own alarm list (Saved alarms, Save alarm, Ringing) does not exist on Android.
    await expect(clock.getByText('Saved alarms', { exact: true })).toHaveCount(0);
    await expect(clock.getByRole('button', { name: 'Save alarm', exact: true })).toHaveCount(0);
    await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
    await clock.getByRole('textbox', { name: 'Alarm label' }).fill('Flag-off alarm');
    await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
    await expect(clock).toContainText('Ask Clock to set an alarm at 07:15 named “Flag-off alarm”, using the phone’s local time. Review the alarm in Clock.');
    // Review alone sends nothing.
    expect(await native(page, f => f.clock)).toEqual([]);
    const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });
    await expect(confirm).toHaveText('Continue to Clock');
    await confirm.click();
    await expect(clock).toContainText(outcome === 'opened' ? 'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.' : 'No Clock app can handle this request.');
    const sent = await native(page, f => f.clock) as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'set', hour: 7, minute: 15, label: 'Flag-off alarm', reviewed: true });
    await expect(clock).not.toContainText(/Alarm saved|will ring|Ringing/);
    await expectNoDevelopmentSurface(page);
  });
}

// Journey hardening (docs/core-loop-audit.md, work order 14): snooze and dismiss on the Android path.
test('loop C on Android: snooze and dismiss are reviewed Clock requests, one handoff each, and neither claims an alarm changed', async ({ page }) => {
  test.setTimeout(120_000);
  await android(page, { clock: 'opened' });
  await residentHome(page);
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });

  await clock.getByRole('button', { name: 'Snooze', exact: true }).click();
  // The alarm time and label belong to Set; a snooze request carries only the minutes asked for.
  await expect(clock.getByLabel('Alarm time', { exact: true })).toHaveCount(0);
  await clock.getByLabel('Snooze minutes', { exact: true }).fill('7');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to snooze ringing alarms, requesting 7 minutes. Clock may use its default duration and snooze all ringing alarms. If nothing is ringing, Clock may do nothing.');
  expect(await native(page, f => f.clock)).toEqual([]);
  await confirm.dblclick();
  await expect(clock).toContainText('Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.');
  expect(await native(page, f => f.clock)).toEqual([{ action: 'snooze', snoozeMinutes: 7, reviewed: true }]);

  await clock.getByRole('button', { name: 'Dismiss', exact: true }).click();
  // Choosing another action withdraws the earlier review; nothing is sent by choosing.
  await expect(confirm).toHaveCount(0);
  await expect(clock.getByLabel('Snooze minutes', { exact: true })).toHaveCount(0);
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to dismiss the active alarm. If there is more than one, Clock may ask you to choose. A one-time alarm is disabled; a repeated alarm skips its upcoming occurrence.');
  expect(await native(page, f => f.clock.length)).toBe(1);
  await confirm.click();
  await expect.poll(() => native(page, f => f.clock.length)).toBe(2);
  expect(await native(page, f => f.clock)).toEqual([{ action: 'snooze', snoozeMinutes: 7, reviewed: true }, { action: 'dismiss', reviewed: true }]);
  await expect(clock).toContainText('Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.');
  await expect(clock).not.toContainText(/Alarm saved|snoozed for|was dismissed|Ringing/i);
  await expectNoDevelopmentSurface(page);
});

test('loop C on Android: a cancelled review sends nothing, and an unknown result is remembered across a restart before any repeat', async ({ page }) => {
  test.setTimeout(120_000);
  await android(page, { clock: 'unknown' });
  await residentHome(page);
  const openClock = async () => { await button(page, 'Calendar').click(); await button(page, 'Clock alarms').click(); return page.getByRole('dialog', { name: 'Clock alarms', exact: true }); };
  let clock = await openClock();
  await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await clock.getByRole('button', { name: 'Cancel Clock review', exact: true }).click();
  await expect(clock.getByRole('button', { name: 'Confirm Clock request', exact: true })).toHaveCount(0);
  expect(await native(page, f => f.clock)).toEqual([]);
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await clock.getByRole('button', { name: 'Confirm Clock request', exact: true }).click();
  await expect(clock).toContainText('Clock result is unknown. Check Clock before repeating the request.');
  expect(await native(page, f => f.clock.length)).toBe(1);
  // Restart: the unknown outcome is still stated before another request can be reviewed, and nothing is replayed.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  clock = await openClock();
  await expect(clock).toContainText('Previous Clock result is unknown. Check Clock before repeating a request.');
  expect(await native(page, f => f.clock)).toEqual([]);
});

test('loop C on Android: a phone time zone that changes after review retires the request before anything is sent', async ({ page, context }) => {
  test.setTimeout(120_000);
  await android(page);
  await residentHome(page);
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });
  await expect(confirm).toBeVisible();
  // The phone moves to another zone between review and confirmation (browser time zone override).
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await (await context.newCDPSession(page)).send('Emulation.setTimezoneOverride', { timezoneId: before === 'Asia/Tokyo' ? 'Europe/Paris' : 'Asia/Tokyo' });
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).not.toBe(before);
  await confirm.click();
  await expect(clock).toContainText('Phone time zone changed. Review the Clock request again.');
  await expect(confirm).toHaveCount(0);
  expect(await native(page, f => f.clock)).toEqual([]);
});

test('loops B, C and J04 in the web build: Agent Calendar requires a connection, local alarms persist, and Maps waits for a location', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Calendar').click();
  await expect(page.getByRole('region', {name: 'Calendar', exact: true})).toContainText('Connect to view Agent Calendar.');
  await button(page, 'New event').click();
  await expect(page.getByRole('textbox', {name: 'Title', exact: true})).toHaveCount(0);
  await expect(button(page, 'Save event')).toHaveCount(0);
  expect(await storedEvents(page)).toEqual([]);
  // An unavailable Agent Calendar must not silently create a local event.
  await page.goto('/');
  await button(page, 'Maps').click();
  await expect(page.getByRole('region', {name: 'Map', exact: true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Add a location');
  await expect(button(page, 'Directions')).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Maps'})).not.toContainText(/\d+ min|\d km/);
  // The independent browser alarm list remains a durable local feature.
  await page.goto('/');
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  let clock = page.getByRole('dialog', {name: 'Clock alarms', exact: true});
  await clock.getByRole('textbox', {name: 'Alarm label'}).fill('Flag-off web alarm');
  await clock.getByLabel('Alarm time', {exact: true}).fill('07:15');
  await clock.getByRole('button', {name: 'Save alarm', exact: true}).click();
  await expect(clock.getByText('Flag-off web alarm', {exact: true})).toHaveCount(1);
  await page.reload();
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  clock = page.getByRole('dialog', {name: 'Clock alarms', exact: true});
  await expect(clock.getByText('Flag-off web alarm', {exact: true})).toHaveCount(1);
  expect(await storedEvents(page)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loops D and F in the web build: digests and mail name the missing account instead of offering development schedules or a local mailbox', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  const digests = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  await expect(digests).toContainText('Choose where your agent runs to set up scheduled digests.');
  await expect(digests).toContainText('Your agent runs on your phone, not here. Open Alpha on your Android phone to use it.');
  await expect(digests).not.toContainText(/remote agent/i);
  // None of the development scheduler exists: no snapshot, no schedule review, no "runs while open".
  await expect(digests.getByText('Share a snapshot', { exact: true })).toHaveCount(0);
  await expect(digests.getByRole('button', { name: /^Review (morning|evening) schedule$/ })).toHaveCount(0);
  await expect(digests.getByText(/Schedules run while this app is open/)).toHaveCount(0);
  await expect(digests.getByRole('article')).toHaveCount(0);
  await button(page, 'Close scheduled digests').click();
  await page.goto('/');
  await button(page, 'Inbox').click();
  await expect(page.locator('[data-screen]')).toContainText('Connect Eliza Cloud to use Gmail');
  // No development mailbox: no fixture message, and Compose does not open a local "Sent locally" path.
  await expect(page.getByText('Dinner Friday?', { exact: true })).toHaveCount(0);
  await expect(button(page, 'Compose')).toBeDisabled();
  await expect(page.getByRole('textbox', {name: 'To', exact: true})).toHaveCount(0);
  await expect(button(page, 'Send email')).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loops E and J05 in the web build: page content requires review and no development vault is offered', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page, ['public-fixture.test']);
  const url = 'https://public-fixture.test/harbour';
  await page.route('https://public-fixture.test/**', route => route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<article><h1>Harbour report</h1><p>The ferry leaves at nine from pier four.</p></article>' }));
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Browser').click();
  await page.getByRole('button', { name: 'Search or type address' }).first().click();
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(url);
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter');
  await expect(page.locator('iframe[title="Website"]:visible').contentFrame().getByRole('heading', { name: 'Harbour report', exact: true })).toBeVisible();
  // The web build cannot verify TLS for the framed page and does not claim it.
  await expect(page.getByRole('img', { name: 'Secure connection', exact: true })).toHaveCount(0);
  await button(page, 'Menu').click();
  // A committed web page offers an explicit review of a separately fetched copy;
  // the frame itself is never certified as TLS or silently added to agent context.
  await expect(button(page, 'Share')).toHaveCount(0);
  await button(page, 'Ask about page').click();
  const review = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue(/The ferry leaves at nine from pier four/);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.goto('/');
  await button(page, 'Settings').click();
  await button(page, 'Password manager').click();
  const settings = page.locator('[data-settings-page]:not([inert])').last();
  await expect(settings).toContainText(/Saved passwords\s*Available in the Android app/);
  await expect(settings).toContainText('Native provider status is unavailable here');
  for (const name of ['Add development provider', 'Open development vault', 'Unlock passwords', 'Choose password provider']) await expect(button(page, name)).toHaveCount(0);
  await expect(page.getByText(/demo-only-password|Example sign-in/)).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loop J01 in the web build: a scanned event remains in review without an authorized Calendar source', async ({ page }) => {
  test.setTimeout(300_000);
  const foreign = await fenceNetwork(page);
  await page.clock.setFixedTime(new Date('2026-10-09T15:00:00Z'));
  await page.addInitScript(offline);
  await page.addInitScript(() => {
    // Synthetic camera: a canvas stream drawing the poster. Capture, local OCR and review are the shipped code.
    const mediaDevices = navigator.mediaDevices; Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    mediaDevices.getUserMedia = async () => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700; const c = canvas.getContext('2d')!; const draw = () => { c.fillStyle = 'white'; c.fillRect(0, 0, 1000, 700); c.fillStyle = 'black'; c.font = '58px Arial'; c.fillText('Open studio', 60, 140); c.fillText('October 10, 2026', 60, 260); c.fillText('Time: 6:30 PM - 8:00 PM', 60, 380); c.fillText('Venue: Main hall', 60, 500); }; draw(); const stream = canvas.captureStream(10); const timer = setInterval(draw, 100); stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream; };
  });
  await page.goto('/');
  await button(page, 'Camera').click();
  const video = page.locator('[aria-label^="Viewfinder."] video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await button(page, 'Scan mode').click();
  await button(page, 'Scan text').click();
  const dialog = page.getByRole('dialog', { name: 'Review scanned text' }), text = dialog.getByRole('textbox', { name: 'Scanned text' });
  await expect(text).toBeEnabled({ timeout: 120_000 });
  await expect(text).toHaveValue(/October 10, 2026/);
  // The suggestions come from the local OCR result as recognized; the text is not corrected first.
  const recognized = await text.inputValue();
  await dialog.locator('summary').filter({ hasText: 'Create event draft' }).click();
  await expect(dialog.getByLabel('Event title', { exact: true })).toHaveValue('Open studio');
  await expect(dialog.getByLabel('Event date', { exact: true })).toHaveValue('2026-10-10');
  await expect(dialog.getByLabel('Event start time', { exact: true })).toHaveValue('18:30');
  await expect(dialog.getByLabel('Event location', { exact: true })).toHaveValue('Main hall');
  await dialog.getByLabel('Event title', { exact: true }).fill('Reviewed studio visit');
  await dialog.getByRole('button', { name: 'Review in Calendar', exact: true }).click();
  // No agent Calendar source exists in this web session. Keep both the OCR
  // text and the user's edited fields instead of opening an unusable form.
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Calendar could not open. Your draft remains here.');
  await expect(text).toHaveValue(recognized);
  await expect(dialog.getByLabel('Event title', { exact: true })).toHaveValue('Reviewed studio visit');
  await expect(button(page, 'Save event')).toHaveCount(0);
  expect(await storedEvents(page)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  // Capture and OCR are local: nothing left the preview server.
  expect(foreign).toEqual([]);
});

test('loop J03 in the web build: a chosen document can be reviewed for a question, and with no agent nothing is sent or saved', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Files').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Documents').click();
  await (await chooser).setFiles({ name: 'garden-report.txt', mimeType: 'text/plain', buffer: Buffer.from('Public fact: twelve raised beds.') });
  await button(page, 'Ask Alpha').click();
  const question = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(question.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue('Public fact: twelve raised beds.');
  await question.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await button(page, 'Send').click();
  await expect(page.locator('.alpha-connection').getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  // The refused send gets its text back with no line under the composer (owner, 2026-11-03).
  await expect.poll(() => page.locator('textarea[data-alpha-composer]').evaluateAll(fields => fields.some(field => (field as HTMLTextAreaElement).value.includes('Public fact: twelve raised beds.')))).toBe(true);
  await expect(page.getByRole('status', { name: 'Assistant draft status' })).toHaveCount(0);
  await expect(page.getByText('Your message is back in the composer')).toHaveCount(0);
  await expect(page.getByText('Review summary note', { exact: true })).toHaveCount(0);
  await page.locator('.alpha-connection').getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await page.goto('/');
  await button(page, 'Notes').click();
  await expect(page.locator('[data-screen]')).toContainText('Notes is unavailable for this agent connection. Check Settings › Agent connection.');
  await expect(button(page, 'New note')).toHaveCount(0);
  await expect(page.getByRole('textbox', {name:'Note', exact:true})).toHaveCount(0);
  // The development Inbox simulator that feeds journey J03 does not exist here.
  await expect(button(page, 'Incoming email')).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

const HARBOUR = 'https://public-fixture.test/harbour';
/** Opens Browser on the stubbed native browser and loads the synthetic public page. */
async function openHarbour(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Browser').click();
  await page.getByRole('button', { name: 'Search or type address' }).first().click();
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(HARBOUR);
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter');
  // The committed HTTPS page is reported by the native browser, which alone can claim TLS.
  await expect(page.getByRole('img', { name: 'Secure connection', exact: true })).toBeVisible();
  const tab = await native(page, f => f.browser.created.at(-1)) as string;
  expect(await native(page, f => f.browser.navigations)).toEqual([HARBOUR]);
  return tab;
}
async function askAboutHarbour(page: Page) {
  await button(page, 'Menu').click();
  await button(page, 'Ask about page').click();
}
/** The notes saved in the Keystore-backed Notes slot of the stub (its envelope holds the collection's bytes). */
const savedNotes = (page: Page) => native(page, f => { const slot = f.slots['notes-records:v1:device']; return slot ? JSON.parse(JSON.parse(slot).currentRaw).records : []; }) as Promise<any[]>;

/** The attachment-summary path uses explicitly selected retained device notes. */
async function openRetainedNativeNotes(page:Page){
 await native(page,f=>{
  const key='notes-records:v1:device';
  if(!f.slots[key])f.slots[key]=JSON.stringify({version:1,archive:{v1:null,v2:null,daily:null},currentRaw:JSON.stringify({version:2,collectionId:crypto.randomUUID(),records:[],deleted:[]})});
 });
 await selectLegacyNotes(page);
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();
 await expect(page.getByText('Note text encrypted on this device',{exact:true})).toBeVisible();
}

test('loop J05 on Android: a reviewed native page excerpt, a resident answer and an explicit Save leave one web-linked note', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  await openRetainedNativeNotes(page);
  const tab = await openHarbour(page);
  await native(page, f => { f.browser.excerpt = 'The ferry leaves at nine from pier four.\nOMIT THIS: internal planning detail.'; f.replies.push('The ferry leaves at nine.'); });
  await askAboutHarbour(page);
  const review = page.getByRole('dialog', { name: 'Ask about selected content' });
  const excerpt = review.getByRole('textbox', { name: 'Content excerpt' });
  await expect(excerpt).toHaveValue(/OMIT THIS/);
  // The native reviewed read is bound to the session, the tab and the exact committed navigation.
  const session = (await native(page, f => f.browser.tabs[f.browser.created.at(-1)].session)) as string;
  expect(await native(page, f => f.browser.questions)).toEqual([{ session, id: tab, url: HARBOUR, navigation: 1 }]);
  await excerpt.fill('The ferry leaves at nine from pier four.');
  await review.getByRole('textbox', { name: 'Question about content' }).fill('When does the ferry leave?');
  await review.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await expect(review).toHaveCount(0);
  // Composed only: nothing reaches the agent before Send.
  expect(await native(page, f => f.streams)).toBe(0);
  await button(page, 'Send').click();
  await expect(bubble(page, 'The ferry leaves at nine.')).toHaveCount(1);
  // Exactly one turn, carrying the question, the page it came from and only the reviewed excerpt.
  expect(await native(page, f => f.posts)).toEqual(['When does the ferry leave?\n\nSource: Harbour report\n\nThe ferry leaves at nine from pier four.']);
  expect(await native(page, f => f.bodies.join('\n'))).not.toContain('OMIT THIS');
  // An answer alone saves nothing.
  expect(await savedNotes(page)).toEqual([]);
  const card = page.getByRole('button', { name: /^Review summary note/ });
  await expect(card).toHaveCount(1);
  await card.click();
  const summary = page.getByRole('dialog', { name: 'Save reviewed summary note' });
  await expect(summary).toContainText('The note will link to Harbour report.');
  await expect(summary.getByRole('textbox', { name: 'Summary note text' })).toHaveValue('The ferry leaves at nine.');
  await summary.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(summary).toHaveCount(0);
  expect(await savedNotes(page)).toEqual([]);
  await card.click();
  await summary.getByRole('textbox', { name: 'Summary note title' }).fill('Harbour summary');
  await summary.getByRole('button', { name: 'Save reviewed note', exact: true }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Summary note saved/ })).toHaveCount(1);
  await expect(card).toHaveCount(0);
  const saved = await savedNotes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ title: 'Harbour summary', body: 'The ferry leaves at nine.', webSource: { kind: 'web-page', version: 1, url: HARBOUR } });
  expect(JSON.stringify(saved)).not.toContain('OMIT THIS');

  // After a restart the note is still the only one and reopens with its web source.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await openRetainedNativeNotes(page);
  await expect(page.getByRole('region', { name: 'Notes' }).getByRole('button', { name: /^Open (?!Trash$)/ })).toHaveCount(1);
  await button(page, 'Open Harbour summary').click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('The ferry leaves at nine.');
  await button(page, 'Web source linked').click();
  await expect(page.getByRole('dialog', { name: 'Note web source' })).toContainText(HARBOUR);
  expect(await native(page, f => f.streams)).toBe(0);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

// An unusable excerpt (too long or empty) is not a refusal: the review opens with an empty excerpt and
// Continue disabled until the user pastes, as the web CORS-denied path does (J05-5). Nothing is sent.
for (const [name, text] of [['too long', 'Harbour '.repeat(626)], ['empty', '  ']] as const) {
  test(`loop J05 on Android: a native page excerpt that is ${name} opens the review empty, with nothing sent`, async ({ page }) => {
    test.setTimeout(120_000);
    const foreign = await fenceNetwork(page);
    await android(page);
    await residentHome(page);
    await openHarbour(page);
    await page.evaluate(value => { (window as any).coreLoops.browser.excerpt = value; }, text);
    await askAboutHarbour(page);
    const review = page.getByRole('dialog', { name: 'Ask about selected content' });
    await expect(review).toBeVisible();
    await expect(review.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue('');
    await expect(review.getByRole('button', { name: 'Use in conversation', exact: true })).toBeDisabled();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(await native(page, f => f.browser.questions.length)).toBe(1);
    expect(await native(page, f => f.streams)).toBe(0);
    await expectNoDevelopmentSurface(page);
    expect(await native(page, f => f.unexpected)).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

test('loop J05 on Android: a native page excerpt that looks like credentials is refused before any review opens', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  await openHarbour(page);
  await page.evaluate(() => { (window as any).coreLoops.browser.excerpt = 'Enter the verification code 123456 to continue.'; });
  await askAboutHarbour(page);
  await expect(page.locator('[data-alpha-toast]')).toContainText('This page may contain credentials or verification codes. Open a different page.');
  await expect(page.getByRole('dialog', { name: 'Ask about selected content' })).toHaveCount(0);
  expect(await native(page, f => f.browser.questions.length)).toBe(1);
  expect(await native(page, f => f.streams)).toBe(0);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('loop J05 on Android: a page navigation closes the open review, and an agent reconnect before Save refuses the summary', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  const tab = await openHarbour(page);
  await native(page, f => { f.browser.excerpt = 'The ferry leaves at nine from pier four.'; });
  await askAboutHarbour(page);
  const review = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(review).toBeVisible();
  // The page navigates itself while the excerpt is under review: the review closes with nothing composed.
  await page.evaluate(id => (window as any).coreLoops.commit(id, 'https://public-fixture.test/timetable'), tab);
  await expect(review).toHaveCount(0);
  expect(await native(page, f => f.streams)).toBe(0);

  // Asked again on the new page, sent and answered.
  await native(page, f => { f.replies.push('The ferry leaves at nine.'); });
  await askAboutHarbour(page);
  await expect.poll(() => native(page, f => f.browser.questions.length)).toBe(2);
  expect(await native(page, f => f.browser.questions[1])).toMatchObject({ url: 'https://public-fixture.test/timetable', navigation: 2 });
  await review.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await button(page, 'Send').click();
  await expect(bubble(page, 'The ferry leaves at nine.')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Review summary note/ })).toHaveCount(1);
  // The resident agent is reconnected (a new verified session) before the answer is saved.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Settings').click();
  await button(page, 'Agent connection').click();
  const account = page.getByRole('region', { name: 'Settings',exact:true });
  await account.getByRole('button', { name: 'Reconnect agent', exact: true }).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  expect(await native(page, f => f.calls.filter((call: string) => call === 'Agent.start').length)).toBe(2);
  await button(page, 'Open conversation').click();
  const card = page.getByRole('button', { name: /^Review summary note/ });
  // The restored conversation keeps the answer, but the review bound to the previous session is
  // withdrawn: there is nothing left to save under the new one.
  await expect(bubble(page, 'The ferry leaves at nine.')).toHaveCount(1, { timeout: 30_000 });
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Summary note saved/ })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Save reviewed summary note' })).toHaveCount(0);
  expect(await savedNotes(page)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

const TRANSCRIPT = 'Meeting: we agreed to book the venue for Friday and email the caterer.';
const SUMMARY = 'The team agreed to book the venue.';
const ACTIONS = 'Book the venue\nEmail the caterer';

async function openAndroidCalendar(page:Page){
 await selectCalendarSource(page, 'Android calendars');
}

test('loop B / J02 on Android: a recorded note, a resident summary and reviewed hand-offs save one reminder and one device event, each only on Save', async ({ page }) => {
  test.setTimeout(240_000);
  // Tomorrow crosses the week boundary; the saved day must be reachable after reload.
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  const foreign = await fenceNetwork(page);
  await android(page, { voice: TRANSCRIPT });
  await residentHome(page);
  const writes = () => native(page, f => ({ reminders: f.writes.reminders.length, events: f.writes.events.length }));

  // 1. Record with the native recorder, transcribe on the phone (on-device voice host), review and save the note.
  await openAndroidCalendar(page);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await openRetainedNativeNotes(page);
  await button(page, 'Record and transcribe').click();
  await button(page, 'Start recording').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await button(page, 'Stop recording').click();
  await button(page, 'Transcribe on this phone').click();
  await expect(page.getByRole('textbox', { name: 'Review transcript', exact: true })).toHaveValue(TRANSCRIPT);
  // One on-device transcription of this recording, no Cloud upload; nothing is saved before Save note.
  expect(await native(page, f => f.voice.transcriptions.map((row: any) => row.recordingId))).toEqual(['recording-1']);
  expect(await native(page, f => f.calls.filter((call: string) => call === 'AlphaVoiceCloud.transcribeRecording'))).toEqual([]);
  expect(await savedNotes(page)).toEqual([]);
  await button(page, 'Save note').click();
  await expect(button(page, 'Play recording')).toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Venue meeting');
  await expect.poll(async () => (await savedNotes(page)).filter(n => n.kind === 'voice' && n.title === 'Venue meeting' && n.body === TRANSCRIPT && !!n.audio?.audioId).length).toBe(1);
  const recorded = (await savedNotes(page))[0];

  // 2. Review the transcript with the resident agent; its answer is a summary and action items.
  await page.evaluate(reply => { (window as any).coreLoops.replies = [reply]; }, JSON.stringify({ summary: SUMMARY, actions: ACTIONS.split('\n') }));
  await button(page, 'Review transcript with Alpha').click();
  const question = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(question.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue(TRANSCRIPT);
  await question.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await button(page, 'Send').click();
  const card = page.getByRole('button', { name: /^Review summary note/ });
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  expect(await native(page, f => f.posts.length)).toBe(1);
  expect(await native(page, f => f.posts[0])).toContain(TRANSCRIPT);
  await card.click();
  const summary = page.getByRole('dialog', { name: 'Save reviewed summary note' });
  await expect(summary.getByRole('textbox', { name: 'Summary note text' })).toHaveValue(SUMMARY);
  await expect(summary.getByRole('textbox', { name: 'Action items, one per line' })).toHaveValue(ACTIONS);
  expect((await savedNotes(page))[0]).toEqual(recorded);
  await summary.getByRole('button', { name: 'Save recording summary', exact: true }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Recording summary saved/ })).toHaveCount(1);
  expect((await savedNotes(page))[0]).toMatchObject({ id: recorded.id, audio: recorded.audio, body: TRANSCRIPT, summary: [SUMMARY], actions: [{ t: 'Book the venue', done: false }, { t: 'Email the caterer', done: false }] });
  // Saving the summary schedules nothing.
  expect(await writes()).toEqual({ reminders: 0, events: 0 });

  // 3. Reminder draft from the note: reviewed in Calendar, written once on Save.
  await button(page, 'Minimize chat').click();
  await button(page, 'Review reminder draft').click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(ACTIONS);
  expect(await writes()).toEqual({ reminders: 0, events: 0 });
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Book the venue');
  await button(page, 'Save event').click();
  await expect.poll(writes).toEqual({ reminders: 1, events: 0 });
  const reminder = (await native(page, f => f.writes.reminders))[0];
  expect(reminder).toMatchObject({ title: 'Book the venue', body: ACTIONS });
  await page.getByRole('button', { name: /^Book the venue,/ }).click();
  await expect(page.getByText('From note: Venue meeting', { exact: true })).toBeVisible();

  // 4. Calendar event draft from the note: written once to the device calendar on Save.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Notes').click();
  await button(page, 'Open Venue meeting').click();
  await button(page, 'Review calendar event draft').click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(ACTIONS);
  expect(await writes()).toEqual({ reminders: 1, events: 0 });
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Venue walkthrough');
  await button(page, 'Save event').click();
  await expect(page.getByRole('heading', { name: 'Venue walkthrough', level: 1 })).toBeVisible();
  await expect.poll(writes).toEqual({ reminders: 1, events: 1 });
  const event = (await native(page, f => f.writes.events))[0];
  // The note draft targets the phone's own local calendar (form calendar 'native:local').
  expect(event).toMatchObject({ calendarId: 'local', title: 'Venue walkthrough', body: ACTIONS, begin: reminder.dueAt, end: reminder.dueAt + 3_600_000 });
  // The event's review shows no note link before the reload below.
  await expect(page.getByText(/From note/)).toHaveCount(0);

  // 5. Reload once: both records are still there, exactly once, and nothing is written again.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  // Reopen the retained Notes source before resolving its saved backlinks.
  await openRetainedNativeNotes(page);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  // Device records are reviewed through the explicit Android source; Home uses Agent Calendar.
  await openAndroidCalendar(page);
  const savedDate=await page.evaluate(timestamp=>{const date=new Date(timestamp);return date.toLocaleDateString('en-US',{weekday:'long'})+' '+date.toLocaleDateString('en-US',{month:'long'})+' '+date.getDate();},reminder.dueAt);
  await button(page,'Month view').click();
  await page.getByRole('dialog',{name:'Choose calendar date',exact:true}).getByRole('button',{name:savedDate,exact:true}).click();
  await expect(page.getByRole('button', { name: /^Book the venue,/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Venue walkthrough,/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^Book the venue,/ }).click();
  await expect(page.getByText('From note: Venue meeting', { exact: true })).toBeVisible();
  expect(await writes()).toEqual({ reminders: 0, events: 0 });
  expect(await native(page, f => [f.device.reminders.length, f.device.events.length])).toEqual([1, 1]);
  // Both saved records link back to the note: the reminder by its id, the device event by the creation
  // id the upstream calendar plugin returns for events the host created (elizaOS/eliza#35912).
  const links = Object.keys(await native(page, f => JSON.parse(f.slots['note-origins:v1:device']).links));
  expect(links).toHaveLength(2);
  expect(links).toContain('reminder:' + reminder.id);
  expect(links.filter(key => /^event:[0-9a-f-]{36}$/.test(key))).toHaveLength(1);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('loop B / J02 on Android signed out: the Eliza Cloud sign-in comes first and nothing is captured', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await android(page, { signedOut: true });
  await page.goto('/');
  // P-43 with #410: the resident starts signed out and the sign-in dialog, which every Alpha Phone
  // needs, opens by itself and cannot be dismissed; no "without AI" choice is offered.
  const dialog = page.getByRole('main', { name: 'Welcome to Alpha.', exact: true });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: 'Email', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText('Eliza Cloud sign-in is unavailable right now. Try again.');
  await expect(dialog.getByRole('button', { name: 'Close connection settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use local apps without AI', exact: true })).toHaveCount(0);
  await expect(button(page, 'Start recording')).toHaveCount(0);
  expect(await native(page, f => [f.voice.starts, f.voice.transcriptions.length])).toEqual([0, 0]);
  expect(await native(page, f => f.calls.filter((call: string) => call.startsWith('AlphaVoiceCloud.') && call !== 'AlphaVoiceCloud.checkPermissions'))).toEqual([]);
  expect(await savedNotes(page)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('loops D and F on Android: schedules are stated as phone-bound, and mail without a Gmail grant asks for one instead of showing a mailbox', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  const digests = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  // The resident agent schedules on the phone and the panel says what that cannot do (decision A-09 is open).
  await expect(digests).toContainText('Your agent runs schedules on this phone. It cannot run while the phone is off.');
  await expect(digests).toContainText('one is recorded below as missed and none is run later');
  await expect(digests.getByText(/Schedules run while this app is open/)).toHaveCount(0);
  // This stub has no result store: the panel reports that instead of showing results.
  await expect(digests).toContainText('Result storage could not be connected. Reconnect the agent to try again.');
  await expect(digests.getByRole('article')).toHaveCount(0);
  await button(page, 'Close scheduled digests').click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Inbox').click();
  // Signed in to Cloud but with no Gmail grant (the account list is refused): no messages, an explicit connect.
  await expect(page.locator('[data-screen]')).toContainText('Gmail access was revoked or needs authorization again. Reconnect Gmail, then retry.');
  await expect(button(page, 'Reconnect Gmail')).toHaveCount(1);
  await expect(button(page, 'Reconnect Gmail')).toBeVisible();
  await expect(button(page, 'Connect Gmail')).toHaveCount(0);
  await expect(page.getByText('Dinner Friday?', { exact: true })).toHaveCount(0);
  await button(page, 'Reconnect Gmail').click();
  const google = page.getByRole('dialog', { name: 'Google accounts', exact: true });
  await expect(google).toBeVisible();
  await google.getByRole('button', { name: 'Close Google accounts', exact: true }).click();
  await expect(google).toHaveCount(0);
  await expect(button(page, 'Reconnect Gmail')).toBeVisible();
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
