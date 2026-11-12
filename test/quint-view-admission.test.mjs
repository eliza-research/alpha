// ViewAdmission traces replayed against the image Contacts admission step, the enabled and deferred
// view sets, and a shell that keeps the product shell's two rules: a deferred view is reported as no
// view, and only an enabled view opens. No Android capability read is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelTraces, replayTraces, repositoryRoot, sourceModule} from '../specs/quint/refinement/services/identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/application/ViewAdmission.qnt', module: 'ViewAdmission'};
const SCENARIOS = ['revokedWhileOpenTest', 'deferredViewCannotOpenTest', 'unrefreshedCapabilityTest', 'admittedViewOpensTest', 'revokedElsewhereTest'];
const WITNESSES = ['ContactsOpenWitness', 'RevokedWhileOpenWitness', 'RevokedAndLeftWitness'];
const {admitImageContacts, applyImageContacts, isMvpView, DEFERRED_MVP_VIEWS} = await sourceModule(
  ['apps/app/src/prototype/mvp-features.ts', 'apps/app/src/runtime/image-contacts.ts'], {
    'browser/dev-profile$': 'export const browserDevProfile=false;',
    'runtime/aosp-image$': 'export const aospImage=false;export const admittedAospViews=()=>[];',
  });
// The shell presentation rule the driver's shell repeats.
const shellSource = readFileSync(`${repositoryRoot}apps/app/src/prototype/model.js`, 'utf8');
assert.match(shellSource, /if \(DEFERRED_MVP_VIEWS\.has\(value\.view\)\) value\.view = null;/);

const project = s => ({rawView: s.rawView, reported: s.rawView === 'contacts' && !s.admitted ? 'none' : s.rawView,
  admitted: s.admitted, ordered: s.ordered, capability: s.capability, leaves: s.leaves});

function create() {
  const order = ['notes'];
  let capability = false, leaves = 0;
  admitImageContacts(false);
  const shell = {
    view: null,
    S() { return {view: DEFERRED_MVP_VIEWS.has(this.view) ? null : this.view}; },
    leave() { if (this.S().view === 'contacts') leaves = Math.min(3, leaves + 1); },
    goHome() { this.leave(); this.view = null; },
    open(view) { if (!isMvpView(view)) return; if (view !== this.view) this.leave(); this.view = view; },
  };
  return {
    navigate(view) { if (view === 'home') shell.goHome(); else shell.open(view); },
    capabilityChanges() { capability = !capability; },
    refreshImage() { applyImageContacts(capability, order, shell, admitImageContacts); },
    observe: () => ({rawView: shell.view ?? 'home', reported: shell.S().view ?? (shell.view ? 'none' : 'home'),
      admitted: isMvpView('contacts'), ordered: order.includes('contacts'), capability, leaves}),
  };
}

test('the image Contacts admission follows ViewAdmission scenarios, witnesses and random walks', {timeout: 180000}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  assert.equal(receipt.rejected, 2);
  // The comparison is live: a model that left the revoked view stored is refused.
  const stored = state => ({...project(state), rawView: state.leaves ? 'contacts' : state.rawView});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'revokedWhileOpenTest'), create, {project: stored}), /revokedWhileOpenTest step/);
  for (const action of ['navigate', 'capabilityChanges', 'refreshImage']) assert.ok(receipt.actions[action] > 0, action);
});
