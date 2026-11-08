import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, repositoryRoot as root, sha256} from '../../../../scripts/quint-lib.mjs';
import {fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {entitlements, startNativeCloudSignInFixture, USER} from '../../../../test/browser/helpers/native-cloud-signin.ts';
import {captureInputs, checkTraces, qset} from '../../refinement/check-traces.mjs';

const expect = baseExpect.configure({timeout: 30000});
const panel = page => page.locator('.alpha-cloud-sign-in');
const button = (page, name) => panel(page).getByRole('button', {name, exact: true});
const address = 'synthetic-signin@example.invalid';
const action = (name, ...args) => ({name, args});
const model = 'SignIn';
const state = page => page.evaluate(() => {
  const fixture = window.signInFixture, current = window.planController.getSnapshot();
  return {step: current.signIn?.step, owner: current.cloudAccount?.userId ?? null,
    kind: current.kind, inference: current.residentInference, error: current.error,
    saved: fixture.saved, calls: fixture.calls.map(({method, path, email, phone}) => ({method, path, email, phone}))};
});

async function chooser(page, google) {
  await expect(panel(page).getByRole('heading', {name: 'Welcome to Alpha.', exact: true})).toBeVisible();
  await expect(panel(page).getByRole('textbox', {name: 'Email', exact: true})).toBeVisible();
  await expect(button(page, 'Use phone number instead')).toBeVisible();
  if (google) await expect(button(page, 'Continue with Google')).toBeVisible();
  else await expect(button(page, 'Continue with Google')).toHaveCount(0);
  const enabled = ['email', 'phone'];
  if (await button(page, 'Continue with Google').count()) {
    await expect(button(page, 'Continue with Google')).toBeEnabled();
    enabled.push('google');
  }
  assert.equal((await state(page)).step, 'choose');
  return {'s.screen': 'Choose', 's.offered': qset(enabled)};
}

async function emailCode(page, record) {
  await panel(page).getByRole('textbox', {name: 'Email', exact: true}).fill(address);
  await button(page, 'Email me a code').click();
  await expect(panel(page).getByRole('form', {name: 'Enter your email code'})).toBeVisible();
  const offered = await state(page);
  assert.equal(offered.step, 'code');
  assert.equal(offered.calls.filter(call => call.method === 'startEmail').at(-1)?.email, address);
  record('Mounted email form accepts the exact challenge', action('EnterAddress', 'email'),
    {'s.screen': 'Code', 's.method': 'email', 's.cred': offered.saved ? 'valid' : 'none'});
  await panel(page).getByLabel('Six-digit code').fill('000000');
  await button(page, 'Verify').click();
  await expect(panel(page).getByRole('alert')).toContainText('That code didn’t work');
  await expect(panel(page).getByLabel('Six-digit code')).toBeFocused();
  const rejected = await state(page);
  assert.equal(rejected.step, 'code');
  record('Wrong code keeps the mounted challenge and stores no sign-in', action('WrongCode'),
    {'s.screen': 'Code', 's.cred': rejected.saved ? 'valid' : 'none'});
  await panel(page).getByLabel('Six-digit code').fill('123 456');
  await button(page, 'Verify').click();
  await expect.poll(async () => {
    const value = await state(page);
    return [value.owner, value.kind, value.inference, value.saved];
  }).toEqual([USER, 'resident', 'cloud', true]);
  await expect(panel(page)).toHaveCount(0);
  const accepted = await state(page);
  assert.equal(accepted.calls.filter(call => call.method === 'verifyEmail').length, 2);
  record('Accepted code closes sign-in only after the actual controller verifies the synthetic account',
    action('EnterCode'), {'s.screen': 'Home', 's.cred': accepted.owner === USER ? 'valid' : 'none'});
}

async function phoneBack(page, record) {
  await button(page, 'Use phone number instead').click();
  await panel(page).locator('[name="phone"]').fill('+12025550101');
  await button(page, 'Text me a code').click();
  await expect(panel(page).getByRole('form', {name: 'Enter your phone code'})).toBeVisible();
  const offered = await state(page);
  assert.equal(offered.step, 'code');
  assert.equal(offered.calls.filter(call => call.method === 'startPhone').at(-1)?.phone, '+12025550101');
  record('Mounted phone form accepts its own challenge', action('EnterAddress', 'phone'),
    {'s.screen': 'Code', 's.method': 'phone'});
  await button(page, 'Back').click();
  await expect(panel(page).getByRole('heading', {name: 'Welcome to Alpha.', exact: true})).toBeVisible();
  await expect(panel(page).getByLabel('Six-digit code')).toHaveCount(0);
  const retired = await state(page);
  assert.equal(retired.step, 'choose');
  record('Back returns to the chooser and leaves the challenge unverified', action('Back'),
    {'s.screen': 'Choose', 's.cred': retired.saved ? 'valid' : 'none'});
}

async function googleBack(page, record) {
  await button(page, 'Continue with Google').click();
  await expect(panel(page).getByRole('heading', {name: 'Finish in your browser.', exact: true})).toBeVisible();
  const pending = await state(page);
  assert.equal(pending.step, 'google');
  assert.equal(pending.calls.filter(call => call.method === 'startGoogle').length, 1);
  record('Google enters the waiting screen with a held native request', action('ChooseGoogle'),
    {'s.screen': 'Google', 's.method': 'google', 's.cred': pending.saved ? 'valid' : 'none'});
  await button(page, 'Back').click();
  await expect(panel(page).getByRole('heading', {name: 'Welcome to Alpha.', exact: true})).toBeVisible();
  const retired = await state(page);
  assert.equal(retired.step, 'choose');
  assert.ok(retired.calls.some(call => call.method === 'cancel'));
  record('Back cancels that exact held sign-in and restores the chooser', action('Back'),
    {'s.screen': 'Choose', 's.cred': retired.saved ? 'valid' : 'none'});
}

async function mounted(extraSources) {
  checkClientFeatures();
  const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-sign-in-vite-cache');
  const watched = new Set(['apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/runtime/cloud-sign-in.ts',
    'apps/app/src/runtime/cloud-sign-in-ui.tsx', '.eliza/client-features/packages/auth/src/auth/native-cloud-sign-in.ts']
    .map(path => resolve(root, path)));
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'config')), ...filesWithin(resolve(root, 'patches/eliza')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs', fileURLToPath(import.meta.url),
    'test/browser/flag-off-android.ts', 'test/browser/helpers/native-navigation-protocol.ts',
    'test/browser/helpers/native-cloud-signin.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources), loaded = new Set();
  const fixture = await startNativeCloudSignInFixture(cacheDir, [{name: 'quint-sign-in-inputs', enforce: 'pre', transform(code, id) {
    const path = id.split('?')[0];
    if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
      assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
      if (watched.has(path)) {
        assert.equal(sha256(Buffer.from(code)), driverHashes[path]);
        loaded.add(path);
      }
    }
  }}]);
  let browser;
  try {
    browser = await chromium.launch({headless: true});
    const traces = [], testEntitlements = await entitlements();
    for (const [name, google, signIn, drive] of [
      ['email-wrong-code-and-verified-account', true, 'ok', emailCode],
      ['text-challenge-back-with-google-unavailable', false, 'ok', phoneBack],
      ['held-google-handoff-and-back', true, 'hold', googleBack],
    ]) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}, reducedMotion: 'reduce'});
      page.setDefaultTimeout(45000);
      const foreign = await fenceNetwork(page), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        assert.equal(page.url(), 'about:blank');
        const trace = {name, init: action('StartState', 'proposed', false, google, google, 'up', 'none', qset([])),
          expect: {'s.screen': 'Boot'}, steps: []};
        const record = (label, action, expect) => trace.steps.push({label, action, expect});
        await fixture.boot(page, {...testEntitlements, signIn, methods: {google, email: true, phone: true}});
        record('Mount and readiness open the local chooser directly', action('Boot'), await chooser(page, google));
        await drive(page, record);
        assert.deepEqual(foreign, [], 'Provider network must remain inside the synthetic native port');
        assert.deepEqual(errors, []);
        assert.deepEqual((await state(page)).calls.filter(call => call.method === 'openExternal' || call.path?.startsWith('/api/auth/cli-session')), []);
        traces.push(trace);
      } catch (error) {throw Error('Mounted SignIn schedule failed: '+name, {cause: error});}
      finally {await page.close();}
    }
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {sources, driverHashes, traces};
  } finally {try {await browser?.close();} finally {await fixture.close();}}
}

export async function checkSignInRefinement(extraSources = []) {
  const {sources, driverHashes, traces} = await mounted(extraSources);
  const shared = {model, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Flag-off Chromium mounts the actual Android renderer chooser and controller over the closed native fixture. The real controller verifies a fixture account and signed fixture entitlement. Native login, browser handoff, HTTP and SMS are synthetic ports.',
    'The source boot macro includes local startup and readiness. The Home projection means a verified synthetic account, released sign-in view and cloud-ready resident. The current historical profile instead requires a distinct sign-in gate after boot.',
    'One email challenge, one text challenge and one held Google request. The UI and native call select the method. Real browser state, callback identity, link verification, saved-account recovery, MFA and temporal convergence stay separate.',
  ]};
  const receipt = await checkTraces({...shared, traces});
  const mismatch = structuredClone(traces[0]);
  mismatch.name = 'current-historical-boot-requires-separate-sign-in-gate';
  mismatch.init.args[0] = 'current';
  mismatch.steps = mismatch.steps.slice(0, 1);
  const id = 'SignInHistoricalBootGate', out = 'test-results/quint-refinement/'+id+'.json';
  await assert.rejects(checkTraces({...shared, id, out, traces: [mismatch]}), /Source\/model trace mismatch/);
  const receiptPath = resolve(root, out), negative = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(negative.results[0].kind, 'observation-mismatch');
  assert.ok(negative.driverInputsBound && negative.inputsUnchanged);
  return {receipts: [receipt], mismatch: {...negative, id, receiptPath}};
}
