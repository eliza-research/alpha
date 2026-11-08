import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {HostedDigestPanel} from '../../apps/app/src/runtime/hosted-digest-ui.tsx';
import {latestRetainedDigest} from '../../apps/app/src/runtime/hosted-digests.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const subscribers = new Set(), intervals = new Map(), requests = [], capabilities = [], releases = [];
let selection = {kind: 'none', session: null}, owner = 0, nextInterval = 0, holdStatus = false;
const createInterval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
window.setInterval = (run, delay, ...args) => {
  if (delay !== 15000) return createInterval(run, delay, ...args);
  const id = --nextInterval;
  intervals.set(id, () => run(...args));
  return id;
};
window.clearInterval = id => {
  if (id < 0) intervals.delete(id);
  else clearInterval(id);
};

function request(kind, id, signal) {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  requests.push({kind, id, signal, resolve, reject, done: false});
  return promise;
}

function reply(kind, id, value, refuse = false) {
  const pending = requests.find(row => row.kind === kind && row.id === id && !row.done);
  if (!pending) throw Error('No pending '+kind+' for fixture owner '+id);
  pending.done = true;
  if (refuse) pending.reject(Error('Synthetic fixture refusal'));
  else pending.resolve(value);
}

const status = {enabled: true, backgroundEnabled: true};
const date = '2027-01-01T12:00:00.000Z';
const payload = id => ({cursor: id, runId: 'run-'+id, workflowId: 'fixture-workflow', workflowVersionId: 'fixture-version',
  templateVersion: 'fixture-template', scheduledAt: date, source: {observedAt: date, expiresAt: date},
  status: 'completed', startedAt: date, completedAt: date, output: 'fixture-result-'+id, error: null});

const client = id => ({
  fixtureId: id,
  async capabilities(signal) {signal.throwIfAborted(); capabilities.push(id); return {digests: true};},
  async sources() {return [];},
  async loops() {return [];},
});

globalThis.hostedDigestRefreshPorts = {
  subscribe(fn) {subscribers.add(fn); return () => subscribers.delete(fn);},
  snapshot: () => selection,
  workflow() {
    const id = owner;
    return id ? {sessionId: 'session-'+id, client: {hosted: () => client(id)}} : null;
  },
  status: () => holdStatus ? request('status', owner) : Promise.resolve(status),
  bind(sessionId, binding) {
    if (sessionId !== 'session-'+owner || binding.scope !== 'owner-'+owner || !binding.current())
      throw Error('Inbox callback registration requires the exact current owner');
    return () => {releases.push(sessionId);};
  },
  inbox(input) {
    const id = Number(input.scope.at(-1));
    return {history: () => request('history', id), sync(other, signal) {
      if (id !== other.fixtureId) throw Error('Digest refresh crossed an inbox scope');
      return request('sync', id, signal);
    }};
  },
};

const root = createRoot(document.getElementById('root'));
const perform = run => act(async () => {run(); await new Promise(resolve => setTimeout(resolve, 0));});
globalThis.hostedDigestRefresh = {
  mount: () => perform(() => root.render(<HostedDigestPanel />)),
  unmount: () => perform(() => root.unmount()),
  select: id => perform(() => {
    owner = id;
    selection = id ? {kind: 'resident', name: 'Fixture agent '+id,
      session: {origin: 'https://fixture.invalid', ownerId: 'owner-'+id, agentId: 'agent-'+id, sessionId: 'session-'+id}}
      : {kind: 'none', session: null};
    for (const notify of subscribers) notify();
  }),
  history: (id, row = 0, refuse = false) => perform(() => reply('history', id, row ? [payload(row)] : [], refuse)),
  sync: (id, row = 0, refuse = false) => perform(() => reply('sync', id, row ? [payload(row)] : [], refuse)),
  status: (id, backgroundEnabled = true) => perform(() => {
    holdStatus = false;
    reply('status', id, {...status, backgroundEnabled});
  }),
  open: () => perform(() => window.dispatchEvent(new Event('alpha:hosted-digests'))),
  close: () => perform(() => {
    const close = document.querySelector('[aria-label="Close scheduled digests"]');
    if (!close) throw Error('No mounted digest panel to close');
    close.click();
  }),
  poll: (held = false) => perform(() => {
    holdStatus = held;
    if (intervals.size !== 1) throw Error('Expected a single mounted digest poll');
    const [tick] = intervals.values();
    const open = !!document.querySelector('[aria-label="Close scheduled digests"]');
    for (let i = 0; i < (open ? 1 : 4); i++) tick();
  }),
  visibility: hidden => perform(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
    document.dispatchEvent(new Event('visibilitychange'));
  }),
  observe: () => ({...globalThis.inspectHostedDigestRefresh(),
    hidden: document.hidden, brief: latestRetainedDigest(), capabilities: [...capabilities], releases: [...releases],
    requests: requests.map(({kind, id, signal, done}) => ({kind, id, aborted: signal?.aborted ?? false, done}))}),
};
