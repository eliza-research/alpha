import {test} from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('HTML email rendering isolates untrusted content and remote images',()=>{
 runChildSuite('test-mail-html.ts',{timeout:30000});
});
