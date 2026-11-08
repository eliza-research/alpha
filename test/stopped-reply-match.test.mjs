import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {findStoppedUserTurn} from '../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts';
// Contract: GET /api/conversations/:id/messages returns `clientMessageId` on user rows sent with one
// (elizaOS/eliza#35907). A Stop check matches its own turn by that id, never by text alone.
const root=path.resolve(import.meta.dirname,'..');
const plain=text=>text;
const at=Date.parse('2026-10-13T12:00:00Z');

test('the pinned agent returns clientMessageId on conversation history user rows',()=>{
 const routes=fs.readFileSync(path.join(root,'vendor/eliza/packages/agent/src/api/conversation-routes.ts'),'utf8');
 assert.match(routes,/clientMessageId\?: string;/,'the history row type carries an optional clientMessageId');
 assert.match(routes,/\.\.\.\(clientMessageId \? \{ clientMessageId \} : \{\}\)/,'user rows sent with one return it');
 const ui=fs.readFileSync(path.join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 assert.match(ui,/clientMessageId: requestId, channelType/,'the send posts requestId as clientMessageId');
 assert.match(ui,/scheduleStoppedReply\(selected, session, dispatched\.conversationId, \{ clientMessageId: requestId, text, sentAt: dispatched\.at \}\)/,'and Stop checks for that same id');
 assert.match(ui,/const user = findStoppedUserTurn\(result\.messages, turn, restoredText\);/);
});

test('a user row carrying clientMessageId is matched even when two turns have identical text',()=>{
 const rows=[
  {id:'u1',role:'user',text:'Same words',timestamp:at,clientMessageId:'first'},
  {id:'a1',role:'assistant',text:'Reply one',replyToMessageId:'u1'},
  {id:'u2',role:'user',text:'Same words',timestamp:at+1000,clientMessageId:'second'},
  {id:'u3',role:'user',text:'Same words',timestamp:at+2000},
 ];
 assert.equal(findStoppedUserTurn(rows,{clientMessageId:'first',text:'Same words',sentAt:at},plain)?.id,'u1');
 assert.equal(findStoppedUserTurn(rows,{clientMessageId:'second',text:'Same words',sentAt:at},plain)?.id,'u2');
 // An agent that returns ids but did not record this send: no text fallback onto another turn.
 assert.equal(findStoppedUserTurn(rows,{clientMessageId:'never-recorded',text:'Same words',sentAt:at},plain),undefined);
 // Assistant rows never match, whatever they carry.
 assert.equal(findStoppedUserTurn([{id:'x',role:'assistant',text:'Same words',clientMessageId:'first'}],{clientMessageId:'first',text:'Same words',sentAt:at},plain),undefined);
});

test('older agents and shared-tier Cloud rows without ids keep the text and time match',()=>{
 const rows=[
  {id:'old',role:'user',text:'Hello',timestamp:at-10*60_000},
  {id:'u',role:'user',text:'[wrapped] Hello',timestamp:at-60_000},
 ];
 const unwrap=text=>text.replace(/^\[wrapped\] /,'');
 assert.equal(findStoppedUserTurn(rows,{clientMessageId:'id',text:'Hello',sentAt:at},unwrap)?.id,'u');
 assert.equal(findStoppedUserTurn(rows,{text:'Hello',sentAt:at},unwrap)?.id,'u');
 assert.equal(findStoppedUserTurn([rows[0]],{text:'Hello',sentAt:at},unwrap),undefined,'older than the two-minute clock skew');
 assert.equal(findStoppedUserTurn([{id:'n',role:'user',text:'Hello'}],{text:'Hello',sentAt:at},plain)?.id,'n','an untimed row still matches');
});
