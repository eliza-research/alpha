import assert from 'node:assert/strict';
import test from 'node:test';
import {tsImport} from './support/ts-import.mjs';
const {boot} = await tsImport('../scripts/inbox-adapter-fixture.ts', import.meta.url);
const {reviewMailAttachment} = await tsImport('../apps/app/src/runtime/inbox-attachment.ts', import.meta.url);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=';

async function review(t, nativePlatform = true) {
  const source = await boot({nativePlatform});
  t.after(() => source.shell.componentWillUnmount());
  const file = {name:'photo.png', mimeType:'image/png', dataBase64:png};
  const checked = {...file,...await reviewMailAttachment(file)};
  source.client.gmailAttachment = async () => checked;
  source.mount(); source.setActive(true); source.render(); await source.tick();
  source.render().rows[0].open(); await source.tick();
  source.reader().atts[1].open(); await source.tick();
  assert.equal(source.attachment().external,true);
  return {source,checked};
}

test('Android opened confirms a launch request and passes the exact reviewed file', async t => {
  const {source,checked} = await review(t);
  const calls = [];
  source.native.openReviewed = async input => {
    calls.push(structuredClone(input));
    return {status:'opened',message:'Sent a temporary read-only copy to the viewer. Viewing is not confirmed.'};
  };
  source.attachment().open(); await source.tick();
  assert.deepEqual(calls,[{...checked,reviewed:true}]);
  assert.deepEqual(source.toasts,['Asked Android to open the file.']);
  assert.deepEqual(source.dispatched,[]);
});

test('browser opened reports its local attachment viewer', async t => {
  const {source} = await review(t,false);
  source.native.openReviewed = async () => ({status:'opened',message:'Attachment opened.'});
  source.attachment().open(); await source.tick();
  assert.deepEqual(source.toasts,['Attachment opened.']);
});

for (const [name, result, expected] of [
  ['cancelled',async()=>({status:'cancelled',message:'Dismissed'}),[]],
  ['unknown',async()=>({status:'unknown',message:'Internal bridge detail'}),['Couldn’t confirm that the file opened.']],
  ['rejected',async()=>{throw Error('No viewer available, or the review was cancelled.');},['Couldn’t confirm that the file opened.']],
]) {
  test(`a current attachment open that is ${name} does not report success`, async t => {
    const {source} = await review(t);
    source.native.openReviewed = result;
    source.attachment().open(); await source.tick();
    assert.deepEqual(source.toasts,expected);
  });
}

test('closing an attachment review retires its delayed receipt and old Open action', async t => {
  const {source} = await review(t);
  const pending = Promise.withResolvers();
  let calls = 0;
  source.native.openReviewed = async () => {calls++;return pending.promise;};
  const original = source.attachment();
  original.open();
  assert.equal(calls,1);
  original.close();
  original.open();
  pending.resolve({status:'opened',message:'Sent a temporary read-only copy.'});
  await source.tick();
  assert.equal(calls,1);
  assert.equal(source.render().attachment,null);
  assert.deepEqual(source.toasts,[]);
});
