import { expect, test, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';

// Issue #404: the login-field reporter Alpha's Android browser injects at document start into
// every frame (BrowserLoginFields.SCRIPT in the pinned plugin-native-browser-surface). On Android it runs in an
// isolated JavaScript world and its channel is a WebMessageListener whose sourceOrigin the
// engine supplies. Here a stand-in channel records messages in each frame, so this checks the
// script's own behaviour only: what it reports, on which events, and where fills land. It does
// not exercise WebView, the isolated world, the engine origin or a password provider.
// The reporter is a Java text block; undo its backslash escapes.
const reporter = fs.readFileSync('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserLoginFields.java', 'utf8')
  .split('static final String SCRIPT = """')[1].split('""";')[0].replaceAll('\\\\', '\\');
const channel = `(() => {
  const target = new EventTarget();
  globalThis.__sent = [];
  target.postMessage = message => { globalThis.__sent.push(String(message)); };
  globalThis.__elizaLoginFields = target;
  globalThis.__deliver = data => target.dispatchEvent(new MessageEvent('message', { data }));
})();`;

const loginForm = (extra = '') => `<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0">
<form id=login style="margin:40px 10px" onsubmit="event.preventDefault();window.__submitted=true">
<input id=user name=user autocomplete=username style="display:block;box-sizing:border-box;width:200px;height:40px">
<input id=pass type=password autocomplete=current-password style="display:block;box-sizing:border-box;width:200px;height:40px">
<input id=note style="display:block;box-sizing:border-box;width:200px;height:40px">
<button id=go>Sign in</button></form>${extra}
<script>window.__events=[];for(const id of ['user','pass'])for(const type of ['input','change'])document.getElementById(id).addEventListener(type,()=>window.__events.push(id+':'+type));</script></body>`;

async function serve(page: Page, routes: Record<string, string>) {
  await page.addInitScript({ content: `${channel}\n${reporter}` });
  for (const [url, body] of Object.entries(routes)) await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body }));
}
const sent = (frame: Frame | Page) => frame.evaluate(() => (globalThis as any).__sent as string[]);
const documentId = (message: string) => message.split('|')[1];

test('reports only the focused login fields of its own frame, with no origin, on real focus', async ({ page }) => {
  await serve(page, { 'https://a.test/login': loginForm() });
  await page.goto('https://a.test/login');
  // A page-dispatched focus event is untrusted and reports nothing.
  await page.evaluate(() => document.getElementById('user')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  expect(await sent(page)).toEqual([]);
  await page.click('#user');
  const [focus] = await sent(page);
  expect(focus).toMatch(/^focus\|[0-9a-f]{24}\|1\|1\|2\|username\|current-password\|10,40,200,40,412$/);
  expect(focus).not.toMatch(/a\.test|https?:|origin|location/i);
  await page.click('#pass');
  expect((await sent(page)).slice(1)).toEqual([`blur|${documentId(focus)}`, `focus|${documentId(focus)}|2|1|2|username|current-password|10,80,200,40,412`]);
  // A field that is not a login field ends the report.
  await page.click('#note');
  expect((await sent(page)).at(-1)).toBe(`blur|${documentId(focus)}`);
});

test('fills only registered fields of this document and only for this frame\'s own origin', async ({ page }) => {
  await serve(page, { 'https://a.test/login': loginForm() });
  await page.goto('https://a.test/login');
  await page.click('#user');
  const doc = documentId((await sent(page))[0]);
  const deliver = (data: object) => page.evaluate(d => (globalThis as any).__deliver(JSON.stringify(d)), data);
  await deliver({ t: 'fill', d: doc, o: 'https://evil.test', u: 1, uv: 'wrong', p: 2, pv: 'wrong' });
  await deliver({ t: 'fill', d: 'ffffffffffffffffffffffff', o: 'https://a.test', u: 1, uv: 'wrong', p: 2, pv: 'wrong' });
  await deliver({ t: 'fill', d: doc, o: 'https://a.test', u: 7, uv: 'wrong' });
  await deliver({ t: 'other', d: doc, o: 'https://a.test', u: 1, uv: 'wrong' });
  expect(await page.inputValue('#user')).toBe('');
  expect(await page.inputValue('#pass')).toBe('');
  await deliver({ t: 'fill', d: doc, o: 'https://a.test', u: 1, uv: 'ada@example.com', p: 2, pv: 's3cret' });
  expect(await page.inputValue('#user')).toBe('ada@example.com');
  expect(await page.inputValue('#pass')).toBe('s3cret');
  // Sites built on input/change listeners see the filled values.
  expect(await page.evaluate(() => (window as any).__events)).toEqual(['user:input', 'user:change', 'pass:input', 'pass:change']);
  // Nothing is posted back: fill values never return to native code.
  expect((await sent(page)).every(message => !message.includes('s3cret'))).toBe(true);
});

test('reports submitted values for save only on a real submit of registered fields', async ({ page }) => {
  await serve(page, { 'https://a.test/login': loginForm() });
  await page.goto('https://a.test/login');
  await page.fill('#user', 'ada@example.com');
  await page.fill('#pass', 'p|ss w%rd');
  // Untrusted submit events report nothing.
  await page.evaluate(() => document.getElementById('login')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  expect((await sent(page)).filter(m => m.startsWith('submit'))).toEqual([]);
  await page.click('#pass');
  await page.click('#go');
  await expect.poll(() => page.evaluate(() => (window as any).__submitted)).toBe(true);
  const doc = documentId((await sent(page))[0]);
  expect((await sent(page)).filter(m => m.startsWith('submit'))).toEqual([`submit|${doc}|1|2|ada%40example.com|p%7Css%20w%25rd`]);
});

test('same-origin frames report in top-level coordinates; cross-origin frames and frames inside them report nothing', async ({ page }) => {
  await serve(page, {
    'https://a.test/top': `<!doctype html><body style="margin:0"><iframe id=same src="https://a.test/frame" style="position:absolute;left:0;top:300px;width:300px;height:200px;border:0"></iframe>
      <iframe id=cross src="https://b.test/frame" style="position:absolute;left:0;top:520px;width:300px;height:200px;border:0"></iframe></body>`,
    'https://a.test/frame': loginForm(),
    'https://b.test/frame': `${loginForm()}`.replace('</body>', '<iframe src="https://a.test/frame" style="width:300px;height:200px;border:0"></iframe></body>'),
  });
  await page.goto('https://a.test/top');
  const same = page.frameLocator('#same'), cross = page.frameLocator('#cross');
  await same.locator('#user').click();
  const sameFrame = page.frames().find(frame => frame.url() === 'https://a.test/frame' && frame.parentFrame() === page.mainFrame())!;
  expect((await sent(sameFrame))[0]).toMatch(/^focus\|[0-9a-f]{24}\|1\|1\|2\|username\|current-password\|10,340,200,40,412$/);
  await cross.locator('#user').click();
  await cross.frameLocator('iframe').locator('#user').click();
  const crossFrame = page.frames().find(frame => frame.url() === 'https://b.test/frame')!;
  const nested = crossFrame.childFrames()[0];
  expect(await sent(crossFrame)).toEqual([]);
  expect(await sent(nested)).toEqual([]);
  expect(await sent(page)).toEqual([]);
});

test('does nothing on cleartext pages', async ({ page }) => {
  await serve(page, { 'http://c.test/login': loginForm() });
  await page.goto('http://c.test/login');
  await page.click('#user');
  expect(await sent(page)).toEqual([]);
});

test('a document that unloads tells native code to end its binding', async ({ page }) => {
  await serve(page, {
    'https://a.test/top': `<!doctype html><body style="margin:0"><iframe id=same src="https://a.test/frame" style="width:300px;height:200px;border:0"></iframe></body>`,
    'https://a.test/frame': loginForm(),
    'https://a.test/next': '<!doctype html><p>next</p>',
  });
  await page.goto('https://a.test/top');
  await page.frameLocator('#same').locator('#user').click();
  const frame = page.frames().find(f => f.url() === 'https://a.test/frame')!;
  const doc = documentId((await sent(frame))[0]);
  // Record the frame's messages in the parent before it navigates away on its own.
  await frame.evaluate(() => { const own = (globalThis as any).__sent; addEventListener('pagehide', () => { (parent as any).__frameSent = own.slice(); }); });
  await frame.evaluate(() => { location.href = 'https://a.test/next'; });
  await expect.poll(() => page.evaluate(() => (window as any).__frameSent?.at(-1))).toBe(`gone|${doc}`);
});

test('a field focused while the page is still loading is reported once, before the load finishes', async ({ page }) => {
  // Native code keeps this report (BrowserFieldOrigin.Deferred) and offers the field when the tab
  // becomes eligible, because the script does not report a field again while it stays focused.
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await serve(page, { 'https://a.test/login': loginForm('<img src="https://a.test/slow.png"><script>document.getElementById("user").focus()</script>') });
  await page.route('https://a.test/slow.png', async route => { await held; await route.fulfill({ status: 404, body: '' }); });
  await page.goto('https://a.test/login', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => sent(page)).toHaveLength(1);
  expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
  expect((await sent(page))[0]).toMatch(/^focus\|[0-9a-f]{24}\|1\|1\|2\|username\|current-password\|/);
  release();
  await page.waitForLoadState('load');
  expect(await sent(page)).toHaveLength(1);
});
