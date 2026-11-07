import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Google Calendar reader identity, every-calendar listing and revocation boundaries (synthetic)',()=>{
  execFileSync(process.execPath,['--import','tsx','scripts/test-google-calendar.ts'],{cwd:new URL('..',import.meta.url),timeout:60_000,stdio:'pipe'});
});
