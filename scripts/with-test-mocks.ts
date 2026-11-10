#!/usr/bin/env node
// Runs one command with the upstream test-mocks switch explicitly on.
import { exitFromChild, runChild } from './child-command.ts';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-test-mocks.ts <command> [...args]');
  process.exit(2);
}

try {
  exitFromChild(await runChild(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ELIZA_DEV_ALLOW_TEST_MOCKS: '1' },
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
