import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Google Calendar writer: scopes, Cloud gaps, guests, RSVP and error classes (synthetic client)',()=>{
  execFileSync(process.execPath,['--import','tsx','scripts/test-google-calendar-writer.ts'],{cwd:new URL('..',import.meta.url),timeout:60_000,stdio:'pipe'});
});
