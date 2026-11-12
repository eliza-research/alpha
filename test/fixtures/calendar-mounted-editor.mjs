import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {scaledTimeout} from '../../specs/quint/refinement/timeouts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = resolve(root, 'apps/app/src/main.tsx');
const adapter = resolve(root, 'apps/app/src/prototype/agent-calendar-adapter.ts');
const cameraAdapter = resolve(root, 'apps/app/src/prototype/camera-adapter.ts');
export const mountedCalendarFixtureSources = [fileURLToPath(import.meta.url), main, adapter, resolve(root, 'vite.config.ts'),
  resolve(root, 'bun.lock'), resolve(root, 'specs/quint/refinement/timeouts.mjs')];

async function installCalendar({legacyTitle, eventTitles, notes}) {
  const {connectionController} = await import('/src/runtime/connection-ui.tsx');
  const {browserDocuments} = await import('/src/browser/documents.ts');
  const {calendarDocument, initialCalendarState} = await import('/src/browser/calendar-store.ts');
  const {legacyCalendarPreservation} = await import('/src/runtime/legacy-calendar-preservation.ts');
  const {calendarOwnerKey} = await import('/src/runtime/agent-calendar.ts');
  const {assistantDraftStore} = await import('/src/runtime/assistant-draft-store.ts');
  const {decodeCanonicalCalendarDraft} = await import('/src/runtime/canonical-calendar-draft.ts');
  const shell = window.quintMountedCalendar;
  const calendar = shell.agentCalendar;
  const capture = calendarDocument.capture.bind(calendarDocument);
  const read = browserDocuments.read.bind(browserDocuments);
  const exchange = browserDocuments.compareExchange.bind(browserDocuments);
  const confirm = calendar.confirmLegacyRetention.bind(calendar);
  const refresh = calendar.refresh.bind(calendar);
  const toast = shell.toast.bind(shell);
  const notices = [], attempts = [], writes = [], requests = [], refreshes = [], publications = [];
  const queued = new Map(), gates = new Map(), captures = new Map(), markers = new Map();
  const ownerKeys = new Map(), ownerSlots = new Map();
  const prefix = 'alpha.calendar.retention.v1.';
  let invoking, activePort, draftScope, draftAdmission, generation = 0, gateId = 0, hidden = false;
  const consume = shell.canonicalDraft.consume.bind(shell.canonicalDraft);
  shell.canonicalDraft.consume = (text, ...args) => {
    const admission = {text};
    draftAdmission = admission;
    const pending = consume(text, ...args);
    const release = () => {if (draftAdmission === admission) draftAdmission = undefined;};
    void pending.then(release, release);
    return pending;
  };

  function hold(stage, error = '') {
    const gate = {id: ++gateId, stage, error};
    const waiting = queued.get(stage) ?? [];
    queued.set(stage, [...waiting, gate]);
    gates.set(gate.id, gate);
    return gate.id;
  }
  function block(stage, attempt) {
    const gate = queued.get(stage)?.shift();
    if (!gate) return;
    return new Promise((resolve, reject) => {
      gate.attempt = attempt?.id ?? 0;
      gate.release = () => {
        gate.release = undefined;
        if (gate.error) reject(Error(gate.error));
        else resolve();
      };
    });
  }
  calendar.confirmLegacyRetention = (...args) => {
    const attempt = {id: attempts.length + 1, session: activePort.sessionId,
      owner: activePort.identity.ownerId, ownerKey: calendarOwnerKey(activePort), review: calendar.state.legacy?.fingerprint,
      stage: 'capture', result: '', expected: 0};
    attempts.push(attempt);
    invoking = attempt;
    try {
      const pending = confirm(...args);
      void pending.then(() => {attempt.result = 'success';}, error => {
        attempt.result = error?.name === 'AbortError' ? 'aborted' : 'rejected';
      });
      return pending;
    } finally {
      invoking = undefined;
    }
  };
  calendarDocument.capture = async signal => {
    if (invoking) {
      invoking.signal = signal;
      captures.set(signal, invoking);
      const gate = block('capture', invoking);
      if (gate) await gate;
    }
    return capture(signal);
  };
  browserDocuments.read = async (key, signal) => {
    if (key === ownerSlots.get(activePort?.identity.ownerId) && shell.canonicalDraft?.state.opening) {
      const gate = block('draft-open');
      if (gate) await gate;
    }
    const attempt = key.startsWith(prefix) ? captures.get(signal) : undefined;
    const stage = attempt && ['capture', 'validated'].includes(attempt.stage) ? 'marker-read' : 'marker-readback';
    if (attempt) {
      attempt.stage = stage;
      const gate = block(stage, attempt);
      if (gate) await gate;
    }
    const result = await read(key, signal);
    if (attempt && stage === 'marker-read') {
      attempt.stage = 'marker-ready';
      attempt.expected = writes.find(write => write.revision === result?.revision && write.committed)?.attempt ?? 0;
    }
    return result;
  };
  browserDocuments.compareExchange = async (key, expected, raw, signal) => {
    if (!key.startsWith(prefix)) {
      if (key.startsWith('alpha.browser.assistant-draft:v1:') && shell.canonicalDraft?.state.consuming) {
        const gate = block('draft-clear');
        if (gate) await gate;
      }
      return exchange(key, expected, raw, signal);
    }
    const attempt = captures.get(signal ?? shell.quintCalendarRetentionSignal?.());
    if (attempt) attempt.stage = 'marker-dispatch';
    const operation = {key, value: JSON.parse(raw), committed: false, attempt: attempt?.id ?? 0};
    writes.push(operation);
    const dispatch = block('marker-dispatch', attempt);
    if (dispatch) await dispatch;
    const result = await exchange(key, expected, raw, signal);
    markers.set(key, {value: JSON.parse(result.raw), receipt: operation.attempt});
    operation.revision = result.revision;
    operation.committed = true;
    const gate = block('committed-marker', attempt);
    if (gate) await gate;
    return result;
  };
  calendar.refresh = (...args) => {
    refreshes.push(activePort?.sessionId ?? '');
    return refresh(...args);
  };
  shell.toast = (message, ...args) => {
    notices.push(message);
    return toast(message, ...args);
  };
  const seed = title => calendarDocument.edit(initialCalendarState, data => {
    data.events = [{id: 'legacy-event', calendarId: 'local', title, begin: 1000, end: 2000, repeat: 'none'}];
  });
  const switchPort = async (ownerId, sessionId) => {
    const id = ++generation;
    const identity = {ownerId, agentId: 'calendar-fixture-agent', sessionId, origin: location.origin};
    const today = new Date();
    const events = eventTitles.map((title, i) => ({id: 'fixture-event-' + i, externalId: 'fixture-external-' + i,
      agentId: identity.agentId, provider: 'eliza', side: 'owner', grantId: 'eliza-calendar', connectorAccountId: 'fixture-account',
      calendarId: 'primary', title, description: '', location: '', status: 'confirmed',
      startAt: new Date(today.setHours(12 + i, 0, 0, 0)).toISOString(), endAt: new Date(today.setMinutes(30)).toISOString(),
      isAllDay: false, timezone: 'UTC', htmlLink: null, conferenceLink: null, organizer: null, attendees: [],
      metadata: {etag: 'fixture-event-v1-' + i}, syncedAt: new Date().toISOString(), updatedAt: new Date().toISOString()}));
    activePort = {
      identity, sessionId, current: () => generation === id,
      async request(path, method, _body, signal) {
        signal.throwIfAborted();
        requests.push({ownerId, sessionId, path, method});
        if (method !== 'GET') throw Error('The mounted Calendar fixture forbids record writes');
        const url = new URL(path, location.origin), now = new Date().toISOString();
        if (url.pathname === '/api/notes/state') return {success: true, data: {notes: structuredClone(notes), trash: [], revision: notes.length ? 1 : 0}};
        if (url.pathname === '/api/lifeops/calendar/calendars') return {calendars: [{provider: 'eliza', side: 'owner',
          grantId: 'eliza-calendar', connectorAccountId: 'fixture-account', accountEmail: null, calendarId: 'primary',
          summary: 'Fixture Calendar', description: null, primary: true, accessRole: 'owner', backgroundColor: null,
          foregroundColor: null, timeZone: 'UTC', selected: true, includeInFeed: true, selectionVersion: 0}]};
        if (url.pathname === '/api/lifeops/calendar/feed') return {calendarId: 'primary', events: structuredClone(events), source: 'cache',
          state: 'complete', sources: [], timeMin: url.searchParams.get('timeMin'), timeMax: url.searchParams.get('timeMax'), syncedAt: now};
        if (url.pathname === '/api/lifeops/calendar/next-context') return {event: null,
          readScope: {selection: 'next_event', timeMin: now, timeMax: new Date(Date.now() + 86400000).toISOString(), exhaustive: false},
          calendarFeedState: 'complete', calendarSources: [], startsAt: null, startsInMinutes: null, attendeeCount: 0,
          attendeeNames: [], location: null, conferenceLink: null, preparationChecklist: [], linkedMailState: 'unavailable',
          linkedMailError: null, linkedMail: []};
        throw Error('Unexpected mounted Calendar request ' + url.pathname);
      },
    };
    const ownerKey = calendarOwnerKey(activePort);
    ownerKeys.set(ownerId, ownerKey);
    const binding = JSON.stringify(['canonical-calendar-editor', ownerKey]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(binding));
    const slot = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    ownerSlots.set(ownerId, 'alpha.browser.assistant-draft:v1:' + slot);
    await connectionController.offline();
  };
  connectionController.getAppRecordClient = () => activePort ?? null;
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
  if (legacyTitle) await seed(legacyTitle);
  await switchPort('owner-a', 'session-a');

  const inventory = legacyCalendarPreservation({has: async () => false, retain: async () => {throw Error('Observation is read-only');}});
  window.quintCalendar = {
    hold, seed, switchPort,
    async inventory() {return (await inventory.capture(new AbortController().signal)).fingerprint;},
    validated(signal) {captures.get(signal).stage = 'validated';},
    published(signal) {publications.push(captures.get(signal).id);},
    held: id => !!gates.get(id)?.release,
    release: id => gates.get(id)?.release?.(),
    raw: () => calendarDocument.readRaw(),
    refresh: () => window.dispatchEvent(new CustomEvent('alpha:canonical-calendar-invalidated', {detail: {sessionId: activePort.sessionId}})),
    visibility(value) {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    scope: () => !!shell.calendarConnectionScope()?.canChange(),
    bindDraftScope: () => {draftScope = shell.calendarConnectionScope();},
    observeDraftScope: () => !!draftScope?.current() && draftScope.canChange(),
    async saved(ownerId) {
      const store = await assistantDraftStore(JSON.stringify(['canonical-calendar-editor', ownerKeys.get(ownerId)]));
      return (await store.read())?.text ?? '';
    },
    snapshot() {
      const state = shell.vget('calendar');
      const form = state.form;
      const retained = shell.canonicalDraftText;
      const summarize = form => form?.canonicalOwnerKey ? {owner: form.canonicalOwnerKey, id: form.creationId,
        target: form.canonicalEventKey ?? null, title: form.title, picker: form.pq !== null && form.pq !== undefined} : null;
      return {
        owner: activePort.identity.ownerId, session: activePort.sessionId, view: shell.S().view || 'home',
        settingsPage: shell.vget('settings').page, hidden, status: calendar.state.status, refreshing: calendar.refreshing,
        fingerprint: calendar.state.legacy?.fingerprint ?? '', attempts: attempts.map(({signal, ...attempt}) => ({
          ...attempt, aborted: !!signal?.aborted,
        })), active: shell.quintCalendarRetentionSignal?.() ? captures.get(shell.quintCalendarRetentionSignal())?.id ?? 0 : 0,
        writes: writes.slice(), markers: [...markers.entries()], notices: notices.slice(), refreshes: refreshes.slice(),
        publications: publications.slice(),
        requests: requests.slice(), form: summarize(form), reminderTitle: form?.cal === 'alpha-reminders' ? form.title : '', retainedForm: retained ? summarize(decodeCanonicalCalendarDraft(retained).form) : null,
        detail: state.open ?? null, month: state.month, feed: (calendar.state.feed?.events ?? []).map(row => row.title),
        discarding: shell.canonicalDraft.state.consuming && draftAdmission?.text ? summarize(decodeCanonicalCalendarDraft(draftAdmission.text).form) : null,
        retained, invalid: !!shell.canonicalDraftInvalid, draft: shell.canonicalDraft.state,
      };
    },
  };
}

/** Run the actual renderer with a closed record port and the actual IndexedDB document store. */
export async function startMountedCalendar({onSource = () => {}, observeCamera = false} = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'alpha-quint-calendar-'));
  const previous = {mocks: process.env.ELIZA_DEV_ALLOW_TEST_MOCKS, profile: process.env.ALPHA_BROWSER_CLOUD_PROFILE};
  let server, browser;
  const close = async () => {
    await browser?.close();
    await server?.close();
    rmSync(profile, {force: true, recursive: true});
  };
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '1';
    process.env.ALPHA_BROWSER_CLOUD_PROFILE = profile;
    for (const path of mountedCalendarFixtureSources) onSource(path);
    server = await createServer({
      // Bun cannot reliably re-import Vite's generated temporary config modules in one process.
      configFile: resolve(root, 'vite.config.ts'), configLoader: 'runner', cacheDir: join(profile, 'vite'), logLevel: 'error',
      server: {host: '127.0.0.1', port: 0},
      plugins: [{name: 'quint-calendar-observer', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root) && !path.includes('/node_modules/') && existsSync(path)) onSource(path);
        if (path === main) {
          const anchor = 'shell = value;';
          assert.ok(code.includes(anchor), 'The mounted Calendar shell ref must remain observable');
          return code.replace(anchor, anchor + ' window.quintMountedCalendar = value;');
        }
        if (observeCamera && path === cameraAdapter) {
          const anchor = '  function hideAccess(){';
          assert.ok(code.includes(anchor), 'The mounted camera session must remain observable');
          return code.replace(anchor, 'window.quintMountedCamera=()=>({phase:session.phase,released:previewReleased,token:session.token(),lens:direction,flash,zoom:zoomRatio,chat:chatCovers(),capture:session.recording?"recording":session.capturing?"photo":"idle"});\n' + anchor);
        }
        if (path === adapter && code.includes('let retentionAttempt:')) {
          const anchors = ['this.agentCalendar=controller;', 'retain:async(ownerKey,fingerprint,signal,current)=>{',
            'if(current()){retentionAttempt=undefined;refresh(true);}'];
          for (const anchor of anchors) assert.ok(code.includes(anchor), 'The mounted retention action must remain observable');
          return code.replace(anchors[0], anchors[0] + 'this.quintCalendarRetentionSignal=()=>retentionAttempt?.abort.signal;')
            .replace(anchors[1], anchors[1] + 'window.quintCalendar?.validated(signal);')
            .replace(anchors[2], 'if(current()){window.quintCalendar?.published(abort.signal);retentionAttempt=undefined;refresh(true);}');
        }
      }}],
    });
    await server.listen();
    browser = await chromium.launch();
  } catch (error) {
    await close();
    throw error;
  } finally {
    for (const [key, previousValue] of [['ELIZA_DEV_ALLOW_TEST_MOCKS', previous.mocks],
      ['ALPHA_BROWSER_CLOUD_PROFILE', previous.profile]]) {
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    }
  }
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  return {close, async page({legacyTitle = '', eventTitles = [], notes = []} = {}) {
    const page = await browser.newPage({viewport: {width: 412, height: 915}});
    page.setDefaultTimeout(scaledTimeout(60_000));
    const errors = [], foreign = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => {
      foreign.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})));
    await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: scaledTimeout(120_000)});
    const button = name => page.getByRole('button', {name, exact: true});
    await button('Calendar').waitFor();
    await page.evaluate(installCalendar, {legacyTitle, eventTitles, notes});
    const status = async (value, session) => page.waitForFunction(({value, session}) => {
      const s = window.quintCalendar.snapshot();
      return s.status === value && (!session || s.session === session) && !s.draft.opening;
    }, {value, session});
    await status(legacyTitle ? 'transition-required' : 'ready');
    const invoke = (method, ...args) => page.evaluate(({method, args}) => window.quintCalendar[method](...args), {method, args});
    return {page, button, status, invoke, snapshot: () => invoke('snapshot'), async settings() {
      await button('Settings').click();
      await button('Apps').click();
      await button('Calendar').click();
    }, async close() {
      try {
        assert.deepEqual(errors, [], 'The real renderer reported an exception');
        assert.deepEqual(foreign, [], 'The synthetic fixture must not contact external services');
        assert.ok((await invoke('snapshot')).requests.every(request => request.method === 'GET'));
      } finally {
        await page.close();
      }
    }};
  }};
}
