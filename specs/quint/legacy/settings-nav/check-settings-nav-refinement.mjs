import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.mjs';
import {flagOffAndroid, fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {residentStub} from '../../../../test/browser/resident-stub.ts';
import {captureInputs, checkTraces} from '../../refinement/check-traces.mjs';

const comparison = 'test/fixtures/quint/SettingsNavComparison.qnt';
const main = resolve(root, 'apps/app/src/main.tsx');
const settings = resolve(root, 'apps/app/src/prototype/settings-adapter.ts');
const adapter = resolve(root, 'apps/app/src/prototype/agent-adapter.ts');
const shell = resolve(root, 'apps/app/src/prototype/model.js');
const licenses = resolve(root, 'apps/app/public/licenses/third-party-notices.json');
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-settings-vite-cache');
const expect = baseExpect.configure({timeout: 15000});
const current = page => page.locator('[data-settings-page]:not([inert])').last();
const button = (page, name) => current(page).getByRole('button', {name, exact: true});
const nativeBack = page => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
const action = (name, ...args) => ({name, args});
const open = (label, target) => action('Open', label, 'nav', target);

async function attachNativeFixture(page) {
  const initializers = [];
  const fixture = {async addInitScript(script, args) {
    assert.equal(typeof script, 'function');
    initializers.push('('+script.toString()+')('+(JSON.stringify(args) ?? 'undefined')+');');
  }};
  await flagOffAndroid(fixture);
  await residentStub(fixture, {accounts: [{
    token: 'quint-settings-fixture-owner', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5',
    email: 'settings@example.invalid', balance: 5,
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
      navigator.mediaDevices.getUserMedia = async () => {throw Error('Settings fixture forbids physical capture');};
  });
  await page.addInitScript('const __name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n'
    +initializers.join('\n'));
}

async function snapshot(page, expectedTitle) {
  if (expectedTitle === 'Account & plan') {
    const sheet = page.getByRole('dialog', {name: 'Account', exact: true});
    await expect(sheet).toBeVisible();
    const state = await current(page).evaluate(element => ({
      title: 'Account & plan', renderedTitle: 'Account', layer: 'account-sheet',
      view: window.quintLegacySettings.S().view,
      route: window.quintLegacySettings.vget('settings').page || 'top', confirming: false,
    }));
    assert.equal(state.view, 'settings');
    assert.equal(state.route, 'top', 'The Account sheet preserves the selected Settings root');
    return state;
  }
  await expect(current(page)).toHaveAttribute('data-settings-page', expectedTitle);
  const state = await current(page).evaluate(element => ({
    title: element.getAttribute('data-settings-page'),
    view: window.quintLegacySettings.S().view,
    route: window.quintLegacySettings.vget('settings').page || 'top',
    confirming: false,
  }));
  assert.equal(state.view, 'settings');
  assert.equal(state.title, expectedTitle);
  return state;
}

function projection(state, profile) {
  // Only the shared navigation states have historical representations. The
  // grouped indexes have their own divergence trace and are stutter here.
  const routes = {
    Settings: ['top', ['top']],
    Apps: [['settings-apps', 'top'], ['top']],
    Account: ['settings-account', ['top']],
    About: ['about', ['top', 'about']],
    'Open source licenses': ['licenses', ['top', 'about', 'licenses']],
    'License details': ['license-detail', ['top', 'about', 'licenses', 'license-detail']],
    Calendar: ['calendar', ['top', 'calendar']],
    'Password manager': ['password-provider', ['top', 'passwords']],
    // The current Account sheet overlays Settings; project that explicit leaf to the
    // historical plan page while retaining its actual root route in the receipt.
    'Account & plan': [state.layer === 'account-sheet' ? 'top' : 'cloud-plan', ['top', profile === 'current' ? 'cloudplan' : 'account']],
  };
  const [route, stack] = routes[state.title];
  assert.ok([route].flat().includes(state.route), 'Selected route matches mounted '+state.title+': '+state.route);
  return {'s.stack': stack, 's.confirming': state.confirming, ProfileSafety: true};
}

function replay(name, profile, initial, events) {
  return {
    name, expect: projection(initial, profile),
    steps: events.map(({label, state, proposed, current: historical = proposed}) => ({
      label, action: profile === 'current' ? historical : proposed, expect: projection(state, profile),
    })),
  };
}

function schedule(page, initial) {
  const events = [];
  return {
    events,
    async point(label, title, proposed = null, historical = proposed) {
      const state = await snapshot(page, title);
      events.push({label, state, proposed, current: historical});
      return state;
    },
    replay(name, profile) {return replay(name, profile, initial, events);},
  };
}

async function collect(page, notice) {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const top = await snapshot(page, 'Settings');
  const hasTopWifi = await button(page, 'Wi-Fi').isVisible();
  assert.equal(hasTopWifi, false, 'Historical direct Wi-Fi entry is absent at the mounted Settings root');
  const about = schedule(page, top);
  await button(page, 'About').click();
  await about.point('About opens from the visible Settings row', 'About', open('About', 'about'));
  await button(page, 'Open source licenses').click();
  await about.point('Open source licenses opens from About', 'Open source licenses', open('Open source licenses', 'licenses'));
  const search = current(page).getByRole('searchbox', {name: 'Search components', exact: true});
  const component = button(page, notice.name+' '+notice.version);
  await expect(component).toBeVisible();
  await search.fill('no-component-matches-quint-settings');
  await expect(component).toHaveCount(0);
  await expect(current(page).getByText('No matching components', {exact: true})).toBeVisible();
  await about.point('Unmatched search changes results and keeps licenses selected', 'Open source licenses');
  await search.fill(notice.name);
  await expect(component).toBeVisible();
  await about.point('Matching search displays the actual packaged React notice', 'Open source licenses');
  await component.click();
  const detail = await snapshot(page, 'License details');
  await expect(current(page).getByText(notice.name, {exact: true})).toBeVisible();
  await expect(current(page).getByText('License and notices', {exact: true})).toBeVisible();
  const detailsDifference = profile => replay('mounted_license_detail_has_no_historical_state', profile, top, [
    ...about.events, {label: 'Selected packaged notice opens a separate details route', state: detail, proposed: null},
  ]);
  await nativeBack(page);
  await expect(search).toHaveValue(notice.name);
  await expect(component).toBeVisible();
  await about.point('Delivered Back returns from the unmapped detail excursion and retains the search', 'Open source licenses');
  await nativeBack(page);
  await about.point('Delivered Back returns to About', 'About', action('Back'));
  await nativeBack(page);
  await about.point('Delivered Back returns to Settings', 'Settings', action('Back'));

  const apps = schedule(page, top);
  await button(page, 'Apps').click();
  assert.equal((await apps.point('Apps index opens as a grouping step', 'Apps')).route, 'settings-apps');
  await button(page, 'Calendar').click();
  await apps.point('Calendar selected from the real Apps index', 'Calendar', open('Calendars', 'calendar'), open('Calendar', 'calendar'));
  await nativeBack(page);
  await apps.point('Delivered Back restores the Apps index', 'Apps', action('Back'));
  await button(page, 'Passwords').click();
  await apps.point('Passwords opens the actual password manager settings', 'Password manager',
    open('Passwords', 'passwords'), open('Password manager', 'passwords'));
  await nativeBack(page);
  await apps.point('Delivered Back restores the Apps index from Password manager', 'Apps', action('Back'));
  await button(page, 'Back to Settings').click();
  await apps.point('Visible Back leaves the Apps index', 'Settings');

  const account = schedule(page, top);
  await button(page, 'Account').click();
  const plan = await account.point('The signed-in Account sheet opens from Settings', 'Account & plan',
    open('Eliza Cloud', 'account'), open('Eliza Cloud account & plan', 'cloudplan'));
  const sheet = page.getByRole('dialog', {name: 'Account', exact: true});
  const infoLabel = 'AI connection';
  await expect(sheet.getByRole('button', {name: /^AI connection/})).toBeVisible();
  const noInfoRows = !(await sheet.getByText(infoLabel, {exact: true}).isVisible());
  const accountSlot = () => page.evaluate(() => window.flagOff.slots['cloud:production']);
  const before = await accountSlot();
  assert.ok(before, 'Synthetic Cloud owner is signed in');
  await sheet.getByRole('button', {name: 'Sign out', exact: true}).click();
  const confirmation = page.getByRole('dialog', {name: 'Sign out?', exact: true});
  await expect(confirmation).toBeVisible();
  account.events.push({label: 'Actual Account callback opens a confirmation before destructive work',
    state: {...plan, confirming: true},
    proposed: action('Destroy', 'Sign out', 'danger', 'confirm'),
    current: action('Destroy', 'Sign out', 'danger', 'direct')});
  await confirmation.getByRole('button', {name: 'Close Account', exact: true}).click();
  await account.point('Dismissing confirmation leaves the same account selected', 'Account & plan', action('Answer'));
  assert.equal(await accountSlot(), before, 'Dismissal preserves the synthetic durable Cloud owner');

  const proposed = [
    about.replay('about_license_search_and_delivered_back', 'proposed'),
    apps.replay('calendar_and_passwords_via_grouped_apps', 'proposed'),
    account.replay('real_sign_out_confirmation_dismissed', 'proposed'),
  ];
  const historical = [
    about.replay('current_about_license_search_and_delivered_back', 'current'),
    apps.replay('current_calendar_and_passwords_via_grouped_apps', 'current'),
    replay('current_account_plan_navigation_before_sign_out', 'current', top, account.events.slice(0, 1)),
  ];
  const directSignOut = replay('current_direct_sign_out_diverges_from_confirm_dialog', 'current', top, account.events.slice(0, 2));
  const infoRows = replay('proposed_account_omits_visible_information_rows', 'proposed', top, account.events.slice(0, 1));
  infoRows.steps.at(-1).expect.NoInfoRows = noInfoRows;
  const directWifi = {name: 'current_root_wifi_entry_is_absent', expect: {...projection(top, 'current'), HasTopWifi: hasTopWifi},
    steps: [{label: 'Read the mounted Settings root', action: null, expect: projection(top, 'current')}]};
  return {proposed, historical, differences: [
    ['SettingsNavCurrentDirectSignOut', 'current', directSignOut],
    ['SettingsNavCurrentRootWifi', 'current', directWifi],
    ['SettingsNavCurrentLicenseDetails', 'current', detailsDifference('current')],
    ['SettingsNavProposedLicenseDetails', 'proposed', detailsDifference('proposed')],
    ['SettingsNavProposedInfoRows', 'proposed', infoRows],
  ]};
}

async function mounted(extraSources) {
  checkClientFeatures();
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')),
    ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'upstream.lock.json',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs', licenses, comparison,
    'test/browser/flag-off-android.ts', 'test/browser/resident-stub.ts',
    'test/browser/helpers/native-navigation-protocol.ts',
    fileURLToPath(import.meta.url), ...extraSources,
  ])];
  const driverHashes = captureInputs(sources);
  const noticeBytes = readFileSync(licenses);
  assert.equal(sha256(noticeBytes), driverHashes[licenses]);
  const rendererReactVersion = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
    .packages['node_modules/react'].version;
  const notices = JSON.parse(noticeBytes).filter(item => item.name === 'react' && item.version === rendererReactVersion);
  assert.equal(notices.length, 1, 'Packaged licenses identify the renderer React component');
  const watched = new Set([main, settings, adapter, shell]);
  const loaded = new Set();
  const previousMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error',
      cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-settings-nav-readback', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted source matches the driver capture');
            loaded.add(path);
          }
        }
        if (path === main) {
          const anchor = 'shell = value;';
          assert.equal(code.split(anchor).length, 2);
          return code.replace(anchor, anchor+' window.quintLegacySettings = value;');
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const foreign = await fenceNetwork(page);
    await attachNativeFixture(page);
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.quintLegacySettings?.live);
    assert.ok(await page.locator('html').evaluate(el => el.classList.contains('native-phone')));
    const observations = await collect(page, notices[0]);
    assert.deepEqual(foreign, [], 'External requests are fenced');
    assert.deepEqual(errors, [], 'Mounted Settings reports no uncaught browser errors');
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {...observations, sources, driverHashes};
  } finally {
    if (previousMocks === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previousMocks;
    try {await browser?.close();} finally {await server?.close();}
  }
}

const modelNames = {proposed: 'SettingsNavProposedReplay', current: 'SettingsNavCurrentReplay'};

export async function checkSettingsNavRefinement(extraSources = []) {
  const {proposed, historical, differences, sources, driverHashes} = await mounted(extraSources);
  const shared = {sources, driverHashes, modelPath: comparison, scope: 'bounded-orchestration', assumptions: [
    'Actual grouped Settings and its alpha-back handler execute in flag-off Chromium. Native and resident transport ports are synthetic and requests outside loopback are fenced.',
    'Mounted DOM title and actual selected route establish the semantic Settings page. Account and Apps grouping indexes project to top for shared leaf navigation; grouping and license query are explicit projection boundaries.',
    'The current Account sheet overlays the Settings root and is explicitly projected to the historical plan leaf. Its visible Sign out confirmation is observed as a rendered dialog; only dismissal is exercised and the durable Cloud owner remains unchanged.',
    'Replay aliases supply the original row tuples and original profile initializers. ProfileSafety checks each original model profile; it does not assert equivalence of the full rendered row inventory.',
  ]};
  const receipts = [];
  for (const [profile, traces] of [['proposed', proposed], ['current', historical]]) {
    receipts.push(await checkTraces({...shared, model: modelNames[profile], traces}));
  }
  const mismatches = [];
  for (const [id, profile, trace] of differences) {
    const out = 'test-results/quint-refinement/'+id+'.json';
    await assert.rejects(checkTraces({...shared, model: modelNames[profile], id, out, traces: [trace]}), /Source\/model trace mismatch/);
    const receiptPath = resolve(root, out);
    const mismatch = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, id, receiptPath});
  }
  return {receipts, mismatches};
}
