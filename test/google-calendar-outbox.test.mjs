import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Google Calendar outbox: optimistic rows, Undo before delete, merging, conflicts and recovery (synthetic)',()=>{
  execFileSync(process.execPath,['--import','tsx','scripts/test-google-calendar-outbox.ts'],{cwd:new URL('..',import.meta.url),timeout:60_000,stdio:'pipe'});
});
