import test from 'node:test';
import {spawnSync} from 'node:child_process';
// npm test starts each .mjs without a TypeScript loader; mirror the workflow adapter's own tests.
if (!process.versions.bun && !process.execArgv.some(value => value === 'tsx' || value === '--import=tsx')) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1]], {stdio: 'inherit', timeout: 280000});
  if (child.error) throw child.error; process.exit(child.status ?? 1);
}
const {runWorkflowLifecycleChangeCase1}=await import('../specs/quint/refinement/services/workflow-lifecycle-change-replay.mjs');

test('the real workflow adapter follows every step of the lifecycle model scenarios', {timeout: 240000}, async () => runWorkflowLifecycleChangeCase1(undefined));
