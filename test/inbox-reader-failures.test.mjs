import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
// Real Inbox adapter with a closed provider fixture: failures of one part keep the open message, a
// revoked grant closes it, and aborts or failed refreshes keep the cursor and offline snapshot.
test('inbox reader, cursor and offline mailbox survive failures and aborts', () => {
  execFileSync(process.execPath, ['--import', 'tsx', '--experimental-transform-types', 'scripts/test-inbox-reader-failures.mjs'], {
    cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe',
  });
});
