import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deferred, root, sourceContext, tick} from '../../specs/quint/refinement/application/support.mjs';

const source = 'apps/app/src/prototype/browser-external-handoff.ts';
const tabHostSource = 'plugins/plugin-native-browser-surface/src/tab-host.ts';
const tabHost = `vendor/eliza/${tabHostSource}`;
const projection = '.eliza/client-features';
const preparedTabHost = projection + '/' + tabHostSource;
const stampPath = projection + '/.source.json';
const exists = path => existsSync(resolve(root, path));
const read = path => readFileSync(resolve(root, path));
export const browserExternalHandoffSources = [
  source, 'apps/app/src/prototype/browser-adapter.ts', ...(exists(tabHost) ? [tabHost] : []), ...(exists(preparedTabHost) ? [preparedTabHost, stampPath] : []),
  'upstream.lock.json', fileURLToPath(import.meta.url),
  'test/support/strip-types.mjs', 'specs/quint/refinement/application/support.mjs',
];
const addresses = {
  primary: 'https://handoff.invalid/primary',
  other: 'https://handoff.invalid/other',
};
const navigation = {primary: '7', other: '9'};
const refusals = new Map([
  ['Load an HTTPS page before opening another browser.', 'no-page'],
  ['The page changed. Review it again before leaving Alpha.', 'changed'],
  ['Synthetic chooser refused.', 'refused'],
]);

export async function browserExternalHandoffFixture({privateTab = false, https = true} = {}) {
  if (exists(preparedTabHost)) {
    const stamp = JSON.parse(read(stampPath));
    const hash = createHash('sha256').update(read(preparedTabHost)).digest('hex');
    assert.equal(stamp.baseCommit, JSON.parse(read('upstream.lock.json')).commit);
    assert.equal(hash, stamp.sourceFiles[tabHostSource], 'The replay uses the authenticated shared tab host');
    assert.equal(hash, stamp.files[tabHostSource], 'The replay uses the exact prepared renderer file');
    if (exists(tabHost)) assert.ok(read(preparedTabHost).equals(read(tabHost)));
  }
  const document = {hidden: false};
  const {createExternalBrowserHandoff, BrowserTabSession} = sourceContext(
    [source, exists(preparedTabHost) ? preparedTabHost : tabHost], ['createExternalBrowserHandoff', 'BrowserTabSession'], {document});
  const tabs = new BrowserTabSession({session: 'fixture-session'});
  const state = {cur: 'primary', menu: true};
  const flags = {sharing: false, confirming: false, lastGeometry: 'previous', disposed: false};
  const view = {view: 'browser', screen: 'home'};
  const shell = {S: () => view, vset(name, patch) {assert.equal(name, 'browser'); Object.assign(state, patch);}};
  const launches = [], errors = [];
  let gate, captured, guarded, requestError, updates = 0, reviews = 0, requests = 0, approved = false;
  let visit = 0, boundVisit = 0;
  const retire = () => {visit++; handoff.retire();};
  const hold = phase => {
    assert.equal(gate, undefined, 'The selected schedules use one outstanding port');
    gate = {phase, ...deferred()};
    return gate.promise;
  };
  const annotate = (id, url = addresses[id]) => {
    tabs.annotate(id, {committed: true, loading: false, error: '', navigation: navigation[id], url});
  };
  await tabs.ensure('primary', privateTab, async () => ({}));
  await tabs.ensure('other', false, async () => ({}));
  annotate('primary', https ? addresses.primary : 'http://handoff.invalid/primary');
  annotate('other');
  const handoff = createExternalBrowserHandoff({
    tabs: {
      pageBinding(id, options) {
        captured = tabs.pageBinding(id, options);
        boundVisit = captured ? visit : 0;
        if (captured) approved = false;
        return captured;
      },
      current: (page, selected) => tabs.current(page, selected),
      guard(page) {guarded = page; return tabs.guard(page);},
    },
    reviews: {confirm(id, title, details, label) {
      const page = tabs.pageBinding(state.cur);
      assert.equal(id, 'external-browser');
      assert.equal(title, 'Leave private browsing?');
      assert.equal(label, 'Choose browser');
      assert.ok(details.includes(addresses.primary));
      assert.ok(!page || page.private || state.cur === 'other');
      assert.equal(flags.confirming, true);
      reviews++;
      return hold('review');
    }},
    shell: () => shell,
    Browser: {openExternalBrowser(input) {
      assert.deepEqual({...input}, {session: 'fixture-session', id: guarded.id, url: addresses[guarded.id],
        navigation: navigation[guarded.id], privateConfirmed: guarded.private});
      launches.push({tab: guarded.id, revision: guarded.revision, privateConfirmed: input.privateConfirmed, approved,
        exact: boundVisit === visit && !flags.disposed && !document.hidden &&
          view.screen === 'home' && view.view === 'browser' && tabs.current(guarded, state.cur)});
      return hold('dispatch');
    }},
    state: () => state, isPrivate: id => tabs.isPrivate(id),
    update() {
      assert.equal(flags.lastGeometry, '');
      updates++;
      return hold(flags.confirming ? 'prepareReview' : flags.sharing ? 'present' : 'cleanup');
    },
    report(error) {
      const reason = refusals.get(error.message);
      assert.ok(reason, error.message);
      errors.push(reason);
    },
    flags,
  });
  async function release(phase, value, reject = false) {
    assert.equal(gate?.phase, phase);
    const pending = gate;
    gate = undefined;
    if (reject) pending.reject(value);
    else pending.resolve(value);
    await tick();
    assert.ifError(requestError);
  }

  return {
    async start() {
      requests++;
      void handoff.open().catch(error => {requestError = error;});
      await tick();
      assert.ifError(requestError);
    },
    update() {
      assert.ok(['prepareReview', 'present', 'cleanup'].includes(gate?.phase));
      return release(gate.phase);
    },
    review(value) {approved = value; return release('review', value);},
    complete(accepted) {return release('dispatch', accepted ? undefined : Error('Synthetic chooser refused.'), !accepted);},
    selectTab(tab) {state.cur = tab;},
    hide(hidden) {
      if (hidden && !document.hidden) retire();
      document.hidden = hidden;
    },
    leave(left) {
      if (left && view.view === 'browser') retire();
      view.view = left ? 'home' : 'browser';
    },
    lock(locked) {view.screen = locked ? 'lock' : 'home';},
    dispose() {flags.disposed = true; tabs.dispose();},
    navigate(settled) {
      tabs.beginNavigation('primary', addresses.primary);
      if (settled) annotate('primary');
    },
    observe() {
      return {privateTab, https, hidden: document.hidden, left: view.view !== 'browser', disposed: flags.disposed,
        locked: view.screen === 'lock', visit, boundVisit,
        selected: state.cur, revision: tabs.revision('primary'), settled: !!tabs.pageBinding('primary'),
        sharing: flags.sharing, confirming: flags.confirming, phase: gate?.phase ?? 'idle',
        menu: state.menu, clearedGeometry: flags.lastGeometry === '', updates, reviews, requests, approved,
        boundTab: captured?.id ?? '', boundRevision: captured?.revision ?? 0, boundPrivate: captured?.private ?? false,
        launches: structuredClone(launches), errors: [...errors]};
    },
  };
}
