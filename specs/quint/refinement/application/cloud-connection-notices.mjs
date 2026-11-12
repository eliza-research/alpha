import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, repositoryRoot as root, sha256} from '../../../../scripts/quint-lib.mjs';
import {seedCompletedAccessSetup} from '../../../../test/browser/flag-off-android.ts';
import {observeCloudNotices} from '../../../../test/browser/helpers/cloud-connection-notices.ts';
import {entitlements, installNativeCloudPlanPorts} from '../../../../test/browser/helpers/native-cloud-plan-fixture.ts';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'CloudConnectionNotices';
const modelPath = 'specs/quint/application/'+model+'.qnt';
const controller = 'apps/app/src/runtime/connection-ui.tsx';
const style = 'apps/app/src/runtime/connection-ui.css';
const kinds = ['plan'];
const expect = baseExpect.configure({timeout:15000});
const region = (page, kind) => page.getByRole('region', {name:'Eliza Cloud '+kind+' notice', exact:true});
const noticeButton = (page, kind, name) => region(page, kind).getByRole('button', {name, exact:true});
const stack = page => page.locator('.alpha-plan-notices');

async function observe(page) {
  const {notices} = await observeCloudNotices(page);
  const input = await page.evaluate(() => {
    const c = window.quintNoticeController, snapshot = c.getSnapshot();
    return {
      plan: !!snapshot.session && !!snapshot.cloudAccount && snapshot.residentPlanNotice === 'needs-plan',
      signIn: !!snapshot.session && c.residentPlanSettings().keyExpiring,
      covered: (document.documentElement.dataset.activeView ?? 'home') !== 'home' || !!document.querySelector('[data-alpha-layer="conversation"][aria-hidden="false"]'),
      compact: innerWidth === 360 && innerHeight === 480,
      largeText: Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')) >= 1.5,
    };
  });
  assert.ok(input.plan && input.signIn, 'The fixture has both a plan requirement and a near-expiry key');
  assert.ok(notices.every(notice => notice.kind==='plan'), 'Expiry never mounts on Home');
  const mounted = notices.map(notice => notice.kind);
  const order = notices.filter(notice => notice.visible).map(notice => notice.kind);
  const accountOpen = await page.getByRole('dialog', {name:'Account', exact:true}).isVisible();
  return {
    's.required': qset(kinds),
    ...(!accountOpen ? {'s.dismissed': qset(kinds.filter(kind => !mounted.includes(kind)))} : {}),
    's.covered': input.covered,
    's.accountOpen': accountOpen,
    's.compact': input.compact,
    's.largeText': input.largeText,
    mounted: qset(mounted), exposed: qset(order), order,
    expiryInSettings: await page.getByRole('button', {name:'Approve this phone again', exact:true}).isVisible(),
  };
}

async function proveHitTargets(page, {short = false} = {}) {
  const overflow = await stack(page).evaluate(node => ({needed: node.scrollHeight > node.clientHeight + 1, enabled: node.dataset.scrollable === 'true'}));
  assert.equal(overflow.enabled, overflow.needed, 'Only an overflowing notice stack owns body gestures');
  const {notices} = await observeCloudNotices(page);
  // Back changes display before ResizeObserver measures the newly exposed stack.
  await expect.poll(async()=>{
    const home=await page.locator('[data-alpha-layer="home"]').boundingBox(),noticeBox=await stack(page).boundingBox();
    return !!home&&!!noticeBox&&home.y>=noticeBox.y+noticeBox.height;
  },{timeout:2000,message:'Home scroll area stays below the visible notice controls'}).toBe(true);
  for (const [index, notice] of notices.entries()) {
    assert.ok(notice.visible, notice.label+' is laid out');
    if (index > 0) assert.ok(notices[index - 1].bounds.bottom <= notice.bounds.top, 'Rendered notices occupy separate rows');
    for (const action of notice.actions) {
      if (short) await noticeButton(page, notice.kind, action.name).scrollIntoViewIfNeeded();
      const row = (await observeCloudNotices(page)).notices.find(row => row.kind === notice.kind);
      const point = row.actions.find(candidate => candidate.name === action.name);
      assert.ok(point.owned, action.name+' owns its rendered center instead of '+point.hit);
    }
  }
}

async function settingsRoundTrip(page, t) {
  for (const entry of ['Settings', 'Inbox', 'Open conversation']) {
    await page.getByRole('button', {name:entry, exact:true}).click();
    await expect(stack(page)).toBeHidden();
    checkpoint(t, 'Actual '+entry+' suspends passive notices without dismissing them', call('coverScreen'), await observe(page));
    if(entry==='Settings'){
      await page.getByRole('button', {name:'Account', exact:true}).click();
      const account=page.getByRole('dialog', {name:'Account', exact:true});
      await expect(account.getByRole('button', {name:'Approve this phone again', exact:true})).toBeVisible();
      checkpoint(t, 'Opening Account reveals the sign-in expiry action', call('openAccount'), await observe(page));
      await page.keyboard.press('Escape');
      await expect(account).toHaveCount(0);
      checkpoint(t, 'Closing Account hides the sign-in action', call('closeAccount'), await observe(page));
    }
    await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable:true})));
    await expect(stack(page)).toBeVisible();
    checkpoint(t, 'Actual Back returns Home to the unchanged owned notices', call('returnHome'), await observe(page));
  }
}

async function exercise(page, short) {
  const t = trace(short ? 'short_large_text_plan_and_account' : 'home_plan_and_account', await observe(page));
  if (short) {
    await page.setViewportSize({width:360, height:480});
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--alpha-visible-height'))).toBe('480px');
    checkpoint(t, 'The actual shell measures the short viewport', call('compact'), await observe(page));
    const notice = region(page, 'plan');
    const font = () => notice.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const normal = await font();
    await page.evaluate(async () => {
      const {installBrowserDisplay, applyBrowserDisplay} = await import('/src/browser/display.ts');
      installBrowserDisplay();
      applyBrowserDisplay({textScalePercent:150, brightness:100});
    });
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement)
      .getPropertyValue('--alpha-text-scale')))).toBe(1.5);
    assert.ok(await font() >= normal * 1.49, 'The notice text itself grew');
    checkpoint(t, 'The actual browser display adapter enlarges text', call('largeText'), await observe(page));
  }
  await proveHitTargets(page, {short});
  if (!short) {
    const {notices} = await observeCloudNotices(page);
    const buttons = notices.flatMap(notice => notice.actions.map(action => noticeButton(page, notice.kind, action.name)));
    await buttons[0].focus();
    for (const button of buttons.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
    }
  }
  await settingsRoundTrip(page, t);
  await proveHitTargets(page, {short});

  const dismiss = async kind => {
    await noticeButton(page, kind, 'Dismiss '+kind+' notice').tap();
    await expect(region(page, kind)).toHaveCount(0);
    checkpoint(t, 'Touch dismisses only the exact '+kind+' notice', call('dismiss', kind), await observe(page));
  };
  await dismiss('plan');
  await expect(stack(page)).toHaveCount(0);
  return t;
}

async function nativeFixture(page, input) {
  const initializers = [];
  // Both native scripts refer to earlier helpers and may carry the TS loader's function-name helper.
  const fixture = {addInitScript: async (script, argument) => {
    initializers.push('('+script.toString()+')('+ (JSON.stringify(argument) ?? 'undefined')+');');
  }};
  await seedCompletedAccessSetup(fixture);
  await installNativeCloudPlanPorts(fixture, input);
  await page.addInitScript('const __name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n'+initializers.join('\n'));
}

export async function checkCloudConnectionNotices(extraSources = []) {
  checkClientFeatures();
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    'apps/app/index.html', 'vite.config.ts', 'upstream.lock.json', 'package-lock.json',
    'scripts/prepare-client-features.mjs', modelPath, fileURLToPath(import.meta.url),
    'test/browser/flag-off-android.ts', 'test/browser/helpers/cloud-connection-notices.ts',
    'test/browser/helpers/native-cloud-plan-fixture.ts', 'test/browser/helpers/resident-agent-plugin.ts',
    'test/browser/helpers/native-navigation-protocol.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources), loaded = new Set();
  const watched = new Set([resolve(root, controller), resolve(root, style)]);
  const previous = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel:'error',
      cacheDir: resolve(root, 'test-results/quint-refinement/cloud-notice-vite-cache'),
      server: {host:'127.0.0.1', port:0, hmr:false, watch:null},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},
      plugins:[{name:'quint-cloud-notice-inputs', enforce:'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (watched.has(path)) {
          assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted notice uses the captured source');
          loaded.add(path);
        }
      }}]});
    await server.listen();
    const origin = 'http://127.0.0.1:'+server.httpServer.address().port;
    browser = await chromium.launch({headless:true});
    const input = {...await entitlements(), plan:'none', expiresAt:Date.now()+5*24*3600_000,
      holdProvider:false, fullApp:true};
    const traces = [];
    for (const short of [false, true]) {
      const page = await browser.newPage({viewport:{width:412,height:915}, hasTouch:true, reducedMotion:'reduce'});
      const foreign = [], errors = [];
      page.setDefaultTimeout(40000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if ((url.origin === origin && request.method() === 'GET' && !url.pathname.startsWith('/api/')) ||
            ['data:', 'blob:'].includes(url.protocol)) return route.continue();
        foreign.push(request.method()+' '+url.origin+url.pathname);
        return route.abort();
      });
      await page.routeWebSocket(/.*/, socket => {
        const url = new URL(socket.url());
        const vite = [origin.replace(/^http:/,'ws:'), 'ws://127.0.0.1:0'].includes(url.origin) &&
          url.pathname === '/' && url.searchParams.has('token');
        if (!vite) foreign.push('WS '+url.origin+url.pathname);
        return socket.close();
      });
      try {
        await nativeFixture(page, input);
        await page.goto(origin+'/', {waitUntil:'commit', timeout:180000});
        await page.evaluate(async () => {
          const {connectionController} = await import('/src/runtime/connection-ui.tsx');
          const {testMocksEnabled} = await import('/src/build-flags.ts');
          const {isAndroid} = await import('/src/native.ts');
          if (testMocksEnabled || !isAndroid) throw Error('Expected the real flag-off native renderer');
          window.quintNoticeController = connectionController;
        });
        await expect(region(page, 'plan')).toBeVisible({timeout:120000});
        await expect(region(page, 'sign-in')).toHaveCount(0);
        traces.push(await exercise(page, short));
        const effects = await page.evaluate(() => window.planFixture.calls.filter(call =>
          ['configureCloudProvider','openExternal','startEmail','verifyEmail'].includes(call.method) || call.path?.endsWith('/redeem')));
        assert.deepEqual(effects, [], 'Layout and dismissal cannot dispatch a plan, email, or inference action');
        assert.deepEqual(foreign, [], 'The browser may only use the closed native ports');
        assert.deepEqual(errors, [], 'The mounted notice stack reports no uncaught errors');
      } finally {
        await page.close();
      }
    }
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return await checkTraces({model, modelPath, sources, driverHashes, traces, scope:'bounded-orchestration', assumptions:[
      'The real flag-off Alpha, connection chooser, Settings shell and stylesheet run in Chromium with a synthetic signed plan and near-expiry credential. CSS hit owners and scrolling are checked in the actual viewport.',
      'One stable account and key per trace. Dismissal projects from the exact mounted notice disappearing while its upstream requirement remains. Foreground app or conversation suspension retains the mounted notice, and returning Home restores it.',
      'The short 360×480 viewport uses the actual browser text sizing adapter as a controlled 150% text input. Native WebView text zoom, billing, credential renewal and subscription transitions are separate.',
    ]});
  } finally {
    if (previous === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previous;
    try {await browser?.close();} finally {await server?.close();}
  }
}
