import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {plain, repositoryRoot} from '../../specs/quint/refinement/services/identity-comms-traces.mjs';

/** Named Quint schedules supply every expected state. Accepted action names come from each
 * .then chain; parameters name its exact queued/result record. No scenario step is skipped. */
export function settingsScenarioTraces() {
  const file = 'specs/quint/application/SettingsSession.qnt', source = readFileSync(join(repositoryRoot, file), 'utf8');
  const scenarios = [...source.matchAll(/\brun (\w+Test)\s*=\s*init([\s\S]*?)(?=\n\s*run |\n})/g)];
  assert.ok(scenarios.length >= 8);
  const directory = mkdtempSync(join(tmpdir(), 'alpha-settings-scenarios-'));
  try {
    const result = spawnSync(process.execPath, [join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js'),
      'test', file, '--main=SettingsSession', '--backend=typescript', '--max-samples=1', '--seed=20261107',
      `--match=^(${scenarios.map(match => match[1]).join('|')})$`, `--out-itf=${join(directory, 'scenario-{test}-{seq}.json')}`],
    {cwd: repositoryRoot, encoding: 'utf8', timeout: 120000});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = readdirSync(directory), known = new Set(['mount', 'unmount', 'refresh', 'changeScale', 'deviceHandles', 'deviceChanges', 'settleRead', 'settleWrite']);
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return scenarios.map(([, name, chain]) => {
      const actions = [...chain.matchAll(/\.then\((\w+)/g)].map(match => match[1]);
      assert.ok(actions.every(action => known.has(action)), `${name}: every action has a closed request port`);
      const output = files.find(file => file.startsWith(`scenario-${name}-`));
      assert.ok(output, `${name}: Quint wrote the scenario`);
      const states = JSON.parse(readFileSync(join(directory, output), 'utf8')).states.filter(state => 's' in state).map(state => plain(state.s));
      assert.equal(states.length, actions.length + 1, `${name}: one expected model state per action`);
      return states.map((state, index) => {
        if (!index) return {action: '', picks: {}, state};
        const before = states[index - 1], action = actions[index - 1], picks = {};
        if (action === 'changeScale') picks.value = state.queue.at(-1).value;
        if (action === 'deviceHandles') {
          const added = state.results.filter(op => !before.results.some(old => equal(op, old)));
          assert.equal(added.length, 1);picks.fails = added[0].failed;
        }
        if (action === 'settleRead' || action === 'settleWrite') {
          const removed = before.results.filter(op => !state.results.some(next => equal(op, next)));
          assert.equal(removed.length, 1);picks.op = removed[0];
        }
        return {action, picks, state};
      });
    });
  } finally {rmSync(directory, {recursive: true, force: true});}
}
