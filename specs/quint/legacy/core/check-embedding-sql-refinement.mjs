import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
import {checkTraces, qset} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, deferred, root} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const agent = '00000000-0000-4000-8000-000000000001';
const memoryId = '00000000-0000-4000-8000-000000000002';
const widths = [384, 512, 768, 1024, 1536, 2048, 3072];
const historicalRuntime = [
  'packages/core/src/runtime/embeddings.ts',
  'packages/core/src/embedding-vector-space.ts',
  'plugins/plugin-sql/src/base.ts',
  'plugins/plugin-sql/src/embedding-space.ts',
  'plugins/plugin-sql/src/pglite/adapter.ts',
];
const abstractWidth = width => {
  assert.ok(width === 384 || width === 512);
  return width === 384 ? 2 : 3;
};
const sqlDependencies = {name: 'pinned-sql-dependencies', setup(build) {
  build.onResolve({filter: /^@elizaos\/core$/}, () => ({path: resolve(root, 'vendor/eliza/packages/core/src/index.ts')}));
  build.onResolve({filter: /^file-type$/}, () => ({path: 'file-type', external: true}));
}};

async function withDatabase(drive) {
  const db = await PGlite.create({extensions: {vector}});
  try {
    await db.exec(`CREATE EXTENSION vector;
      CREATE TABLE memories (id uuid PRIMARY KEY, type text NOT NULL, created_at timestamp DEFAULT now(),
        content jsonb NOT NULL, entity_id uuid, agent_id uuid NOT NULL, room_id uuid, world_id uuid,
        "unique" bool NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE embeddings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id uuid NOT NULL REFERENCES memories(id), space_id text, write_nonce uuid,
        created_at timestamp DEFAULT now(), ${widths.map(width => `dim_${width} vector(${width})`).join(',')},
        CHECK (space_id IS NULL OR write_nonce IS NOT NULL));`);
    return await drive(db);
  } finally {
    await db.close();
  }
}

async function scenario(module, name, drive) {
  return withDatabase(async db => {
    const {RuntimeEmbeddings, ModelType, PgliteDatabaseAdapter, identifyEmbeddingVector, getEmbeddingVectorSpace} = module;
    const adapter = new PgliteDatabaseAdapter(agent, {getConnection: () => db, isShuttingDown: () => false, initialize: async () => {}});
    const started = deferred(), reply = deferred(), spaced = deferred(), publishPin = deferred();
    const space = 'S', providers = [{provider: 'named', modelKey: ModelType.TEXT_EMBEDDING}];
    const makeVector = width => Array.from({length: width}, (_, i) => i === 0 ? 1 : 0);
    const runtime = {
      agentId: agent, adapter, logger: {debug() {}, info() {}, warn() {}}, getSetting() {},
      async useModel(type, params, provider) {
        assert.equal(type, ModelType.TEXT_EMBEDDING);
        assert.equal(params, null);
        assert.equal(provider, 'named');
        started.resolve();
        await reply.promise;
        const embedding = identifyEmbeddingVector(makeVector(384), space);
        await embeddings.validateProviderOutput(type, params, embedding, embedding, provider);
        return embedding;
      },
      reportError(scope, error) { assert.fail(`${scope}: ${error.message}`); },
    };
    const embeddings = new RuntimeEmbeddings(runtime, {resolveModelRegistrations: () => providers});
    let input, fromSpace, dropped = 0, probes = 0;
    async function observe() {
      const {rows} = await db.query('SELECT memory_id, space_id, dim_384 IS NOT NULL AS small, dim_512 IS NOT NULL AS wide FROM embeddings');
      const stored = rows.map(row => {
        assert.equal(row.memory_id, memoryId);
        assert.notEqual(row.small, row.wide);
        return {space: row.space_id ?? 'none', dim: row.small ? 2 : 3, fromSpace};
      });
      return {'sourceState.col': abstractWidth(Number(adapter.embeddingDimension.slice(3))),
        'sourceState.aspace': adapter.embeddingSpace ?? 'none',
        'sourceState.stored': qset(stored), 'sourceState.pinProv': embeddings.getPinnedProvider() ?? 'none',
        'sourceState.pinSpace': embeddings.pinnedEmbeddingSpace ?? 'none',
        'sourceState.pinDim': embeddings.pinnedEmbeddingDimension === undefined ? 0 : abstractWidth(embeddings.pinnedEmbeddingDimension),
        'sourceState.probes': probes, 'sourceState.dropped': dropped,
        storedOneSpace: stored.every(row => row.space === row.fromSpace)};
    }
    const trace = {name, init: {name: 'init'}, expect: await observe(), steps: []};
    async function point(label, name, ...args) {
      trace.steps.push({label, action: {name, args}, expect: await observe()});
    }
    const resize = adapter.ensureEmbeddingDimension.bind(adapter);
    adapter.ensureEmbeddingDimension = async dimension => {
      await resize(dimension);
      await point('actual adapter activates the width', 'resizeProbe');
    };
    const ensureSpace = adapter.ensureEmbeddingSpace.bind(adapter);
    adapter.ensureEmbeddingSpace = async value => {
      const result = await ensureSpace(value);
      await point('actual SQL transaction activates the named space', 'spaceProbe');
      spaced.resolve();
      await publishPin.promise;
      return result;
    };
    const clear = adapter.clearEmbeddingsOutsideActiveDimension.bind(adapter);
    adapter.clearEmbeddingsOutsideActiveDimension = async () => {
      await point('the runtime has published its pin before stale-vector cleanup', 'pinProbe');
      return clear();
    };
    await drive({
      async call(provider) {
        input = {provider, vector: makeVector(provider === 'wide' ? 512 : 384)};
        fromSpace = getEmbeddingVectorSpace(input.vector) ?? 'none';
        await point('the controlled provider emits an untagged vector', 'callEmbedding', 'e1', provider);
      },
      async validate() {
        await embeddings.validateProviderOutput(ModelType.TEXT_EMBEDDING, {text: 'Synthetic memory'},
          input.vector, input.vector, input.provider);
        await point('actual runtime validates the untagged output', 'validateEmbedding', 'e1');
      },
      async write() {
        await adapter.createMemory({id: memoryId, agentId: agent, entityId: null, unique: true,
          content: {text: 'Synthetic memory'}, embedding: input.vector}, 'fixture');
        assert.equal((await db.query('SELECT id FROM memories WHERE id = $1', [memoryId])).rows.length, 1);
        dropped = (await db.query('SELECT id FROM embeddings WHERE memory_id = $1', [memoryId])).rows.length === 0 ? 1 : 0;
        await point('actual SQL memory write accepts or drops its vector', 'writeEmbedding', 'e1');
      },
      async activate() {
        const initialization = embeddings.ensureEmbeddingDimension();
        await Promise.race([started.promise, initialization]);
        probes++;
        await point('actual runtime owns the held named probe', 'startProbe', 'named');
        reply.resolve();
        await Promise.race([spaced.promise, initialization]);
        return {complete: initialization.then(() => point('real stale-width cleanup has settled', 'clearProbe', false))};
      },
      publish() {publishPin.resolve();},
      async checkDatabaseFence() {
        const {rows} = await db.query('SELECT space_id, write_nonce FROM embeddings WHERE memory_id = $1', [memoryId]);
        assert.equal(rows[0]?.space_id, space);
        assert.ok(rows[0].write_nonce);
        await assert.rejects(db.query('UPDATE embeddings SET dim_384 = dim_384 WHERE memory_id = $1', [memoryId]), {code: '23514'});
        assert.equal((await db.query('SELECT space_id, write_nonce FROM embeddings WHERE memory_id = $1', [memoryId])).rows[0].write_nonce,
          rows[0].write_nonce);
      },
    });
    return trace;
  });
}

export async function checkEmbeddingSqlRefinement(extraSources = []) {
  const bundle = await bundleVendorCore(undefined, `
    export {PgliteDatabaseAdapter} from './plugins/plugin-sql/src/pglite/adapter.ts';
    export {RuntimeEmbeddings} from './packages/core/src/runtime/embeddings.ts';
    export {identifyEmbeddingVector, getEmbeddingVectorSpace} from './packages/core/src/embedding-vector-space.ts';
    export {ModelType} from './packages/core/src/types/model.ts';
  `, [driver, 'bun.lock', 'upstream.lock.json', ...extraSources], [sqlDependencies], historicalRuntime);
  const module = bundle.instantiate({});
  const traces = [
    await scenario(module, 'old-untagged-vector-can-be-retagged-during-activation', async f => {
      await f.call('plain');
      // Activation deliberately waits before returning to the pin owner.
      const {complete} = await f.activate();
      try {
        await f.validate();
        await f.write();
        await f.checkDatabaseFence();
      } finally {
        f.publish();
        await complete;
      }
    }),
    await scenario(module, 'wrong-width-drops-vector-and-keeps-memory', async f => {
      await f.call('wide'); await f.validate(); await f.write();
    }),
  ];
  return checkTraces({model: 'CoreEmbeddingDimension', traces, sources: bundle.sources,
    driverHashes: bundle.driverHashes, scope: 'bounded-component', assumptions: [
      `Historical RuntimeEmbeddings, vector identity and SQL adapter fragments from authenticated upstream ${bundle.historicalRevision}, materialized outside vendor. This is the original model's witness, not a current-source failure.`,
      `Other imported support modules are byte-bound to current upstream ${bundle.revision} and the root package lock. This fragment execution does not claim a complete historical runtime build or qualification.`,
      'The physical PGlite columns 384 and 512 project to widths two and three. A controlled runtime supplies vector bytes and provider identity. The real adapter executes in a temporary database with the selected memory and embedding columns.',
      'The translated design intentionally preserves the known historical provenance counterexample. Its historical SQL fragment can tag a delayed unmarked input at insertion, while the nonce trigger blocks a stale direct UPDATE. The separate NamedEmbeddingProvenance campaign executes the current source and checks refusal instead.',
      'Full migrations, concurrent database processes, foreign agent isolation, and index re-embedding remain separate.',
    ]});
}
