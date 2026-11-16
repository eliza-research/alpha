import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {deferred} from '../../../../test/fixtures/wait-for.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';
import {checkTraces} from '../check-traces.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const entry = 'apps/app/src/browser/calendar-editor.ts';
const identity = {id: 'fixture-event', revision: 'revision-2'};
const binding = JSON.stringify(['calendar-modal-editor', 'app', identity.id]);
const key = 'alpha.browser.assistant-draft:v1:' + createHash('sha256').update(binding).digest('hex');
const baseline = {title: 'Fixture event', body: 'Agenda', location: 'Room', begin: Date.UTC(2027, 0, 15, 10),
  end: Date.UTC(2027, 0, 15, 11), timeZone: 'UTC'};
const damaged = 'synthetic invalid persisted bytes';
const storedDraft = (revision = identity.revision) => JSON.stringify({
  version: 1, legacy: null, value: JSON.stringify({raw: JSON.stringify({version: 1, binding, revision,
    text: JSON.stringify({version: 1, id: identity.id, revision, fields: {
      title: 'Retained fixture', body: 'Agenda', location: 'Room', start: '2027-01-15T10:00:00.000',
      end: '2027-01-15T11:00:00.000', zone: 'UTC', allDay: false, repeat: '', alert: 'none', video: false, who: [],
    }}),
  })}),
});
const call = (name, ...args) => ({name, args});
const settle = async () => { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); };

async function compile() {
  const ports = [
    [/^@capacitor\/core$/, 'exports.Capacitor={getPlatform:()=>"web"}'],
    [/\/dev-profile$/, 'exports.browserDevProfile=false'],
    [/\/build-flags$/, 'exports.testMocksEnabled=fixture.development'],
    [/^\.\/documents$/, 'exports.browserDocuments=fixture.documents'],
    [/\/native-connection$/, 'exports.secureConnectionStore=fixture.unused'],
    [/\/native-recovery-backup$/, 'exports.saveNativeRecoveryBackup=fixture.unused'],
    [/\/icon-style$/, 'exports.iconStyle=()=>({})'],
  ];
  const result = await build({absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    format: 'cjs', platform: 'node', loader: {'.css': 'empty'}, metafile: true,
    plugins: [{name: 'calendar-editor-platform', setup(builder) {
      for (const [filter, source] of ports) builder.onResolve({filter}, () => ({path: source, namespace: 'calendar-editor-port'}));
      builder.onLoad({filter: /.*/, namespace: 'calendar-editor-port'}, ({path}) => ({contents: path, loader: 'js'}));
    }}]});
  const sources = Object.keys(result.metafile.inputs).filter(path => !path.includes(':') && !path.startsWith('node_modules/'));
  for (const owner of [entry, 'apps/app/src/browser/calendar-editor-draft.ts', 'apps/app/src/browser/review.ts',
    'apps/app/src/runtime/assistant-draft-store.ts', 'apps/app/src/browser/domain-document.ts',
    'apps/app/src/browser/domain-recovery.ts', 'apps/app/src/browser/retained-data-notice.ts',
    '.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts']) assert.ok(sources.includes(owner), owner);
  return {code: result.outputFiles[0].text, sources};
}

function fixture(compiled, raw, development) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://alpha.test/', pretendToBeVisual: true});
  const {window} = dom, {document} = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.Element.prototype.scrollIntoView = () => {};
  const blobs = [];
  window.HTMLAnchorElement.prototype.click = function () { assert.ok(this.download, 'Only the backup port may download'); };
  const module = {exports: {}};
  let serial = 0, snapshot, captured, readGate, editGate, resetGate;
  let reads = 0, edits = 0, resets = 0, reloads = 0, commits = 0, result, captureSignal, resetSignal;
  const replace = raw => (snapshot = {revision: 'document-' + (++serial), raw});
  if (raw !== undefined) replace(raw);
  const current = expected => expected?.revision === snapshot?.revision && expected?.raw === snapshot?.raw;
  const ownKey = actual => assert.equal(actual, key, 'Only the synthetic editor slot is reachable');
  const editor = () => document.querySelector('dialog.alpha-calendar-editor');
  const review = () => document.querySelector('dialog.alpha-operation-review');
  const recovery = () => document.querySelector('dialog[aria-label="Calendar editor recovery"]');
  const button = (parent, label) => {
    const control = [...parent.querySelectorAll('button')].find(child => child.textContent === label && !child.hidden);
    assert.ok(control, label);
    return control;
  };
  const title = () => [...editor().querySelectorAll('label')].find(label => label.textContent === 'Event title').querySelector('input');
  const documents = {
    async read(actual, signal) {
      ownKey(actual); reads++;
      const result = snapshot;
      if (recovery() && development) {
        captureSignal = signal;
        if (readGate) await readGate.promise;
        signal?.throwIfAborted();
        captured = result;
      }
      return result;
    },
    async compareExchange(actual, expected, raw, signal) {
      ownKey(actual);
      resetSignal = signal;
      if (resetGate) await resetGate.promise;
      signal?.throwIfAborted();
      if (!current(expected)) throw Error('Saved editor changed after capture');
      resets++;
      return replace(raw);
    },
    async edit(actual, editor, signal) {
      ownKey(actual); edits++;
      const before = snapshot;
      if (editGate) await editGate.promise;
      signal?.throwIfAborted();
      const next = await editor(before);
      if (!current(before)) throw Error('Saved editor changed before write');
      replace(next.raw);
      return next.result;
    },
    readOrCreate() { throw Error('A fixture has no legacy import'); },
  };
  const local = {documents, development, unused() { throw Error('External effects are outside this fixture'); }};
  const URL = {createObjectURL(blob) { blobs.push(blob); return 'blob:https://alpha.test/synthetic'; }, revokeObjectURL() {}};
  const schedule = (callback, delay) => { if (delay < 1000) queueMicrotask(callback); return 0; };
  new Function('module', 'exports', 'fixture', 'window', 'document', 'HTMLInputElement', 'getComputedStyle',
    'requestAnimationFrame', 'localStorage', 'location', 'URL', 'setTimeout', compiled.code)(
    module, module.exports, local, window, document, window.HTMLInputElement, window.getComputedStyle.bind(window),
    () => 0, window.localStorage, {reload() {reloads++;}}, URL, schedule);
  const commitEvent = () => { commits++; throw Error('Event writes are outside this fixture'); };
  void module.exports.editCalendarEvent(baseline, commitEvent, [], identity).then(value => {result = value.status;});
  const stored = () => {
    try {
      const value = JSON.parse(JSON.parse(JSON.parse(snapshot.raw).value).raw).text;
      return value ? JSON.parse(value).revision === identity.revision ? 'fresh' : 'stale' : 'none';
    } catch { return 'none'; }
  };
  const status = () => recovery()?.querySelector('[role="status"]')?.textContent;
  const observe = () => {
    const label = review()?.getAttribute('aria-label') ?? '';
    const phase = !recovery() ? 'none' : !development ? 'notice' : reloads ? 'reloading'
      : status()?.startsWith('Reading') ? 'capturing' : status() === 'Unreadable' ? 'unreadable'
      : [...recovery().querySelectorAll('button')].some(control => control.textContent === 'Confirm calendar editor reset')
        ? button(recovery(), 'Confirm calendar editor reset').disabled ? 'resetting' : 'confirm' : 'ready';
    return {
      's.alive': !!editor(), 's.review': label.startsWith('Discard') ? 'discard' : label.startsWith('Replace') ? 'replace' : 'none',
      's.recovery': phase, 's.recoveryCurrent': !!captured && current(captured) && !['none', 'reloading'].includes(phase),
      's.recoveryReset': resets > 0, 's.stored': stored(),
      's.conflict': !![...editor()?.querySelectorAll('button') ?? []].find(control => control.textContent === 'Replace saved editor' && !control.hidden),
      's.error': !![...editor()?.querySelectorAll('button') ?? []].find(control => control.textContent === 'Retry editor storage' && !control.hidden),
    };
  };
  return {
    window, document, editor, review, recovery, button, title, observe, stored, status, replace, blobs,
    snapshot: () => snapshot, captureSignal: () => captureSignal, resetSignal: () => resetSignal, counters: () => ({reads, edits, resets, reloads, commits}), outcome: () => result,
    holdRead: () => (readGate = deferred()), holdEdit: () => (editGate = deferred()), holdReset: () => (resetGate = deferred()),
    dispose() {
      readGate?.resolve(); editGate?.resolve(); resetGate?.resolve();
      if (editor()) button(editor(), 'Cancel').click();
      window.close();
    },
  };
}

async function replay(compiled, name) {
  const review = ['discard-review', 'retired-review', 'replace-review', 'stale-discard-review'].includes(name);
  const copy = review && name !== 'replace-review' ? 'fresh' : 'none';
  const f = fixture(compiled, review ? copy === 'fresh' ? storedDraft() : undefined : damaged, name !== 'production-notice');
  const trace = {name, init: call('opening', copy), expect: f.observe(), steps: []};
  const point = (label, action) => trace.steps.push({label, action, expect: f.observe()});
  const activate = (dialog, label) => f.button(dialog(), label).click();
  try {
    await settle();
    point('The actual stored draft read settled', call('openDone', review));
    if (review) {
      const replace = name === 'replace-review';
      if (replace) {
        f.replace(storedDraft('revision-1'));
        f.title().value = 'Typed fixture edit';
        f.title().dispatchEvent(new f.window.Event('input', {bubbles: true}));
        await settle();
        assert.equal(f.stored(), 'stale');
        point('Other view owns the differing saved copy', [call('edit', true), call('reportConflict', 'stale')]);
      }
      const kind = replace ? 'replace' : 'discard', open = replace ? 'Replace saved editor' : 'Discard saved editor';
      const approve = replace ? 'Replace saved edits' : 'Discard edits';
      const before = f.snapshot(), counts = f.counters();
      activate(f.editor, open);
      const staleApproval = f.button(f.review(), approve);
      assert.deepEqual(f.counters(), counts, 'A held review has no write effect');
      assert.equal(f.snapshot(), before);
      point('Actual confirmation is held open', call('openReview', kind));
      if (name === 'retired-review') {
        f.window.dispatchEvent(new f.window.Event('alpha:device-state'));
        staleApproval.click();
        await settle();
        assert.equal(f.outcome(), 'cancelled');
        assert.equal(f.snapshot(), before, 'A detached approval preserves retained bytes');
        assert.deepEqual(f.counters(), counts);
        point('Closing the editor retires the held review and late approval', call('close'));
        return trace;
      }
      if (name === 'stale-discard-review') {
        const newer = f.replace(storedDraft('revision-1'));
        point('Another editor owns newer bytes while review is open', call('reviewStoreChanged', 'stale'));
        const write = f.holdEdit();
        activate(f.review, approve);
        await settle();
        point('The clear waits against the previously reviewed draft', call('answerReview', true));
        write.resolve();
        await settle();
        assert.equal(f.snapshot(), newer, 'A stale discard never clears the newer saved copy');
        assert.equal(f.title().value, baseline.title);
        point('The shared store refuses the stale clear and offers its winner', call('discardDone', 'conflict'));
        return trace;
      }
      activate(f.review, 'Cancel');
      await settle();
      assert.equal(f.snapshot(), before);
      assert.deepEqual(f.counters(), counts);
      point('Denying the review preserves the exact stored copy', call('answerReview', false));
      activate(f.editor, open);
      point('A new review can be accepted explicitly', call('openReview', kind));
      if (replace) {
        activate(f.review, approve);
        await settle();
        assert.equal(f.stored(), 'fresh');
        const saved = JSON.parse(JSON.parse(JSON.parse(f.snapshot().raw).value).raw);
        assert.equal(JSON.parse(saved.text).fields.title, 'Typed fixture edit');
        point('Approved Replace writes the exact current editor', call('answerReview', true));
        return trace;
      }
      const write = f.holdEdit();
      activate(f.review, approve);
      await settle();
      assert.equal(f.snapshot(), before, 'Even approval leaves the copy until clear settles');
      point('Approval starts a clear against the reviewed copy', call('answerReview', true));
      write.resolve();
      await settle();
      assert.equal(f.stored(), 'none');
      assert.equal(f.title().value, baseline.title);
      point('Clear is read back before returning to the baseline editor', call('discardDone', 'cleared'));
      return trace;
    }

    const currentTitle = name === 'confirmed-recovery' ? 'Unsaved fixture editor' : baseline.title;
    if (currentTitle !== baseline.title) {
      f.title().value = currentTitle;
      f.title().dispatchEvent(new f.window.Event('input', {bubbles: true}));
      await settle();
      point('A failed store leaves the current edits in the editor', call('edit', true));
    }
    const before = f.snapshot(), counts = f.counters();
    const read = f.holdRead();
    activate(f.editor, 'Recover editor storage');
    point('The installed recovery opens for the storage error', call('openRecovery', name !== 'production-notice'));
    if (name === 'production-notice') {
      assert.match(f.recovery().textContent, /Data kept/);
      assert.deepEqual([...f.recovery().querySelectorAll('button')].map(control => control.textContent), ['Close']);
      assert.deepEqual(f.counters(), counts);
      activate(f.recovery, 'Close');
      point('Closing the production notice leaves storage alone', call('closeRecovery'));
      return trace;
    }
    if (name === 'retired-recovery') {
      f.window.dispatchEvent(new f.window.Event('pagehide'));
      assert.equal(f.captureSignal().aborted, true);
      read.resolve();
      await settle();
      assert.equal(f.outcome(), 'cancelled');
      assert.equal(f.snapshot(), before);
      assert.equal(f.recovery(), null);
      assert.equal(f.counters().resets, counts.resets);
      point('Parent close aborts the recovery capture before it can publish', call('close'));
      return trace;
    }

    read.resolve();
    await settle();
    assert.equal(f.status(), 'Needs recovery');
    point('Recovery reads the complete snapshot before enabling reset', call('recoveryCaptured', true));
    activate(f.recovery, 'Download calendar editor backup');
    const backup = JSON.parse(await f.blobs[0].text());
    assert.equal(backup.saved, damaged);
    assert.equal(backup.current.title, currentTitle);
    assert.equal(f.snapshot(), before, 'A backup does not change storage');
    activate(f.recovery, 'Reset app calendar editor');
    assert.equal(f.snapshot(), before, 'The first reset press is only a review');
    point('Reset now asks for a separate confirmation', call('requestReset'));
    if (name === 'stale-recovery') {
      f.replace(before.raw);
      point('An intervening write invalidates an identical-byte capture', call('recoverySuperseded'));
    }
    const replacement = f.snapshot(), reset = f.holdReset();
    activate(f.recovery, 'Confirm calendar editor reset');
    await settle();
    assert.equal(f.snapshot(), replacement);
    point('Confirmed reset waits for the exact compare-exchange', call('confirmReset'));
    if (name === 'retired-reset') {
      f.window.dispatchEvent(new f.window.Event('pagehide'));
      assert.equal(f.resetSignal().aborted, true);
      reset.resolve();
      await settle();
      assert.equal(f.outcome(), 'cancelled');
      assert.equal(f.snapshot(), replacement);
      assert.equal(f.counters().resets, counts.resets);
      assert.equal(f.counters().reloads, counts.reloads);
      point('Closing the parent retires a held reset before the storage effect', call('close'));
      return trace;
    }
    reset.resolve();
    await settle();
    if (name === 'stale-recovery') {
      assert.equal(f.status(), 'Saved editor changed after capture');
      assert.equal(f.snapshot(), replacement);
      assert.equal(f.counters().resets, counts.resets);
    } else {
      assert.equal(f.counters().resets, 1);
      assert.equal(f.counters().reloads, 1);
      assert.equal(JSON.parse(JSON.parse(JSON.parse(f.snapshot().raw).value).raw).text, '');
    }
    point('The exact storage reply controls reset and reload', call('recoverySettled', name !== 'stale-recovery'));
    return trace;
  } finally {
    try { assert.equal(f.counters().commits, 0, 'Editor recovery and review never commit an event'); }
    finally { f.dispose(); }
  }
}

export async function checkCalendarEditorReviewRecovery(owner) {
  const driver = fileURLToPath(import.meta.url);
  const driverHashes = captureReplayClosure([driver, owner]);
  const compiled = await compile(), traces = [];
  for (const name of ['discard-review', 'retired-review', 'replace-review', 'stale-discard-review', 'production-notice',
    'retired-recovery', 'stale-recovery', 'confirmed-recovery', 'retired-reset']) traces.push(await replay(compiled, name));
  return checkTraces({model: 'CalendarEditorDraft', id: 'CalendarEditorDraft-review-recovery',
    traces, sources: [...compiled.sources, driver, owner], driverHashes, scope: 'bounded-component',
    assumptions: [
      'Whole modal editor, BrowserReviews, shared durable draft controller, actual store binding, domain capture and recovery UI are installed. Browser storage transactions, downloads, reload and event effects use closed host ports.',
      'Review scope is opening, denial, exact discard/replace, stale store rejection, and close with late approval. Storage scope is production Data kept and a dev-only captured reset, including identical bytes at a newer revision and parent abort.',
      'JSDOM paints dialog state and host input. It does not establish actual browser focus, native storage, or Event-provider acceptance.',
    ]});
}
