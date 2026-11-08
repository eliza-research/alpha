import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
// Real Inbox adapter with a closed provider fixture: Home attention, bounded unread probe, links,
// folders, provider drafts, attachments and Use in email. No network, account or mail.
test('inbox attention, links, folders and attachments', () => {
  execFileSync(process.execPath, ['--import', 'tsx', '--experimental-transform-types', 'scripts/test-inbox-attention-flow.mjs'], {
    cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe',
  });
});
