import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

// These standalone scenarios also run independently when diagnosing a Calendar integration.
for (const [name, script] of [
  ['reader identity, calendar listing and revocation', 'test-google-calendar.ts'],
  ['outbox, Undo, conflicts and recovery', 'test-google-calendar-outbox.ts'],
  ['Cloud client reads, writes and route boundaries', 'test-google-calendar-protocol.mjs'],
  ['account-bound display preferences', 'test-google-calendar-selection.ts'],
  ['writer scopes, guests, RSVP and error classes', 'test-google-calendar-writer.ts'],
]) {
  test(`Google Calendar: ${name}`, () => {
    execFileSync(process.execPath, ['--import=tsx', `scripts/${script}`], {
      cwd: new URL('..', import.meta.url),
      timeout: 60_000,
      stdio: 'pipe',
    });
  });
}
