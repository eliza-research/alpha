import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {filesWithin, repositoryRoot as root, sha256} from '../../../../scripts/quint-lib.ts';
import {fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {installOneCalendar} from '../../../../test/browser/helpers/one-calendar.ts';
import {captureInputs, checkTraces, qset} from '../../refinement/check-traces.mjs';

const expect = baseExpect.configure({timeout: 30000});
const model = 'GoogleConnect';
const authorization = 'https://fixture.invalid/google-consent';
const googlePanel = page => page.getByRole('dialog', {name: 'Google accounts', exact: true});
const button = (page, name) => page.getByRole('button', {name, exact: true});
const active = (page, view) => expect(page.locator('html')).toHaveAttribute('data-active-view', view);
const action = (name, ...args) => ({name, args});
const fixture = page => page.evaluate(() => window.googleConnectFixture);
const scopes = new Map([['google.gmail.triage', 'gmail.read'], ['google.gmail.send', 'gmail.write'],
  ['google.calendar.read', 'cal.read'], ['google.calendar.write', 'cal.write']]);
const mailbox = rows => qset(rows.flatMap(row => row.grantedCapabilities).map(scope => scopes.get(scope)).filter(Boolean));

async function setup(page, google, googleInFeed, mailOnly) {
  await page.addInitScript(() => {
    const f = window.googleConnectFixture = {launches: [], initiations: [], reads: [], searches: [], rows: []};
    const methods = ['request', 'cancel', 'secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'openExternal'];
    window.Capacitor = {PluginHeaders: [{name: 'AlphaConnection', methods: methods.map(name => ({name, rtype: 'promise'}))}],
      async nativePromise(plugin, method, input) {
        if (plugin !== 'AlphaConnection') throw Error('Unexpected synthetic native plugin');
        if (method === 'secureRead') return {value: null};
        if (method === 'secureCompareExchange') return {status: 'saved'};
        if (['secureWrite', 'secureRemove', 'cancel'].includes(method)) return {};
        if (method === 'openExternal') {f.launches.push(input.url); return {};}
        throw Error('Native network is closed');
      }};
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async () => {throw Error('Google comparison forbids physical capture');};
  });
  await installOneCalendar(page, {google, googleInFeed});
  await page.evaluate(async ({authorization, mailOnly}) => {
    const {connectionController: controller} = window.__alphaModules['/src/runtime/connection-ui.tsx'];
    const {client} = controller.getCloudClient(), f = window.googleConnectFixture;
    f.rows = await client.gmailAccounts();
    if (mailOnly) for (const row of f.rows) row.grantedCapabilities = row.grantedCapabilities.filter(scope => scope.includes('.gmail.'));
    client.gmailAccounts = async signal => {
      signal?.throwIfAborted();
      const rows = structuredClone(f.rows);
      f.reads.push(rows);
      return rows;
    };
    client.gmailSearch = async (grant, query, signal) => {
      signal?.throwIfAborted();
      if (!f.rows.some(row => row.connectionId === grant)) throw Error('Mailbox has no current grant');
      f.searches.push({grant, query});
      return {messages: [], syncedAt: 'fixture-mail-revision', nextPageToken: null};
    };
    client.initiateGoogle = async (signal, calendar, gmail) => {
      signal.throwIfAborted();
      f.initiations.push([calendar, gmail]);
      return authorization;
    };
  }, {authorization, mailOnly});
}

async function openInbox(page, connected) {
  await button(page, 'Inbox').click();
  await active(page, 'inbox');
  if (connected) {
    await expect(button(page, 'Refresh inbox')).toBeVisible();
    await expect(button(page, 'Connect Gmail')).toHaveCount(0);
    await expect.poll(async () => (await fixture(page)).searches.length).toBeGreaterThan(0);
  } else {
    await expect(button(page, 'Connect Gmail')).toBeVisible();
    assert.deepEqual((await fixture(page)).searches, [], 'The unlinked inbox makes no mailbox request');
  }
  const result = await fixture(page);
  assert.ok(result.reads.length > 0);
  return {'s.screen': 'Inbox', 's.inboxView': await button(page, 'Connect Gmail').isVisible() ? 'connect' : 'mail',
    's.scopes': mailbox(result.reads.at(-1))};
}

function schedule(name, design, initial) {
  const trace = {name, init: action('StartState', design, false, initial['s.scopes'], 'Inbox'), expect: initial, steps: []};
  return {trace, record(label, action, expect) {trace.steps.push({label, action, expect});}};
}

async function panelFlow(page) {
  const t = schedule('opening-and-closing-google-accounts-from-unlinked-inbox', 'current', await openInbox(page, false));
  const panel = googlePanel(page);
  await button(page, 'Connect Gmail').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('No Google account connected.');
  const ready = await fixture(page);
  assert.deepEqual([ready.initiations, ready.launches, ready.searches], [[], [], []]);
  t.record('Opening the actual account review does not initiate consent', action('TapConnect'),
    {'s.screen': 'Panel', 's.requested': qset([]), 's.scopes': mailbox(ready.reads.at(-1))});
  const direct = structuredClone(t.trace);
  direct.name = 'historical-proposed-one-tap-omits-the-account-panel';
  direct.init.args[0] = 'proposed';
  const consent = structuredClone(t.trace);
  consent.name = 'historical-current-requests-only-read-access';
  await panel.getByRole('button', {name: 'Close Google accounts', exact: true}).click();
  await expect(panel).toHaveCount(0);
  await active(page, 'inbox');
  await expect(button(page, 'Connect Gmail')).toBeVisible();
  t.record('Closing the account review returns to the unlinked inbox', action('ClosePanel'),
    {'s.screen': 'Inbox', 's.inboxView': 'connect'});

  await button(page, 'Connect Gmail').click();
  await expect(panel.getByRole('status')).toHaveText('No Google account connected.');
  await panel.getByRole('button', {name: 'Connect Google account', exact: true}).click();
  await expect(panel.getByRole('status')).toHaveText('Waiting for Google…');
  const handedOff = await fixture(page);
  assert.deepEqual(handedOff.launches, [authorization]);
  assert.deepEqual(handedOff.initiations, [['write', 'send']]);
  assert.deepEqual(handedOff.searches, []);
  const [[calendar, gmail]] = handedOff.initiations;
  consent.steps.push({label: 'The actual combined request offers Gmail send and Calendar write', action: action('PanelConnect'),
    expect: {'s.requested': qset(['gmail.read', 'cal.read', ...(gmail === 'send' ? ['gmail.write'] : []),
      ...(calendar === 'write' ? ['cal.write'] : [])])}});
  return {trace: t.trace, differences: [['GoogleConnectProposedDirectConsent', direct], ['GoogleConnectCurrentReadOnlyRequest', consent]]};
}

async function mergedFeed(page) {
  const t = schedule('verified-combined-grant-supports-inbox-and-merged-calendar', 'proposed', await openInbox(page, true));
  await button(page, 'Back to apps').click();
  const upcoming = page.locator('[data-alpha-home-calendar]');
  await expect(upcoming).toContainText('Public holiday');
  await upcoming.click();
  await active(page, 'calendar');
  await button(page, 'Back to calendar').click();
  for (const title of ['Team standup', 'Dentist']) await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
  t.record('Calendar includes verified Google and local rows without a new account picker', action('SwitchApp'),
    {'s.screen': 'Calendar', 's.calView': 'google'});
  await button(page, 'Back to apps').click();
  t.record('Returning to Inbox uses the verified mailbox grant without a new consent', action('SwitchApp'), await openInbox(page, true));
  const observed = await fixture(page);
  assert.deepEqual([observed.launches, observed.initiations], [[], []]);
  assert.equal(await page.evaluate(() => window.oneCalendarFixture.googleCalendarLists), 0);
  return {trace: t.trace, differences: []};
}

async function revokedInbox(page) {
  const t = schedule('mailbox-scope-loss-retires-visible-inbox', 'proposed', await openInbox(page, true));
  await page.evaluate(() => {
    window.googleConnectFixture.rows = [];
    window.dispatchEvent(new Event('alpha:google-accounts-changed'));
  });
  await expect(button(page, 'Connect Gmail')).toBeVisible();
  await expect(button(page, 'Connect Gmail')).toBeVisible();
  const retired = await fixture(page);
  t.record('Canonical empty grant readback retires the mailbox without a manual refresh', action('Revoke'),
    {'s.screen': 'Inbox', 's.inboxView': 'connect', 's.scopes': mailbox(retired.reads.at(-1))});
  assert.deepEqual([retired.launches, retired.initiations], [[], []]);
  return {trace: t.trace, differences: []};
}

async function mounted(extraSources) {
  checkClientFeatures();
  const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-google-connect-vite-cache');
  const watched = new Set(['apps/app/src/main.tsx', 'apps/app/src/prototype/inbox-cloud-adapter.ts',
    'apps/app/src/prototype/agent-calendar-adapter.ts', 'apps/app/src/runtime/google-connection-ui.tsx',
    'apps/app/src/runtime/google-accounts.ts'].map(path => resolve(root, path)));
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts', 'apps/app/index.html', 'vite.config.ts', 'package.json', 'bun.lock',
    'upstream.lock.json', 'scripts/prepare-client-features.ts', 'scripts/quint-lib.ts', fileURLToPath(import.meta.url),
    'test/browser/flag-off-android.ts', 'test/browser/helpers/native-navigation-protocol.ts',
    'test/browser/helpers/one-calendar.ts', 'test/browser/helpers/page-modules.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources), loaded = new Set();
  let server, browser;
  try {
    const previous = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    try {
      server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir,
        server: {host: '127.0.0.1', port: 0, hmr: false, watch: null},
        define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
        plugins: [{name: 'quint-google-connect-inputs', enforce: 'pre', transform(code, id) {
          const path = id.split('?')[0];
          if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
            assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
            if (watched.has(path)) {assert.equal(sha256(Buffer.from(code)), driverHashes[path]); loaded.add(path);}
          }
        }}]});
    } finally {
      if (previous === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
      else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previous;
    }
    await server.listen();
    browser = await chromium.launch({headless: true});
    const baseURL = 'http://127.0.0.1:'+server.httpServer.address().port, results = [];
    for (const [google, inFeed, mailOnly, drive] of [[false, false, false, panelFlow], [true, true, false, mergedFeed], [true, false, true, revokedInbox]]) {
      const page = await browser.newPage({baseURL, viewport: {width: 412, height: 915}, reducedMotion: 'reduce'});
      page.setDefaultTimeout(45000);
      page.setDefaultNavigationTimeout(90000);
      const foreign = await fenceNetwork(page), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await setup(page, google, inFeed, mailOnly);
        results.push(await drive(page));
        assert.deepEqual(foreign, [], 'The fixture keeps Google and Cloud effects within controlled ports');
        assert.deepEqual(errors, []);
      } catch (error) {throw Error('Mounted Google Connect schedule failed: '+drive.name, {cause: error});}
      finally {await page.close();}
    }
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {results, sources, driverHashes};
  } finally {try {await browser?.close();} finally {await server?.close();}}
}

export async function checkGoogleConnectRefinement(extraSources = []) {
  const {results, sources, driverHashes} = await mounted(extraSources);
  const shared = {model, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Flag-off Chromium mounts real Inbox, Google accounts and merged Calendar. Cloud account, feed and openExternal ports are synthetic. The Calendar projection google means Google rows are included in the visible merged view.',
    'The current panel actions, existing-grant app switching and account readback retirement use the original action relations. Intermediate browser return, consent completion, actual provider access and temporal convergence are separate.',
  ]};
  const receipt = await checkTraces({...shared, traces: results.map(row => row.trace)});
  const mismatches = [];
  for (const [id, trace] of results.flatMap(row => row.differences)) {
    const out = 'test-results/quint-refinement/'+id+'.json';
    await assert.rejects(checkTraces({...shared, id, out, traces: [trace]}), /Source\/model trace mismatch/);
    const receiptPath = resolve(root, out), mismatch = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound && mismatch.inputsUnchanged);
    mismatches.push({...mismatch, id, receiptPath});
  }
  return {receipts: [receipt], mismatches};
}
