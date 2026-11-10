import {execFileSync} from 'node:child_process';
import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
// Real Inbox adapter with a closed provider fixture: Home attention, bounded unread probe, links,
// folders, provider drafts, attachments and Use in email. No network, account or mail.
test('inbox attention, links, folders and attachments', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/test-inbox-attention-flow.ts'], {
    cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe',
  });
});
