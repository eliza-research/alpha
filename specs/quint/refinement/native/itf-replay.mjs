// Trace replay for native models whose source is repo-owned Java. The pinned Quint simulator
// writes ITF traces naming the action taken and its nondeterministic picks at every step. A Java
// harness performs each step on the product class and prints what it observed after every step;
// the observation must equal the model state.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {javaTraceCampaign, root} from './java.mjs';
import {recordComparedObservation} from '../observed-replay.mjs';

const quint = join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js');

/** ITF values as plain data: numbers, arrays for lists and tuples, sorted arrays for sets,
 * objects keyed by the printed key for maps. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#tup' in value) return value['#tup'].map(plain);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

function simulate(model, options, expectViolation) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-native-itf-'));
  try {
    const result = spawnSync(process.execPath, [quint, 'run', join(root, `specs/quint/native/${model}.qnt`),
      `--main=${model}`, '--backend=typescript', ...options, '--mbt', `--out-itf=${join(directory, 'trace-{seq}.itf.json')}`],
    {cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024});
    assert.equal(result.status === 0, !expectViolation, `${options.join(' ')}\n${result.stdout}\n${result.stderr}`);
    const files = readdirSync(directory).filter(name => name.endsWith('.itf.json')).sort();
    assert.ok(files.length > 0, 'the simulator wrote no trace');
    return files.map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')).states.map(raw => ({
      action: raw['mbt::actionTaken'],
      state: plain(raw.s),
      picks: Object.fromEntries(Object.entries(raw['mbt::nondetPicks'] ?? {}).filter(([, pick]) => pick.tag === 'Some')
        .map(([name, pick]) => [name, plain(pick.value)])),
    })));
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

/** Simulate a native model and return its traces as [{action, picks, state}], one entry per model
 * state. A stutter step has the action ''. `state` is the model's `s` record. Each entry of
 * `witnesses` (a witness name or a state predicate) adds, for each of `witnessSeeds` seeds, the
 * trace the simulator found to a state where it holds. `step` names the model's step action when
 * it is not `step`. */
export function modelTraces({model, traces = 40, maxSteps = 30, seed = 20261107, witnesses = [], witnessSeeds = 1, step}) {
  const stepping = step ? [`--step=${step}`] : [];
  const sampled = simulate(model, [...stepping, `--seed=${seed}`, `--max-samples=${traces}`, `--n-traces=${traces}`,
    `--max-steps=${maxSteps}`, '--invariant=safety'], false);
  const directed = witnesses.flatMap(name => Array.from({length: witnessSeeds}, (_, offset) =>
    simulate(model, [...stepping, `--seed=${seed + offset}`, '--max-samples=8000', '--max-steps=60', `--invariant=not(${name})`], true)[0]));
  return [...sampled, ...directed];
}

/** Replay every trace in its own JVM. The harness receives a file holding [{action, picks}] and
 * prints one observation per entry. `project(state)` selects the model fields compared with an
 * observation; `required` names actions and `reached` names state predicates that at least one
 * replayed trace must contain. Returns the replay statistics. */
export function replayJava({harness, sources, mainClass, traces, project = state => state, required = [], reached = {}, extraArguments = []}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-native-replay-'));
  try {
    const files = traces.map((trace, index) => {
      const path = join(directory, `trace-${index}.json`);
      writeFileSync(path, JSON.stringify(trace.map(({action, picks}) => ({action, picks}))));
      return [path, ...extraArguments];
    });
    const observed = javaTraceCampaign(harness, sources, files, mainClass);
    const actions = new Map(), hit = new Set();
    let steps = 0;
    for (const [index, trace] of traces.entries()) {
      assert.equal(observed[index].length, trace.length, `trace ${index}: one observation per model state`);
      for (const [at, {action, picks, state}] of trace.entries()) {
        const projection = project(state);
        assert.deepEqual(observed[index][at], projection,
          `trace ${index} step ${at} ${action || 'stutter'} ${JSON.stringify(picks)}\nmodel path: ${
            trace.slice(0, at + 1).map(item => item.action || '-').join(' ')}`);
        recordComparedObservation({trace: index, step: at, init: trace[0].action || 'init', action: at > 0 ? action : null,
          picks, actual: observed[index][at], expected: projection});
        if (at > 0 && action) { actions.set(action, (actions.get(action) ?? 0) + 1); steps++; }
        for (const [name, holds] of Object.entries(reached)) if (holds(state)) hit.add(name);
      }
    }
    for (const action of required) assert.ok(actions.has(action), `no replayed trace took ${action}`);
    for (const name of Object.keys(reached)) assert.ok(hit.has(name), `no replayed trace reached ${name}`);
    return {traces: traces.length, steps, actions: Object.fromEntries([...actions].sort()), reached: [...hit].sort()};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}
