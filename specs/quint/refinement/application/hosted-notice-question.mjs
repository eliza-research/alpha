import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/hosted-notice-question.ts';
const model = 'HostedNoticeQuestion';
const excerpt = 'The reviewed task is complete.';
const privateText = 'Example verification code.';
const snapshot = {kind: 'ready', question: true, token: 'fixture-tap',
  result: {runId: 'fixture-run', output: excerpt}};
const inputs = {
  valid: snapshot,
  ordinary: {...snapshot, question: false},
  summary: {...snapshot, result: {...snapshot.result, output: {}}},
  private: {...snapshot, result: {...snapshot.result, output: privateText}},
};
const replies = {exact: snapshot, ordinary: inputs.ordinary, missing: {kind: 'none'},
  token: {...snapshot, token: 'replacement-tap'}, body: {...snapshot, result: {...snapshot.result, output: 'A changed fixture result.'}}};

async function load(extraSources) {
  captureSources([driver, implementation, ...extraSources]);
  const fixture = {
    './alpha-client': 'export const alphaClient={getState:()=>({context:{sensitive:globalThis.__quintHostedQuestion.sensitive}})};',
    '../prototype/local-ocr': 'export const recognizeLocalText=()=>{throw Error("Text-only review cannot start OCR");};',
  };
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true, format: 'esm',
    platform: 'node', write: false, metafile: true,
    plugins: [{name: 'hosted-question-fixture', setup(builder) {
      builder.onResolve({filter: /^\.\/alpha-client$|^\.\.\/prototype\/local-ocr$/},
        args => ({path: args.path, namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: fixture[args.path]}));
    }}]});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.startsWith('fixture:') && !path.startsWith('node_modules/'));
  captureSources(sources);
  const exports = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  return {exports, sources};
}

async function scenario(actual, name, drive) {
  const {window} = new JSDOM('<!doctype html><body><button>Review saved result</button></body>',
    {url: 'https://fixture.invalid', pretendToBeVisual: true});
  window.HTMLDialogElement.prototype.showModal = function() {this.open = true;};
  window.HTMLElement.prototype.scrollIntoView = function() {};
  const state = {owner: true, sensitive: false, composer: true};
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle, __quintHostedQuestion: state};
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const resolveTap = actual.hostedTapResolver(), signal = new AbortController();
  const button = window.document.querySelector('button');
  button.focus();
  const dialog = () => window.document.querySelector('dialog[aria-label="Ask about selected content"]');
  const proceed = () => dialog()?.querySelector('button[aria-label="Use in conversation"]');
  const editBox = () => dialog()?.querySelector('[aria-label="Content excerpt"]');
  let close, recheck, consumption, resolver, closing = false, interrupted = false, expectedDraft;
  let closes = 0, discards = 0, rechecks = 0, consumeCalls = 0, consumed = 0, composed = 0, reports = 0;
  let fallback = 0, resolveCalls = 0, resolveFailures = 0;
  function observe() {
    const review = dialog(), status = review?.querySelector('[role="status"]')?.textContent ?? '';
    const validation = status.includes('Selection changed') ? 'stale' :
      status === 'Remove secrets first' ? 'private' : '';
    return {'s.owner': state.owner, 's.sensitive': state.sensitive, 's.composer': state.composer,
      's.phase': review ? 'review' : recheck ? 'recheck' : consumption ? 'consume' : closes ? 'done' :
        fallback ? 'fallback' : 'idle',
      's.dialog': !!review, 's.proceed': !!proceed() && !proceed().disabled, 's.validation': validation,
      's.interrupted': interrupted, 's.closes': closes, 's.discards': discards, 's.rechecks': rechecks,
      's.consumeCalls': consumeCalls, 's.consumed': consumed, 's.composed': composed, 's.reports': reports,
      's.fallback': fallback, 's.resolving': !!resolver, 's.resolveCalls': resolveCalls,
      's.resolveFailures': resolveFailures};
  }
  const schedule = trace(name, observe());
  const record = (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), observe());
  try {
    await drive({
      async open(kind = 'valid') {
        close = actual.reviewHostedNoticeQuestion({
          signal: signal.signal, result: inputs[kind], current: () => state.owner,
          recheck() {rechecks++; recheck = deferred(); return recheck.promise;},
          canCompose: () => state.composer,
          async consume() {
            consumeCalls++;
            consumption = deferred();
            await consumption.promise;
            consumed++;
          },
          async discard() {discards++;},
          compose(draft) {assert.equal(draft, expectedDraft); composed++;},
          report(message) {assert.match(message, /Nothing was added to your conversation/); reports++;},
          unreviewable() {fallback++;},
          closed() {closes++; if (closing) interrupted = true;},
        });
        await tick();
        if (dialog()) {
          assert.equal(editBox().value, excerpt);
          assert.equal(window.document.activeElement.getAttribute('aria-label'), 'Question about content');
        }
        record('The actual hosted question gate opens or delegates the retained notice', 'open', kind);
      },
      owner(value) {state.owner = value; record('The source owner predicate changes', 'owner', value);},
      sensitive(value) {state.sensitive = value; record('The renderer sensitivity gate changes', 'sensitive', value);},
      composer(value) {state.composer = value; record('The conversation admits or refuses the draft', 'composerAllowed', value);},
      async submit(edit = 'valid') {
        const box = editBox();
        assert.ok(box);
        box.value = edit === 'empty' ? '' : edit === 'private' ? privateText : excerpt;
        box.dispatchEvent(new window.Event('input', {bubbles: true}));
        expectedDraft = 'Help me understand this saved result.\n\nSource: Scheduled result notification\n\n' + excerpt;
        proceed().click();
        await tick();
        if (!dialog()) assert.equal(window.document.activeElement, button);
        record('The actual dialog edits and submits reviewed text', 'submit', edit);
      },
      async dismiss(kind) {
        closing = true;
        const explicit = kind === 'button' || kind === 'back';
        if (kind === 'button') Array.from(dialog().querySelectorAll('button')).find(button => button.textContent === 'Cancel').click();
        else if (kind === 'signal') signal.abort();
        else window.dispatchEvent(new window.Event(kind === 'back' ? 'alpha-back' : kind, {cancelable: true}));
        await tick();
        assert.equal(window.document.activeElement, button);
        record('The review closes with the actual explicit-dismiss or lifecycle behavior', 'dismiss', explicit);
      },
      async interrupt(kind) {
        closing = true;
        window.dispatchEvent(new window.Event(kind));
        await tick();
        record('A held question is interrupted by the real renderer lifecycle listener', 'interrupt');
      },
      async recheck(reply) {
        const held = recheck;
        assert.ok(held);
        recheck = undefined;
        held.resolve(replies[reply]);
        await tick();
        record('The exact retained result and token are rechecked after review', 'recheck', reply);
      },
      async consume(ok) {
        const held = consumption;
        assert.ok(held);
        consumption = undefined;
        if (ok) held.resolve();
        else held.reject(Error('Synthetic consume refused'));
        await tick();
        record('The real wrapper receives settlement before composing the reviewed draft', 'settleConsume', ok);
      },
      async resolveTap() {
        const held = {...deferred()};
        let started = false;
        held.completion = resolveTap(() => {started = true; resolveCalls++; return held.promise;})
          .catch(() => {resolveFailures++;});
        if (started) resolver = held;
        else await held.completion;
        record('Overlapping source tap resolution is refused while the existing callback owns it', 'resolveTap');
      },
      async finishResolve(ok) {
        const held = resolver;
        assert.ok(held);
        if (ok) held.resolve();
        else held.reject(Error('Synthetic resolution refused'));
        await held.completion;
        resolver = undefined;
        record('Settlement releases the source resolution slot after success or refusal', 'finishResolve', ok);
      },
    });
    assert.equal(recheck ?? consumption ?? resolver, undefined);
    return schedule;
  } finally {
    close?.();
    await tick();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

export async function checkHostedNoticeQuestion(extraSources = []) {
  const {exports, sources} = await load(extraSources);
  const run = (name, drive) => scenario(exports, name, drive);
  const admitted = async f => {await f.open(); await f.submit();};
  const traces = [
    await run('exact-draft-and-native-acknowledgement', async f => {
      await admitted(f); await f.recheck('exact'); await f.consume(true);
    }),
  ];
  for (const reply of ['token', 'body', 'ordinary', 'missing'])
    traces.push(await run('recheck-refuses-'+reply, async f => {await admitted(f); await f.recheck(reply);}));
  for (const reason of ['button', 'back', 'signal', 'pagehide', 'blur'])
    traces.push(await run('review-dismiss-'+reason, async f => {await f.open(); await f.dismiss(reason);}));
  for (const kind of ['summary', 'ordinary', 'private'])
    traces.push(await run('unreviewable-'+kind, f => f.open(kind)));
  traces.push(
    await run('sensitive-context-falls-back', async f => {f.sensitive(true); await f.open();}),
    await run('reviewed-edit-rejects-sensitive-text-and-can-recover', async f => {
      await f.open(); await f.submit('empty'); await f.submit('private'); await f.submit();
      await f.recheck('exact'); await f.consume(true);
    }),
    await run('stale-selection-blocks-before-readback', async f => {
      await f.open(); f.owner(false); await f.submit(); await f.dismiss('signal');
    }),
    await run('ownership-loss-before-consume', async f => {
      await admitted(f); f.owner(false); await f.recheck('exact');
    }),
    await run('chooser-refusal-retains-pending-question', async f => {
      await admitted(f); f.composer(false); await f.recheck('exact');
    }),
    await run('home-interrupts-held-recheck', async f => {
      await admitted(f); await f.interrupt('launcher-home'); await f.recheck('exact');
    }),
    await run('owner-loss-after-consume-dispatch-prevents-draft', async f => {
      await admitted(f); await f.recheck('exact'); f.owner(false); await f.consume(true);
    }),
    await run('blur-after-consume-dispatch-prevents-draft', async f => {
      await admitted(f); await f.recheck('exact'); await f.interrupt('blur'); await f.consume(true);
    }),
    await run('failed-acknowledgement-prevents-draft', async f => {
      await admitted(f); await f.recheck('exact'); await f.consume(false);
    }),
    await run('tap-resolver-suppresses-overlap-and-releases-on-error', async f => {
      await f.resolveTap(); await f.resolveTap(); await f.finishResolve(false);
      await f.resolveTap(); await f.finishResolve(true);
    }),
  );
  return await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-orchestration', assumptions: [
      'Actual hosted question wrapper, content-review dialog, shared text sensitivity and summary rules execute in a controlled DOM.',
      'Synthetic current-owner, composer and acknowledgement ports make no provider requests. A successful settlement before owner retirement can outlive the dialog while the old draft remains fenced.',
      'Physical browser focus, native pending-token durability, and full panel and provider integration have separate evidence.',
    ]}));
}
