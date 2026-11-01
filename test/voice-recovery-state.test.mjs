import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Execute the actual development conversation callbacks against reordered events.
const source=readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8');
const match=source.match(/onState:\(phase,progressText=''\)=>\{(.*?)\},onPlaybackUnlockChange:.*?onError:failure=>\{(.*?)\}\}\);/s);
assert(match,'Development callback boundary must be reviewed when source changes');
function fixture(){const state={token:1,generation:1,conversationState:{phase:'starting'},conversationInterim:'pending',error:'',refreshes:0};const context=vm.createContext({...state,refresh(){context.refreshes++}});const onState=vm.runInContext('(phase,progressText=\'\')=>{'+match[1].replace(/ as 'listening'\|'transcribing'\|'thinking'\|'speaking'/g,'')+'}',context);const onError=vm.runInContext('(failure)=>{'+match[2]+'}',context);return {context,onState,onError};}
test('transport error remains visible after canonical idle cleanup',()=>{const h=fixture();h.onState('listening');h.onError(Error('Connection closed'));h.onState('idle');assert.equal(h.context.conversationState.phase,'error');assert.equal(h.context.error,'Connection closed');});
test('initial idle cannot erase startup and stale callbacks cannot change state',()=>{const h=fixture();h.onState('idle');assert.equal(h.context.conversationState.phase,'starting');h.context.generation=2;h.onError(Error('stale'));h.onState('listening');assert.equal(h.context.conversationState.phase,'starting');});
test('ordinary listening then idle still settles normally',()=>{const h=fixture();h.onState('listening');assert.equal(h.context.conversationInterim,'');h.onState('idle');assert.equal(h.context.conversationState.phase,'idle');});
test('server ready keeps startup visible until capture actually starts',()=>{const h=fixture();h.onState('connecting');h.onState('ready');assert.equal(h.context.conversationState.phase,'starting');h.onState('listening');assert.equal(h.context.conversationState.phase,'listening');});
test('turn completion and interruption do not look like a stopped microphone',()=>{for(const phase of ['complete','interrupted']){const h=fixture();h.onState('listening');h.onState(phase);assert.equal(h.context.conversationState.phase,'listening');}});
