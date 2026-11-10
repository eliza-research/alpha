/** Rendered production adapters; synthetic media/transport boundary, no native or model proof. */
import assert from 'node:assert/strict';
import type { ContextEnvelope } from '../apps/app/src/runtime/alpha-client.ts';
import type { phoneContextMessage } from '../apps/app/src/runtime/phone-context.ts';
import { playwright } from './fixtures/playwright.ts';

declare global {
 interface Window {
  fixture: { requests: ReturnType<typeof phoneContextMessage>[]; delayed: boolean; aborts: number; closes: number; releases: (() => void)[]; controller: Pick<typeof import('../apps/app/src/runtime/connection-ui.tsx').connectionController, 'open' | 'close'> };
  rateFixture: { mode: string; posts: number; creates: number; successes: number; paths: string[]; accountReads: number };
 }
}
const url = process.env.ALPHA_CONTEXT_TEST_URL || 'http://127.0.0.1:5188';
if (new URL(url).hostname !== '127.0.0.1') throw Error('Use local Vite only.');
const { chromium } = playwright(import.meta.url);
// Use a fresh Vite process: HMR query aliases can create separate controller modules.
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
 page.setDefaultTimeout(12000);
 await page.addInitScript(() => {
  window.androidBridge = {};
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const media = { id: 'video-fixture-71', kind: 'video', revision: 'revision-2', width: 640, height: 480, duration: 2, date: 1700000000000, image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', path: 'content://PRIVATE_VIDEO_URI_CANARY', privateCaption: 'PRIVATE_VIDEO_CONTENT_CANARY' };
  const drafts = new Map<string, string>();
  window.Capacitor = { PluginHeaders: [{name:'AlphaNotifications',methods:['status','addListener','removeListener'].map(name=>({name,rtype:'promise'}))},{name:'AlphaVoiceCloud',methods:[{name:'checkPermissions',rtype:'promise'}]},{ name: 'AlphaConnection', methods: ['secureRead','secureCompareExchange','addListener','removeListener'].map(name => ({ name, rtype: 'promise' })) }, { name: 'AlphaPhotos', methods: ['list','read','libraryAccess','addListener','removeListener'].map(name => ({ name, rtype: 'promise' })) }], nativeCallback:()=> 'fixture-listener', nativePromise: async (plugin, method, input) => {
   if(plugin==='AlphaNotifications'&&method==='status')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaNotifications'&&method==='addListener')return {callbackId:'fixture-listener'};
   if(plugin==='AlphaNotifications'&&method==='removeListener')return {};
   if(plugin==='AlphaVoiceCloud'&&method==='checkPermissions')return {microphone:'granted'};
   if(plugin==='AlphaConnection'){
    if(method==='addListener')return {callbackId:'fixture-listener'};
    if(method==='removeListener')return {};
    if(method==='secureRead')return {value:drafts.get(input.slot)??null};
    if(method==='secureCompareExchange'){if((drafts.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)drafts.delete(input.slot);else drafts.set(input.slot,input.value);return {status:'saved'};}
    throw Error('Unexpected credential operation');
   }
   if (plugin !== 'AlphaPhotos') throw Error('Unexpected native access');
   if(method==='addListener')return {callbackId:'fixture-photo-listener'};
   if(method==='removeListener')return {};
   if(method==='libraryAccess')return {scope:'denied',images:'denied',videos:'denied'};
   return method === 'list' ? { items: [media], next: '' } : media;
  }};
 });
 await page.goto(url, { waitUntil: 'load', timeout: 180000 });
 await page.getByRole('button', { name: 'Photos', exact: true }).click();
 await page.getByRole('button', { name: /^Video, / }).click();
 await page.getByRole('button', { name: 'Ask Alpha about this video', exact: true }).click();
 // Ask opens the local content review first; only reviewed, synthetic text reaches the composer.
 const review = page.getByRole('dialog', { name: 'Ask about selected content' });
 await review.getByRole('textbox', { name: 'Content excerpt' }).fill('Synthetic description of the selected video frame');
 await review.getByRole('button', { name: 'Use in conversation', exact: true }).click();
 await review.waitFor({ state: 'detached' });
 await page.evaluate(async () => {
  const { alphaClient } = await import('/src/runtime/alpha-client.ts');
  const { phoneContextMessage } = await import('/src/runtime/phone-context.ts');
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  window.fixture = { requests: [], delayed: false, aborts: 0, closes: 0, releases: [], controller:connectionController };
  alphaClient.attachVerifiedTransport({
   session: { ownerId: 'fixture-owner', agentId: 'fixture-agent', sessionId: 'fixture-session', origin: 'https://fixture.invalid' },
   send: async ({ text, context, signal }) => {
    window.fixture.requests.push(phoneContextMessage(text, context));
    const reply = { text: window.fixture.delayed ? 'STALE_REPLY_CANARY' : 'VIDEO_CONTEXT_ACCEPTED', proposals: [{ id: 'proposal-' + context.revision, title: 'Fixture proposal', description: 'Synthetic review only', expiresAt: Date.now() + 60000, contextRevision: context.revision }] };
    if (window.fixture.delayed) { signal.addEventListener('abort', () => window.fixture.aborts++); await new Promise<void>(resolve => window.fixture.releases.push(resolve)); }
    return reply;
   }, execute: async () => { throw Error('Unexpected execution'); }, close: () => window.fixture.closes++,
  });
 });
 const send = async (text: string) => { const box = page.getByRole('textbox', { name: /^Message / }).first(); await box.fill(text); await box.press('Enter'); };
 await send('Describe the selected screen only');
 await page.getByText('VIDEO_CONTEXT_ACCEPTED', { exact: true }).waitFor();
 const wire = await page.evaluate(() => window.fixture.requests[0]);
 // The identity carries the exact item and a session-local revision; the library's own
 // revision string (added time and size on Android) never reaches the agent.
 assert.ok(wire.context.selectedObject);
 const { revision: selectedRevision, ...selectedItem } = wire.context.selectedObject;
 assert.deepEqual(selectedItem, { kind: 'video', id: 'native-camera-video-fixture-71' });
 assert.match(selectedRevision ?? '', /^capture-[0-9a-f]{12}-1$/);
 assert.ok(!JSON.stringify(wire).includes('revision-2'));
 assert.equal(wire.context.view, 'photos');
 assert.ok(!wire.text.includes('PRIVATE_VIDEO_') && !wire.text.includes('content://'));
 for (const mode of ['chooser', 'background', 'pagehide']) {
  await page.evaluate(() => { window.fixture.delayed = true; });
  await send('Wait for ' + mode);
  await page.waitForFunction(async () => (await import('/src/runtime/alpha-client.ts')).alphaClient.getState().pending);
  await page.evaluate(mode => {
   if (mode === 'chooser') window.fixture.controller.open();
   else if (mode === 'background') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
   else window.dispatchEvent(new Event('pagehide'));
  }, mode);
  await page.waitForFunction(async () => !(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().pending);
  const suspended = await page.evaluate(async () => {
   const { alphaClient, AlphaClientError } = await import('/src/runtime/alpha-client.ts');
   let approval; try { await alphaClient.approve('proposal-' + window.fixture.requests[0].context.revision); } catch (e) { if (!(e instanceof AlphaClientError)) throw e; approval = e.code; }
   let blocked; try { await alphaClient.send('MUST_NOT_SEND_WHILE_SUSPENDED'); } catch (e) { if (!(e instanceof AlphaClientError)) throw e; blocked = e.code; }
   return { state: alphaClient.getState(), approval, blocked, closes: window.fixture.closes, aborts: window.fixture.aborts };
  });
  assert.equal(suspended.state.context.sensitive, true, mode + JSON.stringify(suspended)); assert.equal(suspended.state.session?.sessionId, 'fixture-session'); assert.equal(suspended.closes, 0);
  assert.ok(suspended.aborts > 0); assert.equal(suspended.approval, 'proposal-unavailable'); assert.equal(suspended.blocked, 'sensitive');
  await page.evaluate(mode => {
   window.fixture.releases.splice(0).forEach(resolve => resolve()); window.fixture.delayed = false;
   if (mode === 'chooser') window.fixture.controller.close();
   else if (mode === 'background') { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); }
   else window.dispatchEvent(new Event('pageshow'));
  }, mode);
  await page.waitForFunction(async () => !(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.sensitive);
  await send('Fresh request after ' + mode);
  await page.waitForFunction(async () => !(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().pending);
  assert.equal(await page.getByText('STALE_REPLY_CANARY', { exact: true }).count(), 0);
  assert.ok(await page.getByText('Describe the selected screen only', { exact: true }).count(), 'Prior conversation retained');
 }
 assert.equal(await page.evaluate(() => window.fixture.requests.length), 7);

 // Folder, own-notification and settings identities stay bounded and opaque; sensitive
 // screens, other apps' notifications and credential settings never become context.
 const identities = await page.evaluate(async () => {
  const { sanitizePhoneContext, phoneContextMessage } = await import('/src/runtime/phone-context.ts');
  const { ownNotificationSelection } = await import('/src/prototype/notifications-adapter.ts');
  const attempt = (input: unknown) => { try { return sanitizePhoneContext(input as ContextEnvelope); } catch (error) { return 'rejected: ' + (error instanceof Error ? error.message : String(error)); } };
  const folder = { kind: 'folder', id: 'tree-7f3a', revision: 'listing-12' } as const;
  const own = ownNotificationSelection({ id: 'own-reminder-42', revision: 'r3', source: 'own' });
  return {
   folder: attempt({ view: 'files', revision: 3, sensitive: false, selectedObject: { ...folder, privateName: 'PRIVATE_FOLDER_NAME_CANARY' } }),
   folderOutsideFiles: attempt({ view: 'notes', revision: 3, sensitive: false, selectedObject: folder }),
   folderPath: attempt({ view: 'files', revision: 3, sensitive: false, selectedObject: { kind: 'folder', id: '/storage/emulated/0/Private', revision: '1' } }),
   folderWithoutRevision: attempt({ view: 'files', revision: 3, sensitive: false, selectedObject: { kind: 'folder', id: 'tree-7f3a' } }),
   own,
   ownContext: attempt({ view: 'home', revision: 4, sensitive: false, selectedObject: own }),
   external: ownNotificationSelection({ id: 'external-9', revision: 'r1', source: 'external' }) ?? null,
   hosted: ownNotificationSelection({ id: 'hosted-9', revision: 'r1', source: 'hosted' }) ?? null,
   forgedExternal: attempt({ view: 'home', revision: 4, sensitive: false, selectedObject: { kind: 'notification', id: 'external-9', revision: 'r1', accountId: 'com.example.chat' } }),
   settings: attempt({ view: 'settings', revision: 5, sensitive: false, selectedObject: { kind: 'settings', id: 'agent-connection' } }),
   passwordSettings: attempt({ view: 'settings', revision: 5, sensitive: false, selectedObject: { kind: 'settings', id: 'passwords' } }),
   sensitiveSettings: attempt({ view: 'settings', revision: 5, sensitive: true, selectedObject: { kind: 'settings', id: 'agent-connection' } }),
   settingsElsewhere: attempt({ view: 'home', revision: 5, sensitive: false, selectedObject: { kind: 'settings', id: 'agent-connection' } }),
   wire: phoneContextMessage('Which folder is this?', { view: 'files', revision: 3, sensitive: false, selectedObject: folder }).text,
  };
 });
 assert.deepEqual(identities.folder, { view: 'files', revision: 3, sensitive: false, selectedObject: { kind: 'folder', id: 'tree-7f3a', revision: 'listing-12' } });
 for (const key of ['folderOutsideFiles', 'folderPath', 'folderWithoutRevision', 'forgedExternal', 'passwordSettings', 'sensitiveSettings', 'settingsElsewhere'] as const) assert.match(String(identities[key]), /^rejected: /, key);
 assert.equal(identities.sensitiveSettings, 'rejected: This screen cannot share agent context.');
 assert.deepEqual(identities.own, { kind: 'notification', id: 'own-reminder-42', revision: 'r3', accountId: 'own' });
 assert.ok(typeof identities.ownContext !== 'string');
 assert.deepEqual(identities.ownContext.selectedObject, identities.own);
 assert.equal(identities.external, null); assert.equal(identities.hosted, null);
 assert.ok(typeof identities.settings !== 'string');
 assert.deepEqual(identities.settings.selectedObject, { kind: 'settings', id: 'agent-connection' });
 assert.ok(identities.wire.includes('"kind":"folder"') && !identities.wire.includes('PRIVATE_FOLDER_NAME_CANARY'));

 // Exercise the production pairing/connection controller, not a replacement
 // AlphaClient transport, for both wire representations of rate limiting.
 for (const mode of ['http429', 'typed200']) {
  const limited = await browser.newPage({ viewport: { width: 412, height: 915 } });
  limited.setDefaultTimeout(12000);
  await limited.addInitScript(mode => {
   const store = new Map<string, string | null>(), token = 'synthetic-rate-limit-session';
   window.rateFixture = { mode, posts: 0, creates: 0, successes: 0, paths: [], accountReads: 0 };
   window.Capacitor = { PluginHeaders: [{ name: 'AlphaConnection', methods: ['request','cancel','secureRead','secureWrite','secureCompareExchange','secureRemove'].map(name => ({ name, rtype: 'promise' })) }], nativePromise: async (plugin, method, input) => {
    if (plugin !== 'AlphaConnection') throw Error('Unexpected native fixture access');
    if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
    if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
    if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
    if (method === 'secureRemove') { store.delete(input.slot); return {}; }
    if (method === 'cancel') return {};
    const pathname = new URL(input.url).pathname, fixture = window.rateFixture;
    if (pathname === '/api/auth/status') return { status: 200, data: { required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'rate-fixture', expiresAt: Date.now() + 60000 } };
    if (pathname === '/api/auth/pair') return { status: 200, data: { token, identityId: 'rate-owner', access: 'owner', instanceId: 'rate-fixture' } };
    if (input.headers.Authorization !== 'Bearer ' + token) throw Error('Fixture requires actual paired credential');
    if (pathname === '/api/auth/me') { fixture.accountReads++; return { status: 200, data: { identity: { id: 'rate-owner', displayName: 'Fixture owner', kind: 'owner' }, session: { id: token, kind: 'machine', expiresAt: Date.now() + 600000 }, access: { role: 'OWNER', mode: 'session' } } }; }
    if (pathname === '/api/agents') return { status: 200, data: { agents: [{ id: '12345678-1234-4234-8234-123456789abc', name: 'Rate fixture', status: 'running' }] } };
    if (pathname === '/api/client-devices/register') return { status: 404, data: {} }; // no device effects in this fixture
    if (pathname === '/api/conversations' && input.method === 'POST') { fixture.creates++; return { status: 200, data: { conversation: { id: 'rate-conversation', title: 'Fixture conversation' } } }; }
    if (pathname === '/api/conversations/rate-conversation/messages' && input.method === 'POST') {
     fixture.posts++; fixture.paths.push(pathname);
     if (fixture.posts === 1) return mode === 'http429' ? { status: 429, data: { error: 'PRIVATE_PROVIDER_ERROR_CANARY' } } : { status: 200, data: { text: 'PRIVATE_PROVIDER_ERROR_CANARY', agentName: 'Rate fixture', failureKind: 'rate_limited', terminalFailure: { kind: 'rate_limited', message: 'PRIVATE_PROVIDER_ERROR_CANARY', transient: true } } };
     fixture.successes++; return { status: 200, data: { text: 'EXPLICIT_RETRY_ACCEPTED_' + mode, agentName: 'Rate fixture' } };
    }
    throw Error('Unexpected fixture route');
   }};
  }, mode);
  await limited.goto(url, { waitUntil: 'load', timeout: 180000 });
  await limited.getByRole('button', { name: 'Settings', exact: true }).click();
  await limited.getByRole('button', { name: 'Agent', exact: true }).click();
  await limited.getByText('Local development agent', { exact: true }).click();
  const local = limited.locator('.alpha-connection details').filter({ has: limited.getByText('Local development agent', { exact: true }) });
  await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
  await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
  await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
  await limited.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
  const identityBefore = await limited.evaluate(async () => (await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session);
  assert.equal(identityBefore?.ownerId, 'rate-owner');
  await limited.getByRole('button', { name: 'Type', exact: true }).click();
  const input = limited.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
  await input.fill('First visible fixture message'); await input.press('Enter');
  // An HTTP failure may be uncertain; a typed failure is the agent's recorded outcome. Both show the
  // message as it is, with no Check saved conversation card.
  const message='The AI request rate limit was reached. Wait a moment before sending again. Alpha Phone did not retry your message.';
  const rateNotice = limited.locator('[data-alpha-message-text]').filter({hasText:message});
  await rateNotice.waitFor();
  assert.equal(await rateNotice.textContent(), message);
  assert.equal(await limited.getByRole('button',{name:/^Check saved conversation/}).count(),0);
  assert.equal(await limited.getByText('PRIVATE_PROVIDER_ERROR_CANARY', { exact: true }).count(), 0);
  await limited.waitForTimeout(1200);
  assert.equal(await limited.evaluate(() => window.rateFixture.posts), 1, mode + ': no automatic repeated POST');
  await input.fill('Explicit user retry'); assert.equal(await input.inputValue(), 'Explicit user retry');
  assert.equal(await limited.evaluate(() => window.rateFixture.posts), 1, 'Editing draft is not a send');
  await input.press('Enter');
  await limited.locator('[data-alpha-message-text]').filter({hasText: new RegExp('^EXPLICIT_RETRY_ACCEPTED_' + mode + '$')}).waitFor();
  const facts = await limited.evaluate(async () => ({ ...window.rateFixture, session: (await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session }));
  assert.equal(facts.posts, 2); assert.equal(facts.creates, 1); assert.equal(facts.successes, 1);
  assert.deepEqual(facts.session, identityBefore, 'Account and session retained across explicit retry');
  assert.deepEqual(facts.paths, ['/api/conversations/rate-conversation/messages', '/api/conversations/rate-conversation/messages']);
  assert.equal(await limited.getByText('First visible fixture message', { exact: true }).count(), 1);
  assert.equal(await rateNotice.count(), 1);
  await limited.close();
 }
 console.log('PASS rendered video selection -> chat with opaque context; folder, own-notification and settings identities stay bounded with sensitive/external exclusions; chooser/visibility/pagehide cancel stale turns and proposals; session/history retained, fresh requests succeed. HTTP429 and typed200 rate_limited render safe error, never automatically repeat POST, retain usable input/history/account, and explicit retry succeeds in the same conversation. Synthetic native/agent boundaries only; no model or emulator acceptance.');

} finally { await browser.close(); }
