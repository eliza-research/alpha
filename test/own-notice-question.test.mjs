import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('own notification questions retain cancellation and validate source plus current owner',()=>{
 execFileSync(process.execPath,['--import','tsx','--experimental-transform-types','scripts/test-own-notice-question.mjs'],{cwd:new URL('..',import.meta.url),timeout:30000,stdio:'pipe'});
});
