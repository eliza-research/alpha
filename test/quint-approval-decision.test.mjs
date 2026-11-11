import test from 'node:test';
import {spawnSync} from 'node:child_process';
// npm test starts each .mjs without a TypeScript loader; mirror the workflow adapter's own tests.
if (!process.versions.bun && !process.execArgv.some(value => value === 'tsx' || value === '--import=tsx')) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1]], {stdio: 'inherit', timeout: 280000});
  if (child.error) throw child.error; process.exit(child.status ?? 1);
}
const {runApprovalDecisionCase1,runApprovalDecisionCase2}=await import('../specs/quint/refinement/services/approval-decision-replay.mjs');

test('the real workflow adapter follows every step of the approval model scenarios', {timeout: 120000}, async () => runApprovalDecisionCase1(undefined));
test('the real workflow adapter follows random approval model walks step by step', {timeout: 240000}, async () => runApprovalDecisionCase2(undefined));
