import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/*
 * Model-originated traces for the shell models. The pinned Quint simulator writes ITF traces with
 * the action taken and its nondeterministic picks at every step; a driver replays each step on the
 * product entry point and compares its observation with the model state after that step.
 */
export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js');

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(decode);
  if ('#tup' in value) return value['#tup'].map(decode);
  if ('#map' in value) return value['#map'].map(([key, item]) => [decode(key), decode(item)]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}
const picked = picks => Object.fromEntries(Object.entries(picks ?? {})
  .filter(([, pick]) => pick?.tag === 'Some').map(([name, pick]) => [name, decode(pick.value)]));

/**
 * Simulated traces of one model: a list of traces, each a list of
 * `{action, picks, state}` where `action` is '' for a stuttering step and `state` is the model
 * state after the step. The first entry is the initial state.
 */
export function modelTraces({family = 'application', module, traces = 40, steps = 30, seed = 20261107, state = 's'}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-replay-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'run', `specs/quint/${family}/${module}.qnt`, `--main=${module}`,
      '--backend=typescript', `--seed=${seed}`, `--max-samples=${traces}`, `--n-traces=${traces}`,
      `--max-steps=${steps}`, '--invariant=safety', '--mbt', `--out-itf=${join(directory, 'trace-{seq}.itf.json')}`],
    {cwd: root, encoding: 'utf8', timeout: 120000});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = readdirSync(directory).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    assert.ok(files.length > 0, 'the simulator wrote no trace');
    return files.map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')).states.map(entry => ({
      action: entry['mbt::actionTaken'], picks: picked(entry['mbt::nondetPicks']), state: decode(entry[state]),
    })));
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

/**
 * Replays every trace. `start(initial)` builds a fixture for the model's initial step and returns
 * `{apply(step, before), observe()}`; `observe` returns the projection compared with
 * `project(state)` after every step. Stuttering steps must leave the model state unchanged and
 * are checked against an untouched fixture. Returns the set of model actions exercised.
 */
export async function replay(traces, {start, project}) {
  const exercised = new Set();
  let checkpoints = 0;
  for (const [index, trace] of traces.entries()) {
    const fixture = await start(trace[0]);
    const path = [];
    const compare = async step => {
      path.push(step.action || 'stutter');
      assert.deepEqual(await fixture.observe(), project(step.state),
        `trace ${index} after ${path.map((name, at) => `${at}:${name}`).join(' ')} ${JSON.stringify(step.picks)}`);
      checkpoints++;
    };
    await compare(trace[0]);
    for (let at = 1; at < trace.length; at++) {
      const step = trace[at], before = trace[at - 1].state;
      if (step.action === '') assert.deepEqual(step.state, before, 'only a stuttering step is unnamed');
      else { exercised.add(step.action); await fixture.apply(step, before); }
      await compare(step);
    }
    await fixture.close?.();
  }
  return {exercised, checkpoints, traces: traces.length};
}

/** A set value as a sorted list, for comparison with an observed collection. */
export const sorted = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export const tick = () => new Promise(resolve => setImmediate(resolve));
