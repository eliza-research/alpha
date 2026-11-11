import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const session = {sessionId: 'session', origin: 'https://synthetic.invalid', ownerId: 'owner', agentId: 'agent'};
/** The journal slot of a workflow's pending request of one kind, as the adapter names it. */
export const intentSlot = (workflowId, suffix = '') => 'alpha.workflow.pending.v1:' + JSON.stringify([session.origin, session.ownerId, session.agentId, workflowId]) + suffix;
export const wait = async (ready, label = 'The workflow adapter did not settle.') => {
  for (let count = 0; count < 400; count++) { if (ready()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw Error(label);
};

/**
 * The real workflow adapter in the renderer fixture its own tests use, over a caller-supplied agent
 * client and a storage object that outlives the adapter. `restart()` mounts a new adapter over the
 * same storage, as a new app process does; the earlier one is left where it stopped.
 */
export async function workflowAdapter({client, storage = {}}) {
  const {workflowRendererFixture} = await import('../../../../scripts/workflow-renderer-fixture.mjs');
  const protocol = await import('../../../../apps/app/src/runtime/workflow-protocol.ts');
  const contract = await import('../../../../apps/app/src/runtime/workflow-device-contract.ts');
  const source = fs.readFileSync(root + 'apps/app/src/prototype/workflow-adapter.ts', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function') + '\nglobalThis.install=installWorkflowAdapter;';
  const localStorage = new Proxy({getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; }, removeItem: key => { delete storage[key]; }},
    {ownKeys: () => Object.keys(storage), getOwnPropertyDescriptor: () => ({configurable: true, enumerable: true})});
  const mount = () => {
    const toasts = [];
    let view = 'workflows';
    const api = {isActive: () => true, track: () => '', kx: () => 0, toast: message => toasts.push(message), ic: {clock: '', check: ''}};
    class Shell { live = true; renderVals() { return {}; } componentDidMount() {} componentWillUnmount() {} componentDidUpdate() {} S() { return {view}; } vset() {} vget() { return {}; } api() { return api; } openView(next) { view = next; } toast(message) { toasts.push(message); } }
    const views = {workflows: {automationsManaged: true}};
    const controller = {getWorkflowClient: () => ({sessionId: session.sessionId, scope: 'scope', client}), getSnapshot: () => ({session, open: false, busy: false, startupResolved: true}), subscribe: () => () => {}, open() {}, workflowNoticeActions: async () => [], getWorkflowDeviceTarget: () => null};
    const context = workflowRendererFixture({WorkflowAdmissionRejected: protocol.WorkflowAdmissionRejected, WorkflowMetadataRejected: protocol.WorkflowMetadataRejected, WorkflowLifecycleRejected: protocol.WorkflowLifecycleRejected,
      resolveWorkflowTap: contract.resolveWorkflowTap, readyTapStep: contract.readyTapStep, tapRecheck: contract.tapRecheck,
      Capacitor: {isNativePlatform: () => true, getPlatform: () => 'android'}, connectionController: controller, localStorage, queueMicrotask, AbortController, Date, console});
    // Native plugins stay inert: notices and taps are outside these models.
    context.registerPlugin = () => new Proxy({}, {get: (_target, name) => name === 'addListener' ? async () => ({remove() {}}) : async () => ({})});
    vm.runInNewContext(stripTypeScriptTypes(source, {mode: 'strip'}), context);
    context.install(Shell, views);
    const shell = new Shell(); shell.componentDidMount();
    return {render: () => views.workflows.render({}, api), back: () => views.workflows.back(), leave: () => views.workflows.onLeave(), toasts, close: () => shell.componentWillUnmount()};
  };
  let mounted = mount();
  const stopped = [];
  return {get render() { return mounted.render; }, back: () => mounted.back(), leave: () => mounted.leave(), get toasts() { return mounted.toasts; }, storage, protocol,
    restart() { stopped.push(mounted); mounted = mount(); },
    /** Unmounts every adapter of this fixture so its timers end. Call once, after the last observation. */
    close() { for (const adapter of [...stopped, mounted]) adapter.close(); }};
}
