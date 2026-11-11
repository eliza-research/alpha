/** Replays WebReadingReview traces against the real `reviewBrowserReading` dialog in a jsdom
 * document, with the real sensitive-address and sensitive-text rules.
 *
 * Controlled ports: the public page-text fetch and local speech playback. The caller's `valid`
 * callback is the model's `current` argument. Abstraction: `text` is the class of the excerpt
 * field's value; `speaking` is the enabled Stop button; `unsettled` is the set of speech requests
 * that have not ended, numbered by the model generation at which each started; `sourceLive` is a
 * page-text request that has neither settled nor been aborted. Speech whose abort signal has not
 * fired must be exactly the current one. `edited`, `typed` and the generation counter itself are
 * private to the dialog and show only through these observations. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, loadBundled, installDocument, settle} from '../application/browser-model-traces.mjs';
import {sensitiveReadingUrl, sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';

const model = {path: 'specs/quint/services/WebReadingReview.qnt', module: 'WebReadingReview'};
const scenarios = ['staleSpeechEndTest', 'typedTextKeptTest', 'changedPageClosesReviewTest', 'closeStopsSpeechTest'];
const witnesses = ['EarlierSpeechUnsettledWitness', 'RefusedOpenReviewWitness', 'UserTextSpokenWitness'];
const plainAddress = 'https://example.test/article', sensitiveAddress = 'https://example.test/account/sign-in';
const texts = {page: 'Public page text about a harbour.', user: 'A paragraph the user typed.', sensitive: 'Your verification code is 482913'};

export async function webReadingReviewDriver() {
  assert.equal(sensitiveReadingUrl(plainAddress), false);
  assert.equal(sensitiveReadingUrl(sensitiveAddress), true);
  assert.equal(sensitiveReadingText(texts.sensitive), true);
  assert.equal(sensitiveReadingText(texts.page) || sensitiveReadingText(texts.user), false);
  const load = await loadBundled('apps/app/src/browser/reading-review.ts', {
    '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-source.ts': 'export const readPublicPageSource=(url,signal)=>globalThis.__readingPorts.source(url,signal);',
    '../local-speech-playback': 'export const speakLocalText=(text,signal,started)=>globalThis.__readingPorts.speak(text,signal,started);'});
  return async trace => {
    const dom = await installDocument('<!doctype html><body><button id="origin">Read aloud</button></body>');
    const {window, document} = dom;
    const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
    const speeches = new Map();
    let current = true, source, sourceSettled = false, pendingSpeech, finishes = 0, endings = 0;
    globalThis.__readingPorts = {
      source(url, signal) { source = {...deferred(), signal, url}; return source.promise; },
      speak(text, signal, started) { pendingSpeech = {...deferred(), text, signal, started}; return pendingSpeech.promise; },
    };
    const {reviewBrowserReading} = await load();
    const owner = new AbortController();
    let returned = false;
    const review = reviewBrowserReading(trace.init.blocked ? sensitiveAddress : plainAddress, owner.signal, () => { if (!current) throw new window.DOMException('Reading cancelled', 'AbortError'); });
    void review.then(() => { returned = true; }, () => { returned = true; });
    await settle();
    const dialog = document.querySelector('dialog[aria-label="Read page excerpt"]');
    const field = dialog.querySelector('textarea'), status = dialog.querySelector('[role="status"]');
    const [read, stop, close] = dialog.querySelectorAll('footer button');
    assert.deepEqual([read.textContent, stop.textContent, close.textContent], ['Read locally', 'Stop reading', 'Close']);
    const kind = () => field.value === '' ? 'empty' : Object.entries(texts).find(([, value]) => value === field.value)?.[0] ?? `other:${field.value}`;
    return {
      async typeText(sensitive) { field.value = sensitive ? texts.sensitive : texts.user; field.dispatchEvent(new window.Event('input')); await settle(); },
      async sourceSettles(result, isCurrent) {
        current = isCurrent; sourceSettled = true;
        if (result === 'text') source.resolve({text: texts.page, truncated: false});
        else if (result === 'none') source.resolve(null);
        else if (result === 'blocked') source.resolve({blocked: true});
        else source.reject(new Error('fetch failed'));
        await settle(); current = true;
      },
      async read(isCurrent, step) {
        current = isCurrent; pendingSpeech = undefined;
        read.click(); await settle(); current = true;
        if (pendingSpeech) { assert.equal(pendingSpeech.text, field.value.trim()); speeches.set(step.after.generation, pendingSpeech); }
      },
      async stop() { stop.click(); await settle(); },
      async speechSettles(id) {
        const speech = speeches.get(id); speeches.delete(id);
        const way = endings++ % 3;
        if (way === 0) speech.resolve();
        else if (way === 1) speech.reject(new Error('Speech could not start. Try again.'));
        else { current = false; try { speech.started(); speech.resolve(); } catch (error) { speech.reject(error); } }
        await settle(); current = true;
      },
      async finish() {
        const way = finishes++ % 6;
        if (way === 0) close.click();
        else if (way === 1) owner.abort();
        else if (way === 2) window.dispatchEvent(new window.Event('alpha-back', {cancelable: true}));
        else if (way === 3) dom.setHidden(true);
        else if (way === 4) window.dispatchEvent(new window.Event('pagehide'));
        else dialog.dispatchEvent(new window.Event('cancel', {cancelable: true}));
        await settle();
      },
      observe() {
        const open = dialog.isConnected;
        assert.equal(returned, !open, 'the review call returns exactly when its dialog closes');
        return {open, blocked: status.textContent === 'Contains secrets', readOffered: open ? !read.disabled : null,
          fieldLocked: open ? field.disabled : null, sourceLive: !sourceSettled && !source.signal.aborted,
          text: kind(), speaking: !stop.disabled, unsettled: [...speeches.keys()].sort((a, b) => a - b),
          audible: [...speeches].filter(([, speech]) => !speech.signal.aborted).map(([id]) => id)};
      },
      teardown() { delete globalThis.__readingPorts; dom.restore(); },
    };
  };
}

export async function checkWebReadingReview({random = 40, steps = 30} = {}) {
  const create = await webReadingReviewDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({open: s.open, blocked: s.blocked,
    readOffered: s.open ? !s.blocked && !s.sourcePending && !s.speaking : null, fieldLocked: s.open ? s.blocked || s.speaking : null,
    sourceLive: s.sourceLive, text: s.text, speaking: s.speaking, unsettled: s.unsettled, audible: s.speaking ? [s.generation] : []})});
}
