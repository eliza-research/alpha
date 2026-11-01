import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createCloudResidentHost} from './fixtures/product-character-host.mjs';
import {CLOUD_MODEL} from '../scripts/cloud-resident-host.mjs';

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

test('actual pinned SDK collector retains the full host assistant and preserves lean/store exclusions', async () => {
  const {spawnSync} = await import('node:child_process');
  const profile = await fs.mkdtemp(join(tmpdir(), 'alpha-cloud-collector-'));
  const launches = [];
  const host = await createCloudResidentHost({source: resolve('vendor/eliza'), profile, port: 47869, profileMode: 'full', launch: recordingLauncher(launches), inherited: {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ELIZA_BUILD_VARIANT: 'store', ELIZA_PLATFORM: 'android', ELIZA_PLUGIN_SET: 'lean-chat'}});
  try {
    await host.bind({token: 'synthetic-cloud-only', credentialId: 'collector', reference: 'collector-ref'});
    const config = JSON.parse(await fs.readFile(join(profile, 'eliza.json'), 'utf8'));
    const actualEnvironment = launches[0].env;
    function collect(extra = {}) {
      const run = spawnSync(process.env.ALPHA_BUN || 'bun', ['--no-install', '--conditions=eliza-source', 'test/fixtures/cloud-plugin-selection.mjs'], {cwd: process.cwd(), env: {...actualEnvironment, ...extra, ...(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE ? {ALPHA_CLOUD_COLLECTOR_SOURCE: process.env.ALPHA_CLOUD_COLLECTOR_SOURCE} : {}), GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0'}, input: JSON.stringify({config}), encoding: 'utf8', timeout: 20000});
      assert.equal(run.status, 0, run.stderr);
      const line = run.stdout.split('\n').find(row => row.startsWith('SDK_PLUGIN_SELECTION='));
      assert.ok(line, 'the actual collector must return its selection');
      return new Set(JSON.parse(line.slice('SDK_PLUGIN_SELECTION='.length)));
    }
    assert.equal(actualEnvironment.ELIZA_BUILD_VARIANT, undefined);
    assert.equal(actualEnvironment.ELIZA_PLATFORM, undefined);
    const full = collect();
    assert.ok(full.has('@elizaos/plugin-personal-assistant'));
    assert.ok(full.has('@elizaos/plugin-notes'));
    // The SDK deliberately withholds standalone Calendar when the assistant
    // composes it, preventing competing CALENDAR action registrations (#30943).
    assert.equal(full.has('@elizaos/plugin-calendar'), false);
    assert.equal(collect({ELIZA_PLUGIN_SET: 'lean-chat'}).has('@elizaos/plugin-personal-assistant'), false);
    assert.equal(collect({ELIZA_BUILD_VARIANT: 'store'}).has('@elizaos/plugin-personal-assistant'), false);
  } finally { await host.close(); await fs.rm(profile, {recursive: true, force: true}); }
});
