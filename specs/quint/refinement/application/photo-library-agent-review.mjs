// PhotoLibraryAgentReview against createDeviceLibrary in
// apps/app/src/prototype/photo-library-adapter.ts. Ports: the native library plugin (scope and
// inspect answered at once; every validate and requestChange call answered by a model step, from
// the revisions the call carries) and the main Photos Library host (visible, its own review).
import assert from 'node:assert/strict';
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from './notes-files-media-itf.mjs';

const source = 'apps/app/src/prototype/photo-library-adapter.ts';
const stubs = {
  '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true};',
  '../platform-plugins': 'export const registerPlugin=()=>({});',
};
const witnesses = ['StaleReviewClosedWitness', 'SecondRequestRefusedWitness', 'LeftDuringValidationWitness', 'ChangedWhileAndroidAsksWitness', 'TwoReviewsAppliedWitness', 'DoublePressWitness',
  'LatePressIgnoredWhileAndroidAsksWitness'];
const bump = count => Math.min(2, count + 1);

export async function replayPhotoLibraryAgentReview({rewrite, ...options} = {}) {
  const model = {path: 'specs/quint/application/PhotoLibraryAgentReview.qnt', main: 'PhotoLibraryAgentReview'};
  // A change Android refuses as stale needs the item to change between the owner's confirmation
  // and Android's answer; random walks find it rarely, so it is searched for with more samples.
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses}),
    ...witnessTraces({...model, witnesses: ['s.androidStale>0'], maxSamples: 40000})];
  const product = await loadProductModule(source, {rewrite, stubs});
  return replayTraces(traces, {
    required: ['request', 'validated', 'confirmPress', 'confirmValidated', 'androidSettles', 'cancel', 'leave', 'show', 'hostReviewOpens',
      'hostReviewCloses', 'sourceChanges', 'dispose'],
    reached: {
      'a review closed because its item changed': ({s}) => s.staleClosed > 0,
      'a second request refused by the open review': ({s}) => s.refusedBusy > 0 && s.review !== 0,
      'a request retired by leaving Photos': ({s}) => s.refusedLeft > 0,
      'a change Android refused as stale': ({s}) => s.androidStale > 0,
      'two reviews applied': ({s}) => s.applied.length === 2,
      'two confirm presses on one review': ({s}) => s.confirms['1'].pending && s.confirms['2'].pending,
      'a second press answered while Android has the change': ({s}) => s.latePresses > 0 && s.acting !== 0,
    },
    // The revision and visit a review was opened under and the count of ignored presses are
    // closure state; they show in what the provider and Android are asked and in which answers
    // open, close or apply a review.
    project: ({s}) => ({visible: s.visible, hostReview: s.hostReview, disposed: s.disposed, revision: s.revision,
      validating: Object.entries(s.requests).filter(([, request]) => request.phase === 'validating').map(([slot]) => Number(slot)),
      review: s.review, serial: s.serial, confirming: Object.entries(s.confirms).filter(([, press]) => press.pending).map(([slot]) => Number(slot)),
      acting: s.acting, dispatched: s.dispatched, applied: s.applied, refusedBusy: s.refusedBusy, refusedLeft: s.refusedLeft,
      staleClosed: s.staleClosed, androidStale: s.androidStale}),
    async start() {
      let visible = true, hostReview = false, disposed = false, revision = 0, serial = 0, open = 0, acting = 0, slot = 0, change, twice = false;
      let refusedBusy = 0, refusedLeft = 0, staleClosed = 0, androidStale = 0;
      const validating = new Map(), confirming = new Map(), dispatched = [], applied = [], read = new Map();
      const native = () => `1700000000:1000:${revision}`, id = at => `lib:i:${at + 1}:${(at + 1) * 10}`;
      const scope = {scope: 'full', images: true, videos: true, canSelectMore: false, canEditOthers: true, locked: false, version: 'v1'};
      const current = items => items.every(item => item.revision === native());
      const port = {
        async scope() { return scope; },
        async inspect({id: item}) { return {id: item, revision: native(), kind: 'image', mime: 'image/jpeg', name: 'IMG.jpg', album: 'Camera', width: 400,
          height: 300, takenAt: 1700000000000, modifiedAt: 1700000000000, size: 1000, duration: 0, favorite: false, owned: false, image: ''}; },
        validate({items}) {
          const [kind, from] = slot;
          return new Promise(resolve => (kind === 'request' ? validating : confirming).set(from, () =>
            resolve({...scope, items: items.map(item => ({id: item.id, status: current([item]) ? 'current' : 'missing'}))})));
        },
        requestChange({items}) { return new Promise((resolve, reject) => { if (change) twice = true;change = {items, resolve, reject}; }); },
        share() { assert.fail('no share review is opened'); },
      };
      const release = product.setMainLibraryHost({visible: () => visible, reviewOpen: () => hostReview, reviewChanged() {}, trashed() {},
        run() { assert.fail('the host runs no operation'); }});
      const library = product.createDeviceLibrary(port, () => true), signal = new AbortController().signal;
      /** The assistant reads the item at the revision current now; a request names such a read. */
      const assistantReads = async () => disposed || read.set(revision, (await library.agent.run({type: 'photo_library_inspect', id: id(revision)}, signal)).item);
      await assistantReads();
      const status = () => { if (library.takeStatus() === 'Items changed') staleClosed = bump(staleClosed); };
      return {
        actions: {
          async request({slot: from, read: at}) {
            slot = ['request', from];
            const item = read.get(at);
            void library.agent.run({type: 'photo_library_review', action: 'favorite', items: [{id: item.id, revision: item.revision}]}, signal).then(result => {
              assert.equal(result.status, 'review_opened');open = ++serial;
            }, refusal => {
              assert.ok(refusal instanceof product.LibraryAgentRefusal, String(refusal));
              if (refusal.message === 'Open Photos, then ask again.') refusedLeft = bump(refusedLeft);
              else if (refusal.message === 'Finish the open review first.') refusedBusy = bump(refusedBusy);
              else assert.match(refusal.message, /^An item changed or left the library/);
            });
            await settle();
            assert.ok(validating.has(from), 'the request did not reach the provider');
          },
          async validated({slot: from}) { const answer = validating.get(from);validating.delete(from);answer();await settle(); },
          async confirmPress({slot: from}) { slot = ['confirm', from];library.reviewCard().confirm();await settle();assert.ok(confirming.has(from)); },
          async confirmValidated({slot: from}) {
            const answer = confirming.get(from), before = open;confirming.delete(from);answer();await settle();
            if (change && acting === 0) { acting = before;dispatched.push(before); }
            status();
          },
          async androidSettles({approved}) {
            const call = change;change = undefined;
            if (approved && current(call.items)) { applied.push(acting);call.resolve({status: 'complete', outcomes: call.items.map(item => ({id: item.id, status: 'favorited'}))}); }
            else {
              if (approved) androidStale = bump(androidStale);
              call.reject(Object.assign(Error('refused'), {code: approved ? 'LIBRARY_STALE' : 'LIBRARY_DECLINED'}));
            }
            acting = 0;await settle();
            status();
          },
          cancel() { library.reviewCard().cancel(); },
          leave() { library.leave();visible = false;hostReview = false; },
          show() { visible = true; },
          hostReviewOpens() { hostReview = true; },
          hostReviewCloses() { hostReview = false; },
          async sourceChanges() { revision++;await assistantReads(); },
          dispose() { library.dispose();disposed = true;visible = false;hostReview = false; },
        },
        observe() {
          const card = library.reviewCard();
          assert.equal(twice, false, 'two changes handed to Android');
          if (!card) open = 0;
          return {visible, hostReview, disposed, revision, validating: [...validating.keys()].sort(), review: open, serial,
            confirming: [...confirming.keys()].sort(), acting: change ? acting : 0, dispatched: [...dispatched], applied: [...applied],
            refusedBusy, refusedLeft, staleClosed, androidStale};
        },
        async close() {
          for (const answer of [...validating.values(), ...confirming.values()]) answer();
          change?.reject(Object.assign(Error('closed'), {code: 'LIBRARY_DECLINED'}));
          await settle();library.dispose();release();
        },
      };
    },
  });
}
