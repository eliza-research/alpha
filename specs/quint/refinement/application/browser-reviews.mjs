/** Replays BrowserReviews traces against the real `BrowserReviews` class in a jsdom document.
 *
 * Abstraction: review identity n is the id `review-n`. `pending` is the set of open dialogs,
 * `listening` the reviews whose four event listeners are installed (counted on window and document),
 * `calls`/`settled` the confirm calls made and the promises resolved, and `last` how the latest
 * resolved request ended: "refused" when it resolved without opening a dialog, otherwise the
 * resolved value. The lock screen is the visible Wake control plus the device-state event the
 * device chrome dispatches when the screen state changes. `approvedHidden` is a model-only ghost. */
import {modelTraces, replayTraces, loadBundled, installDocument, countListeners, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/BrowserReviews.qnt', module: 'BrowserReviews'};
const scenarios = ['duplicateRefusedTest', 'hiddenCancelsTest', 'hiddenRequestRefusedTest', 'lockCancelsTest', 'dismissThenReopenTest'];
const witnesses = ['TwoReviewsOpenWitness', 'DuplicateRefusedWitness', 'ApprovedWitness', 'RefusedWhileLockedWitness'];
const Reviews = [1, 2];

export async function browserReviewsDriver() {
  const load = await loadBundled('apps/app/src/browser/review.ts');
  return async () => {
    const dom = await installDocument('<!doctype html><body><button id="origin">Origin</button></body>');
    const {window, document} = dom;
    const windowListeners = countListeners(window, ['alpha-back', 'pagehide', 'alpha:device-state']);
    const documentListeners = countListeners(document, ['visibilitychange']);
    const {BrowserReviews} = await load();
    const reviews = new BrowserReviews();
    const calls = {1: 0, 2: 0}, settled = {1: 0, 2: 0}, last = {1: 'none', 2: 'none'}, opened = [];
    let locked = false, dismissals = 0;
    const dialog = id => document.querySelector(`dialog[aria-label="Review ${id}"]`);
    const open = () => Reviews.filter(id => dialog(id));
    const wake = document.createElement('button');
    wake.setAttribute('aria-label', 'Wake');
    wake.getClientRects = () => [{}];
    return {
      async confirm(id) {
        calls[id]++;
        const had = !!dialog(id);
        let done = false;
        void reviews.confirm(`review-${id}`, `Review ${id}`, 'Details', 'Approve').then(value => {
          settled[id]++; last[id] = done ? (value ? 'approved' : 'denied') : 'refused';
          const at = opened.indexOf(id); if (done && at >= 0) opened.splice(at, 1);
        });
        await settle();
        if (!had && dialog(id)) opened.push(id);
        done = true;
      },
      async approve(id) { dialog(id).querySelectorAll('footer button')[1].click(); await settle(); },
      async dismiss(id) {
        const way = dismissals++ % 4;
        // Back reaches only the review that was opened first: its listener stops the event.
        if (way === 0 && opened[0] === id) window.dispatchEvent(new window.Event('alpha-back', {cancelable: true}));
        else if (way === 1) reviews.cancel(`review-${id}`);
        else if (way === 2) dialog(id).dispatchEvent(new window.Event('cancel'));
        else dialog(id).querySelectorAll('footer button')[0].click();
        await settle();
      },
      async hide() { dom.setHidden(true); await settle(); },
      async show() { dom.setHidden(false); await settle(); },
      async lockScreen() { if (!locked) { locked = true; document.body.append(wake); window.dispatchEvent(new window.Event('alpha:device-state')); } await settle(); },
      async unlockScreen() { if (locked) { locked = false; wake.remove(); window.dispatchEvent(new window.Event('alpha:device-state')); } await settle(); },
      observe() {
        const pending = open(), installed = windowListeners() + documentListeners();
        return {foreground: !document.hidden, screenLocked: locked, pending, listening: installed === 4 * pending.length ? pending : `listeners ${installed}`,
          calls: {...calls}, settled: {...settled}, last: {...last}};
      },
      teardown() { dom.restore(); },
    };
  };
}

export async function checkBrowserReviews({random = 40, steps = 30} = {}) {
  const create = await browserReviewsDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({foreground: s.foreground, screenLocked: s.screenLocked, pending: s.pending, listening: s.listening,
    calls: s.calls, settled: s.settled, last: s.last})});
}
