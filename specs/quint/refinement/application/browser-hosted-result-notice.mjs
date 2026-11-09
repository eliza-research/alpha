import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, sourceContext, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const sources = ['apps/app/src/browser/domain-document.ts', 'apps/app/src/browser/revision.ts',
  'apps/app/src/browser/screen-locked.ts', 'apps/app/src/browser/notice-action.ts',
  'apps/app/src/browser/hosted-results.ts', 'apps/app/src/runtime/hosted-result-notices.ts'];
const model = 'BrowserHostedResultNotice';
const ids = [1, 2, 3];
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = {phase: '', digest: 0, revision: 0};
const idle = {id: 0, digest: 0, binding: 0};
const ownerOf = id => id === 3 ? 'B' : 'A';
const identity = owner => {
  const origin = 'https://fixture.invalid', ownerId = 'owner-' + owner, agentId = 'agent-' + owner;
  return {origin, ownerId, agentId, scope: hash(JSON.stringify([origin, ownerId, agentId]))};
};
const route = id => ({...identity(ownerOf(id)), runId: 'run-' + id, workflowId: 'workflow-' + id,
  workflowVersionId: 'version-' + id});
const rowId = id => hash(route(id).scope + ':' + route(id).runId);
const payload = (id, digest) => ({runId: route(id).runId, workflowId: route(id).workflowId,
  workflowVersionId: route(id).workflowVersionId, output: [{text: 'Private fixture result ' + id + '-' + digest}]});

async function scenario(name, drive) {
  const {window} = new JSDOM('<!doctype html><body></body>', {url: 'https://alpha.test/', pretendToBeVisual: true});
  let raw, revision = 0, binding, unbind, bindingCount = 0, visibleSession = 0, retiredSession;
  let reading, settlement, holdNextEdit, history = [], historyReads = 0, revalidate = true, observation = '';
  const revisionSeen = new Map(), tokens = new Map();
  const documents = {
    async read() {return raw;},
    async readOrCreate(_key, value) {return raw ??= {revision: String(++revision), raw: value};},
    async edit(_key, edit, signal) {
      const hold = holdNextEdit;
      holdNextEdit = undefined;
      if (hold) {
        hold.entered.resolve();
        await hold.resume.promise;
      }
      const before = raw;
      signal?.throwIfAborted();
      const result = await edit(before);
      signal?.throwIfAborted();
      assert.equal(raw, before, 'The campaign serializes durable source edits');
      raw = {revision: String(++revision), raw: result.raw};
      return result.result;
    },
  };
  class WebPlugin {
    notifications = 0;
    async notifyListeners(name, payload) {
      assert.equal(name, 'pendingResult');
      assert.equal(Object.keys(payload).length, 0, 'No private route fields cross the notification callback');
      this.notifications++;
    }
  }
  const actual = sourceContext(sources, ['browserHostedResults', 'hostedResultsDocument', 'resolveHostedResultTap', 'canonical'],
    {window, document: window.document, localStorage: window.localStorage, Event: window.Event, crypto,
      WebPlugin, browserDocuments: documents, BroadcastChannel: undefined, registerPlugin: () => ({})});
  const port = actual.browserHostedResults, store = actual.hostedResultsDocument;
  const read = async () => await store.read(() => ({enabled: true, polling: true, rows: []}));
  function digestClass(id, digest) {
    const match = [1, 2].find(version => hash(actual.canonical(payload(id, version))) === digest);
    assert.ok(match, 'Only exact retained bytes may become a notice digest');
    return match;
  }
  async function observe() {
    const saved = await read(), notices = await port.list(), status = await port.status();
    const locked = window.document.documentElement.dataset.devBackground === 'true';
    if (retiredSession && retiredSession !== port.session) visibleSession++;
    retiredSession = port.session;
    const rows = new Map(ids.map(id => {
      const row = saved.rows.find(record => record.id === rowId(id));
      if (!row) return [id, empty];
      assert.equal(row.scope, route(id).scope);
      assert.equal(row.ownerId, route(id).ownerId);
      assert.equal(row.agentId, route(id).agentId);
      assert.equal(row.runId, route(id).runId);
      assert.equal(row.workflowId, route(id).workflowId);
      assert.equal(row.workflowVersionId, route(id).workflowVersionId);
      assert.match(row.revision, /^[a-f0-9]{64}$/);
      const prior = revisionSeen.get(id);
      const number = (prior?.number ?? 0) + Number(prior?.value !== row.revision);
      revisionSeen.set(id, {value: row.revision, number});
      return [id, {phase: row.phase, digest: digestClass(id, row.digest), revision: number}];
    }));
    const cards = ids.filter(id => saved.enabled && rows.get(id).phase === 'posted');
    assert.deepEqual(Array.from(notices, notice => ids.find(id => rowId(id) === notice.id)).sort(), cards);
    for (const notice of notices) {
      assert.equal(notice.title, 'Scheduled digest');
      assert.equal(notice.text, locked ? '' : 'A saved result is ready to review.');
      assert.equal(notice.canOpen, !locked);
    }
    assert.equal(status.enabled, saved.enabled);
    assert.equal(status.backgroundEnabled, saved.polling && !!binding);
    assert.equal(status.backgroundStatus, saved.polling ? 'waiting' : 'paused');
    assert.ok(!JSON.stringify(saved).includes('Private fixture result'), 'The ledger retains no result body');
    const pending = saved.pending ? ids.find(id => rowId(id) === saved.pending.id) : 0;
    let token = 0;
    if (saved.pending) {
      assert.ok(pending);
      assert.match(saved.pending.token, /^[a-f0-9-]{36}$/);
      if (!tokens.has(saved.pending.token)) tokens.set(saved.pending.token, tokens.size + 1);
      token = tokens.get(saved.pending.token);
    }
    return {'s.owner': binding?.owner ?? '', 's.binding': bindingCount, 's.enabled': saved.enabled,
      's.polling': saved.polling, 's.session': visibleSession, 's.locked': locked, 's.rows': qmap(rows),
      's.pending': pending, 's.token': token, 's.minted': tokens.size,
      's.publication': reading ? {id: reading.id, digest: reading.digest, binding: reading.binding} : idle,
      's.settlement': settlement ? {token: settlement.token, binding: settlement.binding} : {token: 0, binding: 0},
      's.notifications': port.notifications, 's.observation': observation};
  }
  const schedule = trace(name, await observe());
  const record = async (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), await observe());
  const published = result => {observation = result.phase;};
  const refused = error => {
    const failures = {'Hosted account changed': 'owner', 'Result is not retained': 'notRetained',
      'Retained result changed': 'changed', 'Result notification changed': 'stale', 'Result link changed': 'stale'};
    const failure = failures[error.message];
    if (!failure) throw error;
    observation = failure;
  };
  try {
    await drive({
      async bind(owner) {
        const previous = unbind;
        bindingCount++;
        if (owner === '') {
          unbind?.();
          binding = undefined;
        } else {
          const current = {...identity(owner), owner,
            current: () => binding === current,
            async revalidate() {return revalidate;},
            async history() {
              historyReads++;
              if (reading && !reading.started) {
                reading.started = true;
                reading.entered.resolve();
                return reading.rows.promise;
              }
              return history;
            },
          };
          binding = current;
          unbind = port.bind('session-' + bindingCount, current);
          previous?.(); // Cleanup of the old object cannot clear its successor.
        }
        await record('The actual browser binding is replaced or detached', 'bind', owner);
      },
      async privacy(locked) {
        window.document.documentElement.dataset.devBackground = String(locked);
        window.dispatchEvent(new window.Event('alpha:device-state'));
        await record('Browser lifecycle retires previously reviewed shade revisions', 'privacy', locked);
      },
      async enable(enabled) {
        await port.setNotifications({enabled});
        await record('A real preference write retires each existing card revision', 'enable', enabled);
      },
      async poll(enabled) {
        await port.setBackgroundPolling({enabled});
        await record('Background polling is an independent saved preference', 'poll', enabled);
      },
      async startPublish(id, digest) {
        assert.equal(reading, undefined);
        const current = {id, digest, binding: bindingCount, started: false, entered: deferred(), rows: deferred()};
        reading = current;
        current.completion = port.publishResult(route(id)).then(published, refused);
        await Promise.race([current.entered.promise, current.completion]);
        if (!current.started) {
          await current.completion;
          reading = undefined;
        }
        await record('Publication captures the exact current binding before reading history', 'startPublish', id, digest);
      },
      async finishPublish(retained) {
        assert.ok(reading);
        const current = reading;
        current.rows.resolve(retained ? [payload(current.id, current.digest)] : []);
        await current.completion;
        reading = undefined;
        await record('The held retained-result check settles through the actual durable edit', 'finishPublish', retained);
      },
      async act(id, exact, open) {
        const card = (await port.list()).find(row => row.id === rowId(id));
        await port.action({id: rowId(id), revision: exact && card ? card.revision : 'retired'}, open)
          .then(() => {observation = 'acted';}, refused);
        await record('The real shade action validates the exact visible revision', 'act', id, exact, open);
      },
      async inspect(profile, allowed) {
        const saved = await read(), pending = saved.rows.find(row => row.id === saved.pending?.id);
        if (pending) {
          const id = ids.find(id => rowId(id) === pending.id), version = digestClass(id, pending.digest);
          history = profile === 'missing' ? [] : [payload(id, profile === 'changed' ? 3 - version : version)];
        } else history = [];
        revalidate = allowed;
        const before = historyReads;
        const result = await actual.resolveHostedResultTap(port, binding ?? null, new AbortController().signal);
        observation = result.kind === 'other-account' ? 'otherAccount' : result.kind;
        if (result.kind === 'other-account') assert.equal(historyReads, before, 'Other-account readback skips the history port');
        if (result.kind === 'ready') {
          assert.equal(result.token, saved.pending.token);
          assert.equal(result.result.runId, pending.runId);
        }
        await record('The actual renderer helper verifies scope, current history and the pending digest', 'inspect', profile, allowed);
      },
      async consume(exact) {
        const saved = await read();
        const wrong = [...tokens.keys()].find(token => token !== saved.pending?.token) ?? 'stale';
        await port.consumeResult({token: exact && saved.pending ? saved.pending.token : wrong})
          .then(() => {observation = 'consumed';}, refused);
        await record('Settlement compares the exact token inside the durable edit', 'consume', exact);
        return observation;
      },
      async startConsume() {
        const saved = await read();
        assert.ok(saved.pending);
        const gate = {entered: deferred(), resume: deferred()};
        holdNextEdit = gate;
        const completion = port.consumeResult({token: saved.pending.token})
          .then(() => {observation = 'consumed';}, refused);
        await Promise.race([gate.entered.promise, completion]);
        settlement = {completion, gate, binding: bindingCount, token: tokens.get(saved.pending.token)};
        await record('The source settlement waits at serialized document admission', 'startConsume');
      },
      async finishConsume() {
        const current = settlement;
        assert.ok(current);
        current.gate.resume.resolve();
        await current.completion;
        settlement = undefined;
        await record('The queued edit checks token and exact captured binding', 'finishConsume');
        return observation;
      },
    });
    assert.equal(reading, undefined);
    assert.equal(settlement, undefined);
    return schedule;
  } finally {
    unbind?.();
    window.close();
  }
}

export async function checkBrowserHostedResultNotice(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const publish = async (f, id, version = 1) => {await f.startPublish(id, version); await f.finishPublish(true);};
  const traces = [
    await scenario('exact-retained-digest-and-idempotent-publication', async f => {
      await f.bind('A'); await publish(f, 1); await publish(f, 1); await publish(f, 1, 2);
      await f.startPublish(3, 1);
    }),
    await scenario('retired-binding-cannot-publish-a-held-history-result', async f => {
      await f.bind('A'); await f.startPublish(1, 1); await f.bind('B'); await f.finishPublish(true);
      await f.startPublish(3, 1); await f.finishPublish(false);
    }),
    await scenario('same-owner-rebind-also-retires-held-publication', async f => {
      await f.bind('A'); await f.startPublish(1, 1); await f.bind('A'); await f.finishPublish(true);
      await publish(f, 2); await f.poll(false); await f.bind('');
    }),
    await scenario('denied-result-does-not-repost-on-later-enable', async f => {
      await f.bind('A'); await f.enable(false); await publish(f, 1); await f.enable(true);
      await publish(f, 1); await publish(f, 2); await f.act(2, true, false); await publish(f, 2);
    }),
    await scenario('current-shade-revision-and-redaction', async f => {
      await f.bind('A'); await publish(f, 1); await f.privacy(true); await f.act(1, true, true);
      await f.privacy(false); await f.act(1, false, true); await f.enable(false);
      await f.act(1, true, false); await f.enable(true); await f.act(1, true, true);
    }),
    await scenario('exact-repeated-tap-and-latest-token', async f => {
      await f.bind('A'); await publish(f, 1); await publish(f, 2); await f.act(1, true, true);
      await f.act(1, true, true); await f.act(2, true, true); await f.consume(false);
      await f.inspect('exact', true); await f.consume(true); await f.inspect('exact', true);
    }),
    await scenario('same-token-is-rechecked-against-exact-retained-history', async f => {
      await f.bind('B'); await publish(f, 3); await f.act(3, true, true);
      await f.inspect('changed', true); await f.inspect('missing', true); await f.inspect('exact', false);
      await f.inspect('exact', true); await f.consume(true);
    }),
    await scenario('only-returning-owner-can-settle-retained-token', async f => {
      await f.bind('A'); await publish(f, 1); await f.act(1, true, true);
      await f.bind('B'); await f.inspect('exact', true);
      assert.equal(await f.consume(true), 'owner', 'A replacement owner cannot settle the previous token');
      await f.bind(''); await f.inspect('exact', true);
      assert.equal(await f.consume(true), 'owner', 'An unbound caller cannot settle the retained token');
      await f.bind('A'); await f.consume(true);
    }),
    await scenario('queued-settlement-refuses-same-scope-replacement', async f => {
      await f.bind('A'); await publish(f, 1); await f.act(1, true, true);
      await f.startConsume(); await f.bind('A');
      assert.equal(await f.finishConsume(), 'owner', 'An old queued call cannot transfer to a same-scope binding');
      await f.consume(true);
    }),
    await scenario('queued-settlement-refuses-different-owner-and-later-tap', async f => {
      await f.bind('A'); await publish(f, 1); await publish(f, 2); await f.act(1, true, true);
      await f.startConsume(); await f.bind('B');
      assert.equal(await f.finishConsume(), 'owner', 'A queued edit retains its dispatch owner');
      await f.bind('A'); await f.startConsume(); await f.act(2, true, true);
      assert.equal(await f.finishConsume(), 'stale', 'The old edit cannot settle a later tap');
      await f.consume(true);
    }),
  ];
  const receipt = await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-orchestration', assumptions: [
      'Actual browser hosted ledger, domain document, visibility action and renderer tap verifier execute with synthetic result history and a serialized document backend.',
      'Three run identities and two owners. The notification callback exposes only a wake event. Web IndexedDB durability, cross-tab arbitration, and the mounted React tap effect are separate.',
    ]}));
  return {receipt, obligations: [
    {model, obligation: 'Owner retirement at browser token settlement',
      reason: 'The queued document edit checks the captured owner and binding before settlement. Cross-tab edits after the in-process check and mounted lifecycle delivery remain separate.'},
  ]};
}
