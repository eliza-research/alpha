import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.ts';
import {flagOffAndroid, fenceNetwork, residentHome} from '../../../../test/browser/flag-off-android.ts';
import {residentStub} from '../../../../test/browser/resident-stub.ts';
import {installHomeCalendar, refreshHomeCalendar} from '../../../../test/browser/helpers/home-calendar.ts';
import {captureInputs, checkTraces, qset} from '../../refinement/check-traces.mjs';

const comparison = 'test/fixtures/quint/HomeLayoutComparison.qnt';
const home = page => page.getByRole('region', {name: 'Home', exact: true});
const card = (page, kind) => home(page).locator('[data-alpha-home-'+kind+']');
const tile = (page, name) => home(page).getByRole('button', {name, exact: true}).and(page.locator('[data-mobile-shell-tile]'));
const back = page => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
const expect = baseExpect.configure({timeout: 15000});
const action = (name, ...args) => ({name, args});
const syntheticWorkflow = 'Synthetic Home routine';
const syntheticMail = 'Synthetic unread Home subject';
const syntheticBrief = 'Synthetic retained Home brief';
const syntheticEvent = 'Synthetic Home event';
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-home-vite-cache');

async function attachFixture(page, launcher) {
  const initializers = [];
  const fixture = {async addInitScript(script, args) {
    assert.equal(typeof script, 'function');
    initializers.push('('+script.toString()+')('+(JSON.stringify(args) ?? 'undefined')+');');
  }};
  await flagOffAndroid(fixture, {digests: 'renderer', accounts: []});
  await residentStub(fixture, {accounts: [{
    token: 'quint-home-fixture-owner', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5',
    email: 'home@example.invalid', balance: 5,
  }]});
  await fixture.addInitScript(({launcher, syntheticWorkflow, syntheticMail}) => {
    const state = window.homeFixture = {held: false, requests: 0, roleReads: 0, surfaceReads: 0,
      workflows: [], unread: false};
    const insets = new Promise(resolve => {state.releaseInsets = resolve;});
    const credential = JSON.parse(window.flagOff.slots['cloud:production']);
    credential.expiresAt = Date.now() + 30 * 86_400_000;
    window.flagOff.slots['cloud:production'] = JSON.stringify(credential);
    window.flagOff.persist();
    const cap = window.Capacitor;
    for (const [name, entries] of Object.entries({
      AlphaNotifications: {addListener: 'callback', removeListener: 'promise'},
      ElizaSystem: {getStatus: 'promise', getDeviceSettings: 'promise', requestRole: 'promise',
        listLauncherApps: 'promise', getLocaleInfo: 'promise'},
    })) {
      const header = cap.PluginHeaders.find(row => row.name === name);
      for (const [method, rtype] of Object.entries(entries))
        if (!header.methods.some(row => row.name === method)) header.methods.push({name: method, rtype});
    }
    const base = cap.nativePromise;
    cap.nativePromise = async (plugin, method, input) => {
      if (plugin === 'ElizaSystem') {
        if (method === 'getBuildInfo') return {launcher, version: 'quint-home'};
        if (method === 'listLauncherApps') return {apps: []};
        if (method === 'getLocaleInfo') return {locale: 'en-US', hour24: false};
        if (method === 'getDeviceSettings') return {volumes: []};
        if (method === 'getStatus') {
          state.roleReads++;
          return {packageName: 'ai.alphacompute.alphaphone',
            roles: [{role: 'home', androidRole: 'android.app.role.HOME', available: true, held: state.held, holders: []}]};
        }
        if (method === 'requestRole') {
          if (!launcher || input.role !== 'home') throw Error('Unexpected synthetic role request');
          state.requests++;
          // First Android dialog is declined. Only the second readback holds HOME.
          state.held = state.requests > 1;
          return {role: 'home', held: state.held, resultCode: state.held ? -1 : 0};
        }
      }
      if (plugin === 'DailyApps' && method === 'surfaceInfo') {
        state.surfaceReads++;
        if (launcher && state.surfaceReads >= 2) {
          await insets;
          return {assistant: false, developmentBuild: false, topInset: 96, bottomInset: 30};
        }
      }
      if (plugin === 'Agent' && method === 'request' && input.method !== 'POST') {
        if (input.path === '/api/workflow/status') return {status: 200, body: JSON.stringify({engine: 'smthrs', status: 'ready', hostedDigestProtocol: 1})};
        if (input.path === '/api/automations') {
          return {status: 200, body: JSON.stringify({automations: state.workflows.map((enabled, index) => ({
            id: 'home-flow-'+index, title: syntheticWorkflow, enabled, status: enabled ? 'active' : 'paused',
            type: 'workflow', workflowId: 'home-flow-'+index, schedules: [],
          }))})};
        }
        const emptySource = {'/api/lifeops/scheduled-tasks?ownerVisibleOnly=1': 'tasks',
          '/api/lifeops/reminders': 'reminders', '/api/lifeops/definitions': 'definitions'}[input.path];
        if (emptySource) return {status: 200, body: JSON.stringify({[emptySource]: []})};
        if (input.path === '/api/workflow/workflows') {
          return {status: 200, body: JSON.stringify({workflows: state.workflows.map((active, index) => ({
            id: 'home-flow-'+index, name: syntheticWorkflow, active, versionId: 'version-'+index, steps: [],
          }))})};
        }
      }
      const response = await base(plugin, method, input);
      if (plugin === 'AlphaConnection' && method === 'request'
          && new URL(input.url).pathname === '/api/v1/eliza/google/gmail/search' && response.status === 200) {
        return {...response, data: {...response.data, messages: response.data.messages.map(message => ({
          ...message, isUnread: state.unread && message.subject === syntheticMail,
        }))}};
      }
      return response;
    };
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {throw Error('Home fixture forbids physical capture');};
  }, {launcher, syntheticWorkflow, syntheticMail});
  await page.addInitScript('window.__name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n'
    +initializers.join('\n'));
}

async function snapshot(page) {
  await expect(home(page)).toBeVisible();
  return home(page).evaluate((element, expected) => {
    const get = kind => element.querySelector('[data-alpha-home-'+kind+']');
    const text = kind => get(kind)?.textContent || '';
    const top = element.getBoundingClientRect().top;
    const grid = element.querySelector('[data-alpha-home-apps]').getBoundingClientRect();
    const focused = document.activeElement?.matches('[data-alpha-composer]');
    const viewport = window.visualViewport.height;
    return {
      shown: ['calendar', 'workflows', 'inbox', 'brief'].filter(kind => get(kind)?.getBoundingClientRect().height > 0),
      date: !!get('date'), setup: !!element.querySelector('.home-date-setup'),
      cal: get('calendar')?.getAttribute('data-alpha-home-calendar-event') === 'true' ? 'event'
        : /Calendar unavailable/.test(text('calendar')) ? 'error' : /Nothing planned|No upcoming events/.test(text('calendar')) ? 'none' : undefined,
      flows: text('workflows').includes(expected.workflow) ? 'active'
        : /\bNone\b/.test(text('workflows')) ? 'none' : undefined,
      mail: text('inbox').includes(expected.mail) ? 'unread'
        : /Connect email/.test(text('inbox')) ? 'unconnected' : /No unread email/.test(text('inbox')) ? 'none' : undefined,
      brief: !get('brief') || /No brief yet/.test(text('brief')) ? false : text('brief').includes(expected.brief) ? true : undefined,
      insets: document.documentElement.style.getPropertyValue('--native-top-inset') ? 'native' : 'pending',
      dock: focused && viewport < 800 ? 'keyboard' : document.querySelector('[data-alpha-input-bar]')?.getBoundingClientRect().height ? 'bar' : undefined,
      gridTop: Math.round(grid.top-top+element.scrollTop),
    };
  }, {workflow: syntheticWorkflow, mail: syntheticMail, brief: syntheticBrief});
}

function project(observation, profile) {
  const expected = Object.fromEntries(['cal', 'flows', 'mail', 'brief', 'dock']
    .filter(field => observation[field] !== undefined).map(field => ['s.'+field, observation[field]]));
  if (observation.insets === 'native' || profile === 'current') expected['s.insets'] = observation.insets;
  if (profile === 'current') {
  }
  return expected;
}

function replay(name, profile, events, extras = () => ({})) {
  let previous = {cal: 'loading', flows: 'loading', mail: 'loading', brief: false, dock: 'bar',
    insets: profile === 'current' ? 'pending' : 'native'};
  const steps = events.map(({label, observation}, index) => {
    const actions = [];
    for (const [field, transition] of [
      ['cal', 'CalendarSource'], ['flows', 'WorkflowSource'], ['mail', 'MailSource'], ['dock', 'ChangeDock'],
    ]) {
      if (observation[field] !== undefined && previous[field] !== observation[field]) actions.push(action(transition, observation[field]));
    }
    if (observation.brief !== undefined && previous.brief !== observation.brief) actions.push(action('BriefSource'));
    if (previous.insets === 'pending' && observation.insets === 'native') actions.push(action('InsetsArrive'));
    const update = Object.fromEntries(Object.entries(observation).filter(([, value]) => value !== undefined));
    previous = {...previous, ...update, insets: profile === 'current' ? observation.insets : 'native'};
    return {label, action: actions.length ? actions : null, expect: {...project(observation, profile), ...extras(observation, index)}};
  });
  // The first mounted observation shares the historical initializer's empty
  // brief. Other already-settled reads enter as the first source actions.
  return {name, expect: {'s.brief': events[0].observation.brief}, steps};
}

async function roleSchedule(page, launcher) {
  const settings = page.locator('[data-settings-page]:not([inert])').last();
  const reads = () => page.evaluate(() => window.homeFixture.roleReads);
  await tile(page, 'Settings').click();
  await settings.getByRole('button', {name: 'General', exact: true}).click();
  await expect.poll(reads).toBeGreaterThan(0);
  const offer = settings.getByRole('button', {name: 'Make Alpha your Home app', exact: true});
  if (launcher) {
    await expect(offer).toBeVisible();
    const before = await reads();
    await offer.click();
    await expect.poll(reads).toBeGreaterThan(before);
    await expect(offer).toBeVisible();
    await offer.click();
    await expect(offer).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({
      held: window.homeFixture.held, requests: window.homeFixture.requests,
    }))).toEqual({held: true, requests: 2});
  } else {
    await expect(offer).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.homeFixture.requests), 0);
  }
  await back(page);
  await expect(settings).toHaveAttribute('data-settings-page', 'Settings');
  await back(page);
  await expect(home(page)).toBeVisible();
}

async function settleHomeLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const layer = document.querySelector('[data-alpha-home-layout]');
    const grid = layer.querySelector('[data-alpha-home-apps]');
    let previous, stable = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const top = Math.round((grid.getBoundingClientRect().top
        - layer.getBoundingClientRect().top + layer.scrollTop) * 100) / 100;
      if (top === previous) stable++; else stable = 0;
      if (stable === 3) return;
      previous = top;
    }
    throw Error('Mounted Home grid did not settle for inset observation');
  });
}

async function collect(page) {
  const events = [];
  async function point(label, readback = {}) {
    const observation = {...await snapshot(page), ...readback};
    events.push({label, observation});
    return observation;
  }
  await expect(card(page, 'workflows')).toHaveCount(0);
  await expect(card(page, 'inbox')).toHaveCount(0);
  await expect(card(page, 'brief')).toHaveCount(0);
  await settleHomeLayout(page);
  const pending = await point('Mounted Home hides empty cards before the workflow and inset readbacks');
  assert.equal(pending.insets, 'pending');
  await page.evaluate(() => window.homeFixture.releaseInsets());
  await expect.poll(async () => (await snapshot(page)).insets).toBe('native');
  await settleHomeLayout(page);
  const inset = await point('Native inset readback moves the actual grid relative to the Home layer');
  events.at(-1).label += ' from '+pending.gridTop+' to '+inset.gridTop+' CSS pixels';
  assert.equal(inset.insets, 'native');

  await tile(page, 'Workflows').click();
  await expect(page.getByText('No workflows yet', {exact: true}).filter({visible: true})).toBeVisible();
  await back(page);
  await expect(card(page, 'workflows')).toHaveCount(0);
  await installHomeCalendar(page);
  await expect(card(page, 'calendar')).toHaveCount(0);
  const empty = await point('Empty Calendar and Workflows plus disconnected Inbox have no Home cards', {cal: 'none', flows: 'none', mail: 'unconnected'});
  assert.equal(empty.cal, 'none');
  assert.equal(empty.flows, 'none');
  assert.equal(empty.mail, 'unconnected');
  assert.equal(empty.brief, false);
  assert.deepEqual(empty.shown, []);
  const emptyIndex = events.length-1;

  await tile(page, 'Settings').click();
  const settings = page.locator('[data-settings-page]:not([inert])').last();
  await settings.getByRole('button', {name: 'Account', exact: true}).click();
  const account = page.getByRole('dialog', {name: 'Account', exact: true});
  await expect(account.getByRole('button', {name: 'Google & email', exact: true})).toBeVisible();
  await account.getByRole('button', {name: 'Close Account', exact: true}).click();
  await expect(account).toHaveCount(0);
  await expect(settings).toHaveAttribute('data-settings-page', 'Settings');
  await back(page);
  await roleSchedule(page, true);
  await point('Google setup is in Settings; declined then granted HOME role returns to the same Home');
  const iso = offset => new Date(Date.now()+offset).toISOString();
  await installHomeCalendar(page, {title: syntheticEvent, startAt: iso(3_600_000), endAt: iso(7_200_000)});
  await expect(card(page, 'calendar')).toContainText(syntheticEvent);
  await page.evaluate(() => {window.homeFixture.workflows = [false];});
  const workflowApp = page.locator('[data-alpha-layer="app"]');
  await tile(page, 'Workflows').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'workflows');
  await expect(workflowApp.getByText(syntheticWorkflow, {exact: true})).toBeVisible();
  const paused = await workflowApp.getByText('Paused', {exact: true}).isVisible();
  assert.equal(paused, true);
  await back(page);
  await expect(card(page, 'workflows')).toHaveCount(0);
  await point('Current calendar event and verified paused workflow without a Home row', {flows: paused ? 'paused' : undefined});

  await page.evaluate(({subject, brief}) => {
    const f = window.flagOff;
    window.homeFixture.workflows = [true];
    window.homeFixture.unread = true;
    const account = window.residentStub.accounts[0];
    account.inbox = 'home-mail@example.invalid';
    f.mail.accounts = [{connectionId: 'grant-'+account.userId.slice(0, 8), email: account.inbox, connected: true, messages: [{
      externalId: 'home-mail', threadId: 'home-thread', subject, from: 'Synthetic sender', fromEmail: 'sender@example.invalid',
      to: ['home-mail@example.invalid'], snippet: 'Synthetic private snippet', bodyText: 'Never read by Home',
    }]}];
    const completedAt = new Date(Date.now()-60_000).toISOString();
    const startedAt = new Date(Date.parse(completedAt)-30_000).toISOString();
    const scheduledAt = new Date(Date.parse(completedAt)-60_000).toISOString();
    f.digests.results.push({cursor: 1, runId: 'home-run', workflowId: 'home-morning',
      workflowVersionId: 'version-home', templateVersion: 'hosted-digest-1',
      scheduledAt, startedAt, completedAt, status: 'finished', output: {summary: brief}, error: null,
      source: {observedAt: scheduledAt, expiresAt: new Date(Date.now()+86_400_000).toISOString()}});
    f.persist();
    window.dispatchEvent(new CustomEvent('alpha:gmail-accounts-changed', {detail: {source: 'settings'}}));
    window.dispatchEvent(new Event('online'));
  }, {subject: syntheticMail, brief: syntheticBrief});
  await tile(page, 'Workflows').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'workflows');
  await expect(workflowApp.getByText('Active', {exact: true})).toBeVisible();
  await back(page);
  await expect(card(page, 'workflows')).toContainText(syntheticWorkflow);
  await expect(card(page, 'inbox')).toContainText(syntheticMail);
  await expect(card(page, 'inbox')).not.toContainText('Synthetic private snippet');
  await expect(card(page, 'brief')).toContainText(syntheticBrief);
  const full = await point('Enabled workflow, authorized unread headers and a retained digest show their Home cards');
  assert.equal(full.flows, 'active');
  assert.equal(full.mail, 'unread');
  assert.equal(full.brief, true);
  const fullIndex = events.length-1;

  const input = page.locator('[data-alpha-layer="composer"] textarea[data-alpha-composer]');
  await input.focus();
  await page.setViewportSize({width: 412, height: 620});
  // Deliver the covered frame to the mounted keyboard watcher before restoring the viewport.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(input).toBeFocused();
  const keyboard = await point('Focused composer receives a reduced viewport representing the keyboard');
  assert.equal(keyboard.dock, 'keyboard');
  await page.setViewportSize({width: 412, height: 915});
  await expect(input).not.toBeFocused();
  assert.equal((await point('Restored viewport returns to the bar')).dock, 'bar');

  await refreshHomeCalendar(page, {fail: true});
  await expect(card(page, 'calendar')).toHaveCount(0);
  await point('Failed Calendar read removes the unverified Home event', {cal: 'error'});
  const effects = await page.evaluate(() => ({
    bodies: window.flagOff.mail.reads, sends: window.flagOff.mail.dispatches,
    runs: window.flagOff.digests.runs, posts: window.flagOff.posts,
    bodyRequests: window.residentStub.cloud.filter(row => /\/gmail\/(?:read|inbox-v1\/thread)$/.test(row.path)),
  }));
  assert.deepEqual(effects, {bodies: [], sends: [], runs: 0, posts: [], bodyRequests: []});
  const main = [
    ['HomeLayoutCurrentReplay', replay('mounted_launcher_content_and_measured_inset_arrival', 'current', events,
      (observation, index) => ({
        ...(index === 1 ? {GridStable: observation.gridTop === pending.gridTop} : {}),
        ...(index === fullIndex ? {Shown: qset(observation.shown)} : {}),
      }))],
    ['HomeLayout', replay('mounted_launcher_source_and_dock_projection', 'proposed', events,
      (observation, index) => index === fullIndex ? {Shown: qset(observation.shown)} : {})],
  ];
  const emptyEvents = events.slice(0, emptyIndex+1);
  const differences = [
    ['HomeLayoutCurrentEmptyShells', 'HomeLayoutCurrentReplay', 'historical_current_keeps_empty_card_shells',
      observation => ({Shown: qset(observation.shown)})],
    ['HomeLayoutProposedDateLine', 'HomeLayout', 'historical_proposed_shows_date_when_no_content',
      observation => ({DateLine: observation.date})],
    ['HomeLayoutProposedSetupLink', 'HomeLayout', 'historical_proposed_shows_inline_google_setup',
      observation => ({SetupLink: observation.setup})],
  ].map(([id, model, name, observe]) => [id, model, replay(name,
    model === 'HomeLayout' ? 'proposed' : 'current', emptyEvents, (observation, index) => index === emptyIndex ? observe(observation) : {})]);
  return {main, differences};
}

async function mounted(extraSources) {
  checkClientFeatures();
  const watched = new Set(['main.tsx', 'prototype/data-adapter.ts', 'prototype/home-overview-cards.ts',
    'prototype/home-shell.ts', 'prototype/settings-adapter.ts', 'prototype/automations-adapter.ts',
    'prototype/inbox-cloud-adapter.ts', 'prototype/chat-overlay-motion-adapter.ts'].map(path => resolve(root, 'apps/app/src/'+path)));
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'bun.lock', 'upstream.lock.json',
    'scripts/prepare-client-features.ts', 'scripts/quint-lib.ts',
    'test/browser/flag-off-android.ts', 'test/browser/resident-stub.ts', comparison,
    'test/browser/helpers/native-navigation-protocol.ts', 'test/browser/helpers/home-calendar.ts',
    'test/browser/helpers/page-modules.ts', fileURLToPath(import.meta.url), ...extraSources,
  ])];
  const driverHashes = captureInputs(sources);
  const loaded = new Set();
  const previousMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-home-layout-readback', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted source matches the driver capture');
            loaded.add(path);
          }
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const baseURL = 'http://127.0.0.1:'+server.httpServer.address().port;
    async function scenario(launcher, body) {
      const page = await browser.newPage({baseURL, viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(35000);
      page.setDefaultNavigationTimeout(90000);
      const foreign = await fenceNetwork(page), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await attachFixture(page, launcher);
      try {
        await residentHome(page);
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('standalone-app')), !launcher);
        const result = await body(page);
        assert.deepEqual(foreign, [], 'External requests are fenced');
        assert.deepEqual(errors, [], 'Mounted Home reports no uncaught browser errors');
        return result;
      } finally {await page.close();}
    }
    const observations = await scenario(true, collect);
    await scenario(false, page => roleSchedule(page, false));
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {...observations, sources, driverHashes};
  } finally {
    if (previousMocks === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previousMocks;
    try {await browser?.close();} finally {await server?.close();}
  }
}

export async function checkHomeLayoutRefinement(extraSources = []) {
  const {main, differences, sources, driverHashes} = await mounted(extraSources);
  const shared = {sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual flag-off Home and Settings run in Chromium with synthetic native role, inset, canonical Calendar, resident workflow, managed mail and retained-digest ports. Network traffic outside loopback is fenced.',
    'Content states are derived from mounted card copy, visibility, event identity and retained-result presentation. Unknown transient copy is left unobserved. Font readiness and stable animation frames separate completed layout from the native CSS-variable readback. Actual Home grid movement is compared as a boolean, without identifying CSS pixels with the historical constants.',
    'The reduced focused viewport represents the keyboard. HOME offer, decline, readback grant and standalone absence are checked at visible Settings controls. Role status itself is outside the historical Home model.',
    'Both historical profiles compare source states and the full card set when all four have content. The original current profile retains empty shells that the owner-approved renderer now hides; that difference and the proposed date/setup differences have separate mismatch receipts. Historical models are unchanged.',
  ]};
  const modelOptions = model => ({model, ...(model === 'HomeLayout' ? {} : {modelPath: comparison})});
  const receipts = [];
  for (const [model, trace] of main) receipts.push(await checkTraces({...shared, ...modelOptions(model), traces: [trace]}));
  const mismatches = [];
  for (const [id, model, trace] of differences) {
    const out = 'test-results/quint-refinement/'+id+'.json';
    const receiptPath = resolve(root, out);
    await assert.rejects(checkTraces({...shared, ...modelOptions(model), id, out, traces: [trace]}), /Source\/model trace mismatch/);
    const mismatch = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, id, receiptPath});
  }
  return {receipts, mismatches};
}
