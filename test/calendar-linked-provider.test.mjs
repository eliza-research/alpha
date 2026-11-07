import test from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('Calendar sync uses the authenticated Cloud transport and keeps provider outcomes and owner fences',()=>{
 runChildSuite('test-calendar-sync-provider.ts',{flags:['--import','tsx'],timeout:30000});
});
