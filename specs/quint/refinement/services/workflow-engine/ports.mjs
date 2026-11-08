import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {until} from '../support.mjs';

const root = process.cwd();
const packages = createRequire(resolve(root, 'package.json'));
const prefix = 'vendor/eliza/plugins/plugin-workflow/src/';
let compiled, evaluated;
let compilation = 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** The service, compiler and transaction logic run unchanged. These are process/runtime ports. */
async function bundleEngine() {
  const compiledHashes = {};
  const stubs = {
    '@elizaos/core': `
      export {agentProcessStartedAtMs,computeNextCronRunAtMs,isMissedScheduledOccurrence,recordsMissedScheduledOccurrences,MISSED_SCHEDULED_OCCURRENCE_TEXT} from ${JSON.stringify(resolve(root, 'vendor/eliza/packages/core/src/services/trigger-scheduling.ts'))};
      export class Service {constructor(runtime){this.runtime=runtime;}}
      export const logger={info(){},warn(){},error(){}};
      export const ModelType={TEXT_LARGE:'TEXT_LARGE'};export const TRIGGER_SCHEMA_VERSION=1;
      export const stringToUuid=value=>{throw Error('Task arming is outside this fixture '+value);};`,
    'smithers-runtime': `
      export const runSmithersWorkflow=(input)=>globalThis.__workflowEnginePorts.run(input);
      export const controlSmithersRun=(...input)=>globalThis.__workflowEnginePorts.control(...input);
      export const validateSmithersSource=()=>{throw Error('Source authoring is outside this fixture');};`,
    'workflow-approval-receipts': 'export const readApprovalReceipts=(...input)=>globalThis.__workflowEnginePorts.readApprovals(...input);',
    'hosted-google-source': ['assertHostedGoogleSource', 'listHostedGoogleCalendars', 'listHostedGoogleSources', 'readHostedGoogleSource', 'validateHostedGoogleSelection']
      .map(name => `export const ${name}=()=>{throw Error('Hosted Google source is outside this fixture');};`).join('\n'),
    'hosted-native-source': ['assertHostedNativeSource', 'readHostedNativeSource', 'validateHostedNativeSelection']
      .map(name => `export const ${name}=()=>{throw Error('Hosted native source is outside this fixture');};`).join('\n'),
  };
  const result = await build({
    stdin: {
      contents: `export {EmbeddedWorkflowService} from './${prefix}services/embedded-workflow-service.ts';
        export {createWorkflowDispatchService} from './${prefix}services/workflow-dispatch.ts';
        export * as schema from './${prefix}db/schema.ts';
        export * as phone from './${prefix}services/phone-workflow-spec.ts';`,
      resolveDir: root,
      sourcefile: 'workflow-engine-entry.ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', metafile: true,
    plugins: [{name: 'workflow-process-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        const basename = args.path.split('/').at(-1).replace(/\.ts$/, '');
        if (Object.hasOwn(stubs, args.path)) return {path: args.path, namespace: 'workflow-port'};
        if (Object.hasOwn(stubs, basename)) return {path: basename, namespace: 'workflow-port'};
        if (args.path.startsWith('drizzle-orm')) return {
          path: pathToFileURL(packages.resolve(args.path).replace(/\.cjs$/, '.js')).href, external: true,
        };
        if (args.path === '@elizaos/contracts/phone-workflow') return {path: resolve(root, '.eliza/client-features/packages/contracts/src/phone-workflow.ts')};
        if (args.path === '@elizaos/contracts/workflow-client') return {path: resolve(root, '.eliza/client-features/packages/contracts/src/workflow-client.ts')};
      });
      builder.onLoad({filter: /.*/, namespace: 'workflow-port'}, args => ({
        contents: stubs[args.path], loader: 'js', resolveDir: root,
      }));
      builder.onLoad({filter: /\.(?:ts|tsx|js|mjs|cjs|json)$/, namespace: 'file'}, args => {
        const contents = readFileSync(args.path);
        compiledHashes[args.path] = digest(contents);
        const extension = args.path.split('.').at(-1);
        return {contents: contents.toString('utf8'), loader: extension === 'mjs' || extension === 'cjs' ? 'js' : extension, resolveDir: resolve(args.path, '..')};
      });
    }}],
  });
  const sources = Object.keys(result.metafile.inputs)
    .filter(name => !name.startsWith('workflow-port:') && name !== 'workflow-engine-entry.ts');
  return {code: result.outputFiles[0].text, sources, compiledHashes};
}

/** Discover the first-party graph without evaluating its JavaScript. */
export async function engineDriverSources() {
  return (await bundleEngine()).sources;
}

/** Rebuild from the captured input bytes and bind the exact bytes esbuild consumed. */
export async function prepareEngineModule(discovered, driverHashes) {
  const artifact = await bundleEngine();
  assert.deepEqual([...artifact.sources].sort(), [...discovered].sort(), 'Workflow module graph changed during compilation');
  for (const [path, hash] of Object.entries(artifact.compiledHashes)) {
    assert.equal(hash, driverHashes[path], `Workflow compiled bytes differ from the before-driver snapshot: ${path}`);
    assert.equal(digest(readFileSync(path)), hash, `Workflow source changed during compilation: ${path}`);
  }
  compiled = artifact;
  evaluated = undefined;
  return {...artifact.compiledHashes};
}

export async function engineModule() {
  if (!compiled) compiled = await bundleEngine();
  for (const [path, hash] of Object.entries(compiled.compiledHashes)) {
    assert.equal(digest(readFileSync(path)), hash, `Workflow source changed before evaluation: ${path}`);
  }
  if (!evaluated) {
    const module = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64') + `#${++compilation}`);
    evaluated = {...module, sources: compiled.sources, compiledHashes: {...compiled.compiledHashes}};
  }
  return evaluated;
}

const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function createTables(database, schema, getTableConfig) {
  await database.exec('CREATE SCHEMA workflow');
  for (const table of Object.values(schema)) {
    let config;
    try { config = getTableConfig(table); } catch { continue; }
    const fields = config.columns.map(column => quote(column.name) + ' ' + column.getSQLType() + (column.notNull ? ' NOT NULL' : ''));
    for (const key of config.primaryKeys) fields.push('PRIMARY KEY (' + key.columns.map(column => quote(column.name)).join(',') + ')');
    await database.exec('CREATE TABLE ' + quote(config.schema) + '.' + quote(config.name) + ' (' + fields.join(',') + ')');
  }
}

/** Each fixture runs one service against real SQL. Test runners must keep these fixtures sequential. */
export async function createEngineFixture() {
  const module = await engineModule();
  const {PGlite} = await import(pathToFileURL(packages.resolve('@electric-sql/pglite')).href);
  const {drizzle} = await import(pathToFileURL(packages.resolve('drizzle-orm/pglite')).href);
  const {getTableConfig} = await import(pathToFileURL(packages.resolve('drizzle-orm/pg-core')).href);
  const database = new PGlite();
  await createTables(database, module.schema, getTableConfig);
  const db = drizzle(database, {schema: module.schema});
  const transaction = db.transaction.bind(db);
  let transactionFault;
  db.transaction = async callback => {
    const fault = transactionFault;
    transactionFault = undefined;
    const result = await transaction(async tx => {
      const value = await callback(tx);
      if (fault === 'before-commit') throw Error('Injected rollback before commit');
      return value;
    });
    if (fault === 'after-commit') throw Error('Injected lost response after commit');
    return result;
  };
  const calls = [], pending = [], controls = [], approvals = new Map();
  let controlBehavior = async input => ({status: input.kind === 'cancel' ? 'cancelled' : null});
  const ports = {
    async run(input) {
      const rows = await db.select().from(module.schema.embeddedExecutions);
      assert.ok(rows.some(row => row.id === input.runId), 'durable SQL admission precedes process entry');
      calls.push(input);
      return new Promise((resolve, reject) => pending.push({input, resolve, reject}));
    },
    async control(_tenant, _workflow, input) {
      controls.push(input);
      return controlBehavior(input);
    },
    async readApprovals(_tenant, execution) {
      return structuredClone(approvals.get(execution.id) ?? []);
    },
  };
  globalThis.__workflowEnginePorts = ports;
  const settings = {};
  const runtime = {
    agentId: 'agent-A', db, getSetting: key => settings[key], getService: name => name === 'embedded_workflow_service' ? fixture.service : null,
    emitEvent: async () => {}, getTasksByName: async () => [], getTasks: async () => [], deleteTask: async () => {},
    createTask: async () => { throw Error('Task arming is outside this fixture'); },
  };
  async function seed({id = 'workflow-A', version = 'version-1', active = true, metadata = {}, source = 'export default null;', agentId = runtime.agentId} = {}) {
    const now = new Date().toISOString();
    const workflow = {id, name: 'Fixture', source, language: 'typescript', active, metadata};
    await db.insert(module.schema.embeddedWorkflows).values({agentId, id, name: workflow.name, active, workflow, createdAt: now, updatedAt: now, versionId: version});
    return workflow;
  }
  const fixture = {
    ...module, database, db, runtime, calls, pending, controls, approvals, ports, settings, seed,
    service: new module.EmbeddedWorkflowService(runtime),
    faultNextTransaction(stage) { transactionFault = stage; },
    controlWith(callback) { controlBehavior = callback; },
    async rows() {
      return {workflows: await db.select().from(module.schema.embeddedWorkflows), executions: await db.select().from(module.schema.embeddedExecutions), submissions: await db.select().from(module.schema.manualSubmissions)};
    },
    async settle(status = 'finished', errorCode) {
      await until(() => pending.length > 0, 'worker process entry');
      const next = pending.shift();
      if (errorCode) next.reject(Object.assign(Error(errorCode), {code: errorCode}));
      else next.resolve({status, events: [], output: {text: 'result'}});
      await until(() => !fixture.service.running.has(next.input.runId), 'worker result persisted');
      return next.input.runId;
    },
    async restart() {
      assert.equal(pending.length, 0, 'restart follows process termination');
      await fixture.service.stop();
      fixture.service = await module.EmbeddedWorkflowService.start(runtime);
    },
    async close() {
      for (const next of pending.splice(0)) next.resolve({status: 'cancelled', events: []});
      await fixture.service.stop();
      await database.close();
      delete globalThis.__workflowEnginePorts;
    },
  };
  return fixture;
}
