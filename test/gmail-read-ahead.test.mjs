import {test} from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('Gmail read-ahead obeys account, request and lifetime boundaries',()=>{
 runChildSuite('test-gmail-read-ahead.ts',{timeout:30000});
});
