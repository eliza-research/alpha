import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

// The Inbox scenarios use closed provider and storage fixtures.
for (const [name, script] of [
  ['attention, links, folders and attachments', 'test-inbox-attention-flow.mjs'],
  ['unfinished emails stay in separate account-scoped drafts', 'test-inbox-multiple-drafts.mjs'],
  ['saved drafts preserve account and conflict boundaries', 'test-inbox-saved-drafts.mjs'],
]) {
  test(`Inbox: ${name}`, () => {
    execFileSync(process.execPath, ['--import=tsx', `scripts/${script}`], {
      cwd: new URL('..', import.meta.url),
      timeout: 60_000,
      stdio: 'pipe',
    });
  });
}
