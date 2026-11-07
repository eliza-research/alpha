import { test } from 'node:test';
import { runChildSuite } from './fixtures/child-suite.mjs';
// Product executor and DeviceActions client over a synthetic calendar provider. No Android,
// CalendarProvider, permission dialog or agent is exercised.
test('foreground Calendar availability executor and receipt', () => {
  runChildSuite('test-calendar-availability-flow.ts', {flags: ['--import', 'tsx', '--experimental-transform-types'], timeout: 60_000});
});
