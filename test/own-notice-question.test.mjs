import test from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('own notification questions retain cancellation and validate source plus current owner',()=>{
 runChildSuite('test-own-notice-question.mjs',{flags: ['--import', 'tsx'],timeout:30000});
});
