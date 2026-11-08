import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
// Real Inbox adapter with a closed provider fixture: failures of one part keep the open message, a
// revoked grant closes it, and aborts or failed refreshes keep the cursor and offline snapshot.
test('inbox reader, cursor and offline mailbox survive failures and aborts', () => {
  runChildSuite('test-inbox-reader-failures.mjs', {flags: ['--import', 'tsx'], timeout: 60_000});
});
