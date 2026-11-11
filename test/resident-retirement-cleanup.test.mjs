import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const begin=source.indexOf('function retire(name?: string)'),end=source.indexOf('\n/** ',begin);
assert.ok(begin>=0&&end>begin);
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'});
const make=new Function(`return function fixture(kind,fail){
 let epoch=1,active={kind,remote:{disconnect:async()=>{calls.push(['disconnect',epoch,active]);if(fail)throw Error('retired transport');}},viewNavigation:{dispose(){calls.push(['view']);}}};
 let sending=new AbortController();const requests=[new AbortController()],calls=[],patches=[];
 const state={session:{sessionId:'old'}},appRequests=requests,testMocksEnabled=false,residentAlwaysPresent=true,RESIDENT_NAME='Resident';
 const clearClientObservationSupport=()=>{},retireConversationEvents=()=>{},retireReadReplies=()=>{},pauseHostedBackground=async()=>{},retireClockReviews=async()=>{},cancelStoppedReply=()=>{};
 const actionReceipts={clear(){}},conversationMemory={clear(){}},update=patch=>patches.push(patch);
 ${code}
 return {retire,calls,patches,requests,replace(){epoch++;active={kind:'resident',remote:{disconnect(){throw Error('new connection touched');}}};}};
}`)();

test('retire invalidates the old epoch before disconnecting only its resident transport',async()=>{
 const t=make('resident',false);await t.retire();
 assert.equal(t.calls.filter(([name])=>name==='disconnect').length,1);
 assert.deepEqual(t.calls.find(([name])=>name==='disconnect'),['disconnect',2,null]);
 assert.equal(t.requests[0].signal.aborted,true);
 const paired=make('remote',false);await paired.retire();assert.ok(!paired.calls.some(([name])=>name==='disconnect'),'paired disconnect has credential semantics and is owned by explicit sign-out');
});
test('late retirement failure cannot paint over a new connection',async()=>{
 const t=make('resident',true),pending=t.retire();t.replace();
 await assert.rejects(pending,/retired transport/);await Promise.resolve();
 assert.ok(!t.patches.some(patch=>patch.error));
});
