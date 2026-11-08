import test from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('own notification questions retain cancellation and validate source plus current owner',()=>{
 execFileSync(process.execPath,['--import','tsx','scripts/test-own-notice-question.mjs'],{cwd:new URL('..',import.meta.url),timeout:30000,stdio:'pipe'});
});
