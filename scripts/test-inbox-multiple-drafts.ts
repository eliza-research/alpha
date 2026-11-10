import assert from 'node:assert/strict';
import {bundledFixture, installFixtureGlobals} from './fixtures/bundled-module.ts';
import type {inboxDrafts as createDrafts} from '../apps/app/src/prototype/inbox-drafts.ts';

const context = {
  rows: new Map<string, {items?: unknown[]} | null>(),
  retained: new Map<string, unknown>(),
  toasts: [] as string[],
  sessionId: 'session-A',
  providerCalls: 0,
  failShelf: false,
  waitShelf: null as Promise<void> | null,
};
const restoreGlobals = installFixtureGlobals({multipleDraftsFixture: context, window: {confirm: () => true}});
try {
  const mocks={
   'inbox-unsaved':`export function inboxUnsaved(owner,publish,restore){const s=globalThis.multipleDraftsFixture;return {ready:Promise.resolve(),get available(){return s.retained.has(owner)},peek(){return structuredClone(s.retained.get(owner)||null)},edit(v){s.retained.set(owner,structuredClone(v));},clear:async()=>{s.retained.delete(owner)},resume(){const v=s.retained.get(owner);if(v)restore(structuredClone(v));},retire(){},error:false,conflict:false,status:''};}`,
   'platform-plugins':`export const registerPlugin=()=>({});`,
   'daily':`export const DailyApps={perform(){throw Error('Unexpected external operation')}};`,
   'inbox-attachment':`export const reviewMailAttachment=()=>{throw Error('Unexpected attachment read')};`,
   'inbox-operation':`export const outgoingAttachmentLimits={maximumFiles:20,maximumTotalBytes:8*1024*1024};export const checkOutgoingAttachments=()=>{};export const attachmentBytes=()=>0;`,
   'inbox-local-store':`export const inboxLocalStore={read:async key=>structuredClone(globalThis.multipleDraftsFixture.rows.get(key)||null),compareExchange:async(key,before,next)=>{const s=globalThis.multipleDraftsFixture;if(s.waitShelf&&key.includes(':shelf:'))await s.waitShelf;if(s.failShelf&&key.includes(':shelf:'))throw Error('Synthetic storage failure');if(JSON.stringify(s.rows.get(key)||null)!==JSON.stringify(before))return {status:'conflict'};s.rows.set(key,structuredClone(next));return {status:'saved'};}};`,
   'connection-ui':`export const connectionController={getCloudClient:()=>({sessionId:globalThis.multipleDraftsFixture.sessionId,credentialId:'credential'}),getSnapshot:()=>({cloudAccount:{environment:'production',userId:'owner',organizationId:'organization',sessionId:globalThis.multipleDraftsFixture.sessionId}})};`,
  };
  const {inboxDrafts} = await bundledFixture<{inboxDrafts: typeof createDrafts}>('apps/app/src/prototype/inbox-drafts.ts', mocks);
  const make = () => inboxDrafts(() => {}, text => context.toasts.push(text), {
    prepare: async () => { context.providerCalls++; },
    capabilities: () => ({send: true, providerDrafts: false, from: 'owner@example.invalid'}),
  });
  type Drafts = ReturnType<typeof make>;
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  const chip = (label: string, pick: () => void) => ({label, pick});
  function composer(drafts: Drafts) {
    const current = drafts.render().c;
    assert.ok(current, 'Expected an open Inbox composer');
    return current;
  }
  function field(drafts: Drafts, key: 'onSubj' | 'onBody' | 'onTo', value: string) {
    composer(drafts)[key]({target: {value}});
  }
  function proposal(drafts: Drafts) {
    const current = drafts.proposal();
    assert.ok(current, 'Expected a local draft proposal');
    return current;
  }
  function draftId(drafts: Drafts) {
    const current = drafts.email();
    assert.ok(current, 'Expected a local draft identifier');
    return current.draftId;
  }
  let d=make();await d.bind('grant-A','owner@example.invalid');assert.equal(await d.newEmail(),true);field(d,'onSubj','First email');field(d,'onBody','Preserve these unfinished edits');field(d,'onTo','partial-address');d.close();
  assert.equal(await d.newEmail(),true);assert.equal(composer(d).body,'');assert.equal(composer(d).subject,'');
  const first=d.chips(chip).find(row=>row.subject==='First email');assert.ok(first,'unfinished email becomes a Drafts entry');
  field(d,'onSubj','Second email');field(d,'onBody','Keep the second draft too');d.close();first.pick();await tick();assert.equal(composer(d).subject,'First email');assert.equal(composer(d).body,'Preserve these unfinished edits');assert.equal(composer(d).toQ,'partial-address');
  d.close();d=make();await d.bind('grant-A','owner@example.invalid');assert.ok(d.chips(chip).some(row=>row.subject==='Second email'),'archived drafts survive a new composer instance');assert.equal(await d.newEmail(),true);
  field(d,'onSubj','Storage failure draft');field(d,'onBody','Must remain current');context.failShelf=true;assert.equal(await d.newEmail(),false);assert.equal(composer(d).body,'Must remain current');context.failShelf=false;
  d.close();await d.bind('grant-B','other@example.invalid');assert.equal(d.chips(chip).length,0,'another Google grant sees no archived emails');await d.bind('grant-A','owner@example.invalid');assert.ok(d.chips(chip).some(row=>row.subject==='Second email'));
  assert.equal(context.providerCalls,0,'archiving and composing never stage or send provider mail');
  const archivedCount = () => [...context.rows.values()].reduce((count, row) => count + (row?.items?.length ?? 0), 0);
  const before = archivedCount();
  assert.equal(await d.newEmail(),true);
  assert.equal(await d.newEmail(),true);
  assert.equal(archivedCount(), before+1, 'only meaningful edits are retained; empty composers are not collected');
  const message={unread:false, snippet:'', receivedAt:'2026-10-08T12:00:00Z', id:'source-message',threadId:'source-thread',from:'Sender',fromEmail:'sender@example.invalid',replyTo:'reply@example.invalid',to:['owner@example.invalid','teammate@example.invalid'],cc:['copy@example.invalid'],subject:'Selected message'};
  field(d,'onSubj','Keep before reply');field(d,'onBody','Existing unfinished email');d.close();assert.equal(await d.newEmail(message,'reply-all'),true);
  assert.deepEqual(proposal(d).to,['reply@example.invalid','teammate@example.invalid']);assert.deepEqual(proposal(d).cc,['copy@example.invalid']);assert.equal(proposal(d).replyMessageId,'source-message');assert.equal(proposal(d).bodyText,'');assert.equal(proposal(d).mode,'reply-all');assert.ok(d.chips(chip).some(row=>row.subject==='Keep before reply'));
  field(d,'onBody','Unfinished reply');const replyDraftId=draftId(d);d.close();assert.equal(await d.newEmail(message,'reply-all'),true);assert.equal(draftId(d),replyDraftId,'the same reply resumes its draft instead of creating a duplicate');assert.equal(proposal(d).bodyText,'Unfinished reply');d.close();assert.equal(await d.newEmail(message,'forward','Original source text'),true);assert.equal(proposal(d).mode,'forward');assert.equal(proposal(d).subject,'Fwd: Selected message');assert.deepEqual(proposal(d).to,[]);assert.match(String(proposal(d).bodyText),/Original source text/);assert.ok(d.chips(chip).some(row=>row.subject==='Re: Selected message'));
  context.failShelf=true;assert.equal(await d.newEmail(message),false);assert.equal(proposal(d).mode,'forward');context.failShelf=false;
  const shelf = Promise.withResolvers<void>();context.waitShelf=shelf.promise;const pending=d.newEmail(message);await tick();await d.bind('grant-C','third@example.invalid');shelf.resolve();assert.equal(await pending,false,'an account switch cannot open the old message under the new From account');context.waitShelf=null;assert.equal(d.chips(chip).length,0);assert.equal(context.providerCalls,0);
  console.log('PASS multiple local drafts: preserve unsaved text/partial recipient, reopen, reload, account isolation, storage-failure retention, empty composer cleanup, reply-all/forward preservation, account-switch race, zero provider operations.');
} finally {
  restoreGlobals();
}
