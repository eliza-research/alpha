import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {setImmediate} from 'node:timers/promises';
import {checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {createFactWriteFixture, reachFactWriteBoundary, factText, factEvidence} from '../specs/quint/legacy/core/check-fact-write-dedupe-refinement.mjs';
import {loadTaskService} from '../specs/quint/refinement/services/task-service/module.mjs';

const model = 'FactWriteScope';
const driver = fileURLToPath(import.meta.url);
const fixtureSource = fileURLToPath(new URL('../specs/quint/legacy/core/check-fact-write-dedupe-refinement.mjs', import.meta.url));
const slots = [1, 2, 3, 4];
const action = (name, ...args) => ({name, args});
const isTargetFact = row => row.content.text?.trim() === factText;
const evidenceId = key => {
  assert.match(key, /^(Seed|w[1-4])$/);
  return key === 'Seed' ? 0 : Number(key.slice(1));
};

async function scenario(f, name, drive) {
  const rooms = [null, await f.room(), await f.room()];
  const second = new f.runtime.constructor({agentId: f.runtime.agentId,
    character: {name: 'Independent fact scope fixture runtime'}, logLevel: 'fatal'});
  second.registerDatabaseAdapter(f.adapter);
  const runtimes = [null, f.runtime, second];
  const tickets = new Map(), seeds = new Map();
  const refusal = Error('controlled refusal before SQL commit');

  function knownId(sqlId) {
    for (const [id, ticket] of tickets) {
      if (ticket.mutation === 'miss' && ticket.value === sqlId) return id;
    }
    if ([...seeds.values()].includes(sqlId)) return 0;
    throw Error('Fact row was not produced by the seed or a known insert');
  }
  const observedRow = row => row
    ? {id: knownId(row.id), evidence: qset(factEvidence(row).map(evidenceId))}
    : {id: -1, evidence: qset([])};

  async function observe() {
    const rows = await Promise.all(rooms.slice(1).map(room => f.read(room)));
    const roomData = rows.map((result, index) => [index+1, {
      rows: qset(result.filter(isTargetFact).map(observedRow)),
      padding: result.filter(row => !isTargetFact(row)).length,
    }]);
    const ranks = rows.map((result, index) => [index+1, qset(result.flatMap((row, rank) =>
      isTargetFact(row) ? [{id: knownId(row.id), rank}] : []))]);
    const requests = slots.map(id => {
      const ticket = tickets.get(id);
      return [id, {
        room: ticket ? rooms.indexOf(ticket.room) : 0,
        runtime: ticket ? runtimes.indexOf(ticket.owner) : 0,
        evidence: ticket ? evidenceId(ticket.writer) : 0,
        phase: !ticket ? 'idle' : ticket.error ? 'rejected' : ticket.returned ? 'done' :
          ticket.mutation ?? (ticket.readRows ? 'read' : 'queued'),
        seen: observedRow(ticket?.readRows?.find(isTargetFact)),
        checked: ticket?.readRows?.length ?? 0,
        result: ticket?.returned ? knownId(ticket.value) : -1,
      }];
    });
    return {'s.rooms': qmap(roomData), 's.requests': qmap(requests), 's.next': tickets.size+1, ranks: qmap(ranks)};
  }
  const trace = {name, init: action('init'), expect: await observe(), steps: []};
  const record = async (label, transition) => trace.steps.push({label, action: transition, expect: await observe()});
  const api = {
    async seed(room) {
      seeds.set(room, await f.write(rooms[room], 'Seed', {createdAt: 1000}));
      await record('normal runtime write creates the oldest equivalent fact', action('seed', room));
    },
    async pad(room, count) {
      const inserted = await f.originalInsert(Array.from({length: count}, (_, index) => ({
        memory: {...f.fact(rooms[room], 'fixture-padding', {
          text: 'Different synthetic fact '+index, createdAt: 2000+index}), agentId: f.runtime.agentId},
        tableName: 'facts', unique: true,
      })));
      assert.equal(inserted.length, count);
      await record('real SQL rows move the original fact to the requested rank', action('pad', room, count));
    },
    async enqueue(room, owner, evidence, fails = false) {
      const id = tickets.size+1;
      const ticket = f.start(rooms[room], 'w'+evidence, {owner: runtimes[owner], beforeRead: true,
        failure: fails ? refusal : undefined, fields: {createdAt: 3000+id, text: id === 2 ? ` ${factText} ` : factText}});
      tickets.set(id, ticket);
      assert.ok(runtimes[owner].dataMutations.factWrites.has(rooms[room]), 'actual runtime has a room-local tail');
      await record('public runtime call joins its instance-local room lane', action('enqueue', room, owner, evidence));
    },
    async capture(id) {
      const ticket = tickets.get(id);
      ticket.beforeRead.release();
      await reachFactWriteBoundary(ticket.readReady, ticket, 'real scoped SQL lookup');
      await record('the SQL candidate window is captured before selecting a write', action('capture', id));
    },
    async blocked(id) {
      await setImmediate();
      const ticket = tickets.get(id);
      assert.equal(ticket.readStarted, false, 'queued same-instance same-room call cannot enter the lookup');
      await record('the same-room successor is blocked while the older attempt owns its lane',
        {...action('capture', id), reject: true});
    },
    async admit(id, kind) {
      const ticket = tickets.get(id);
      ticket.releaseRead.release();
      await reachFactWriteBoundary(ticket.mutationReady, ticket, 'real insert or update port');
      assert.equal(ticket.mutation, kind);
      if (kind === 'miss') assert.equal(ticket.mutationInput.memory.roomId, ticket.room);
      else assert.equal(ticket.mutationInput.id, ticket.readRows.find(isTargetFact).id);
      await record('captured evidence selects a real adapter mutation', action('admit', id));
    },
    async finish(id) {
      const ticket = tickets.get(id);
      ticket.releaseMutation.release();
      const {error} = await ticket.result;
      if (ticket.failure) assert.equal(error, refusal);
      else assert.ifError(error);
      await record('public settlement follows SQL commit or a known precommit refusal',
        action(ticket.failure ? 'reject' : 'commit', id));
    },
    async skip(id) {
      const ticket = tickets.get(id);
      ticket.releaseRead.release();
      assert.ifError((await ticket.result).error);
      assert.equal(ticket.mutation, null, 'existing evidence does not need an update');
      await record('the replay returns the existing ID without an adapter mutation', action('skipUpdate', id));
    },
  };
  await drive(api);
  return trace;
}

async function runFactWriteScopeRefinement(extraSources = []) {
  const loaded = await loadTaskService([driver, fixtureSource, ...extraSources]);
  const f = await createFactWriteFixture(loaded);
  const traces = [];
  const run = async (name, drive) => traces.push(await scenario(f, name, drive));
  const persist = async (api, id, kind) => { await api.capture(id); await api.admit(id, kind); await api.finish(id); };
  try {
    for (const count of [119, 120]) {
      await run('sql-window-'+count, async api => {
        await api.seed(1); await api.pad(1, count); await api.enqueue(1, 1, 1);
        await persist(api, 1, count === 119 ? 'hit' : 'miss');
      });
    }
    await run('two-runtime-instances-capture-the-same-empty-room', async api => {
      await api.enqueue(1, 1, 1); await api.enqueue(1, 2, 2);
      await api.capture(1); await api.capture(2);
      await api.admit(1, 'miss'); await api.admit(2, 'miss');
      await api.finish(2); await api.finish(1);
      await api.enqueue(1, 1, 3); await persist(api, 3, 'hit');
    });
    await run('one-runtime-owns-distinct-rooms-independently', async api => {
      await api.enqueue(1, 1, 1); await api.enqueue(2, 1, 2);
      await api.capture(1); await api.capture(2);
      await api.admit(1, 'miss'); await api.admit(2, 'miss');
      await api.finish(1); await api.finish(2);
      await api.enqueue(2, 1, 3); await persist(api, 3, 'hit');
    });
    await run('precommit-insert-refusal-releases-lane-and-original-evidence-can-retry', async api => {
      await api.enqueue(1, 1, 1, true); await api.enqueue(1, 1, 2);
      await api.capture(1); await api.admit(1, 'miss'); await api.blocked(2); await api.finish(1);
      await persist(api, 2, 'miss');
      await api.enqueue(1, 1, 1); await persist(api, 3, 'hit');
      await api.enqueue(1, 1, 1); await api.capture(4); await api.skip(4);
    });
    await run('precommit-metadata-refusal-preserves-seed-until-retry', async api => {
      await api.seed(1); await api.enqueue(1, 1, 1, true);
      await persist(api, 1, 'hit');
      await api.enqueue(1, 1, 1); await persist(api, 2, 'hit');
    });
  } finally {
    await f.close();
  }

  const receipt = await checkTraces({model, sources: loaded.sources, driverHashes: loaded.driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Real AgentRuntime, RuntimeDataMutations and isolated PGlite execute under the SDK pin. Runtime lanes share an adapter and an agent. Two rooms, one entity and one normalized fact identity per room are observed.',
      'Distinct fixture timestamps place seed first, unrelated rows next and attempts in admission order. Observed SQL row ranks and public return IDs are mapped to finite symbols. One source task can settle before an earlier timestamp.',
      'Gates outside SQL transactions capture source read/admission boundaries. A refused adapter write is known to be precommit. No source deletion or evaluator/persistence hook is installed.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Ambiguous commit, concurrent metadata hits and other evidence identities',
      reason: 'The source schedules distinguish known rejection from successful writes. Lost acknowledgements, multiple lanes updating the same captured metadata row, same-ID adapter semantics, inactive evidence and other entities remain separate.'},
    {model, obligation: 'Other database and runtime hook owners',
      reason: 'Temporary PGlite shares one adapter between two runtime objects. Separate processes/adapters, installed evaluator mutations, post-persistence hooks and production provider traffic are outside this replay.'},
  ]};
}

test('real fact writes refine room lanes, exact lookup eviction and known rejection', async () => {
  const {receipts: [receipt]} = await runFactWriteScopeRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 6);
  assert.ok(receipt.observedFields.includes('ranks'));
});
