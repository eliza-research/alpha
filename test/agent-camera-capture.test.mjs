import test from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('requested Camera capture uses the existing adapter and journal without replay',()=>{
 runChildSuite('test-agent-camera-flow.mjs',{flags:['--import','tsx'],timeout:30000});
});
