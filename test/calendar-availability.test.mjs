import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
// Product executor and DeviceActions client over a synthetic calendar provider. No Android,
// CalendarProvider, permission dialog or agent is exercised.
test('foreground Calendar availability executor and receipt', () => {
  execFileSync(process.execPath, ['--import', 'tsx', '--experimental-transform-types', 'scripts/test-calendar-availability-flow.ts'], {
    cwd: new URL('..', import.meta.url), timeout: 60_000, stdio: 'pipe',
  });
});
