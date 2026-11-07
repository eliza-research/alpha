import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
// Real Inbox adapter with a closed provider fixture: Home attention, bounded unread probe, links,
// folders, provider drafts, attachments and Use in email. No network, account or mail.
test('inbox attention, links, folders and attachments', () => {
  runChildSuite('test-inbox-attention-flow.mjs', {flags: ['--import', 'tsx'], timeout: 60_000});
});
