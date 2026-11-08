import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const model = 'CoreFactWriteDedupe';
const modelPath = `specs/quint/legacy/${model}.qnt`;
const design = 'vendor/eliza/packages/core/tla/FactWriteDedupe';
const writers = ['w1', 'w2', 'w3'];
const orders = [['w1', 'w2', 'w3'], ['w1', 'w3', 'w2'], ['w2', 'w1', 'w3'],
  ['w2', 'w3', 'w1'], ['w3', 'w1', 'w2'], ['w3', 'w2', 'w1']];
const text = 'The fixture person lives in Berlin';
const action = (name, ...args) => ({name, args});
const gate = () => {
  let release;
  const promise = new Promise(resolve => {release = resolve;});
  return {promise, release};
};
const evidence = row => {
  assert.ok(Array.isArray(row.metadata?.extractionEvidenceIds), 'real SQL row has evidence IDs');
  return row.metadata.extractionEvidenceIds;
};

async function reach(signal, ticket, boundary) {
  let timeout;
  try {
    await Promise.race([signal.promise, ticket.result.then(({error}) => {
      throw error ?? new Error(`Writer returned before ${boundary}`);
    }), new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out reaching ${boundary}`)), 15000);
    })]);
  } finally {clearTimeout(timeout);}
}

async function fixture(loaded) {
  // Never admit environment-selected PostgreSQL, even when POSTGRES_URL exists.
  const database = await loaded.createIsolatedTestDatabase(`quint-fact-write-dedupe-${randomUUID()}`, [], {postgresUrl: null});
  const {runtime, adapter, testAgentId: agentId} = database;
  const world = randomUUID(), entity = randomUUID(), scope = new AsyncLocalStorage(), tickets = [];
  const originalRead = adapter.getMemories.bind(adapter), originalInsert = adapter.createMemories.bind(adapter);
  const originalUpdate = adapter.updateMemories.bind(adapter);
  try {
    assert.equal(adapter.constructor.name, 'PgliteDatabaseAdapter');
    await adapter.createWorld({id: world, agentId, name: 'Fact fixture world', serverId: randomUUID()});
    await adapter.createEntities([{id: entity, agentId, names: ['Fact fixture entity']}]);
  } catch (error) {
    await database.cleanup();
    throw error;
  }

  adapter.getMemories = async params => {
    const ticket = scope.getStore();
    if (!ticket) return originalRead(params);
    assert.equal(params.tableName, 'facts');
    assert.equal(params.roomId, ticket.room);
    assert.equal(params.limit, 120);
    assert.equal(params.unique, false);
    assert.equal(ticket.readStarted, false, 'one real lookup per writer');
    ticket.readStarted = true;
    const rows = await originalRead(params);
    ticket.readRows = rows;
    ticket.readReady.release();
    await ticket.releaseRead.promise;
    return rows;
  };
  async function mutate(kind, input, operation) {
    const ticket = scope.getStore();
    if (!ticket) return operation(input);
    assert.equal(ticket.mutation, null, 'one real mutation per distinct evidence ID');
    assert.equal(input.length, 1);
    ticket.mutation = kind;
    ticket.mutationInput = input[0];
    ticket.mutationReady.release();
    await ticket.releaseMutation.promise;
    if (ticket.failure) throw ticket.failure;
    return operation(input);
  }
  adapter.createMemories = entries => mutate('miss', entries, originalInsert);
  adapter.updateMemories = entries => mutate('hit', entries, originalUpdate);

  function fact(roomId, writer, fields = {}) {
    return {entityId: entity, roomId, content: {type: 'fact', text: fields.text ?? text},
      ...(fields.createdAt === undefined ? {} : {createdAt: fields.createdAt}),
      metadata: {type: 'custom', extractionEvidenceIds: [writer], ...fields.metadata}};
  }
  const write = (room, writer, fields, owner = runtime) => owner.createMemory(fact(room, writer, fields), 'facts', true);
  function start(room, writer, {owner = runtime, failure, fields} = {}) {
    const ticket = {room, writer, failure, readStarted: false, readRows: null, mutation: null, returned: false,
      readReady: gate(), releaseRead: gate(), mutationReady: gate(), releaseMutation: gate()};
    tickets.push(ticket);
    ticket.result = scope.run(ticket, () => write(room, writer, fields, owner)).then(value => {
      ticket.returned = true;
      return {value};
    }, error => ({error}));
    return ticket;
  }
  return {
    runtime, adapter, fact, write, start, originalInsert,
    read: (roomId, limit = 140) => originalRead({roomId, tableName: 'facts', limit, unique: false, includeEmbedding: false}),
    async room() {
      const id = randomUUID();
      await adapter.createRooms([{id, agentId, worldId: world, name: 'Fact fixture room', source: 'test', type: 'GROUP'}]);
      await adapter.addParticipant(entity, id);
      return id;
    },
    async close() {
      for (const ticket of tickets) {ticket.releaseRead.release();ticket.releaseMutation.release();}
      await Promise.all(tickets.map(ticket => ticket.result));
      await database.cleanup();
    },
  };
}

async function sourceTrace(f, prefilled, order) {
  const room = await f.room(), tickets = new Map();
  const seedId = prefilled ? await f.write(room, 'Seed') : null;
  const read = async () => {
    const rows = await f.read(room);
    const active = [...tickets.values()].filter(ticket => ticket.mutation && !ticket.returned);
    assert.ok(active.length <= 1, 'the real mutation ports never share a room owner');
    return {safety: true, 'observed.rows': rows.map(row => qset(evidence(row))),
      'observed.pc': qmap(writers.map(writer => {
        const ticket = tickets.get(writer);
        return [writer, ticket?.returned ? 'done' : ticket?.mutation ?? 'idle'];
      })),
      'observed.seen': qmap(writers.map(writer => {
        const ticket = tickets.get(writer);
        return [writer, qset(ticket?.mutation === 'hit' ? evidence(ticket.readRows[0]) : [])];
      })),
      'observed.owner': active[0]?.writer ?? 'Seed'};
  };
  const trace = {name: `${prefilled ? 'prefilled' : 'empty'}:${order.join('-')}`, expect: await read(), steps: []};
  const record = async (label, action) => trace.steps.push({label, action, expect: await read()});
  // A real, instance-local FIFO tail orders writers started before any read returns.
  for (const writer of order) tickets.set(writer, f.start(room, writer, {
    fields: {text: writer === 'w2' ? ` ${text} ` : text, metadata: {confidence: writer === 'w2' ? 0.9 : 0.3}},
  }));
  const returned = [];
  for (const [index, writer] of order.entries()) {
    const ticket = tickets.get(writer), next = tickets.get(order[index + 1]);
    await reach(ticket.readReady, ticket, 'real SQL lookup');
    assert.equal(next?.readStarted ?? false, false);
    assert.ok(f.runtime.dataMutations.factWrites.has(room), 'actual room tail remains owned while the lookup is held');
    await record('real read completed but its result is held outside the SQL transaction', null);
    ticket.releaseRead.release();
    await reach(ticket.mutationReady, ticket, 'selected insert or metadata update');
    const hit = prefilled || index > 0;
    assert.equal(ticket.mutation, hit ? 'hit' : 'miss');
    assert.equal(ticket.readRows.length, hit ? 1 : 0);
    if (hit) {
      assert.equal(ticket.mutationInput.id, ticket.readRows[0].id);
      assert.deepEqual(ticket.mutationInput.metadata.extractionEvidenceIds, [...evidence(ticket.readRows[0]), writer]);
    } else assert.equal(ticket.mutationInput.memory.roomId, room);
    await record('real mutation admission identifies the read branch and captured evidence', action('checkWriter', writer));
    if (next) {
      await setImmediate();
      assert.equal(next.readStarted, false, 'queued equivalent writer cannot read while the first SQL write is held');
      await record('a queued same-room writer cannot pass the owned section', {...action('checkWriter', next.writer), reject: true});
    }
    ticket.releaseMutation.release();
    const outcome = await ticket.result;
    assert.ifError(outcome.error);
    returned.push(outcome.value);
    await record('real SQL mutation persists and the public runtime call returns', action(hit ? 'mergeFact' : 'insertFact', writer));
  }
  const rows = await f.read(room);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, seedId ?? returned[0]);
  assert.ok(returned.every(id => id === rows[0].id));
  assert.deepEqual(evidence(rows[0]), prefilled ? ['Seed', ...order] : order);
  assert.equal(rows[0].metadata.confidence, 0.9);
  await setImmediate();
  assert.equal(f.runtime.dataMutations.factWrites.has(room), false, 'finished FIFO tail is retired');
  return trace;
}

async function boundaries(f) {
  // Source limitations are checked separately from the original configurations.
  const failureRoom = await f.room(), failure = Error('controlled refusal before SQL insert');
  const failed = f.start(failureRoom, 'w1', {failure}), successor = f.start(failureRoom, 'w2');
  await reach(failed.readReady, failed, 'failed writer lookup');
  failed.releaseRead.release();
  await reach(failed.mutationReady, failed, 'failed writer insert');
  assert.equal(successor.readStarted, false);
  failed.releaseMutation.release();
  assert.equal((await failed.result).error, failure);
  await reach(successor.readReady, successor, 'successor lookup');
  assert.equal(successor.readRows.length, 0);
  successor.releaseRead.release();
  await reach(successor.mutationReady, successor, 'successor insert');
  successor.releaseMutation.release();
  assert.ifError((await successor.result).error);
  assert.deepEqual((await f.read(failureRoom)).map(evidence), [['w2']]);

  const firstRoom = await f.room(), secondRoom = await f.room();
  const first = f.start(firstRoom, 'w1'), second = f.start(secondRoom, 'w2');
  await Promise.all([reach(first.readReady, first, 'first room lookup'), reach(second.readReady, second, 'second room lookup')]);
  for (const ticket of [first, second]) ticket.releaseRead.release();
  await Promise.all([reach(first.mutationReady, first, 'first room insert'), reach(second.mutationReady, second, 'second room insert')]);
  for (const ticket of [first, second]) ticket.releaseMutation.release();
  for (const ticket of [first, second]) assert.ifError((await ticket.result).error);
  assert.deepEqual((await f.read(firstRoom)).map(evidence), [['w1']]);
  assert.deepEqual((await f.read(secondRoom)).map(evidence), [['w2']]);

  const pool = [];
  for (const newerCount of [119, 120]) {
    const room = await f.room(), seed = await f.write(room, 'Seed', {createdAt: 1000});
    await f.originalInsert(Array.from({length: newerCount}, (_, index) => ({
      memory: {...f.fact(room, `different-${index}`, {text: `Different fixture fact ${index}`, createdAt: 2000 + index}), agentId: f.runtime.agentId},
      tableName: 'facts', unique: true,
    })));
    const id = await f.write(room, 'w1', {createdAt: 3000});
    const matching = (await f.read(room)).filter(row => row.content.text === text);
    assert.equal(id === seed, newerCount === 119);
    assert.equal(matching.length, newerCount === 119 ? 1 : 2);
    pool.push({newerCount, reused: id === seed, rows: matching.length});
  }

  const sharedRoom = await f.room();
  const anotherRuntime = new f.runtime.constructor({agentId: f.runtime.agentId, character: {name: 'Independent fact fixture runtime'}, logLevel: 'fatal'});
  anotherRuntime.registerDatabaseAdapter(f.adapter);
  const a = f.start(sharedRoom, 'w1'), b = f.start(sharedRoom, 'w2', {owner: anotherRuntime});
  await Promise.all([reach(a.readReady, a, 'first runtime lookup'), reach(b.readReady, b, 'second runtime lookup')]);
  assert.deepEqual([a.readRows.length, b.readRows.length], [0, 0]);
  for (const ticket of [a, b]) ticket.releaseRead.release();
  await Promise.all([reach(a.mutationReady, a, 'first runtime insert'), reach(b.mutationReady, b, 'second runtime insert')]);
  for (const ticket of [a, b]) ticket.releaseMutation.release();
  for (const ticket of [a, b]) assert.ifError((await ticket.result).error);
  const separateRuntimeRows = (await f.read(sharedRoom)).length;
  assert.equal(separateRuntimeRows, 2);
  return {pool, separateRuntimeRows, failureReleasesTail: true, independentRoomWrites: true};
}

export async function checkFactWriteDedupeRefinement(extraSources = []) {
  const loaded = await loadTaskService([fileURLToPath(import.meta.url), modelPath,
    `${design}.tla`, `${design}.empty.cfg`, `${design}.prefilled.cfg`, ...extraSources]);
  const f = await fixture(loaded), profiles = [];
  let sourceBoundaries;
  try {
    for (const prefilled of [false, true]) {
      const traces = [];
      for (const order of orders) traces.push(await sourceTrace(f, prefilled, order));
      profiles.push({prefilled, traces});
    }
    sourceBoundaries = await boundaries(f);
  } finally {await f.close();}
  const receipts = [];
  for (const {prefilled, traces} of profiles) receipts.push(await checkTraces({
    model: prefilled ? `${model}Prefilled` : model, modelPath, id: `${model}-${prefilled ? 'prefilled' : 'empty'}`,
    sources: loaded.sources, driverHashes: loaded.driverHashes, traces, batchSize: 3, scope: 'bounded-orchestration', assumptions: [
      'Actual AgentRuntime and RuntimeDataMutations execute with real plugin-sql migrations, PgliteDatabaseAdapter and disk-backed temporary PGlite; environment PostgreSQL is excluded.',
      'Three distinct evidence IDs, one current runtime/agent/room/entity and one normalized active fact. All six FIFO submission orders are driven for each original profile.',
      'Read and mutation admission are held outside SQL transactions. The projection observes actual SQL rows, captured evidence and public call settlement; the pre-branch wait is abstract stutter.',
      'The original model excludes lookup beyond 120 recent candidates, independent runtime owners, failed DB operations and post-persistence hook timing. Separate source checks characterize selected edges.',
    ],
  }));
  return {receipts, sourceBoundaries, obligations: [
    {model, obligation: 'Cross-runtime and older fact history', reason: 'The queue belongs to one RuntimeDataMutations instance and one room, with a 120-row candidate lookup. Actual PGlite source schedules demonstrate duplicates when either original premise is absent.'},
    {model, obligation: 'Production fact generation and deployment scheduling', reason: 'The replay drives the actual write owner with synthetic evidence. Evaluator registration, inference, desktop-only legacy validation, multi-process SQL isolation, retries and arbitrary hook timing remain separate.'},
  ]};
}
