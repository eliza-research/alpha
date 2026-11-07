import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Google Calendar Cloud client: typed reads, owner writes and route boundaries (synthetic transport)',()=>{
  execFileSync(process.execPath,['scripts/test-google-calendar-protocol.mjs'],{cwd:new URL('..',import.meta.url),timeout:60_000,stdio:'pipe'});
});
