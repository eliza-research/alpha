import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const {automationsCommitted}=await loadBrowserModule('apps/app/src/runtime/automation-completion.ts');

const receipt=(kind,overrides={})=>({receiptId:'receipt-'+kind,operation:kind+'.create',resource:{kind,id:'record'},artifacts:[],idempotency:{key:null,replayed:false},observedAt:'2026-11-06T12:00:00.000Z',outcome:'applied',commit:{kind:'durable',id:'commit',committedAt:'2026-11-06T12:00:00.000Z'},...overrides});
const result=(...receipts)=>({success:true,effectReceipts:receipts});

test('an applied durable receipt of every listed kind refreshes the unified list',()=>{
 for(const kind of ['lifeops.definition','lifeops.occurrence','lifeops.scheduled_task','trigger.task','workflow.definition'])assert.equal(automationsCommitted([result(receipt(kind))]),true,kind);
});
test('tentative, failed and unrelated receipts do not refresh it',()=>{
 const {commit,...base}=receipt('trigger.task');
 assert.equal(automationsCommitted([result(receipt('trigger.task',{commit:{kind:'provider_accepted',id:'commit',committedAt:'2026-11-06T12:00:00.000Z'}}))]),false);
 assert.equal(automationsCommitted([result({...base,outcome:'preview'})]),false);
 assert.equal(automationsCommitted([result({...base,outcome:'failed',failure:{code:'refused',retryable:false,acceptance:'rejected'}})]),false);
 assert.equal(automationsCommitted([result(receipt('calendar.event'))]),false);
 assert.equal(automationsCommitted([{success:false,effectReceipts:[receipt('trigger.task')]}]),false);
 assert.equal(automationsCommitted([{success:true}]),false);
 assert.equal(automationsCommitted(undefined),false);
});
