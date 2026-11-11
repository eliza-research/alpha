import {test} from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('Google Calendar nonsecret selection storage remains account-bound (synthetic)',()=>{
  runChildSuite('test-google-calendar-selection.ts',{timeout:60_000});
});
