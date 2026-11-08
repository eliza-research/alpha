import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {GoogleConnectionsPanel, googleConnectionController} from '../../../../apps/app/src/runtime/google-connection-ui.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const event = 'alpha:fixture-google-accounts';
const messages = new Map([
  ['', ''], ['Checking Google connections…', 'checking'],
  ['No Google account connected.', 'no-account'], ['Calendar includes the calendars you show in Google.', 'calendar-includes'],
  ['Google connections could not be verified. Check sign-in and try again.', 'unverified'],
  ['Connecting Calendar with Google…', 'connecting'], ['After authorizing Google, return here and check connections.', 'authorization'],
  ['Calendar sync is not available on this host yet, so Calendar is not synced. Calendar keeps working.', 'host-refused'],
  ...['synced', 'syncing', 'needs-grant', 'not-linked', 'unconfirmed'].map(code => ['Fixture ' + code, code]),
]);
const makeTask = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {resolve, reject, promise};
};
const inspect = () => globalThis.inspectGoogleLinkPublication();
const demand = (value, description) => {
  if (!value) throw Error(description);
};
const go = async action => act(async () => {
  action?.();
  await new Promise(resolve => setTimeout(resolve, 0));
});

let stop;
async function reset(browser) {
  await stop?.();
  globalThis.configureGoogleLinkHost(browser);
  const root = createRoot(document.getElementById('root'));
  document.getElementById('prior').focus();
  let owner = 1, accessRevision = 0, consents = 0;
  const reads = [], links = [], intents = [], hostCalls = [], helperCalls = [];
  const subscriptions = new Set(), owners = new WeakMap(), tokens = new WeakMap(), rowsOf = new WeakMap();
  const makeCloud = (id, full = true, previous) => {
    const client = {environment: 'production'};
    owners.set(client, id);
    return {client, sessionId: full ? 'session-' + id : previous.sessionId,
      credentialId: full ? 'credential-' + id : previous.credentialId};
  };
  let cloud = makeCloud(owner), snapshot = {cloudAccount: {environment: 'production', userId: 'user-1', organizationId: 'organization-1'}};
  const identity = () => googleConnectionController.calendar();
  const mapIntent = raw => intents.findIndex(row => row.raw === raw) + 1;
  const mapRead = raw => raw ? rowsOf.get(raw.rows) ?? 0 : 0;
  function click(label) {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    demand(button && !button.disabled, 'Expected actionable mounted control ' + label);
    button.click();
  }
  function startLink(phase, signal) {
    const seen = inspect(), actualSignal = seen.linking?.signal;
    demand(actualSignal && (!signal || signal === actualSignal), 'Expected exact live link controller at dispatch');
    let job = tokens.get(actualSignal);
    if (!job) {
      const read = seen.accountBusy ? reads.find(item => item.signal === seen.active?.signal) : undefined;
      job = {id: links.length + 1, intent: mapIntent(identity()), owner, read: read?.id ?? 0,
        phase, signal: actualSignal};
      links.push(job);
      tokens.set(actualSignal, job);
    }
    job.phase = phase;
    return job;
  }
  function grantRows(grant, readId) {
    const rows = grant === 'none' ? [] : [{configured: true, connected: true,
      label: 'fixture@example.invalid', connectionId: 'fixture-connection', grantedCapabilities: [
        'google.gmail.triage', 'google.calendar.read', ...(grant === 'write' ? ['google.calendar.write'] : []),
      ]}];
    rowsOf.set(rows, readId);
    return rows;
  }

  globalThis.googleLinkPorts = {
    subscribe(fn) {subscriptions.add(fn); return () => subscriptions.delete(fn);},
    getSnapshot: () => snapshot,
    getCloudClient: () => cloud,
    createAccounts(binding) {
      return {
        list(signal) {
          const task = {...makeTask(), id: reads.length + 1, owner: owners.get(binding.client), signal,
            settled: false, grant: ''};
          reads.push(task);
          return task.promise;
        },
        async connect(signal, calendar, gmail) {
          demand(!signal.aborted && calendar === 'write' && gmail === 'read', 'Expected current Calendar consent with held Gmail read');
          return 'https://example.invalid/fixture-consent';
        },
      };
    },
    openBrowser(url, signal) {
      demand(url === 'https://example.invalid/fixture-consent' && !signal.aborted, 'Expected synthetic authorization handoff');
      consents++;
      return Promise.resolve();
    },
    browserCall(operation, credential, enabled) {
      demand(operation === 'residentGoogleCalendarAccess' && credential === cloud.credentialId && enabled,
        'Expected exact current browser write admission request');
      const job = startLink('host');
      job.host = makeTask();
      hostCalls.push(job.id);
      return job.host.promise;
    },
    link(scope, rows, signal) {
      demand(scope.current() && scope.calendar === identity().calendar, 'Link helper needs the exact current intent');
      const verified = inspect().read?.rows;
      demand(verified && rows.every(row => verified.includes(row)), 'Link helper receives the actual verified account rows');
      const job = startLink('helper', signal);
      job.helper = makeTask();
      helperCalls.push(job.id);
      return job.helper.promise;
    },
    async captureAccess() {return {calendarEdits: true, receipt: {revision: accessRevision}};},
    async saveAccess(change, guard) {
      demand(change.calendarEdits && guard.current() && guard.expectedCalendarEdits && guard.receipt.revision === accessRevision,
        'Current fixture permission receipt authorizes the exact requested edit flag');
      accessRevision++;
      window.dispatchEvent(new Event('alpha:device-settings'));
    },
  };

  const operations = {
    open() {
      const scope = {current: true, calendar: {}};
      googleConnectionController.openCalendar({calendar: scope.calendar, current: () => scope.current, canChange: () => true});
      intents.push({raw: identity(), scope});
    },
    close() {click('Close Google accounts');},
    replaceOwner(mode = 'all') {
      const full = mode === 'all';
      cloud = makeCloud(++owner, full, cloud);
      snapshot = {cloudAccount: {...snapshot.cloudAccount, ...(full ? {userId: 'user-' + owner} : {})}};
      for (const fn of subscriptions) fn();
    },
    reload() {window.dispatchEvent(new Event(event));},
    setScope(current) {intents[mapIntent(identity()) - 1].scope.current = current;},
    sync() {click('Sync Calendar with Google');},
    authorize() {click('Connect Google Calendar');},
    readReply(id, grant) {
      const job = reads[id - 1];
      demand(job && !job.settled, 'Expected held real account read');
      job.settled = true;
      job.grant = grant;
      if (grant === 'failed') job.reject(Error('Fixture account read failed'));
      else job.resolve(grantRows(grant, id));
    },
    hostReply(id, allowed) {
      const job = links[id - 1];
      demand(job?.phase === 'host', 'Expected held real host permission call');
      job.host.resolve(allowed ? {calendarEdits: true} : {calendarEdits: false});
      return () => {if (job.phase === 'host') job.phase = 'done';};
    },
    linkReply(id, outcome, revision) {
      const job = links[id - 1];
      demand(job?.phase === 'helper', 'Expected held real Calendar link helper call');
      const review = revision ? {binding: 'fixture-binding-' + id, control: {revision}, sources: [], visibleLocalEventIds: []} : undefined;
      job.helper.resolve({outcome, message: 'Fixture ' + outcome, review});
      job.phase = 'done';
    },
  };

  function observe() {
    const seen = inspect(), intent = mapIntent(identity()), active = tokens.get(seen.linking?.signal);
    const activeRead = seen.accountBusy ? reads.find(item => item.signal === seen.active?.signal) : undefined;
    demand(!seen.accountBusy || activeRead, 'Busy account state belongs to the observed actual account read');
    demand(seen.linkBusy === !!active, 'Busy link state belongs to the observed actual link controller');
    const actualGrant = seen.accounts.some(row => row.grantedCapabilities.includes('google.calendar.write')) ? 'write' :
      seen.accounts.some(row => row.grantedCapabilities.includes('google.calendar.read')) ? 'read' : 'none';
    const notice = messages.get(seen.notice);
    demand(notice !== undefined, 'Unexpected panel notice ' + seen.notice);
    const status = document.querySelector('[role="status"]');
    demand(intent ? status?.textContent === seen.notice : !status, 'The mounted panel publishes exactly its current notice');
    if (intent) demand(document.querySelector('[aria-label="Close Google accounts"]'), 'Current modal is mounted');
    return {'s.browser': browser, 's.owner': owner, 's.intent': intent, 's.lastIntent': intents.length,
      's.intents': intents.map(({raw, scope}, i) => [i + 1, {current: scope.current, authorizing: raw.authorizing, review: raw.review?.control.revision ?? 0}]),
      's.lastRead': reads.length, 's.reads': reads.map(job => [job.id, {owner: job.owner, settled: job.settled, grant: job.grant}]),
      's.accountActive': activeRead?.id ?? 0, 's.verifiedRead': mapRead(seen.verified), 's.grant': actualGrant,
      's.lastLink': links.length, 's.links': links.map(job => [job.id, {intent: job.intent, owner: job.owner,
        read: job.read, phase: job.phase, aborted: job.signal.aborted}]),
      's.linkActive': active?.id ?? 0, 's.hostCalls': hostCalls, 's.helperCalls': helperCalls,
      's.consents': consents, 's.notice': notice, busy: seen.busy, verified: mapRead(seen.read),
      panelInert: document.querySelector('.os').inert};
  }

  stop = async () => {
    await go(() => googleConnectionController.close());
    await go(() => root.unmount());
    demand(!document.querySelector('.os').inert, 'Retired modal releases its real inert hold');
    demand(document.activeElement.id === 'prior', 'Retired modal restores the prior focus');
  };
  await go(() => root.render(<GoogleConnectionsPanel/>));
  return {observe, step: async (operation, args) => {
    let after;
    await go(() => {after = operations[operation](...args);});
    after?.();
    return observe();
  }};
}

globalThis.googleCalendarLinkPublication = {
  async reset(browser) {
    this.fixture = await reset(browser);
    return this.fixture.observe();
  },
  step(operation, args) {return this.fixture.step(operation, args);},
  close: async () => {await stop?.(); stop = undefined;},
};
