import { test, expect, type Page } from '@playwright/test';
import { auditPage, auditReadingOrder, auditTabOrder, auditTree, format } from './accessibility-audit';

// The sweep is only as good as its checks. Each rule is shown here to fire on a seeded defect
// and to stay quiet on the corrected markup, so a silent sweep means a clean page.
const page_ = (body: string) => `<!doctype html><html lang="en"><body style="margin:0;font:16px sans-serif;background:#fff;color:#000">${body}</body></html>`;
const rules = (lines: string[]) => [...new Set(lines.map(line => line.split(':')[0]))].sort();
async function load(page: Page, body: string) { await page.setContent(page_(body)); }

test('names and focusability come from the accessibility tree', async ({ page }) => {
  await load(page, `<button><svg width="20" height="20" aria-hidden="true"></svg></button>
    <input type="text"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">
    <div role="dialog"><p>Untitled</p></div><div role="button">Not focusable</div>`);
  const found = format(await auditTree(page));
  expect(rules(found)).toEqual(['accessible-name', 'keyboard-focusable']);
  expect(found.filter(line => line.startsWith('accessible-name'))).toHaveLength(4);
  expect(found.filter(line => line.startsWith('keyboard-focusable')).join()).toContain('Not focusable');

  await load(page, `<button aria-label="Close"><svg width="20" height="20" aria-hidden="true"></svg></button>
    <label>Name <input type="text"></label><img alt="A lighthouse" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">
    <div role="dialog" aria-label="Details"><p>Titled</p></div><div role="button" tabindex="0">Focusable</div>`);
  expect(format(await auditTree(page))).toEqual([]);
});

test('hidden focus, broken references, small targets and low contrast are reported', async ({ page }) => {
  await load(page, `<div aria-hidden="true"><button>Behind</button></div>
    <button aria-labelledby="missing" style="width:16px;height:16px;padding:0">x</button>
    <p style="color:#999;background:#fff">Grey on white</p>
    <div style="background:#000"><p style="color:#fff;opacity:.4">Faded on black</p></div>`);
  const found = format(await auditPage(page, { contrast: true, targetSize: 24 }));
  expect(rules(found)).toEqual(['aria-hidden-focus', 'aria-reference', 'contrast', 'target-size']);
  expect(found.filter(line => line.startsWith('contrast'))).toHaveLength(2);

  await load(page, `<div aria-hidden="true" inert><button>Behind</button></div>
    <span id="present">Close</span><button aria-labelledby="present" style="width:24px;height:24px;padding:0">x</button>
    <p style="color:#595959;background:#fff">Grey on white</p>
    <p style="color:#8a8a8a;background:#fff;font-size:24px">Large grey on white</p>
    <button disabled style="color:#bbb;background:#fff">Unavailable</button>`);
  expect(format(await auditPage(page, { contrast: true, targetSize: 24 }))).toEqual([]);
});

test('text printed over text, stacked or cut controls and labels split mid-word are reported', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 400 });
  // The round-7 Home card at 200% text: a title too tall for its fixed box, printed over the time
  // above it. A four-column tile whose one-word label breaks after its seventh letter. Two buttons
  // on the same pixels. A button cut through by a box that does not scroll.
  await load(page, `<div class="os" style="position:relative;width:400px;height:400px">
    <div style="position:absolute;left:0;top:0;width:200px;height:60px">
      <span id="time" style="display:block;font-size:14px;line-height:18px">3:00 PM</span>
      <div id="title" style="font-size:40px;line-height:40px;margin-top:-22px">Design review</div>
    </div>
    <button id="tile" style="position:absolute;left:0;top:140px;width:60px;padding:0;border:0;font-size:24px;overflow-wrap:anywhere">Calendar</button>
    <button id="under" style="position:absolute;left:220px;top:0;width:100px;height:44px">Under</button>
    <button id="over" style="position:absolute;left:260px;top:10px;width:100px;height:44px;background:transparent">Over</button>
    <div style="position:absolute;left:0;top:260px;width:200px;height:20px;overflow:hidden"><button id="cut" style="height:44px;width:120px;padding:0;border:0"><span style="display:block;height:44px"></span></button></div>
  </div>`);
  const found = format(await auditPage(page, { overlap: true }));
  expect(rules(found)).toEqual(['control-clipped', 'control-overlap', 'label-word-broken', 'text-overlap']);
  expect(found.find(line => line.startsWith('text-overlap'))).toMatch(/3:00 PM.*Design review|Design review.*3:00 PM/);
  expect(found.find(line => line.startsWith('label-word-broken'))).toContain('"Calendar" is split across lines');
  expect(found.find(line => line.startsWith('control-clipped'))).toContain('id="cut"');
  expect(found.filter(line => line.startsWith('control-overlap'))).toHaveLength(1);

  // The same content laid out with room: the card grows with its title, the tile is wide enough,
  // the buttons sit side by side and the clipped row scrolls. Tight line heights, a label that
  // wraps between words, a long unbroken address, a field with its clear button, text under an
  // opaque sheet and text scrolled out of a list are not defects.
  await load(page, `<div class="os" style="position:relative;width:400px;height:400px">
    <div style="position:absolute;left:0;top:0;width:200px">
      <span style="display:block;font-size:14px;line-height:18px">3:00 PM</span>
      <div style="font-family:serif;font-size:40px;line-height:1.02">Design review</div>
      <span style="display:block;font-size:14px;line-height:1.1">Room 4</span>
    </div>
    <button style="position:absolute;left:0;top:140px;width:130px;padding:0;border:0;font-size:24px;overflow-wrap:anywhere">Calendar</button>
    <button style="position:absolute;left:140px;top:140px;width:60px;padding:0;border:0;font-size:16px">Apps</button>
    <button style="position:absolute;left:210px;top:140px;width:90px;padding:0;border:0;font-size:14px;overflow-wrap:anywhere">https://a-very-long-host.example/path</button>
    <button style="position:absolute;left:220px;top:0;width:80px;height:44px">Left</button>
    <button style="position:absolute;left:300px;top:0;width:80px;height:44px">Right</button>
    <label style="position:absolute;left:0;top:220px;width:200px;height:44px"><input aria-label="Search" style="width:200px;height:44px;box-sizing:border-box"><button aria-label="Clear" style="position:absolute;right:0;top:0;width:44px;height:44px">x</button></label>
    <div style="position:absolute;left:0;top:280px;width:200px;height:44px;overflow-y:auto"><button style="height:44px;width:120px">First</button><button style="display:block;height:44px;width:120px">Second</button><p style="margin:0">Scrolled text</p></div>
    <p style="position:absolute;left:220px;top:300px;margin:0">Behind the sheet</p>
    <div style="position:absolute;left:210px;top:290px;width:180px;height:60px;background:#fff"><p style="margin:10px">On the sheet</p></div>
  </div>`);
  expect(format(await auditPage(page, { overlap: true }))).toEqual([]);
});

test('clipped text, spilling labels and unreachable controls are reported; ellipsis is separate', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await load(page, `<div class="os" style="position:relative;width:400px;height:300px;overflow:hidden">
    <div id="cut" style="width:80px;height:14px;overflow:hidden;white-space:nowrap;font-size:20px">Cut through the middle</div>
    <div id="ellipsis" style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Deliberately shortened preview</div>
    <button id="spill" style="width:40px;height:24px;padding:0;white-space:nowrap">A label that spills over</button>
    <button id="below" style="position:absolute;top:400px;left:0">Below the fold</button>
    <button id="side" style="position:absolute;top:100px;left:380px;width:80px">Off the side</button>
    <p id="overlap" style="position:absolute;top:150px;left:0;width:120px;margin:0;font-size:28px;line-height:20px">Two lines that print over each other</p>
  </div>`);
  const found = format(await auditPage(page, { clipping: true }));
  expect(rules(found)).toEqual(['control-off-screen', 'control-unreachable', 'label-overflows-control', 'text-clipped', 'text-lines-overlap', 'text-truncated']);
  expect(found.find(line => line.startsWith('text-lines-overlap'))).toContain('Two lines');
  expect(found.find(line => line.startsWith('text-truncated'))).toContain('Deliberately shortened');
  expect(found.find(line => line.startsWith('text-clipped'))).toContain('Cut through');

  // Nothing clips this paragraph, so it simply runs off the side of the phone.
  await load(page, `<div class="os" style="position:relative;width:400px;height:300px"><p style="position:absolute;left:340px;top:20px;margin:0;white-space:nowrap">Runs off the side</p></div>`);
  expect(rules(format(await auditPage(page, { clipping: true })))).toEqual(['text-off-screen']);

  await load(page, `<div class="os" style="position:relative;width:400px;height:300px;overflow:hidden">
    <div style="height:300px;overflow-y:auto"><p style="font-size:20px">Wraps instead of being cut through the middle of a line</p>
    <p style="width:120px;font-size:28px;line-height:1.2">Two lines with room between them</p><p style="font-size:28px;line-height:20px">One line</p>
    <button style="min-height:24px">A label that fits</button><div style="height:400px"></div><button>Below the fold, but scrollable</button></div>
    <div style="width:80px;height:20px;overflow:hidden"><span style="display:block;height:20px">Fits</span><span style="display:block">Hidden whole</span></div>
  </div>`);
  expect(format(await auditPage(page, { clipping: true }))).toEqual([]);
});

test('a focus trap and focus inside hidden content are reported; a bounded order is not', async ({ page }) => {
  await load(page, `<button>One</button><button id="trap">Trap</button><button>Never reached</button>
    <script>document.getElementById('trap').addEventListener('keydown',event=>{if(event.key==='Tab')event.preventDefault();});</script>`);
  expect(rules(format(await auditTabOrder(page)))).toEqual(['focus-trap']);

  await load(page, `<button>One</button><div aria-hidden="true"><button>Hidden but focusable</button></div><button>Three</button>`);
  expect(rules(format(await auditTabOrder(page)))).toEqual(['focus-in-hidden-content']);

  // A modal with one control holds focus by design.
  await load(page, `<div role="dialog" aria-label="Notice"><button id="only">OK</button></div>
    <script>document.getElementById('only').addEventListener('keydown',event=>{if(event.key==='Tab')event.preventDefault();});</script>`);
  expect(format(await auditTabOrder(page))).toEqual([]);

  // A modal with a second control that Tab can never reach is a trap, not containment.
  await load(page, `<div role="dialog" aria-label="Notice"><button id="first">Cancel</button><button>Confirm</button></div>
    <script>document.getElementById('first').addEventListener('keydown',event=>{if(event.key==='Tab')event.preventDefault();});</script>`);
  expect(rules(format(await auditTabOrder(page)))).toEqual(['focus-trap']);

  // A cycle through part of the page leaves the rest unreachable by keyboard.
  await load(page, `<button id="a">One</button><button id="b">Two</button><button>Never reached</button>
    <script>document.getElementById('b').addEventListener('keydown',event=>{if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();document.getElementById('a').focus();}});</script>`);
  const partial = format(await auditTabOrder(page));
  expect(rules(partial)).toEqual(['focus-order-incomplete']);
  expect(partial.join()).toContain('Never reached');

  // Tab swallowed for the whole page: nothing is ever focused, so every control is unreachable.
  await load(page, `<button>One</button><button>Two</button>
    <script>document.addEventListener('keydown',event=>{if(event.key==='Tab')event.preventDefault();},true);</script>`);
  const swallowed = format(await auditTabOrder(page));
  expect(rules(swallowed)).toEqual(['focus-order-incomplete']);
  expect(swallowed).toHaveLength(2);

  // A control that arrives on a timer during the walk was not skipped by it.
  await load(page, `<button id="a">One</button><button id="b">Two</button>
    <script>document.getElementById('b').addEventListener('focus',()=>{const late=document.createElement('button');late.textContent='Late';document.getElementById('b').before(late);},{once:true});</script>`);
  expect(format(await auditTabOrder(page))).toEqual([]);

  // The same cycle inside a dialog is containment: the page behind it is meant to be skipped.
  await load(page, `<button>Behind</button><div role="dialog" aria-label="Choose"><button id="a">One</button><button id="b">Two</button></div>
    <script>document.getElementById('a').focus();document.getElementById('b').addEventListener('keydown',event=>{if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();document.getElementById('a').focus();}});</script>`);
  expect(format(await auditTabOrder(page))).toEqual([]);

  await load(page, `<button>One</button><a href="#two">Two</a><input aria-label="Three">`);
  expect(format(await auditTabOrder(page))).toEqual([]);

  // A sheet over a scrim that leaves the page under it in the tab order: focus goes where it
  // cannot be seen, onto controls (here a destructive one) a pointer could not reach.
  const sheet = (page_: string, popup: string) => `<div class="os" style="position:relative;width:400px;height:300px">${page_}${popup}</div>`;
  const popup = `<button aria-label="Close share" tabindex="-1" style="position:absolute;inset:0;z-index:7;border:0;background:rgba(0,0,0,.2)"></button>
    <div role="dialog" aria-label="Share" style="position:absolute;left:0;right:0;bottom:0;height:160px;z-index:8;background:#fff"><button>Copy link</button></div>`;
  await page.setViewportSize({ width: 400, height: 300 });
  await load(page, sheet(`<div><button>Share</button><button style="position:absolute;left:10px;bottom:10px">Delete</button></div>`, popup));
  const under = format(await auditTabOrder(page));
  expect(rules(under)).toEqual(['focus-behind-scrim']);
  expect(under).toHaveLength(2);
  expect(under.join()).toContain('Delete');
  // The same sheet with the page under it retired holds focus to itself.
  await load(page, sheet(`<div inert><button>Share</button><button style="position:absolute;left:10px;bottom:10px">Delete</button></div>`, popup));
  expect(format(await auditTabOrder(page))).toEqual([]);
  // A full-screen control under its own chrome is not a scrim over that chrome.
  await load(page, sheet(`<button aria-label="Photo" style="position:absolute;inset:0;border:0"></button><button style="position:absolute;left:10px;top:10px">Back</button>`, ''));
  expect(format(await auditTabOrder(page))).toEqual([]);

  // Tab walks the fields inside a native time input before it leaves; that is not a trap.
  await load(page, `<div role="dialog" aria-label="Alarm"><input type="time" aria-label="Alarm time" value="07:00"><button>Save</button></div>`);
  expect(format(await auditTabOrder(page))).toEqual([]);
});

// Round 10: the floating dock and toasts, measured from bounding boxes and hit tests.
const phone = (body: string) => `<div class="os" style="position:relative;width:400px;height:600px;overflow:hidden"><div data-screen="1" style="position:absolute;inset:0">${body}</div></div>`;
const composer = `<div data-alpha-layer="composer" style="position:absolute;left:16px;right:16px;bottom:28px;z-index:40"><div data-alpha-input-bar style="height:62px;border-radius:31px;background:#eee"><button aria-label="Open conversation" style="width:44px;height:44px">A</button></div></div>`;
const pill = `<div data-alpha-layer="pill" style="position:absolute;left:0;right:0;bottom:26px;z-index:40;display:flex;justify-content:center;pointer-events:none"><div style="pointer-events:auto;padding:5px;background:#eee"><button aria-label="Open conversation" style="width:44px;height:44px">A</button></div></div>`;
const rows = (count: number) => Array.from({ length: count }, (_, index) => `<button style="display:block;width:100%;height:60px">Row ${index + 1}</button>`).join('');

test('a control or label under the floating dock is reported; one that ends above it or scrolls clear is not', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  // Home may flow under the composer, but its final content must scroll clear.
  await load(page, phone(`<div data-alpha-layer="home" style="position:absolute;inset:0;overflow-y:auto;z-index:10">${rows(12)}<p>Last line of Home</p></div>${composer}`));
  await page.locator('[data-alpha-layer="home"]').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const home = format(await auditPage(page, { dock: true }));
  expect(rules(home)).toEqual(['obscured-by-dock']);
  expect(home.join('\n')).toContain('under composer');
  expect(home.every(line => line.includes('[home]'))).toBe(true);
  // The same Home ending above the dock: its last visible row is cut by the scroll area, not covered.
  await load(page, phone(`<div data-alpha-layer="home" style="position:absolute;inset:0 0 96px;overflow-y:auto;z-index:10">${rows(12)}<p>Last line of Home</p></div>${composer}`));
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);

  // An app page scrolls under the dock by design. With no room to scroll its last control clear, it is stuck there.
  const app = (padding: number, dock: string) => phone(`<div data-alpha-layer="app" style="position:absolute;inset:0;z-index:20;display:flex;flex-direction:column"><div data-alpha-app-scroll="x" style="flex:1;overflow-y:auto;padding-bottom:${padding}px">${rows(10)}<p>Fine print under the list</p></div></div>${dock}`);
  await load(page, app(0, composer));
  await page.locator('[data-alpha-app-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const stuck = format(await auditPage(page, { dock: true }));
  expect(rules(stuck)).toEqual(['obscured-by-dock']);
  expect(stuck.join('\n')).toMatch(/only \d+px of the \d+px needed can be scrolled/);
  expect(stuck.join('\n')).toContain('Fine print under the list');
  // With the dock's footprint as padding every row can be scrolled above it, wherever the page is scrolled to.
  await load(page, app(110, composer));
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);
  await page.locator('[data-alpha-app-scroll]').evaluate(el => { el.scrollTop = 120; });
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);
  // The pill is narrower: only what is actually behind it counts, and a retired dock covers nothing.
  await load(page, app(0, pill));
  await page.locator('[data-alpha-app-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(format(await auditPage(page, { dock: true })).join('\n')).toContain('under pill');
  await load(page, app(0, composer.replace('data-alpha-layer="composer"', 'data-alpha-layer="composer" inert aria-hidden="true" hidden')));
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);
});

test('keyboard focus left partly under the dock is reported; focus scrolled clear of it is not', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  const app = (script: string) => phone(`<div data-alpha-layer="app" style="position:absolute;inset:0;z-index:20;display:flex;flex-direction:column"><div data-alpha-app-scroll="x" style="flex:1;overflow-y:auto;padding-bottom:120px">${rows(9)}</div></div>${composer}${script}`);
  // Nine 60px rows in a 600px page: the last ones take focus where they are, under the composer.
  await load(page, app(''));
  const under = format(await auditTabOrder(page));
  expect(rules(under)).toEqual(['focus-obscured']);
  expect(under.join('\n')).toContain('under composer');
  // The same page bringing whatever takes focus above the dock.
  await load(page, app(`<script>document.querySelector('[data-alpha-app-scroll]').addEventListener('focusin',event=>{const dock=document.querySelector('[data-alpha-layer="composer"]').getBoundingClientRect(),box=event.target.getBoundingClientRect();if(box.bottom>dock.top-8)event.currentTarget.scrollTop+=box.bottom-dock.top+8;});</script>`));
  expect(format(await auditTabOrder(page))).toEqual([]);
  // A focusable scroll region is the scroller, not a control inside it.
  await load(page, phone(`<div data-alpha-layer="app" style="position:absolute;inset:0;z-index:20"><div tabindex="0" role="region" aria-label="Timeline" style="height:100%;overflow-y:auto"><p style="height:900px;margin:0">Hours</p></div></div>${composer}`));
  expect(format(await auditTabOrder(page))).toEqual([]);
});

test('a toast under a top-layer dialog is reported; one shown inside the dialog, above it, is not', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  const toast = `<div data-alpha-toast aria-live="polite" aria-atomic="true" style="position:absolute;left:16px;right:16px;bottom:40px;z-index:97;display:flex;justify-content:center;pointer-events:none"><div style="pointer-events:auto;min-height:48px;padding:0 18px;background:#000;color:#fff;display:flex;align-items:center"><span>Saved to Notes</span></div></div>`;
  const dialog = (inside: string) => `<dialog aria-label="Review" style="width:360px;height:520px;margin:auto;border:0;padding:16px"><p>Review this page.</p><button>Close</button>${inside}</dialog><script>document.querySelector('dialog').showModal();</script>`;
  // Nothing open: the page's toast is on top and reachable.
  await load(page, phone(toast));
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);
  // A modal dialog opened over it: covered, and inert, so never announced.
  await load(page, phone(toast) + dialog(''));
  const hidden = format(await auditPage(page, { dock: true }));
  expect(rules(hidden)).toEqual(['toast-not-announced']);
  expect(hidden.join('\n')).toContain('Saved to Notes');
  // The same text in the dialog's own status region, drawn above the dialog.
  await load(page, phone(toast) + dialog(`<div data-alpha-dialog-toast aria-live="polite" aria-atomic="true" popover="manual" style="position:fixed;inset:auto;left:16px;width:368px;bottom:40px;margin:0;padding:0;border:0;background:transparent;display:flex;justify-content:center;pointer-events:none"><div style="pointer-events:auto;min-height:48px;padding:0 18px;background:#000;color:#fff;display:flex;align-items:center"><span>Saved to Notes</span></div></div>`) + `<script>document.querySelector('[data-alpha-dialog-toast]').showPopover();</script>`);
  expect(format(await auditPage(page, { dock: true }))).toEqual([]);
  // A toast with something drawn over it is not on screen for a sighted user either.
  await load(page, phone(toast + `<div style="position:absolute;inset:0;z-index:99;background:#fff"><p>Cover</p></div>`));
  expect(rules(format(await auditPage(page, { dock: true })))).toEqual(['toast-covered']);
});


test('drawer scrolls under the dock and rejects unreachable final controls',async({page})=>{
 await page.setViewportSize({width:400,height:600});
 const drawer=(padding:number)=>phone(`<div data-alpha-layer="drawer" style="position:absolute;inset:0;z-index:30;display:flex;flex-direction:column"><div data-alpha-app-scroll="drawer" style="flex:1;min-height:0;overflow-y:auto;padding-bottom:${padding}px">${rows(10)}<button style="display:block;width:100%;height:44px">Last app</button></div></div>${composer}`);
 await load(page,drawer(110));expect(format(await auditPage(page,{dock:true}))).toEqual([]);
 await load(page,drawer(0));await page.locator('[data-alpha-app-scroll="drawer"]').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 expect(rules(format(await auditPage(page,{dock:true})))).toEqual(['obscured-by-dock']);
});

test('closed message details are not painted under the dock; opening the same content exposes the real overlap',async({page})=>{
 await page.setViewportSize({width:400,height:600});
 await load(page,phone(`<div data-alpha-layer="app" data-alpha-subview="inbox-detail" style="position:absolute;inset:0;z-index:10"><details style="position:absolute;top:500px;left:150px"><summary>Message details</summary><dl style="display:grid;margin:0"><dt>To</dt><dd style="margin:0">owner@example.test</dd></dl></details></div>${pill}`));
 expect(format(await auditPage(page,{dock:true}))).toEqual([]);
 await page.locator('details').evaluate(el=>(el as HTMLDetailsElement).open=true);
 expect(rules(format(await auditPage(page,{dock:true})))).toContain('obscured-by-dock');
});

// TalkBack's linear order (AccessibilityInstrumentedTest.talkBackOrder), read from the same
// accessibility tree Android WebView is built from.
const screen = (body: string) => `<div class="os" style="position:relative;width:400px;height:600px;overflow:hidden"><div data-screen="1" style="position:absolute;inset:0;overflow:hidden">${body}</div></div>`;
const assistant = `<div role="group" aria-label="Assistant controls" style="position:absolute;left:16px;right:16px;bottom:28px;height:60px;display:flex;gap:8px"><button aria-label="Open conversation" style="width:44px;height:44px">A</button><textarea aria-label="Ask Alpha" rows="1"></textarea><button aria-label="Talk" style="width:44px;height:44px">M</button></div>`;
const tiles = (count = 6) => `<div role="region" aria-label="Home" style="position:absolute;inset:44px 0 100px;overflow-y:auto"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${Array.from({ length: count }, (_, index) => `<button style="height:80px">App ${index + 1}</button>`).join('')}</div></div>`;

test('reading order: content read after the assistant controls, or upward within a region, is reported', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  // The ongoing-activity chip drawn at the top of the screen but placed after the assistant controls.
  await load(page, screen(`${tiles()}${assistant}<button style="position:absolute;top:8px;left:84px;height:28px">Return to Maps</button>`));
  const after = format(await auditReadingOrder(page));
  expect(rules(after)).toEqual(['assistant-group-order']);
  expect(after.join('\n')).toContain('Return to Maps');
  // The same chip where it is drawn, before the content below it.
  await load(page, screen(`<button style="position:absolute;top:8px;left:84px;height:28px">Return to Maps</button>${tiles()}${assistant}`));
  expect(format(await auditReadingOrder(page))).toEqual([]);

  // A bottom action row placed before the page it acts on: TalkBack reads Save, then goes back up to the title.
  const bar = `<div style="position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;justify-content:flex-end"><button style="height:48px">Save</button></div>`;
  const body = `<div style="position:absolute;left:0;right:0;top:0"><h1 style="margin:0;font-size:28px">Draft</h1><p>The body of the draft, long enough to be a paragraph.</p></div>`;
  await load(page, screen(bar + body));
  const up = format(await auditReadingOrder(page));
  expect(rules(up)).toEqual(['reading-order']);
  expect(up.join('\n')).toMatch(/'Draft'.*goes up from .*'Save'/);
  await load(page, screen(body + bar));
  expect(format(await auditReadingOrder(page))).toEqual([]);

  // A second column to the right starts higher up by design; a live region (a toast) is announced, not read on to.
  await load(page, screen(`<div style="position:absolute;left:0;top:0;width:190px"><button style="display:block;width:100%;height:200px">Long list item</button><button style="display:block;width:100%;height:200px">Second item</button></div><div style="position:absolute;left:200px;top:0;width:190px"><p>Detail of the open item</p></div>${assistant}<div aria-live="polite" style="position:absolute;left:16px;right:16px;bottom:104px"><span>Saved</span><button>Undo</button></div>`));
  expect(format(await auditReadingOrder(page))).toEqual([]);
});

test('reading order: one assistant group; hidden, inert, scrolled-away and off-phone content is not read', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 600 });
  await load(page, screen(`${tiles()}${assistant}${assistant}`));
  expect(rules(format(await auditReadingOrder(page)))).toEqual(['assistant-group-duplicate']);
  // A retired copy (inert, aria-hidden) is not exposed; neither is a row scrolled out of its list,
  // nor the development rail beside the phone.
  const retired = assistant.replace('aria-label="Assistant controls"', 'aria-label="Assistant controls" inert aria-hidden="true"');
  await load(page, `${screen(`${tiles(30)}${assistant}<div inert aria-hidden="true" style="position:absolute;top:0;left:0;right:0"><button>Hidden layer</button></div>${retired}`)}<div style="position:absolute;left:420px;top:0"><button>Jump to Home</button></div>`);
  expect(format(await auditReadingOrder(page))).toEqual([]);
  await page.locator('[role=region]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(format(await auditReadingOrder(page))).toEqual([]);
  // The rule reads the tree, not the DOM's guesses: the same chip after the group is still found when everything else is clean.
  await load(page, screen(`${tiles(30)}${assistant}${retired}<p style="position:absolute;top:8px;left:84px;margin:0">Recording · 0:12</p>`));
  expect(rules(format(await auditReadingOrder(page)))).toEqual(['assistant-group-order']);
});

test('reading order: a bar of controls keeps its own order in every layout; the same order loose on the screen is reported', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 600 });
  // Large system font: the header's title takes a row of its own below its buttons, and is still
  // read between the navigation and the actions, as an Android toolbar's title is.
  const header = (hook: string) => `<div ${hook} style="position:absolute;top:0;left:0;right:0;display:flex;flex-wrap:wrap;align-items:center"><button aria-label="Back to apps" style="width:44px;height:44px">‹</button><h1 style="order:1;flex:1 0 100%;margin:0;font-size:40px">Inbox</h1><button aria-label="Search email" style="width:44px;height:44px;margin-left:auto">S</button></div><p style="position:absolute;top:120px;margin:0">First message</p>`;
  await load(page, screen(header('data-alpha-app-header="main"')));
  expect(format(await auditReadingOrder(page))).toEqual([]);
  await load(page, screen(header('data-other-row')));
  expect(rules(format(await auditReadingOrder(page)))).toEqual(['reading-order']);
});
