import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
// Product executor and DeviceActions client over a synthetic calendar provider. No Android,
// CalendarProvider, permission dialog or agent is exercised.
test('foreground Calendar availability executor and receipt', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/test-calendar-availability-flow.ts'], {
    cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe',
  });
});
