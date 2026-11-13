import assert from 'node:assert/strict';
import test from 'node:test';
import {buildClockRequest,validateClockOperation,describeClockHandoff} from '../apps/app/src/runtime/clock-contract.ts';

test('Clock repeat days are validated and carried in the reviewed request',()=>{
 const once=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[]},'UTC');
 const weekdays=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[6,2,4,3,5]},'UTC');
 const set=days=>({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Run',timeZone:'UTC',days});
 for(const days of [[0],[8],[2,2],[1.5]])assert.throws(()=>validateClockOperation(set(days)),JSON.stringify(days));
 assert.equal('days' in once,false);assert.equal('days' in validateClockOperation(set([])),false);
 assert.deepEqual(weekdays.days,[2,3,4,5,6]);
 assert.match(describeClockHandoff(validateClockOperation(set([1,7]))),/repeating weekends/);
});
