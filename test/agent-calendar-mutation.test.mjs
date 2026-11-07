import test from 'node:test';
import {execFileSync} from 'node:child_process';
// Actual controller with a deferred preservation port and a synthetic write client.
// No provider, agent, database, or native Calendar write runs in this test.
test('Agent Calendar serializes writes and releases failed preservation checks',()=>{
 execFileSync(process.execPath,['--import','tsx','scripts/test-agent-calendar-mutation-flow.ts'],{
  cwd:new URL('..',import.meta.url),timeout:30_000,stdio:'pipe',
 });
});
