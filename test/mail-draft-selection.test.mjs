import test from 'node:test';
import assert from 'node:assert/strict';
import {createInboxFixture} from '../specs/quint/refinement/services/inbox-coordinator-ports.mjs';

async function setup() {
  const fixture = await createInboxFixture();
  const pair = fixture.createPair();
  await pair.bind();
  for (const subject of ['First draft', 'Second draft']) {
    await pair.drafts.newEmail();
    pair.drafts.render().c.onSubj({target:{value:subject}});
    pair.drafts.render().c.onBody({target:{value:'Keep this content'}});
    await fixture.settle();
  }
  assert.equal(await pair.drafts.prepareSelection(), true);
  const entries = pair.drafts.chips((label,pick)=>({label,pick}));
  assert.equal(entries.length,2);
  assert.ok(entries.every(row=>row.id));
  const shelfKey = [...fixture.slots.keys()].find(key=>key.includes(':shelf:'));
  return {fixture,pair,entries,shelfKey};
}

test('local selection removes only selected saved drafts and sends no mail',async()=>{
  const {fixture,pair,entries,shelfKey}=await setup();
  assert.equal(await pair.drafts.removeSelection([entries[0].id],()=>true),true);
  const shelf=fixture.slots.get(shelfKey);
  assert.deepEqual(shelf.items.map(row=>row.draft.id),[entries[1].id]);
  assert.equal(fixture.state.dispatches,0);
  pair.dispose();
});

test('a peer change to a selected draft is retained',async()=>{
  const {fixture,pair,entries,shelfKey}=await setup();
  const shelf=fixture.slots.get(shelfKey);
  shelf.items[0].draft.body='Peer edit';
  await assert.rejects(pair.drafts.removeSelection([entries[0].id],()=>true),/changed/);
  assert.equal(fixture.slots.get(shelfKey).items[0].draft.body,'Peer edit');
  assert.equal(fixture.slots.get(shelfKey).items.length,2);
  pair.dispose();
});

test('a new peer draft survives removal of an unchanged selection',async()=>{
  const {fixture,pair,entries,shelfKey}=await setup();
  const shelf=fixture.slots.get(shelfKey);
  const added=structuredClone(shelf.items[0]);
  added.draft.id='peer-created';added.draft.revision='peer-revision';
  shelf.items.push(added);
  assert.equal(await pair.drafts.removeSelection(entries.map(row=>row.id),()=>true),true);
  assert.deepEqual(fixture.slots.get(shelfKey).items.map(row=>row.draft.id),['peer-created']);
  pair.dispose();
});

test('a lost delete reply is read back without a second mutation',async()=>{
  const {fixture,pair,entries,shelfKey}=await setup();
  let writes=0;
  fixture.gates({storeResult:async event=>{if(event.key===shelfKey){writes++;throw Error('Reply lost');}}});
  assert.equal(await pair.drafts.removeSelection(entries.map(row=>row.id),()=>true),true);
  assert.equal(writes,1);
  assert.equal(fixture.slots.get(shelfKey).items.length,0);
  pair.dispose();
});

test('retired selection cannot remove drafts',async()=>{
  const {fixture,pair,entries,shelfKey}=await setup();
  assert.equal(await pair.drafts.removeSelection(entries.map(row=>row.id),()=>false),false);
  assert.equal(fixture.slots.get(shelfKey).items.length,2);
  await pair.bind('grant-2');
  assert.equal(await pair.drafts.removeSelection(entries.map(row=>row.id),()=>true),false);
  assert.equal(fixture.slots.get(shelfKey).items.length,2);
  pair.dispose();
});
