import {createWorkflowApprovalPoster,definiteNoticeFailure} from '../.eliza/client-features/packages/contracts/src/workflow-approval-poster.ts';
import {projectNoteForModel} from '../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import { NoticeOwnerCoordinator, revalidateWorkflowApprovalNotice } from '../.eliza/client-features/packages/contracts/src/notice-routes.ts';
// Loads the real authoring module into the same explicit boundary fixture as the
// legacy workflow tests. No native plugin or production account is contacted.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from '../test/support/strip-types.mjs';
import { normalizePhoneSpec, assertPhoneCapabilities, describePhoneTrigger, phoneTriggerClockChangeNote } from '../apps/app/src/runtime/phone-workflow-authoring.ts';
import {workflowDeviceTimeZone,workflowLocalInstant,workflowClockContext,automationLocalDateInput,localDate,phoneScheduleTiming} from '../apps/app/src/runtime/workflow-local-time.ts';
import { WorkflowActivationRejected, WorkflowAdmissionRejected, WorkflowMetadataRejected, WorkflowLifecycleRejected, WorkflowHttpError, WorkflowProtocol } from '../apps/app/src/runtime/workflow-protocol.ts';
import { workflowSha, workflowBytes } from '../apps/app/src/runtime/workflow-device-contract.ts';
import { alphaClient } from '../apps/app/src/runtime/alpha-client.ts';
import { formatDateTime } from '../apps/app/src/prototype/locale-time.ts';
import { WorkflowIntentStore as SharedWorkflowIntentStore, emptyWorkflowIntentArchive, storageWorkflowIntentBackend, workflowIntentKey as sharedWorkflowIntentKey, workflowIntentOwnerPrefix } from '../.eliza/client-features/packages/contracts/src/workflow-intents.ts';
const source = readFileSync(new URL('../apps/app/src/prototype/workflow-authoring.ts', import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function');
export function workflowRendererFixture(overrides: Record<string, unknown>) {
  // connection-ui's no-session wording (P-43) for a production build without the resident (the web
  // preview): the agent is the phone's own; there is no remote-agent copy outside test mocks.
  const phoneOnly = 'Your agent runs on your phone, not here. Open Alpha on your Android phone to use it.';
  const context = {
    Capacitor: {isNativePlatform: () => false, getPlatform: () => 'android'},
    browserDevProfile: false, browserLocalAgentEnabled: false, testMocksEnabled: false,
    agentPendingText: (_snapshot: unknown, remote = phoneOnly) => remote,
    agentAvailabilityNotice: (snapshot: {kind?: string} | null | undefined, remote = phoneOnly) =>
      snapshot?.kind === 'starting' ? '' : remote,
    residentAlwaysPresent: false,
    ...overrides,
  };
  const scope = { setInterval,clearInterval, formatDateTime, createWorkflowApprovalPoster,definiteNoticeFailure,projectNoteForModel, NoticeOwnerCoordinator, revalidateWorkflowApprovalNotice, document:{hidden:false,addEventListener(){},removeEventListener(){}}, window:{addEventListener(){},removeEventListener(){},dispatchEvent(){}}, Event, ...context, normalizePhoneSpec, assertPhoneCapabilities, describePhoneTrigger, phoneTriggerClockChangeNote, workflowDeviceTimeZone,workflowLocalInstant,workflowClockContext,automationLocalDateInput,localDate,phoneScheduleTiming, WorkflowActivationRejected, workflowSha, workflowBytes, alphaClient, crypto:globalThis.crypto, TextEncoder, registerPlugin:()=>new Proxy({}, {get:()=>()=>Promise.reject(Error('Unexpected native authoring operation in existing-workflow fixture'))}) };
  vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.createWorkflowAuthoring=createWorkflowAuthoring;globalThis.showAgentStatus=typeof showAgentStatus==="function"?showAgentStatus:()=>{};}', scope);
  // Exercise the actual installed-slot adapter here; IndexedDB concurrency is
  // qualified by the owning browser suite, not this bounded HTTP fixture.
  const intents=readFileSync(new URL('../apps/app/src/runtime/workflow-intents.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  // The Alpha binding extends the shared owner-isolated store (`@elizaos/contracts/workflow-intents`).
  Object.assign(scope,{SharedWorkflowIntentStore,emptyWorkflowIntentArchive,storageWorkflowIntentBackend,sharedWorkflowIntentKey,workflowIntentOwnerPrefix});
  vm.runInNewContext('{'+stripTypeScriptTypes(intents,{mode:'strip'})+'\nglobalThis.WorkflowIntentStore=WorkflowIntentStore;globalThis.workflowIntentKey=workflowIntentKey;globalThis.runIntentReconcilable=runIntentReconcilable;}',scope);
  return scope;
}


type Action = () => void;
type Card = {name: string; open: Action};
interface WorkflowDetail {
  busy: boolean;
  mayHaveRun: boolean;
  name: string;
  summary: string;
  last: string;
  lifecycleReview: boolean;
  lifecycleLabel: string;
  lifecycleText: string;
  on: boolean;
  isRunning: boolean;
  notRunning: boolean;
  hasRuns: boolean;
  runs: {open: Action}[];
  close: Action;
  del: Action;
  edit: Action;
  lifecycleConfirm: Action;
  run: Action;
  toggle: Action;
}
interface WorkflowReceipt {
  status: string;
  againLabel: string;
  againDisabled: boolean;
  log: {t: string}[];
  approvals: {
    status: string;
    canDecide: boolean;
    approveDisabled: boolean;
    approveLabel: string;
    denyLabel: string;
    approve: Action;
    deny: Action;
  }[];
  again: Action;
  ask: Action;
  close: Action;
}
interface WorkflowEditor {
  fullEditor: boolean;
  unknown: boolean;
  steps: unknown[];
  onName: (event: {target: {value: string}}) => void;
  onDescription: (event: {target: {value: string}}) => void;
  refresh: Action;
  save: Action;
}
interface WorkflowRendering {
  cards: Card[];
  detail: boolean;
  builder: boolean;
  runOpen: boolean;
  fd: WorkflowDetail | null;
  r: WorkflowReceipt | null;
  b: WorkflowEditor | null;
}
interface WorkflowSession {
  sessionId: string;
  ownerId: string;
  origin: string;
  agentId: string;
}

export function workflowHttpClient(origin: string) {
  return new WorkflowProtocol(async (path, body, signal) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) throw new WorkflowHttpError(response.status, data);
    return data;
  });
}

export async function waitForWorkflow(check: () => unknown, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (check()) return;
    await delay(10);
  }
  throw Error('Workflow fixture state timeout');
}

const adapterSource = readFileSync(new URL('../apps/app/src/prototype/workflow-adapter.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export function', 'function')
  + '\nglobalThis.install=installWorkflowAdapter;';

export function mountWorkflowRenderer(
  origin: string,
  session: WorkflowSession,
  storage: Map<string, string>,
  listeners = new Set<Action>(),
) {
  const connectionController = {
    getWorkflowClient: () => ({client: workflowHttpClient(origin), sessionId: session.sessionId}),
    getSnapshot: () => ({session}),
    subscribe: (listener: Action) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: () => { throw Error('Unexpected chooser'); },
  };
  const localStorage = new Proxy({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }, {
    ownKeys: () => [...storage.keys()],
    getOwnPropertyDescriptor: () => ({configurable: true, enumerable: true}),
  });
  const sandbox = workflowRendererFixture({
    WorkflowAdmissionRejected, WorkflowMetadataRejected, WorkflowLifecycleRejected,
    connectionController, localStorage, queueMicrotask, AbortController, Date, console,
  });
  class Shell {
    componentDidMount() {}
    componentWillUnmount() {}
    vset() {}
    S() { return {view: 'workflows'}; }
  }
  const api = {isActive: () => true, track: () => '', kx: () => '', ic: {clock: '', check: ''}, toast: () => {}};
  type Render = (state: Record<string, never>, controls: typeof api) => WorkflowRendering;
  const views: {workflows: {render?: Render}} = {workflows: {}};
  type Install = (component: typeof Shell, views: {workflows: {render?: Render}}) => void;
  const context: typeof sandbox & {install?: Install} = sandbox;
  vm.runInNewContext(stripTypeScriptTypes(adapterSource, {mode: 'strip'}), context);
  assert.ok(context.install, 'Workflow adapter exported its installer');
  context.install(Shell, views);
  const renderView = views.workflows.render;
  assert.ok(renderView, 'Workflow adapter installed its renderer');
  const shell = new Shell();
  shell.componentDidMount();
  const render = () => renderView.call(views.workflows, {}, api);
  return {
    render,
    detail() {
      const detail = render().fd;
      assert.ok(detail, 'Expected a workflow detail');
      return detail;
    },
    receipt() {
      const receipt = render().r;
      assert.ok(receipt, 'Expected a workflow receipt');
      return receipt;
    },
    editor() {
      const editor = render().b;
      assert.ok(editor, 'Expected a workflow editor');
      return editor;
    },
    async openCard(name: string) {
      await waitForWorkflow(() => {
        const {cards} = render();
        return cards.some(card => card.name === name) && !cards.some(card => card.name === 'Loading workflows…');
      });
      const card = render().cards.find(item => item.name === name);
      assert.ok(card, `Expected workflow card ${name}`);
      card.open();
    },
    close: () => shell.componentWillUnmount(),
  };
}
