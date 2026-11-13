import assert from 'node:assert/strict';
import test from 'node:test';
import {tsImport} from './support/ts-import.mjs';
const {boot} = await tsImport('../scripts/inbox-adapter-fixture.ts', import.meta.url);
const {reviewMailAttachment} = await tsImport('../apps/app/src/runtime/inbox-attachment.ts', import.meta.url);

async function openAttachment(t, {nativePlatform=true, opaque=false} = {}) {
 const source = await boot({nativePlatform, caps:{opaqueAttachments:true}});
 t.after(() => source.shell.componentWillUnmount());
 const bytes = {name:'notes.txt',mimeType:'text/plain',dataBase64:btoa('hello')};
 source.client.gmailAttachment = async () => ({...bytes,...await reviewMailAttachment(bytes)});
 source.mount(); source.setActive(true); source.render(); await source.tick();
 source.render().rows[0].open(); await source.tick();
 source.reader().atts[opaque?0:1].open(); await source.tick();
 return source;
}

const receipts = [
 ['saved','Saved to the chosen destination. Exact bytes verified.','Saved.',true],
 ['cancelled','Save destination unavailable or review closed.','Save cancelled.',false],
 ['unverified','The destination may contain some or all bytes. Inspect it before retrying.','Couldn’t confirm the save. Check the chosen file before trying again.',true],
];
for (const opaque of [false,true]) {
 test(`Android ${opaque?'opaque':'reviewed'} attachment shows the destination action and typed outcomes`, async t => {
  const source = await openAttachment(t,{opaque});
  const requests = [];
  source.native.saveReviewed = async input => {
   requests.push(input);
   const receipt = receipts[requests.length === 1 ? 1 : 0];
   return {status:receipt[0],message:receipt[1]};
  };
  assert.equal(source.attachment().saveLabel,'Save as…');
  for (const index of [1,0]) {
   const review = source.attachment();
   assert.equal(review.saveDisabled,false);
   review.save();
   assert.equal(source.attachment().saveStatus,'Saving…');
   assert.equal(source.attachment().saveDisabled,true);
   await source.tick();
   assert.equal(source.attachment().saveStatus,receipts[index][2]);
   assert.equal(source.attachment().saveDisabled,receipts[index][3]);
  }
  assert.equal(requests.length,2);
  assert.ok(requests.every(input=>input.reviewed===true && (input.opaque===true)===opaque));
  assert.deepEqual(source.prepared,[]);
  assert.deepEqual(source.dispatched,[]);
 });
}

test('Android unconfirmed save keeps its warning and blocks an uncertain retry', async t => {
 const source = await openAttachment(t);
 let calls = 0;
 source.native.saveReviewed = async () => {calls++;return {status:receipts[2][0],message:receipts[2][1]};};
 source.attachment().save(); await source.tick();
 assert.equal(source.attachment().saveStatus,receipts[2][2]);
 assert.equal(source.attachment().saveDisabled,true);
 source.attachment().save(); await source.tick();
 assert.equal(calls,1);
});

test('browser attachment keeps its Files destination and confirmation', async t => {
 const source = await openAttachment(t,{nativePlatform:false});
 source.native.saveReviewed = async () => ({status:'saved',message:'Saved in Files.'});
 assert.equal(source.attachment().saveLabel,'Save to Files');
 source.attachment().save(); await source.tick();
 assert.equal(source.attachment().saveStatus,'Saved in Files.');
});
