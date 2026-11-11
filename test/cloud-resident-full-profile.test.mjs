import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createCloudResidentHost} from './fixtures/product-character-host.mjs';
import {CLOUD_MODEL} from '../scripts/cloud-resident-host.ts';

function recordingLauncher(launches) {
  return async options => {
    launches.push(options);
    let finish;
    return {completion: new Promise(resolve => { finish = resolve; }), async stop() { finish({code: 0}); }};
  };
}

test('explicit full Cloud profile uses the canonical assistant without inherited lean or provider authority', async () => {
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-full-'));
  const launches = [];
  const host = await createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'full', launch: recordingLauncher(launches), inherited: {PATH: process.env.PATH, ELIZA_PLUGIN_SET: 'lean-chat', ELIZA_LEAN_CHAT_WORKFLOWS: '1', CEREBRAS_API_KEY: 'synthetic-forbidden'}});
  try {
    await host.bind({token: 'synthetic-cloud-only', credentialId: 'full', reference: 'full-ref'});
    const env = launches[0].env;
    const config = JSON.parse(await fs.readFile(join(profile, 'eliza.json'), 'utf8'));
    assert.equal(config.plugins.entries['personal-assistant'].enabled, true);
    assert.equal(env.ELIZA_PLUGIN_SET, undefined);
    assert.equal(env.ELIZA_LEAN_CHAT_WORKFLOWS, undefined);
    assert.equal(env.ELIZA_PLATFORM, undefined, 'the host must not impersonate Android');
    assert.equal(env.ELIZAOS_CLOUD_USE_INFERENCE, 'true');
    assert.equal(env.ELIZAOS_CLOUD_API_KEY, 'synthetic-cloud-only');
    assert.equal(env.CEREBRAS_API_KEY, undefined);
    assert.equal(config.cloud.apiKey, undefined);
    assert.equal(config.serviceRouting.llmText.largeModel, CLOUD_MODEL);
  } finally { await host.close(); await fs.rm(profile, {recursive: true, force: true}); }
});

test('the omitted profile option retains the existing lean Cloud host contract', async () => {
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-lean-'));
  const launches = [];
  const host = await createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, launch: recordingLauncher(launches), inherited: {PATH: process.env.PATH}});
  try {
    await host.clear();
    const config = JSON.parse(await fs.readFile(join(profile, 'eliza.json'), 'utf8'));
    assert.equal(config.plugins.entries['personal-assistant'].enabled, false);
    assert.equal(launches[0].env.ELIZA_PLUGIN_SET, 'lean-chat');
    assert.equal(launches[0].env.ELIZA_LEAN_CHAT_WORKFLOWS, '1');
  } finally { await host.close(); await fs.rm(profile, {recursive: true, force: true}); }
});

test('full mode refuses an existing assistant opt-out without rewriting it or launching a resident', async () => {
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-optout-'));
  const file = join(profile, 'eliza.json');
  const saved = JSON.stringify({cloud: {enabled: true}, serviceRouting: {llmText: {backend: 'elizacloud', transport: 'cloud-proxy', smallModel: CLOUD_MODEL, largeModel: CLOUD_MODEL}}, plugins: {entries: {'personal-assistant': {enabled: false}}}});
  await fs.writeFile(file, saved, {mode: 0o600});
  await fs.writeFile(join(profile, 'owner-token'), '1'.repeat(64), {mode: 0o600});
  const launches = [];
  try {
    await assert.rejects(createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'full', launch: recordingLauncher(launches)}), /personal-assistant.*enabled|assistant.*opt-out/i);
    assert.equal(await fs.readFile(file, 'utf8'), saved);
    assert.equal(launches.length, 0);
    await assert.rejects(fs.stat(join(profile, 'vault-passphrase')), {code: 'ENOENT'});
  } finally { await fs.rm(profile, {recursive: true, force: true}); }
});

test('an unknown profile mode fails before creating runtime state', async () => {
  const parent = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-mode-'));
  const profile = join(parent, 'not-created');
  try {
    await assert.rejects(createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'unknown'}), /profile mode/i);
    await assert.rejects(fs.stat(profile), {code: 'ENOENT'});
  } finally { await fs.rm(parent, {recursive: true, force: true}); }
});

test('full mode refuses an unset saved assistant choice without rewriting the profile', async () => {
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-unset-'));
  const file = join(profile, 'eliza.json');
  const saved = JSON.stringify({cloud: {enabled: true}, serviceRouting: {llmText: {backend: 'elizacloud', transport: 'cloud-proxy', smallModel: CLOUD_MODEL, largeModel: CLOUD_MODEL}}, plugins: {entries: {}}});
  await fs.writeFile(file, saved, {mode: 0o600});
  await fs.writeFile(join(profile, 'owner-token'), '1'.repeat(64), {mode: 0o600});
  const launches = [];
  try {
    await assert.rejects(createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'full', launch: recordingLauncher(launches)}), /personal-assistant.*enabled/);
    assert.equal(await fs.readFile(file, 'utf8'), saved);
    assert.equal(launches.length, 0);
    await assert.rejects(fs.stat(join(profile, 'vault-passphrase')), {code: 'ENOENT'});
  } finally { await fs.rm(profile, {recursive: true, force: true}); }
});

// npm test runs without the prepared SDK and skips; browser.yml's verify job sets ALPHA_REQUIRE_PREPARED_SDK=1.
const skipUnprepared = !(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE && process.env.ALPHA_BUN) && process.env.ALPHA_REQUIRE_PREPARED_SDK !== '1' ? 'Prepared SDK unavailable; run npm run agent:prepare and export ALPHA_CLOUD_COLLECTOR_SOURCE and ALPHA_BUN (browser.yml verify)' : false;
const timeoutScale = Number(process.env.ALPHA_TIMEOUT_SCALE || '1');
const validTimeoutScale = Number.isFinite(timeoutScale) && timeoutScale >= 1 && timeoutScale <= 10;
// Give the authenticated source scan more time on loaded hosts and allow setup and cleanup outside the child budget.
const collectorTimeoutMs = Math.round(120_000 * (validTimeoutScale ? timeoutScale : 1));

test('actual pinned SDK collector retains the full host assistant and preserves lean/store exclusions', {skip: skipUnprepared, timeout: collectorTimeoutMs + 120_000}, async () => {
  assert.ok(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE && process.env.ALPHA_BUN, 'ALPHA_REQUIRE_PREPARED_SDK=1 needs ALPHA_CLOUD_COLLECTOR_SOURCE and ALPHA_BUN');
  assert.ok(validTimeoutScale, 'ALPHA_TIMEOUT_SCALE must be a number from 1 to 10');
  const {spawnSync} = await import('node:child_process');
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-collector-'));
  const launches = [];
  const host = await createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'full', launch: recordingLauncher(launches), inherited: {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ELIZA_BUILD_VARIANT: 'store', ELIZA_PLATFORM: 'android', ELIZA_PLUGIN_SET: 'lean-chat'}});
  try {
    await host.bind({token: 'synthetic-cloud-only', credentialId: 'collector', reference: 'collector-ref'});
    const config = JSON.parse(await fs.readFile(join(profile, 'eliza.json'), 'utf8'));
    const actualEnvironment = launches[0].env;
    assert.equal(actualEnvironment.ELIZA_BUILD_VARIANT, undefined);
    assert.equal(actualEnvironment.ELIZA_PLATFORM, undefined);
    // The single child authenticates every committed byte before importing the collector.
    const variants = [{}, {ELIZA_PLUGIN_SET: 'lean-chat'}, {ELIZA_BUILD_VARIANT: 'store'}];
    const run = spawnSync(process.env.ALPHA_BUN, ['--no-install', '--conditions=eliza-source', 'test/fixtures/cloud-plugin-selection.mjs'], {cwd: process.cwd(), env: {...actualEnvironment, ALPHA_CLOUD_COLLECTOR_SOURCE: process.env.ALPHA_CLOUD_COLLECTOR_SOURCE, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0'}, input: JSON.stringify({config, variants}), encoding: 'utf8', timeout: collectorTimeoutMs});
    assert.equal(run.error, undefined, `the authenticated collector did not finish within ${collectorTimeoutMs / 1000} s: ${run.error?.message}`);
    assert.equal(run.signal, null, `the collector was killed by ${run.signal}`);
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.split('\n').filter(row => row.startsWith('SDK_PLUGIN_SELECTION='));
    assert.equal(lines.length, variants.length, 'the actual collector must return one selection per variant');
    const [full, lean, store] = lines.map(line => new Set(JSON.parse(line.slice('SDK_PLUGIN_SELECTION='.length))));
    assert.ok(full.has('@elizaos/plugin-personal-assistant'));
    assert.ok(full.has('@elizaos/plugin-notes'));
    // The SDK deliberately withholds standalone Calendar when the assistant
    // composes it, preventing competing CALENDAR action registrations (#30943).
    assert.equal(full.has('@elizaos/plugin-calendar'), false);
    assert.equal(lean.has('@elizaos/plugin-personal-assistant'), false);
    assert.equal(store.has('@elizaos/plugin-personal-assistant'), false);
  } finally { await host.close(); await fs.rm(profile, {recursive: true, force: true}); }
});
