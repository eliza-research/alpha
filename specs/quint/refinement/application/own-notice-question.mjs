/** Replays OwnNoticeQuestion model traces against `reviewOwnNoticeQuestion` and the review sheet
 * it opens (`reviewContentQuestion`), both evaluated from source in a JSDOM window.
 *
 * Controlled ports: the publisher callbacks (current, recheck, consume, release, compose, report,
 * closed) and the window's `launcher-home` and `blur` events. The sheet's buttons are clicked.
 *
 * Not observed: `canceled` (internal; visible through what a later recheck does). */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {noticeExcerpt, noticeReviewable} from '../../../../apps/app/src/prototype/context-selection.ts';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/OwnNoticeQuestion.qnt', module: 'OwnNoticeQuestion'};
export const scenarios = ['questionIsDraftedTest', 'homeDuringConsumeStillDraftsTest', 'homeDuringRecheckSpendsNothingTest',
  'dismissReleasesTapTest', 'changedNoticeAfterConsumeIsReportedTest', 'unreviewableNoticeIsRefusedTest'];
export const witnesses = ['DraftAfterCancelWitness', 'ReleasedWitness', 'SpentButNotKeptWitness'];

const flush = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };
const REPORTS = {'This notification is unavailable for review.': 'unavailable', 'This notification changed.': 'changed',
  'The question could not be kept. Open the notification again.': 'not-kept'};

export function compile() {
  const read = path => stripTypeScriptTypes(readFileSync(`${repositoryRoot}/${path}`, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'strip'});
  return `${read('apps/app/src/browser/content-question.ts')}\n${read('apps/app/src/prototype/own-notice-question.ts')}\nglobalThis.review=reviewOwnNoticeQuestion;`;
}

export function project(state) {
  const {canceled, ...observed} = state;
  return observed;
}

export function createDriver(code) {
  const dom = new JSDOM('<!doctype html><body><div class="os"></div></body>', {pretendToBeVisual: true});
  const {window} = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const box = {window, document: window.document, getComputedStyle: window.getComputedStyle.bind(window), HTMLElement: window.HTMLElement,
    URL, AbortController, queueMicrotask, noticeExcerpt, noticeReviewable, sensitiveReadingText, recognizeLocalText: async () => ({text: ''})};
  vm.runInNewContext(code, box);
  let current = true, opened = false, refused = false, recheck, consume, homes = 0;
  const counts = {consumed: 0, released: 0, composed: 0, closedCalls: 0}, reports = [];
  const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject, pending: true}; };
  const options = {
    notice: {source: 'own', id: 'reminder', revision: 'a'.repeat(64), title: 'Owned reminder', text: 'Prepare the meeting', appLabel: 'Alpha Phone'},
    current: () => current,
    recheck: () => { recheck = gate(); return recheck.promise; },
    consume: () => { consume = gate(); return consume.promise; },
    release: async () => { counts.released++; },
    compose: () => { counts.composed++; },
    report: message => { reports.push(REPORTS[message] ?? `unexpected: ${message}`); },
    closed: () => { counts.closedCalls++; },
  };
  const button = label => [...window.document.querySelectorAll('dialog button')].find(item => item.textContent === label);
  return {
    async open(reviewable) {
      if (!reviewable) options.notice.source = 'third-party';
      opened = true; refused = box.review(options) === undefined;
      await flush();
    },
    noticeChanged() { current = false; },
    async dismiss() { button('Cancel').click(); await flush(); },
    async chooseCompose() { button('Add to chat').click(); await flush(); },
    async abort() { window.dispatchEvent(new window.Event(homes++ % 2 ? 'blur' : 'launcher-home')); await flush(); },
    async recheckSettles(ok) { recheck.pending = false; recheck.resolve(ok); await flush(); },
    async consumeSettles(ok) {
      consume.pending = false;
      if (ok) { counts.consumed++; consume.resolve(); } else consume.reject(Error('the tap was not consumed'));
      await flush();
    },
    observe() {
      const phase = !opened ? 'idle' : refused ? 'refused' : recheck?.pending ? 'rechecking' : consume?.pending ? 'consuming'
        : window.document.querySelector('dialog') ? 'review' : 'closed';
      return {phase, current, composing: recheck !== undefined, ended: counts.closedCalls > 0, closedCalls: counts.closedCalls,
        consumed: counts.consumed, released: counts.released, composed: counts.composed, report: reports.at(-1) ?? 'none'};
    },
    close() { window.close(); },
  };
}

export async function runOwnNoticeQuestionReplay({random = 80, steps = 30} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}
