import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapter = 'apps/app/src/prototype/automations-adapter.ts';
const route = 'apps/app/src/runtime/automations-route-policy.ts';
const intentPrefix = 'alpha.workflow.pending.v1:';
const listPath = '/api/lifeops/scheduled-tasks?ownerVisibleOnly=1';
const taskPath = '/api/lifeops/scheduled-tasks/weekly';
const prepare = join(root, 'scripts/prepare-client-features.mjs');
const pin = join(root, 'upstream.lock.json');
const fixture = fileURLToPath(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));
let compiled;

function compile() {
  const hashes = Object.fromEntries([fixture, prepare, pin].map(path => [path, digest(readFileSync(path))]));
  const ports = new Map([
    ['../runtime/connection-ui', 'export const connectionController=ports.connection;export const agentPendingText=()=>"No agent";export const agentAvailabilityNotice=()=>"No agent";'],
    ['../runtime/service-read-cache-store', 'export const serviceReadCache=async()=>({get:async()=>null,put:async()=>{}});'],
    ['../runtime/native-connection', 'export const cloudCredentialStore={read:async()=>null};'],
    ['../runtime/browser-cloud-resident', 'export const browserCloudResidentEnabled=false,browserCloudResidentEnvironment="production";'],
    ['../build-flags', 'export const testMocksEnabled=false;'],
    ['../daily', 'export const DailyApps=ports.daily;'],
    ['./workflow-filters', 'export const openWorkflowFilters=()=>{};export const workflowFilterLabel=()=>"";'],
    ['./workflow-authoring', 'export const showAgentStatus=()=>{};'],
    ['./home-cards', 'export const homeReadIsStale=()=>false;export const presentHomeWorkflowFreshness=()=>({});'],
    ['../runtime/workflow-request-recovery', 'export const createWorkflowRequestRecovery=()=>({retire(){},open(){throw Error("Browser recovery outside installed-slot fixture");}});'],
    ['../browser/domain-recovery', 'export function openDomainRecovery(){throw Error("Browser dialog outside installed-slot fixture");}'],
    ['../browser/domain-document', 'export class BrowserDomainDocument {constructor(){throw Error("Browser document outside fixture");}}'],
    ['../browser/documents', 'export const browserDocuments=null;'],
    ['@capacitor/core', 'export const Capacitor={getPlatform:()=>"android",isNativePlatform:()=>true};'],
    ['./automations.css', ''],
  ]);
  return build({
    absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node',
    stdin: {contents: `export {installAutomationsAdapter} from "./${adapter}";export {assertAutomationRequestAllowed} from "./${route}";`,
      resolveDir: root, sourcefile: 'scheduled-task-controls-entry.mjs'},
    plugins: [{name: 'closed-schedule-source', setup(b) {
      b.onResolve({filter: /.*/}, ({path}) => ports.has(path) ? {path, namespace: 'fixture'} : undefined);
      b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({contents: ports.get(path), loader: 'js'}));
      b.onLoad({filter: /\.(?:tsx?|json|js)$/}, ({path}) => {
        assert.ok(!path.includes('/node_modules/'), 'Unexpected external runtime input ' + path);
        const bytes = readFileSync(path);
        hashes[path] = digest(bytes);
        const staged = path.slice(root.length).match(/^\.eliza\/client-features\/(.*)$/)?.[1];
        if (staged) {
          const original = join(root, 'vendor/eliza', staged);
          assert.deepEqual(bytes, readFileSync(original), 'Staged source differs from pinned source ' + staged);
          hashes[original] = hashes[path];
        }
        return {contents: bytes, loader: extname(path).slice(1), resolveDir: dirname(path)};
      });
    }}],
  }).then(result => ({code: result.outputFiles[0].text, hashes}));
}

const ownerContext = owner => ({origin: 'https://closed.invalid', ownerId: owner,
  agentId: 'synthetic-agent', sessionId: 'session-' + owner});
const scheduleTask = (kind, status) => ({
  taskId: 'weekly', kind: 'recap', promptInstructions: 'Review the week.',
  trigger: kind === 'manual' ? {kind} : {kind: 'cron', expression: kind === 'custom' ? '0 8 1 * *' : '0 8 * * 1', tz: 'UTC'},
  state: {status}, ownerVisible: true, metadata: {recordKey: 'weekly-review'},
});
const intentEntries = storage => Object.entries(storage).filter(([key]) => key.startsWith(intentPrefix))
  .map(([key, raw]) => {
    const [origin, owner, agent, slot] = JSON.parse(key.slice(intentPrefix.length));
    assert.deepEqual([origin, agent, slot], ['https://closed.invalid', 'synthetic-agent', 'automation:scheduled:weekly']);
    return {owner, intent: JSON.parse(raw)};
  });

/** Actual renderer adapter, protocol, owner route checks and intent storage against closed primitives. */
export async function scheduledTaskControlsFixture({kind = 'preset', status = 'scheduled'} = {}) {
  const {code, hashes} = await (compiled ??= compile());
  const document = new EventTarget(), window = new EventTarget();
  document.hidden = false;
  const storage = {};
  Object.defineProperties(storage, {
    getItem: {value: key => storage[key] ?? null},
    setItem: {value: (key, value) => {storage[key] = String(value);}},
    removeItem: {value: key => {delete storage[key];}},
  });
  const subscribers = new Set();
  let owner = ownerContext('a'), visible = true, dialogAccepted = false;
  let task = scheduleTask(kind, status), missing = false, scheduleUnavailable = false, unrelatedUnavailable = false;
  const sends = [];
  let pending;
  const module = {exports: {}};
  async function request(path, method, body, signal) {
    module.exports.assertAutomationRequestAllowed(path, method, body);
    signal.throwIfAborted();
    if (method === 'POST') {
      assert.equal(pending, undefined, 'Only one fixture request can be held');
      const journal = intentEntries(storage).find(entry => entry.owner === owner.ownerId);
      const retained = journal?.intent.kind === 'automation' && journal.intent.method === method
        && journal.intent.path === path && JSON.stringify(journal.intent.body) === JSON.stringify(body);
      sends.push({owner: owner.ownerId, path, body: structuredClone(body), retained});
      return new Promise((resolve, reject) => {pending = {owner: owner.ownerId, path, body, resolve, reject};});
    }
    if (path === listPath) {
      if (scheduleUnavailable) throw Object.assign(Error('Schedule list is unavailable'), {status: 503});
      return {tasks: missing ? [] : [structuredClone(task)]};
    }
    if (path === '/api/lifeops/definitions') {
      if (unrelatedUnavailable) throw Object.assign(Error('Other list is unavailable'), {status: 503});
      return {definitions: []};
    }
    if (path === '/api/lifeops/reminders') return {reminders: []};
    if (path === '/api/automations') return {automations: []};
    throw Error('Unexpected synthetic request ' + path);
  }
  const connection = {
    getSnapshot: () => ({session: owner, open: false}),
    getAutomationsClient: () => ({sessionId: owner.sessionId, request}),
    subscribe(listener) {subscribers.add(listener);return () => subscribers.delete(listener);},
  };
  window.confirm = () => dialogAccepted;
  const context = vm.createContext({exports: module.exports, module, document, window, localStorage: storage,
    Intl:Object.assign(Object.create(Intl),{DateTimeFormat:function(locales,options){return new Intl.DateTimeFormat(locales,{...options,timeZone:options?.timeZone||'UTC'});}}),
    Event, AbortController, TextEncoder, TextDecoder, queueMicrotask, crypto: {randomUUID},
    ports: {connection, daily: {listReminders: async () => ({reminders: []})}}});
  vm.runInContext(code, context);
  class Shell {
    live = true;
    S() {return {view: visible ? 'workflows' : 'home'};}
    componentDidMount() {}
    componentWillUnmount() {}
    vset() {}
  }
  const views = {workflows: {render: () => ({})}};
  module.exports.installAutomationsAdapter(Shell, views);
  const shell = new Shell();
  const render = () => views.workflows.render({}, {ic: {}, track: () => '', kx: () => ''});
  shell.componentDidMount();
  render();
  await turn();
  function detail() {return render().automation;}
  function buttons() {const view = detail();return [...view.schedulePrimary, ...view.scheduleMore ?? []];}
  return {
    hashes,
    open() {render().cards.find(card => card.name === 'Weekly review').open();},
    click(label) {
      const button = buttons().find(candidate => candidate.label === label);
      assert.ok(button && !button.disabled, 'Enabled schedule action ' + label);
      button.run();
    },
    enter(text, time) {
      const view = detail();
      assert.equal(view.editingSchedule, true);
      view.changeScheduleInstructions({target: {value: text}});
      if (time !== undefined) {
        assert.equal(view.scheduleClockEditable, true);
        view.changeScheduleTime({target: {value: time}});
      }
    },
    chooseDays(days) {
      for(const day of [...detail().scheduleDays])if(day.selected !== (days==='*'||days.split(',').includes(String(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(day.name)))))day.pick();
    },
    save() {detail().saveScheduleEdit();},
    cancelEdit() {detail().cancelScheduleEdit();},
    cancelReview() {detail().cancelReview();},
    confirm() {detail().confirm();},
    async release(accepted) {
      dialogAccepted = accepted;
      detail().allowAnother();
      await turn();
    },
    catalog(mode) {
      missing = mode === 'missing-partial';
      unrelatedUnavailable = missing;
      scheduleUnavailable = mode === 'failed';
    },
    async refresh() {detail().refresh();await turn();},
    async wait() {await turn();},
    async switchOwner() {
      owner = ownerContext('b');
      for (const subscriber of subscribers) subscriber();
      render();
      await turn();
    },
    leave() {visible = false;views.workflows.onLeave();},
    async answer(result) {
      assert.ok(pending, 'Synthetic POST must be dispatched first');
      const current = pending;
      pending = undefined;
      if (result === 'transport-lost') current.reject(Error('Synthetic response lost'));
      else if (current.path === taskPath + '/edit') {
        const updated = {...task, ...current.body};
        if (result === 'exact') {task = updated;current.resolve({task: structuredClone(task)});}
        else current.resolve({task: {...updated, promptInstructions: 'Different instructions.'}});
      } else if (current.path === taskPath + '/fire') {
        current.resolve({fire: result === 'wrong-id' ? {kind: 'fired', task: {...task, taskId: 'other'}}
          : result === 'wrong-skipped-id' ? {kind: 'skipped', task: {...task, taskId: 'other'}}
          : result === 'missing-id' ? {kind: 'fired'}
          : result === 'raced' ? {kind: 'raced', task: null}
          : {kind: result === 'exact' ? 'fired' : result, task: structuredClone(task)}});
      } else {
        assert.match(current.path, /^\/api\/lifeops\/scheduled-tasks\/weekly\/(?:reopen|snooze|acknowledge|complete|dismiss)$/);
        if(result==='exact'&&current.path.endsWith('/snooze'))task={...task,state:{...task.state,status:'scheduled',firedAt:current.body.untilIso}};
        if (result === 'exact' && current.path.endsWith('/reopen')) task = {...task, state: {status: 'scheduled'}};
        current.resolve({task: result === 'exact' ? structuredClone(task) : {...task, taskId: 'other'}});
      }
      await turn();
    },
    observe() {
      const rendered = render(), view = rendered.automation;
      const source = !visible ? 'idle' : view.issues.some(issue => issue.source === 'schedules') ? 'failed'
        : rendered.cards.some(card => card.name === 'Weekly review') ? 'available' : 'missing';
      return {owner: owner.ownerId, visible, kind, storedStatus: task.state.status, storedText: task.promptInstructions,
        storedTime: task.trigger.expression ?? '', catalog: missing ? 'missing-partial' : scheduleUnavailable ? 'failed' : 'available',
        source, detail: view.detail, status: view.status, days: view.scheduleDays.filter(day=>day.selected).map(day=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(day.name)).sort((a,b)=>a-b).join(',').replace('0,1,2,3,4,5,6','*'),
        editing: view.editingSchedule, draft: view.scheduleInstructions,
        time: view.editedScheduleTime, clockEditable: view.scheduleClockEditable, review: view.reviewLabel,
        busy: view.busy, locked: view.locked, message: view.message,
        actions: buttons().map(button => ({label: button.label, disabled: button.disabled})),
        pending: pending ? {owner: pending.owner, path: pending.path, body: structuredClone(pending.body)} : null,
        sends: structuredClone(sends), intents: intentEntries(storage)};
    },
  };
}
