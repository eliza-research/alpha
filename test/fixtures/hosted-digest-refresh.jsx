import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {HostedDigestPanel} from '../../apps/app/src/runtime/hosted-digest-ui.tsx';
import {HostedSourceRejected, latestRetainedDigest} from '../../apps/app/src/runtime/hosted-digests.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const subscribers = new Set(), intervals = new Map(), requests = [], capabilities = [], releases = [], visited = [];
const stored = new Map(), writes = [], mutations = [];
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

function request(kind, id, signal, full = false) {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  requests.push({kind, id, signal, full, resolve, reject, done: false});
  return promise;
}

function reply(kind, id, value, refuse = false) {
  const pending = requests.find(row => row.kind === kind && row.id === id && !row.done);
  if (!pending) throw Error('No pending '+kind+' for fixture owner '+id);
  pending.done = true;
  if (refuse) pending.reject(refuse instanceof Error ? refuse : Error('Synthetic fixture refusal'));
  else pending.resolve(value);
}

const status = {enabled: true, backgroundEnabled: true};
const date = '2027-01-01T12:00:00.000Z';
const payload = id => ({cursor: id, runId: 'run-'+id, workflowId: 'fixture-workflow', workflowVersionId: 'fixture-version',
  templateVersion: 'fixture-template', scheduledAt: date, source: {observedAt: date, expiresAt: date},
  status: 'completed', startedAt: date, completedAt: date, output: 'fixture-result-'+id, error: null});
const slot = id => 'hosted-digests:v1:owner-'+id+':pending';
const storageOwner = key => {
  const id = [1, 2].find(owner => slot(owner) === key);
  if (!id) throw Error('Digest storage requires a fixture owner slot');
  return id;
};
const pendingValue = (id, phase) => ({path: 'sources', body: {id: 'fixture-mutation-'+id},
  summary: 'Fixture saved request '+id, ...(phase ? {phase} : {})});

const client = id => ({
  fixtureId: id,
  async capabilities(signal) {signal.throwIfAborted(); capabilities.push(id); return {digests: true};},
  async sources() {return [];},
  async loops() {return [];},
  mutate(path, body, signal) {
    signal.throwIfAborted();
    if (path !== 'sources' || body.id !== 'fixture-mutation-'+id) throw Error('Mutation must match the exact reviewed fixture tuple');
    mutations.push(id);
    return request('mutation', id, signal);
  },
});

globalThis.hostedDigestRefreshPorts = {
  subscribe(fn) {subscribers.add(fn); return () => subscribers.delete(fn);},
  snapshot: () => selection,
  workflow() {
    const id = owner;
    return id ? {sessionId: 'session-'+id, client: {hosted: () => client(id)}} : null;
  },
  status: () => holdStatus ? request('status', owner, undefined, globalThis.inspectHostedDigestRefresh().open) : Promise.resolve(status),
  async read(key) {return structuredClone(stored.get(storageOwner(key)) ?? null);},
  async write(key, value) {
    const id = storageOwner(key);
    if (value.body?.id !== 'fixture-mutation-'+id) throw Error('Journal write must match its owner');
    writes.push([id, value.phase]);
    stored.set(id, structuredClone(value));
  },
  async remove(key) {
    const id = storageOwner(key);
    await request('remove', id);
    stored.delete(id);
  },
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
function press(label) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
  if (!button || button.disabled) throw Error('Missing available action '+label);
  button.click();
}
globalThis.hostedDigestRefresh = {
  mount: () => perform(() => root.render(<HostedDigestPanel />)),
  unmount: () => perform(() => root.unmount()),
  select: id => perform(() => {
    if (id) visited.push(id);
    owner = id;
    selection = id ? {kind: 'resident', name: 'Fixture agent '+id,
      session: {origin: 'https://fixture.invalid', ownerId: 'owner-'+id, agentId: 'agent-'+id, sessionId: 'session-'+id}}
      : {kind: 'none', session: null};
    for (const notify of subscribers) notify();
  }),
  history: (id, row = 0, refuse = false) => perform(() => reply('history', id, row ? [payload(row)] : [], refuse)),
  sync: (id, row = 0, refuse = false) => perform(() => reply('sync', id, row ? [payload(row)] : [], refuse)),
  seed: (id, phase = 'dispatched') => perform(() => {stored.set(id, pendingValue(id, phase));}),
  retry: () => perform(() => press('Retry exact saved request')),
  discard: () => perform(() => press('Discard this request')),
  mutate: (id, outcome = 'ok') => perform(() => reply('mutation', id, {}, outcome === 'rejected' ? new HostedSourceRejected() : outcome === 'refused')),
  remove: (id, refuse = false) => perform(() => reply('remove', id, undefined, refuse)),
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
    hidden: document.hidden, brief: latestRetainedDigest(), capabilities: [...capabilities], releases: [...releases], visited: [...visited],
    stored: [...stored].map(([id, row]) => [id, structuredClone(row)]), writes: [...writes], mutations: [...mutations],
    requests: requests.map(({kind, id, signal, full, done}) => ({kind, id, aborted: signal?.aborted ?? false, full, done}))}),
};
