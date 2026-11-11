import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const preparedSourceFixtureInputs = [
  'scripts/prepare-local-agent.ts', 'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
  'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
  'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
];

export function prepareLocalAgentFixture(temp) {
  const sdk = path.join(temp, 'sdk');
  const product = path.join(temp, 'product');
  fs.mkdirSync(sdk);
  fs.mkdirSync(product);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  function git(args, cwd = sdk) {
    const child = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      {cwd, env, encoding: 'utf8', timeout: 60000});
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim();
  }
  git(['init', '--quiet']);
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({name: 'fixture', workspaces: []}));
  fs.writeFileSync(path.join(sdk, 'turbo.json'), JSON.stringify({tasks: {}}));
  fs.writeFileSync(path.join(sdk, 'README.md'), 'before\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'before']);
  const before = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(sdk, 'README.md'), 'after\n');
  git(['commit', '--quiet', '-am', 'after']);
  const after = git(['rev-parse', 'HEAD']);

  for (const file of preparedSourceFixtureInputs) {
    const target = path.join(product, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(root, file), target);
  }
  const lock = path.join(product, 'upstream.lock.json');
  fs.writeFileSync(lock, JSON.stringify({url: sdk, commit: before}));
  // Fixture source/cache must remain local inside a real preparation environment.
  const runtime = path.join(product, 'artifacts', 'runtime');
  const childEnv = {...env, ALPHA_LOCAL_AGENT_SOURCE_DIR: runtime, ALPHA_RUNTIME_GIT_CACHE: sdk};
  function prepare(args = [], overrides = {}, preload) {
    return spawnSync(process.execPath, [
      ...(preload ? ['--preload', preload] : []),
      path.join(product, 'scripts/prepare-local-agent.ts'), '--source-only', ...args,
    ], {cwd: product, env: {...childEnv, ...overrides}, encoding: 'utf8', timeout: 60000});
  }
  const initial = prepare();
  assert.ifError(initial.error);
  assert.equal(initial.status, 0, initial.stderr);
  const stamp = path.join(runtime, '.alpha-runtime-source.json');
  const old = fs.readFileSync(stamp);
  const backup = path.join(temp, 'prior-stamp.json');
  git(['fetch', '--quiet', sdk, after], runtime);
  git(['checkout', '--quiet', '--detach', after], runtime);
  fs.writeFileSync(lock, JSON.stringify({url: sdk, commit: after}));
  const digest = createHash('sha256').update(old).digest('hex');
  return {product, runtime, stamp, old, backup, before, after, lock, git, prepare,
    args: ['--requalify-from', digest, '--preserve-stamp', backup]};
}
