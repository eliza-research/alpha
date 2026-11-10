import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('canonical notification taps preserve owner, drafts and intended views',()=>{
 execFileSync(process.execPath,['--import=tsx','scripts/test-canonical-notification-navigation.ts'],{cwd:new URL('..',import.meta.url),timeout:30000,stdio:'pipe'});
});
