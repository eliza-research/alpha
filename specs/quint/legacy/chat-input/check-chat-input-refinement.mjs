import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.mjs';
import {flagOffAndroid, fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {residentStub, setStub} from '../../../../test/browser/resident-stub.ts';
import {captureInputs, checkTraces} from '../../refinement/check-traces.mjs';

const model = 'ChatInput';
const currentModel = 'ChatInputCurrentComparison';
const currentPath = 'test/fixtures/quint/ChatInputCurrentComparison.qnt';
const main = resolve(root, 'apps/app/src/main.tsx');
const motion = resolve(root, 'apps/app/src/prototype/chat-overlay-motion-adapter.ts');
const adapter = resolve(root, 'apps/app/src/prototype/agent-adapter.ts');
const shell = resolve(root, 'apps/app/src/prototype/model.js');
const input = '[data-alpha-layer="composer"] textarea[data-alpha-composer]';
const message = '[data-alpha-layer="conversation"] textarea[data-alpha-composer]';
const scrim = '[data-alpha-chat-scrim]';
const expect = baseExpect.configure({timeout: 15000});
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-chat-vite-cache');
const action = (name, ...args) => ({name, args});
const draft = 'Synthetic retained draft';

function readBack(page) {
  return page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
}

function getState(page) {
  return page.evaluate(() => {
    const owner = window.quintLegacyChat;
    const state = owner.S();
    return {
      view: state.view || 'home',
      mode: state.chat,
      focus: Boolean(document.activeElement?.matches('textarea[data-alpha-composer]')),
      draft: String(state.draft || ''),
      rest: owner.rest(),
      posts: [...window.flagOff.posts],
    };
  });
}

function project(state) {
  return {'s.view': state.view === 'home' || state.view === 'browser' ? state.view : 'app',
    's.mode': state.mode, 's.focus': state.focus, 's.draft': state.draft ? 'text' : 'empty'};
}

function compareCurrent(trace, name) {
  return {name, expect: {...trace.expect, CurrentSafety: true},
    steps: trace.steps.map(step => ({...step, expect: {...step.expect, CurrentSafety: true}}))};
}

async function schedule(page, name) {
  const initial = await getState(page);
  assert.equal(initial.view, 'home');
  assert.equal(initial.mode, 'input');
  assert.equal(initial.focus, false);
  assert.equal(initial.draft, '');
  const trace = {name, init: action('checkerInit'), expect: project(initial), steps: []};
  return {trace, async point(label, ...actions) {
    const state = await getState(page);
    trace.steps.push({label, action: actions.length ? actions : null, expect: project(state)});
    return state;
  }};
}

async function position(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Actual element has a hit-test rectangle');
  return {x: box.x+box.width/2, y: box.y+box.height/2};
}

async function drag(page, from, delta) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y+delta, {steps: 8});
  await page.mouse.up();
}

async function attachNativeFixture(page) {
  // Keep existing app test fixture initializers in source-defined order.
  const initializers = [];
  const fixture = {async addInitScript(script, args) {
    assert.equal(typeof script, 'function');
    initializers.push('('+script.toString()+')('+(JSON.stringify(args) ?? 'undefined')+');');
  }};
  await flagOffAndroid(fixture);
  await residentStub(fixture, {accounts: [{
    token: 'quint-chat-fixture-owner', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5',
    email: 'composer@example.invalid', balance: 5,
  }]});
  await fixture.addInitScript(() => {
    for (const name of ['AlphaNotifications', 'AlphaHostedResults']) {
      const header = window.Capacitor.PluginHeaders.find(row => row.name === name);
      for (const method of ['addListener', 'removeListener']) {
        if (header && !header.methods.some(row => row.name === method))
          header.methods.push({name: method, rtype: 'callback'});
      }
    }
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {throw Error('Composer fixture forbids physical capture');};
  });
  await page.addInitScript('const __name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n'
    +initializers.join('\n'));
}

async function mounted(extraSources, run) {
  checkClientFeatures();
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')),
    ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'config')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'upstream.lock.json',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs',
    'test/browser/flag-off-android.ts', 'test/browser/resident-stub.ts',
    'test/browser/helpers/native-navigation-protocol.ts', 'test/browser/full-chat-grabber.spec.ts',
    'test/browser/composer-send-focus.spec.ts', currentPath, fileURLToPath(import.meta.url), ...extraSources,
  ])];
  const driverHashes = captureInputs(sources);
  const watched = new Set([main, motion, adapter, shell]);
  const loaded = new Set();
  const previousMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error',
      cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-chat-input-readback', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Actual mounted source matches the driver capture');
            loaded.add(path);
          }
        }
        if (path === main) {
          const anchor = 'shell = value;';
          assert.equal(code.split(anchor).length, 2);
          return code.replace(anchor, anchor+' window.quintLegacyChat = value;');
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const base = 'http://127.0.0.1:'+server.httpServer.address().port;
    async function scenario(name, body) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(45000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const foreign = await fenceNetwork(page);
      await attachNativeFixture(page);
      try {
        await page.goto(base+'/', {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => window.quintLegacyChat?.live && window.quintLegacyChat?.composerDraft?.binding);
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('native-phone')), true);
        const t = await schedule(page, name);
        await body(page, t);
        assert.deepEqual(foreign, [], 'External requests are fenced');
        assert.deepEqual(errors, [], 'Mounted composer reports no uncaught browser errors');
        return t.trace;
      } finally {await page.close();}
    }
    const observations = await run(scenario);
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {...observations, sources, driverHashes};
  } finally {
    if (previousMocks === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previousMocks;
    try {await browser?.close();} finally {await server?.close();}
  }
}

async function collect(scenario) {
  const traces = [], differences = [];
  const outside = await scenario('focused_home_tap_is_consumed_and_draft_stays', async (page, t) => {
    const composer = page.locator(input);
    const settings = page.locator('[data-alpha-layer="home"]').getByRole('button', {name: 'Settings', exact: true});
    await composer.fill(draft);
    await expect(composer).toBeFocused();
    await expect(page.locator(scrim)).toHaveCSS('pointer-events', 'auto');
    await t.point('real composer focus and text edit', action('FocusComposer'), action('TypeText'));
    const icon = await position(settings);
    const before = await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.hasAttribute('data-alpha-chat-scrim'), icon);
    assert.equal(before, true, 'The raised composer owns the outside pointer');
    await page.touchscreen.tap(icon.x, icon.y);
    await expect(composer).not.toBeFocused();
    await expect(composer).toHaveValue(draft);
    assert.equal((await t.point('first tap lowers focus and retains Home', action('TapOutside'))).view, 'home');
    await expect(page.locator(scrim)).toHaveCSS('pointer-events', 'none');
    await page.touchscreen.tap(icon.x, icon.y);
    await page.waitForFunction(() => window.quintLegacyChat.S().view === 'settings');
    assert.equal((await t.point('second deliberate tap opens Settings', action('TapOutside'))).draft, draft);
  });
  traces.push(outside);
  differences.push({id: 'ChatInputCurrentOutsideTap', trace: compareCurrent(
    {...outside, steps: outside.steps.slice(0, 2)}, 'current_outside_tap_would_open_app')});

  let raisedDockGuarded;
  const back = await scenario('ime_hides_before_delivered_native_back_lowers_app_composer', async (page, t) => {
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Type', exact: true})).toBeVisible();
    await t.point('Settings opens at its pill detent', action('OpenView', 'app'));
    await page.getByRole('button', {name: 'Type', exact: true}).click();
    const composer = page.locator(input);
    await expect(composer).toBeFocused();
    await expect(page.locator(scrim)).toHaveCSS('pointer-events', 'auto');
    raisedDockGuarded = (await page.locator(scrim).getAttribute('data-alpha-dock-scrim')) === 'true';
    assert.equal(raisedDockGuarded, true, 'The raised app dock owns its outside pointer guard');
    await t.point('Type raises the actual composer with focus', action('TapType'));
    await composer.fill(draft);
    await t.point('input edits the mounted draft', action('TypeText'));
    const size = page.viewportSize();
    await page.setViewportSize({...size, height: size.height-320});
    // The actual resize watcher must see the keyboard-covered frame before the hide.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(composer).toBeFocused();
    await page.setViewportSize(size);
    await expect(composer).not.toBeFocused();
    await t.point('adjustResize hide blurs the composer while it remains raised', action('ImeHide'));
    await readBack(page);
    await expect(page.getByRole('button', {name: 'Type', exact: true})).toBeVisible();
    const lowered = await t.point('first delivered Back lowers to pill', action('Back'));
    assert.equal(lowered.view, 'settings');
    assert.equal(lowered.draft, draft);
    await readBack(page);
    await page.waitForFunction(() => !window.quintLegacyChat.S().view);
    assert.equal((await t.point('next delivered Back leaves Settings', action('Back'))).draft, draft);
  });
  traces.push(back);
  differences.push({id: 'ChatInputCurrentBackOrder', trace: compareCurrent(
    {...back, steps: back.steps.slice(0, 5)}, 'current_back_would_leave_raised_app_view')});
  const currentDock = compareCurrent({...back, steps: back.steps.slice(0, 2)}, 'current_has_no_raised_dock_guard');
  currentDock.steps.at(-1).expect.CurrentGuarded = raisedDockGuarded;
  differences.push({id: 'ChatInputCurrentDockGuard', trace: currentDock});

  const gesture = await scenario('content_drag_does_not_open_chat_but_dock_drag_does', async (page, t) => {
    await drag(page, {x: 206, y: 520}, -280);
    const still = await t.point('upward Home content drag leaves the composer at rest', action('SwipeUp', 'content'));
    assert.equal(still.mode, 'input');
    const bar = await position(page.locator('[data-alpha-input-bar]'));
    await drag(page, bar, -300);
    await expect(page.getByRole('button', {name: 'Resize chat', exact: true})).toBeVisible();
    await t.point('upward dock drag opens a sheet', action('SwipeUp', 'dock'));
    await readBack(page);
    await expect(page.getByRole('button', {name: 'Open conversation', exact: true})).toBeVisible();
    await t.point('delivered Back lowers the sheet', action('Back'));
  });
  traces.push(gesture);
  differences.push({id: 'ChatInputCurrentContentDrag', trace: compareCurrent(
    {...gesture, steps: gesture.steps.slice(0, 1)}, 'current_content_swipe_would_open_chat')});

  traces.push(await scenario('browser_rest_and_toolbar_detents_remain_separate', async (page, t) => {
    await page.getByRole('button', {name: 'Browser', exact: true}).click();
    await page.waitForFunction(() => window.quintLegacyChat.S().view === 'browser');
    const browserRest = await t.point('Browser opens at the input rest', action('OpenView', 'browser'));
    assert.equal(browserRest.rest, 'input');
    await page.getByRole('button', {name: 'Open conversation', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Expand chat', exact: true})).toBeVisible();
    await t.point('Browser conversation opens over the same view', action('TapAlpha'));
    await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Shrink chat', exact: true})).toBeVisible();
    await t.point('Browser conversation expands', action('GrabUp'));
    await page.getByRole('button', {name: 'Shrink chat', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Expand chat', exact: true})).toBeVisible();
    await t.point('Browser conversation shrinks to the sheet', action('GrabDown'));
    let hit;
    await expect.poll(async () => {
      hit = await page.evaluate(() => {
        const screen = document.querySelector('[data-screen]').getBoundingClientRect();
        const panel = document.querySelector('[data-alpha-layer="conversation"]').getBoundingClientRect();
        for (let y = screen.top+24; y < panel.top-8; y += 24) {
          for (const x of [screen.left+24, screen.left+screen.width/2, screen.right-24]) {
            if (document.elementFromPoint(x, y)?.hasAttribute('data-alpha-chat-scrim')) return {x,y};
          }
        }
        return null;
      });
      return !!hit;
    }).toBe(true);
    await page.mouse.click(hit.x, hit.y);
    await expect(page.locator(input)).toBeVisible();
    await t.point('sheet scrim returns to Browser input without a view change', action('TapOutside'));
    await readBack(page);
    await page.waitForFunction(() => !window.quintLegacyChat.S().view);
    await t.point('Back at the Browser rest returns to Home', action('Back'));
  }));

  const common = await scenario('mounted_full_chat_send_keeps_composer_focus', async (page, t) => {
    await page.getByRole('button', {name: 'Open conversation', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Expand chat', exact: true})).toBeVisible();
    await t.point('real conversation button opens sheet', action('TapAlpha'));
    await page.getByRole('button', {name: 'Expand chat', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Shrink chat', exact: true})).toBeVisible();
    await t.point('toolbar expands to full', action('GrabUp'));
    await setStub(page, {stream: 'hold'});
    const composer = page.locator(message);
    await composer.fill(draft);
    await expect(composer).toBeFocused();
    await t.point('full composer gains focus and accepts text', action('FocusComposer'), action('TypeText'));
    await composer.press('Enter');
    await page.waitForFunction(() => window.residentStub.release && window.flagOff.posts.length === 1);
    await expect(composer).toHaveValue('');
    await expect(composer).toBeFocused();
    const sent = await t.point('one real composer dispatch clears draft and retains focus', action('Send'));
    assert.deepEqual(sent.posts, [draft]);
    await page.evaluate(() => window.residentStub.release());
    await page.waitForFunction(() => !window.quintLegacyChat.S().typing);
    await expect(composer).toBeFocused();
    await t.point('provider completion keeps visible composer and focus');
    await composer.blur();
    await t.point('composer releases focus before the next Back', action('ImeHide'));
    await readBack(page);
    await expect(page.getByRole('button', {name: 'Expand chat', exact: true})).toBeVisible();
    await t.point('Back lowers full conversation to sheet', action('Back'));
    await readBack(page);
    await expect(page.getByRole('button', {name: 'Open conversation', exact: true})).toBeVisible();
    await t.point('Back lowers sheet to Home composer', action('Back'));
  });
  traces.push(common, {...common, name: 'common_full_chat_source_replay_in_historical_current_design',
    init: action('checkerCurrentInit')});
  return {traces, differences};
}

export async function checkChatInputRefinement(extraSources = []) {
  const {traces, differences, sources, driverHashes} = await mounted(extraSources, collect);
  const shared = {sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'The actual flag-off launcher, composer, drag/scrim and agent adapters execute in Chromium with real DOM focus and pointer delivery. Only native and remote transport ports are synthetic.',
    'Home and one ordinary app are projected onto historical view classes. Composer text is observed exactly at retention boundaries and represented by empty/text in Quint. The legacy design selector is the original profile input.',
    'An Android keyboard dismissal is represented by the real renderer resize response. The subsequent alpha-back event executes the mounted bridge handler. Physical IME and device event order remain separate.',
    'The historical current initializer is checked for the shared safe full-chat sequence. Current-only outside, Back and content-drag differences have separate receipts. Original design transition relation is unchanged.',
  ]};
  const receipt = await checkTraces({...shared, model, traces});
  const mismatches = [];
  for (const {id, trace} of differences) {
    const out = 'test-results/quint-refinement/'+id+'.json';
    await assert.rejects(checkTraces({...shared, model: currentModel, modelPath: currentPath, id, out, traces: [trace]}),
      /Source\/model trace mismatch/);
    const mismatch = JSON.parse(readFileSync(resolve(root, out), 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, id, receiptPath: out});
  }
  return {receipts: [receipt], mismatches};
}
