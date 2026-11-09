import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, deferred, tick} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const epoch = 1000, replayKey = 'fixture-replay', noOwner = [0, 0];
const iso = time => new Date(time).toISOString();
const profileLeases = {module: 'CoreInteractionSession', clients: [1, 2, 3], expiry: 3, ttl: 1};
const profileRetries = {module: 'CoreInteractionSessionRetries', clients: [1, 2], expiry: 4, ttl: 2};
const call = (name, ...args) => ({name, args});
const fixtureAbort = Error('Interrupted interaction client');
const entries = (clients, initial) => new Map(clients.map(client => [client, initial]));
const coreLeaves = {name: 'sqlite-interaction-core-leaves', setup(builder) {
  builder.onResolve({filter: /^@elizaos\/core(?:\/protocol)?$/}, args => ({
    path: resolve(builder.initialOptions.absWorkingDir, 'packages/core/src',
      args.path.endsWith('/protocol') ? 'errors.ts' : 'messaging/interaction-sessions.ts'),
  }));
}};

async function fixture(bundle, profile) {
  const {MessageInteractionSessionAuthority, SqliteMessageInteractionSessionStore,
    createOpaqueMessageInteractionReference, encodeMessageInteractionCallback} = bundle.instantiate({});
  const reference = createOpaqueMessageInteractionReference(), callbackData = encodeMessageInteractionCallback(reference);
  const bindings = {actorId: 'actor', agentId: 'agent', connector: {source: 'fixture', accountId: 'account'},
    audience: {kind: 'task', id: 'task'}, roomId: 'room', sourceMessageId: 'message'};
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-interaction-'));
  const dbs = new Map(), stores = new Map(), active = new Map(), claimIds = new Map();
  const runs = entries(profile.clients, 0), mine = entries(profile.clients, noOwner), last = entries(profile.clients, 'none');
  const digestClasses = new Map(), failures = [];
  let now = epoch, lastStored, claimLease = 0, effects = 0, reached = 'open', late = false;
  let effectReceipt, authorizedEffects = true;
  function open(client) {
    const db = new DatabaseSync(join(root, 'interaction.sqlite'));
    dbs.set(client, db);
    db.exec('PRAGMA synchronous = FULL');
    stores.set(client, new SqliteMessageInteractionSessionStore(db));
  }
  function disconnect() {for (const db of dbs.values()) db.close(); dbs.clear(); stores.clear();}
  const stored = () => stores.get(0).get(reference);
  const initial = {
    sessionVersion: 1, reference, purpose: 'choice', blockKind: 'choice', flow: 'native', profileId: 'fixture',
    bindings, responseSchema: {fields: [{name: 'choice', type: 'select', required: true, options: ['yes', 'no']}], additionalFields: false},
    presetResponse: null, authorization: {decisionId: 'grant', policyRevision: 'policy', state: 'active',
      decidedAt: iso(epoch), revokedAt: null}, effect: {kind: 'fixture-choice'},
    createdAt: iso(epoch), expiresAt: iso(epoch + profile.expiry), consume: {state: 'pending'}, revision: 0,
  };
  function abort(run) {
    const gate = {claimed: run.afterClaim, committed: run.afterCommit, executed: run.afterExecute}[run.phase];
    assert.ok(gate, 'A real client continuation is blocked at a crash checkpoint');
    gate.reject(fixtureAbort);
  }
  const operations = {
    claim(client) {
      assert.ok(!active.has(client));
      const number = runs.get(client) + 1, store = stores.get(client);
      runs.set(client, number);
      const run = {phase: 'starting', afterClaim: deferred(), afterCommit: deferred(), afterExecute: deferred()};
      active.set(client, run);
      const ports = {
        async claimIfCurrent(context) {
          claimIds.set(context.claimId, [client, number]);
          const result = await store.claimIfCurrent(context);
          last.set(client, result.status);
          if (result.status === 'acquired' || result.status === 'resumed') {
            mine.set(client, claimIds.get(result.session.consume.claimId));
            run.phase = 'claimed';
            await run.afterClaim.promise;
          }
          return result;
        },
        async commitIfClaimed(context) {
          const value = await store.commitIfClaimed(context);
          run.phase = 'committed';
          await run.afterCommit.promise;
          return value;
        },
        completeIfClaimed(context) {return store.completeIfClaimed(context);},
      };
      const authority = new MessageInteractionSessionAuthority(ports, {clock: () => now, claimTtlMs: profile.ttl});
      void authority.consumeWithOutcome({callbackData, bindings, replayKey,
        response: {choice: client === 3 ? 'no' : 'yes'}, executor: {async execute(input) {
          const actual = await store.get(reference);
          authorizedEffects &&= actual?.consume.state === 'committed' && actual.consume.claimId === input.session.consume.claimId;
          effects++;
          run.phase = 'executed';
          effectReceipt = {receiptId: 'fixture-receipt', idempotencyKey: input.idempotencyKey,
            status: 'completed', completedAt: iso(now), result: {selected: true}};
          await run.afterExecute.promise;
          return effectReceipt;
        }},
      }).then(
        result => {last.set(client, result.status); active.delete(client);},
        error => {
          if (error === fixtureAbort) last.set(client, 'crashed');
          else if (typeof error.code === 'string' && error.code.startsWith('MESSAGE_INTERACTION_')) {
            last.set(client, run.phase === 'executed' && error.code === 'MESSAGE_INTERACTION_NOT_FOUND' ? 'lost' : 'error');
          } else failures.push(error);
          active.delete(client);
        },
      );
    },
    commit(client) {active.get(client).afterClaim.resolve();},
    execute(client) {active.get(client).afterCommit.resolve();},
    complete(client) {active.get(client).afterExecute.resolve();},
    crash(client) {abort(active.get(client));},
    async reconcile() {
      assert.ok(effectReceipt, 'Reconciliation uses a receipt from an executed effect');
      assert.equal((await stores.get(0).listCommitted({committedBefore: now, limit: 1}))[0]?.reference, reference);
      await stores.get(0).reconcileCommitted({reference, replayKey, receipt: effectReceipt, now});
    },
    async revoke() {
      try {
        const before = await stored();
        const after = await stores.get(0).revokeAuthorization({reference, decisionId: 'grant', now});
        return before.revision !== after.revision;
      } catch (error) {
        assert.equal(error.code, 'MESSAGE_INTERACTION_EFFECT_COMMITTED');
        return false;
      }
    },
    async sweep() {return await stores.get(0).deleteExpired(now) === 1;},
    tick() {now++;},
    reopen() {
      assert.equal(active.size, 0, 'Process reopen happens after client interruption settles');
      disconnect();
      for (const client of [0, ...profile.clients]) open(client);
    },
  };
  async function observe() {
    if (failures.length) throw failures[0];
    const value = await stored();
    if (value) {
      lastStored = value;
      const consume = value.consume;
      if (consume.state === 'claimed') claimLease = Date.parse(consume.claimExpiresAt) - epoch;
      if (consume.state === 'committed' || consume.state === 'completed') {
        late ||= Date.parse(consume.committedAt) >= epoch + claimLease || Date.parse(consume.committedAt) >= Date.parse(value.expiresAt);
        reached = consume.state;
      }
    }
    const consume = lastStored.consume;
    const digest = consume.state === 'pending' ? 'none' : consume.response.choice === 'yes' ? 'A' : 'B';
    if (digest !== 'none') {
      if (digestClasses.has(digest)) assert.equal(digestClasses.get(digest), consume.responseDigest);
      else {
        assert.ok(![...digestClasses.values()].includes(consume.responseDigest));
        digestClasses.set(digest, consume.responseDigest);
      }
    }
    return {
      'state.exists': value !== null, 'state.cstate': consume.state, stateOwner: consume.claimId ? claimIds.get(consume.claimId) : noOwner,
      'state.digest': digest, 'state.lease': claimLease,
      'state.committedAt': consume.committedAt ? Date.parse(consume.committedAt) - epoch : 0,
      'state.completedAt': consume.completedAt ? Date.parse(consume.completedAt) - epoch : 0,
      'state.auth': lastStored.authorization.state, 'state.now': now - epoch,
      'state.pc': qmap(profile.clients.map(client => [client, active.get(client)?.phase ?? 'idle'])),
      'state.runs': qmap(runs), stateMine: qmap(mine), 'state.last': qmap(last),
      'state.effects': effects, 'state.reached': reached, 'state.late': late, authorizedEffects,
    };
  }
  async function close() {
    for (const run of active.values()) {
      if (run.phase !== 'starting') abort(run);
    }
    try {await tick();} finally {disconnect(); rmSync(root, {recursive: true, force: true});}
  }
  try {
    for (const client of [0, ...profile.clients]) open(client);
    await stores.get(0).create(initial);
    return {operations, observe, close, pending: () => active.size};
  } catch (error) {
    await close();
    throw error;
  }
}

const advance = ticks => Array.from({length: ticks}, () => ['tick']);
const schedule = [
  [profileLeases, [
    ['completion-replay-and-mismatch', [['claim', 1], ['commit', 1], ['execute', 1], ['claim', 2], ['claim', 3],
      ['complete', 1], ['claim', 2], ['sweep'], ['claim', 1]]],
    ['lease-takeover-fences-old-owner', [['claim', 1], ['claim', 2], ['tick'], ['claim', 3], ['claim', 2],
      ['commit', 1], ['commit', 2], ['execute', 2], ['complete', 2]]],
    ['revocation-before-commit', [['claim', 1], ['revoke'], ['commit', 1], ['claim', 2], ...advance(3), ['sweep']]],
    ['retained-ambiguous-before-effect', [['claim', 1], ['commit', 1], ['crash', 1], ['reopen'],
      ...advance(3), ['sweep'], ['revoke'], ['claim', 2], ['claim', 3]]],
    ['reopen-after-effect-reconciles', [['claim', 1], ['commit', 1], ['execute', 1], ['crash', 1], ['reopen'],
      ...advance(3), ['sweep'], ['reconcile'], ['claim', 2], ['claim', 3], ['sweep']]],
    ['reconciled-row-swept-before-old-completion', [['claim', 1], ['commit', 1], ['execute', 1],
      ['reconcile'], ['sweep'], ['complete', 1]]],
    ['reconciled-row-accepts-old-completion', [['claim', 1], ['commit', 1], ['execute', 1], ['tick'],
      ['reconcile'], ['complete', 1], ['claim', 2]]],
    ['sweep-expired-pending', [...advance(3), ['claim', 1], ['sweep'], ['claim', 1]]],
    ['exact-lease-expiry-reclaims-same-client', [['claim', 1], ['tick'], ['commit', 1], ['claim', 1],
      ['commit', 1], ['execute', 1], ['complete', 1]]],
  ]],
  [profileRetries, [
    ['resumes-after-client-crash-at-exact-lease', [['claim', 1], ['claim', 2], ['tick'], ['claim', 2], ['crash', 1],
      ['tick'], ['claim', 2], ['commit', 2], ['execute', 2], ['crash', 2], ['reopen'], ...advance(2), ['sweep'],
      ['reconcile'], ['claim', 1]]],
    ['session-expires-before-claim-lease', [...advance(3), ['claim', 1], ['tick'], ['commit', 1], ['claim', 2], ['sweep']]],
    ['same-client-resumes-then-expires', [['claim', 1], ['crash', 1], ...advance(2), ['claim', 1], ['crash', 1],
      ...advance(2), ['claim', 1]]],
  ]],
];

export async function checkInteractionSessionRefinement(vendorPath, extraSources = []) {
  const bundle = await bundleVendorCore(vendorPath, `
    export {MessageInteractionSessionAuthority, createOpaqueMessageInteractionReference, encodeMessageInteractionCallback}
      from './packages/core/src/messaging/interaction-sessions.ts';
    export {SqliteMessageInteractionSessionStore} from './packages/agent/src/services/sqlite-message-interaction-session-store.ts';
  `, [driver, ...extraSources], [coreLeaves]);
  const receipts = [];
  for (const [profile, cases] of schedule) {
    const traces = [];
    for (const [name, operations] of cases) {
      const f = await fixture(bundle, profile);
      try {
        const trace = {name, init: {name: 'init'}, expect: await f.observe(), steps: []};
        for (const [operation, client] of operations) {
          const result = await f.operations[operation](client);
          await tick();
          const action = operation === 'reopen' ? null : call(operation, ...(client === undefined ? [] : [client]));
          if (action && result === false) action.reject = true;
          trace.steps.push({label: [operation, client].filter(value => value !== undefined).join(' '),
            action, expect: await f.observe()});
        }
        assert.equal(f.pending(), 0, 'All client continuations settled');
        traces.push(trace);
      } finally {await f.close();}
    }
    receipts.push(await checkTraces({model: profile.module, modelPath: 'specs/quint/legacy/CoreInteractionSession.qnt',
      id: profile.module + '-source', sources: bundle.sources, driverHashes: bundle.driverHashes, traces,
      scope: 'bounded-orchestration', assumptions: [
        `Actual upstream MessageInteractionSessionAuthority and SqliteMessageInteractionSessionStore at ${bundle.revision} execute against a temporary SQLite database.`,
        'Each client has a separate connection to the same durable journal. The fixture holds replies after atomic claim and commit, and holds external effect completion before the authority samples its completion clock. Rejecting held continuations represents a client interruption.',
        'One valid preinstalled session, shared bindings and replay key, two response classes and bounded client/time profiles. The external executor supplies a synthetic receipt. Reopen closes all connections and reads the real persisted record. The fixture retains the last observed row and lease for model history after deletion and commitment.',
        'Provider effects, multi-process locking under contention, OS power loss, session creation negotiation, foreign bindings and arbitrary replay keys remain outside these schedules.',
      ]}));
  }
  return receipts;
}

if (process.argv[1] === driver) {
  for (const receipt of await checkInteractionSessionRefinement(process.argv[2]?.replace(/^--vendor-dir=/, ''))) {
    console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
  }
}
