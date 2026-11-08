import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
// Actual product adapters, bounded HTTP/native fixtures. No provider writes or Android builds.
for (const script of [
  'test-calendar-crud-review.mjs', 'test-calendar-query-race.mjs',
  'test-reminder-time-flow.mjs', 'test-clock-handoff-flow.mjs',
  'test-cloud-protocol.mjs', 'test-cloud-subscription.mjs', 'test-cloud-personal-flow.mjs', 'test-cloud-voice-flow.mjs', 'test-inbox-cloud-flow.mjs', 'test-inbox-sent-cleanup.mjs', 'test-inbox-grant-withdrawal.mjs', 'test-gmail-mailbox.mjs', 'test-cloud-maps.mjs', 'test-maps-device-navigation.mjs',
  'test-device-actions.mjs', 'test-workflow-protocol.mjs',
  'test-workflow-ui-flow.mjs', 'test-workflow-approval-ui-flow.mjs',
  'test-workflow-lifecycle-ui-flow.mjs', 'test-workflow-metadata-ui-flow.mjs',
  'test-notes-store-flow.ts', 'test-notes-action-flow.ts', 'test-notes-trash-flow.ts',
]) {
  test(`adapter contract: ${script}`, () => {
    // This is an independent child suite, not an IPC worker of node:test.
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    try { execFileSync(process.execPath, ['--import', 'tsx', '--experimental-transform-types', `scripts/${script}`], {
      cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe', env, encoding: 'utf8',
    }); } catch (error) {
      throw new Error(`${script} failed (status ${error.status}, signal ${error.signal}):\n${error.stdout || ''}\n${error.stderr || ''}`, {cause: error});
    }
  });
}
