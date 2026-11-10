import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
// Actual product adapters, bounded HTTP/native fixtures. No provider writes or Android builds.
for (const script of [
  'test-calendar-crud-review.ts', 'test-calendar-query-race.ts', 'test-google-calendar-protocol.ts',
  'test-reminder-time-flow.ts', 'test-clock-handoff-flow.ts',
  'test-cloud-protocol.ts', 'test-cloud-subscription.ts', 'test-cloud-personal-flow.ts', 'test-cloud-voice-flow.ts', 'test-cloud-voice-cancellation-flow.ts', 'test-inbox-cloud-flow.ts', 'test-inbox-sent-cleanup.ts', 'test-inbox-grant-withdrawal.ts', 'test-gmail-mailbox.ts', 'test-cloud-maps.ts', 'test-maps-device-navigation.ts',
  'test-device-actions.ts', 'test-workflow-protocol.ts',
  'test-workflow-ui-flow.ts', 'test-workflow-approval-ui-flow.ts',
  'test-workflow-lifecycle-ui-flow.ts', 'test-workflow-metadata-ui-flow.ts',
  'test-notes-store-flow.ts', 'test-notes-action-flow.ts', 'test-notes-trash-flow.ts', 'test-notes-query-flow.ts',
]) {
  test(`adapter contract: ${script}`, () => {
    // This is an independent child suite, not an IPC worker of node:test.
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    try { execFileSync(process.execPath, ['--import', 'tsx', `scripts/${script}`], {
      cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe', env, encoding: 'utf8',
    }); } catch (error) {
      throw new Error(`${script} failed (status ${error.status}, signal ${error.signal}):\n${error.stdout || ''}\n${error.stderr || ''}`, {cause: error});
    }
  });
}
