import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deferred, root, sourceContext, tick} from '../../specs/quint/refinement/application/support.mjs';

const source = 'apps/app/src/prototype/browser-external-handoff.ts';
const tabHostSource = 'plugins/plugin-native-browser-surface/src/tab-host.ts';
const tabHost = `vendor/eliza/${tabHostSource}`;
const preparedTabHost = resolve(root, '.eliza/client-features', tabHostSource);
export const browserExternalHandoffSources = [
  source, tabHost, 'upstream.lock.json', fileURLToPath(import.meta.url),
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
  if (existsSync(preparedTabHost)) {
    assert.ok(readFileSync(preparedTabHost).equals(readFileSync(resolve(root, tabHost))),
      'The replayed shared tab host must match the prepared renderer source');
  }
  const document = {hidden: false};
  const {createExternalBrowserHandoff, BrowserTabSession} = sourceContext(
    [source, tabHost], ['createExternalBrowserHandoff', 'BrowserTabSession'], {document});
  const tabs = new BrowserTabSession({session: 'fixture-session'});
  const state = {cur: 'primary', menu: true};
  const flags = {sharing: false, confirming: false, lastGeometry: 'previous', disposed: false};
  const view = {view: 'browser'};
  const shell = {S: () => view, vset(name, patch) {assert.equal(name, 'browser'); Object.assign(state, patch);}};
  const launches = [], errors = [];
  let gate, captured, guarded, requestError, updates = 0, reviews = 0, requests = 0, approved = false;
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
  const open = createExternalBrowserHandoff({
    tabs: {
      pageBinding(id, options) {
        captured = tabs.pageBinding(id, options);
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
        exact: !flags.disposed && !document.hidden && view.view === 'browser' && tabs.current(guarded, state.cur)});
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
      void open().catch(error => {requestError = error;});
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
    hide(hidden) {document.hidden = hidden;},
    leave(left) {view.view = left ? 'home' : 'browser';},
    dispose() {flags.disposed = true; tabs.dispose();},
    navigate(settled) {
      tabs.beginNavigation('primary', addresses.primary);
      if (settled) annotate('primary');
    },
    observe() {
      return {privateTab, https, hidden: document.hidden, left: view.view !== 'browser', disposed: flags.disposed,
        selected: state.cur, revision: tabs.revision('primary'), settled: !!tabs.pageBinding('primary'),
        sharing: flags.sharing, confirming: flags.confirming, phase: gate?.phase ?? 'idle',
        menu: state.menu, clearedGeometry: flags.lastGeometry === '', updates, reviews, requests, approved,
        boundTab: captured?.id ?? '', boundRevision: captured?.revision ?? 0, boundPrivate: captured?.private ?? false,
        launches: structuredClone(launches), errors: [...errors]};
    },
  };
}
