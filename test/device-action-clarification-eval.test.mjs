import test from 'node:test';
import { execFileSync } from 'node:child_process';
// Harness self-test only: a synthetic in-process agent, never a model or device result.
test('clarification eval harness classifies, cleans up and binds results to source', () => {
  const output = execFileSync(process.execPath, ['scripts/eval-device-action-clarification.ts', '--self-test'], { encoding: 'utf8', timeout: 60000 });
  if (!output.includes('PASS clarification eval harness')) throw Error(output);
});
