import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
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
    runChildSuite(script, {timeout: 60_000});
  });
}
