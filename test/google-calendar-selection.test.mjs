import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Google Calendar nonsecret selection storage remains account-bound (synthetic)',()=>{
  execFileSync(process.execPath,['--import','tsx','scripts/test-google-calendar-selection.ts'],{cwd:new URL('..',import.meta.url),timeout:60_000,stdio:'pipe'});
});
