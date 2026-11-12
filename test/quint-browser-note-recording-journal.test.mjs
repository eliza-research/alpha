import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createNoteRecordingJournal} from '../apps/app/src/browser/note-recording-journal.ts';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const model = 'BrowserNoteRecordingJournal';
const modelPath = 'specs/quint/application/BrowserNoteRecordingJournal.qnt';
const source = 'apps/app/src/browser/note-recording-journal.ts';
const recording = 'closed-recording';
const binding = {ownerDigest: 'a'.repeat(64), folderId: null};
const manifestKey = 'alpha.browser.note-recording.v1:' + recording;
const segmentKey = index => manifestKey + ':segment:segment-' + index;
const words = ['', 'Earlier words', 'Later words'];
const call = (name, ...args) => ({name, args});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}

/** Serial document transactions and plain snapshot reads are the journal's existing port contract. */
function fixture(count, offset) {
  const documents = new Map();
  const queues = new Map();
  let revision = 0;
  let gate;
  let failure;
  let save;
  let reading;
  let captured = [0, 0];
  let readTexts = [0, 0];
  let outcome = 'none';
  const segments = Array.from({length: count}, (_, index) => ({segmentId: 'segment-' + index,
    durationMs: 1000, ...(offset ? {offsetMs: 0} : {clip: {blob: new Blob(['exact clip ' + index],
      {type: 'audio/webm'}), durationMs: 1000}})}));
  async function before(method, key) {
    if (failure?.method === method && failure.key === key) {
      failure = undefined;
      throw Error('Closed storage refusal');
    }
    if (gate?.method === method && gate.key === key && !gate.entered) {
      gate.entered = true;
      await gate.promise;
      gate = undefined;
    }
  }
  function write(key, raw) {
    const row = {revision: String(++revision), raw};
    documents.set(key, row);
    return row;
  }
  const port = {
    async read(key) {
      await before('read', key);
      return documents.get(key);
    },
    async readOrCreate(key, raw) {
      await before('create', key);
      if (!documents.has(key)) write(key, raw);
      return documents.get(key);
    },
    async edit(key, edit) {
      await before('edit', key);
      // Each key is serialized even when an editor yields. The product store
      // supplies this behavior through its document edit/CAS implementation.
      const previous = queues.get(key) ?? Promise.resolve();
      const operation = previous.then(async () => {
        const next = await edit(documents.get(key));
        write(key, next.raw);
        return next.result;
      });
      queues.set(key, operation.catch(() => {}));
      return operation;
    },
  };
  const journal = createNoteRecordingJournal(port);
  function hold(method, key) {
    assert.equal(gate, undefined);
    gate = {method, key, entered: false, ...deferred()};
  }
  async function entered() {
    for (let spin = 0; spin < 30 && !gate?.entered; spin++) await tick();
    assert.equal(gate?.entered, true, 'the actual journal reached the held document port');
  }
  const raw = key => documents.get(key)?.raw;
  const classify = key => !documents.has(key) ? 'absent' : raw(key) === null ? 'retired' : 'live';
  function manifestTexts() {
    if (classify(manifestKey) !== 'live') return [0, 0];
    const value = JSON.parse(raw(manifestKey));
    assert.deepEqual(value.binding, binding);
    return [0, 1].map(index => words.indexOf(value.segments[index]?.text ?? ''));
  }
  function observe() {
    const result = {
      's.count': count, 's.offset': offset, 's.manifest': classify(manifestKey),
      's.clips': [0, 1].map(index => classify(segmentKey(index))),
      's.texts': manifestTexts(), 's.savePending': !!save, 's.readPending': !!reading,
      's.captured': captured, 's.readTexts': readTexts, 's.outcome': outcome,
    };
    return result;
  }
  async function result(operation, success) {
    try {await operation(); outcome = success;}
    catch (error) {
      assert.match(error.message, /Closed storage refusal|Recording .*changed|Recording .*retired|Recording .*recovery|segment bytes/);
      outcome = 'error';
    }
  }
  return {
    observe,
    async prepareSave(failAt = 0) {
      assert.equal(save, undefined);
      if (failAt > 0 && !offset && failAt <= count) failure = {method: 'create', key: segmentKey(failAt - 1)};
      hold('edit', manifestKey);
      let settled = false;
      const operation = result(() => journal.save(recording, binding, segments), 'saved').finally(() => {settled = true;});
      for (let spin = 0; spin < 30 && !gate?.entered && !settled; spin++) await tick();
      if (settled) {await operation; gate = undefined;}
      else {await entered(); save = operation; outcome = 'pending';}
    },
    async publishSave() {
      assert.ok(save);
      const pending = save;
      gate.resolve();
      await pending;
      save = undefined;
    },
    async setText(index, text) {
      await result(() => journal.setText(recording, binding, 'segment-' + index, words[text]), 'text');
    },
    async changedBytes() {
      const changed = segments.map((row, index) => index ? row : {...row,
        clip: {blob: new Blob(['different clip bytes'], {type: 'audio/webm'}), durationMs: 1000}});
      await result(() => journal.save(recording, binding, changed), 'saved');
    },
    async wrongBinding() {
      await result(() => journal.read(recording, {...binding, folderId: 'f-other'}), 'read');
    },
    async wrongOwner() {
      await result(() => journal.read(recording, {...binding, ownerDigest: 'b'.repeat(64)}), 'read');
    },
    async beginRead() {
      assert.equal(reading, undefined);
      if (classify(manifestKey) !== 'live' || offset) {
        const rows = await journal.read(recording, binding);
        if (rows) {
          assert.equal(rows.length, count);
          assert.equal(rows[0].segmentId, 'segment-0');
          assert.equal(rows[0].durationMs, 1000);
          assert.equal(rows[0].offsetMs, 0);
          assert.equal(rows[0].clip, undefined);
        }
        readTexts = rows ? [0, 1].map(index => words.indexOf(rows[index]?.text ?? '')) : [0, 0];
        outcome = rows ? 'read' : 'empty';
        return;
      }
      captured = manifestTexts();
      hold('read', segmentKey(0));
      reading = result(async () => {
        const rows = await journal.read(recording, binding);
        assert.equal(rows.length, count);
        for (const [index, row] of rows.entries()) {
          assert.equal(row.segmentId, 'segment-' + index);
          assert.equal(row.durationMs, 1000);
          assert.equal(await row.clip.blob.text(), 'exact clip ' + index);
          assert.equal(row.clip.blob.type, 'audio/webm');
        }
        readTexts = [0, 1].map(index => words.indexOf(rows[index]?.text ?? ''));
      }, 'read').then(() => {if (outcome === 'error') readTexts = [0, 0];});
      await entered();
      outcome = 'pending';
    },
    async finishRead() {
      assert.ok(reading);
      const pending = reading;
      gate.resolve();
      await pending;
      reading = undefined;
    },
    async retire(failAt = 0) {
      if (failAt === 3) failure = {method: 'edit', key: manifestKey};
      else if (failAt > 0 && !offset && failAt <= count) failure = {method: 'edit', key: segmentKey(failAt - 1)};
      await result(() => journal.retire(recording, binding), 'retired');
      failure = undefined;
    },
  };
}

async function checkBrowserNoteRecordingJournal(extraSources = []) {
  const sources = [source, modelPath, fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function schedule(name, count, offset, actions) {
    const f = fixture(count, offset);
    const trace = {name, init: call('initFor', count, offset), expect: f.observe(), steps: []};
    for (const [action, ...args] of actions) {
      await f[action](...args);
      trace.steps.push({label: action + ' on the actual pending recording journal', action: call(action, ...args), expect: f.observe()});
    }
    assert.equal(f.observe()['s.savePending'], false);
    assert.equal(f.observe()['s.readPending'], false);
    traces.push(trace);
  }
  const prepare = ['prepareSave', 0], publish = ['publishSave'], save = [prepare, publish];
  const read = [['beginRead'], ['finishRead']];
  await schedule('two clip bytes precede the manifest and reload exactly', 2, false, [...save, ...read]);
  await schedule('failed first clip publishes no manifest and can retry', 2, false, [['prepareSave', 1], ...save, ...read]);
  await schedule('failed second clip retains the exact first clip for retry', 2, false, [['prepareSave', 2], ...save, ...read]);
  await schedule('retry preserves text written before and during the held manifest publication', 2, false,
    [...save, ['setText', 0, 1], prepare, ['setText', 0, 2], publish, ...read]);
  await schedule('different bytes cannot replace the same segment identity', 1, false, [...save, ['changedBytes'], ...read]);
  await schedule('folder and owner binding is checked before recovery', 1, false, [...save, ['wrongBinding'], ...read]);
  await schedule('a different owner cannot read retained recording segments', 1, false, [...save, ['wrongOwner'], ...read]);
  await schedule('retirement fences a save already waiting to publish', 2, false,
    [...save, prepare, ['retire', 0], publish, ['beginRead'], ['setText', 0, 1]]);
  await schedule('retirement cannot be undone by another save attempt', 1, false,
    [...save, ['retire', 0], prepare, ['beginRead']]);
  await schedule('an incomplete retirement stays unreadable until retried', 2, false,
    [...save, ['retire', 2], ...read, ['retire', 0], ['beginRead']]);
  await schedule('a refused first retirement write leaves the recording readable', 2, false,
    [...save, ['retire', 1], ...read, ['retire', 0], ['beginRead']]);
  await schedule('retirement before first publication has no manifest to tombstone', 1, false,
    [prepare, ['retire', 0], publish, ...read]);
  await schedule('a refused manifest tombstone retains the live but unreadable manifest', 2, false,
    [...save, ['retire', 3], ...read, ['retire', 0], ['beginRead']]);
  await schedule('a read captures its manifest text before an independent transcription update', 1, false,
    [...save, ['setText', 0, 1], ['beginRead'], ['setText', 0, 2], ['finishRead'], ...read]);
  await schedule('a read held across retirement cannot return removed clips', 1, false,
    [...save, ['beginRead'], ['retire', 0], ['finishRead'], ['beginRead']]);
  await schedule('legacy offset segments recover text without standalone clip rows', 1, true,
    [...save, ['setText', 0, 1], ['beginRead'], ['retire', 0], ['beginRead']]);
  return checkTraces({model, modelPath, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'Executes the actual browser pending recording journal against a closed document port. Per-key edit transactions serialize, and readOrCreate preserves the existing exact bytes as the shared document API requires.',
    'One recording identity, one or two standalone segments or one legacy offset segment, two transcript values, two owner/folder binding classes and selected failed-storage positions. A read may overlap one text update or retirement, and a retry may overlap a text update or retirement before manifest publication.',
    'Recorder capture, canonical Notes save claims, arbitrary corrupt input, shared IndexedDB/CAS implementation, real browser persistence and process interruption have separate evidence. No microphone, provider or installed data is used.',
  ]});
}

test('pending browser recording publication and retirement refine the journal model', {timeout: 120000}, async () => {
  const receipt = await checkBrowserNoteRecordingJournal([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 16);
  assert.equal(receipt.observedFields.length, 10);
});
