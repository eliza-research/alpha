// Observation labels are derived from real product state after each controlled schedule.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { captureInputs, checkTraces } from "../check-traces.mjs";
import { createInboxFixture, inboxDriverSources, rebuildInboxDriver } from "./inbox-coordinator-ports.mjs";
const action = (name, ...args) => ({ name, args });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
};
async function until(ready, label) {
  const deadline = Date.now() + 10000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise((done) => setTimeout(done, 0));
  }
}
const bodyClass = (value) => !value ? 0 : value === "original" ? 1 : 2;
const attachmentClass = (files) => !files?.length ? 0 : files.some((file) => file.dataBase64 === "Yg==") ? 2 : 1;
function recordFor(fixture, owner) {
  const user = fixture.controller.getSnapshot().cloudAccount?.userId;
  return [...fixture.slots.values()].find((value) => value?.requestId && value.grantId === `grant-${owner}` && JSON.parse(value.owner)[1] === user) ?? null;
}
function observe(fixture, coordinator, owner = 1) {
  const user = fixture.controller.getSnapshot().cloudAccount?.userId;
  const current = coordinator.drafts.email(), saved = [...fixture.slots.values()].find((value) => value?.version === 1 && value.id && value.owner && JSON.parse(value.owner)[1] === user && JSON.parse(value.owner)[3] === `grant-${owner}`);
  const retained = [...fixture.slots.values()].find((value) => value?.binding && value.text && JSON.parse(JSON.parse(value.binding)[2])[1] === user && JSON.parse(JSON.parse(value.binding)[2])[3] === `grant-${owner}`);
  const kept = retained ? fixture.modules.readInboxUnsaved(retained.text, JSON.parse(retained.binding)[2]) : null;
  const shelf = [...fixture.slots.values()].find((value) => value?.items && value.owner && JSON.parse(value.owner)[1] === user && JSON.parse(value.owner)[3] === `grant-${owner}`);
  const record = recordFor(fixture, owner), view = coordinator.provider.render().provider;
  return {
    phase: record?.phase ?? "empty",
    requests: fixture.events.filter((event) => event[0] === "dispatch" && event[1] === `grant-${owner}`).length,
    canConfirm: !view.busy && view.canConfirm,
    "copy.current": bodyClass(current?.proposal.bodyText),
    "copy.saved": bodyClass(saved?.body),
    "copy.retained": bodyClass(kept?.draft.body),
    "copy.shelf": bodyClass(shelf?.items[0]?.draft.body),
    "copy.earlier": saved?.earlierThanSent === true
  };
}
function step(trace, label, actions, expect) {
  trace.steps.push({ label, action: actions, expect });
}
async function setup(name, traces) {
  const fixture = await createInboxFixture(), coordinator = fixture.createPair();
  const trace = { name, init: action("init"), expect: observe(fixture, coordinator), steps: [] };
  traces.push(trace);
  await coordinator.bind();
  step(trace, "bind the real provider and local draft coordinator", [action("bind", 1), action("regrant")], observe(fixture, coordinator));
  return { fixture, coordinator, trace };
}
async function compose(fixture, coordinator, trace, { save = false, edit = false } = {}) {
  assert.equal(coordinator.drafts.begin(undefined, undefined, "", { to: ["recipient@example.test"], subject: "Subject", body: "original" }), true);
  await fixture.settle();
  step(trace, "create and retain the local source email", action("newDraft"), observe(fixture, coordinator));
  if (save) {
    coordinator.drafts.render().c.save();
    await fixture.settle();
    step(trace, "save a version and consume its retained edit", action("saveDraft"), observe(fixture, coordinator));
  }
  if (edit) {
    coordinator.drafts.render().c.onBody({ target: { value: "edited" } });
    await fixture.settle();
    step(trace, "edit after the saved version", action("editDraft"), observe(fixture, coordinator));
  }
}
async function review(fixture, coordinator, trace) {
  coordinator.drafts.render().c.send();
  await fixture.settle();
  step(trace, "prepare exact review through the actual composer", [action("prepare", "send"), action("reviewed", true)], observe(fixture, coordinator));
  assert.equal(coordinator.provider.render().provider.canConfirm, true);
}
async function startSend(fixture, coordinator, trace) {
  const gate = deferred();
  fixture.gates({ dispatch: () => gate.promise });
  coordinator.provider.render().provider.confirm();
  await until(() => fixture.state.dispatches === 1, "provider dispatch");
  step(trace, "durable confirmation precedes one provider request", [action("reserve"), action("persisted", 1), action("dispatched")], observe(fixture, coordinator));
  return gate;
}
export async function runInboxCoordinatorRefinement(extraSources = []) {
  const discovered = await inboxDriverSources();
  const sources = [...discovered, fileURLToPath(import.meta.url), "specs/quint/refinement/services/inbox-coordinator-ports.mjs", "package-lock.json", ...extraSources];
  const driverHashes = captureInputs(sources);
  rebuildInboxDriver(discovered);
  const traces = [];
  for (const mode of ["capability-withdrawn", "capability-unavailable"]) {
    const { fixture, coordinator, trace } = await setup(mode, traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    if (mode === "capability-withdrawn") fixture.capability(1, { send: false });
    else fixture.capability(1, null);
    await coordinator.provider.bind("grant-1");
    step(trace, "fresh negative capability read disables confirmation", action("capabilities", 0, 1, 0, mode !== "capability-unavailable", false, mode !== "capability-unavailable", mode !== "capability-unavailable"), observe(fixture, coordinator));
    coordinator.provider.render().provider.confirm();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    step(trace, "the previously prepared review cannot bypass the current capability", { ...action("reserve"), reject: true }, observe(fixture, coordinator));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("stale-capability-readback", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    const pending = [];
    fixture.gates({ capability: () => new Promise((resolve) => pending.push(resolve)) });
    const older = coordinator.provider.bind("grant-1"), newer = coordinator.provider.bind("grant-1");
    await until(() => pending.length === 2, "overlapping capability reads");
    step(trace, "two explicit refreshes overlap", [action("startCapabilityRead"), action("startCapabilityRead")], observe(fixture, coordinator));
    pending[1]({ send: false, providerDrafts: false, mailboxMutations: false });
    await newer;
    step(trace, "newer negative readback owns capabilities", action("capabilities", 2, 1, 0, true, false, false, false), observe(fixture, coordinator));
    pending[0]({ send: true, providerDrafts: true, mailboxMutations: true });
    await older;
    step(trace, "late positive readback cannot re-enable the review", action("capabilities", 1, 1, 0, true, true, true, true), observe(fixture, coordinator));
    coordinator.dispose();
  }
  for (const mode of ["exact", "earlier", "edited-in-flight", "unknown-restart"]) {
    const { fixture, coordinator, trace } = await setup("source-cleanup-" + mode, traces);
    await compose(fixture, coordinator, trace, { save: true, edit: mode === "earlier" });
    await review(fixture, coordinator, trace);
    if (mode === "unknown-restart") fixture.state.outcome = "lost";
    const gate = await startSend(fixture, coordinator, trace);
    if (mode === "edited-in-flight") {
      coordinator.drafts.render().c.onBody({ target: { value: "edited" } });
      await until(() => [...fixture.slots.values()].some((value) => value?.text?.includes("edited")), "new retained edits");
      step(trace, "typing after dispatch changes the local copy only", action("editDraft"), observe(fixture, coordinator));
    }
    gate.resolve();
    await fixture.settle();
    if (mode === "unknown-restart") {
      step(trace, "lost response preserves every local copy", action("lostReply"), observe(fixture, coordinator));
      coordinator.dispose();
      const restored = fixture.createPair();
      await restored.bind();
      step(trace, "reload never dispatches the saved intent again", action("restart"), observe(fixture, restored));
      assert.equal(fixture.state.dispatches, 1);
      restored.provider.render().provider.check();
      await fixture.settle();
      step(trace, "fresh matching receipt permits source cleanup", [action("checkReceipt", true), action("cleanup", "saved")], observe(fixture, restored));
      restored.dispose();
    } else {
      step(trace, "confirmed send cleans only matching source copies", [action("result", "succeeded"), action("cleanup", "saved")], observe(fixture, coordinator));
      coordinator.dispose();
    }
  }
  {
    const { fixture, coordinator, trace } = await setup("owner-changes-during-confirmation-cas", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    const gate = deferred();
    let entered = false;
    fixture.gates({ store: async (event) => {
      if (event.value?.phase === "dispatching") {
        entered = true;
        await gate.promise;
      }
    } });
    coordinator.provider.render().provider.confirm();
    await until(() => entered, "held dispatching CAS");
    step(trace, "confirmation waits for its durable write", action("reserve"), observe(fixture, coordinator));
    const rebound = coordinator.bind("grant-2");
    await until(() => coordinator.provider.capabilities()?.from === "owner-2@example.test" && coordinator.drafts.ready, "new account binding");
    step(trace, "new account uses a separate retained operation", [action("bind", 2), action("regrant")], observe(fixture, coordinator, 2));
    gate.resolve();
    await rebound;
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    assert.equal(recordFor(fixture, 1).phase, "dispatching");
    step(trace, "old CAS may commit but cannot dispatch under the new binding", action("persisted", 1), observe(fixture, coordinator, 2));
    step(trace, "new binding cannot continue the old dispatch", { ...action("dispatched"), reject: true }, observe(fixture, coordinator, 2));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("withdrawn-grant-discards-review", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    fixture.capability(1, { send: false, providerDrafts: false, mailboxMutations: false });
    coordinator.provider.withdrawn();
    await coordinator.provider.bind("grant-1");
    await fixture.settle();
    step(trace, "grant withdrawal removes the undispatched operation", [action("withdraw", false), action("applyWithdrawal")], observe(fixture, coordinator));
    fixture.capability(1, { send: true, providerDrafts: true, mailboxMutations: true });
    await coordinator.provider.bind("grant-1");
    step(trace, "regrant leaves the discarded review absent", action("regrant"), observe(fixture, coordinator));
    coordinator.provider.render().provider.confirm();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    step(trace, "regrant cannot revive an old confirmation", { ...action("reserve"), reject: true }, observe(fixture, coordinator));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("attachment-owner-fence", traces);
    await compose(fixture, coordinator, trace);
    const gate = deferred();
    let entered = false;
    fixture.gates({ attachment: async () => {
      entered = true;
      await gate.promise;
    } });
    fixture.state.attachments.push({ name: "a.txt", mimeType: "text/plain", dataBase64: "YQ==", size: 1, sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" });
    coordinator.drafts.render().c.attach();
    await until(() => entered, "held native selected attachment");
    step(trace, "selected bytes remain tied to the original draft", action("selectAttachment"), observe(fixture, coordinator));
    await coordinator.bind("grant-2");
    step(trace, "account changes before the byte read completes", [action("bind", 2), action("regrant")], observe(fixture, coordinator, 2));
    gate.resolve();
    await fixture.settle();
    assert.equal(coordinator.drafts.email(), null);
    assert.deepEqual(fixture.state.released, ["selection"]);
    step(trace, "late file result is released without attaching to another account", action("attachmentResult", true, 1), observe(fixture, coordinator, 2));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("attachment-content-binds-review", traces);
    await compose(fixture, coordinator, trace);
    const file = (text, name) => ({ name, mimeType: "text/plain", dataBase64: Buffer.from(text).toString("base64"), size: Buffer.byteLength(text), sha256: "" });
    const first = file("a", "a.txt");
    first.sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from("a"))).toString("hex");
    fixture.state.attachments.push(first);
    coordinator.drafts.render().c.attach();
    await fixture.settle();
    step(trace, "native selection is hashed before attachment", [action("selectAttachment"), action("attachmentResult", true, 1)], { ...observe(fixture, coordinator), "copy.attachment": attachmentClass(coordinator.drafts.email().proposal.attachments) });
    await review(fixture, coordinator, trace);
    coordinator.drafts.render().c.atts[0].rm();
    await fixture.settle();
    step(trace, "removing selected bytes changes the composer", action("removeAttachment"), { ...observe(fixture, coordinator), "copy.attachment": 0 });
    await fixture.settle();
    assert.equal(recordFor(fixture, 1), null);
    step(trace, "edited attachment invalidates the unsent review", action("cancelReview"), observe(fixture, coordinator));
    const second = file("b", "a.txt");
    second.sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from("b"))).toString("hex");
    fixture.state.attachments.push(second);
    coordinator.drafts.render().c.attach();
    await fixture.settle();
    step(trace, "same name with different bytes is a different reviewed attachment", [action("selectAttachment"), action("attachmentResult", true, 2)], { ...observe(fixture, coordinator), "copy.attachment": attachmentClass(coordinator.drafts.email().proposal.attachments) });
    coordinator.provider.render();
    await fixture.settle();
    assert.equal(recordFor(fixture, 1), null);
    step(trace, "stale attachment review cannot dispatch", { ...action("reserve"), reject: true }, observe(fixture, coordinator));
    assert.equal(fixture.state.dispatches, 0);
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("withdrawal-during-confirmed-cas-retains-unknown", traces);
    await compose(fixture, coordinator, trace, { save: true });
    await review(fixture, coordinator, trace);
    const gate = deferred();
    let entered = false;
    fixture.state.outcome = "lost";
    fixture.gates({ store: async (event) => {
      if (event.value?.phase === "dispatching") {
        entered = true;
        await gate.promise;
      }
    } });
    coordinator.provider.render().provider.confirm();
    await until(() => entered, "held confirmed CAS");
    step(trace, "confirmation has been admitted but not persisted", action("reserve"), observe(fixture, coordinator));
    fixture.capability(1, { send: false, providerDrafts: false, mailboxMutations: false });
    coordinator.provider.withdrawn();
    await coordinator.provider.bind("grant-1");
    step(trace, "withdrawal is queued behind the admitted run", action("withdraw", false), observe(fixture, coordinator));
    gate.resolve();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 1);
    step(trace, "admitted request may reach provider and lose its reply", [action("persisted", 1), action("dispatched"), action("lostReply"), action("applyWithdrawal")], observe(fixture, coordinator));
    const request = recordFor(fixture, 1).requestId;
    fixture.gates({});
    fixture.capability(1, { send: true, providerDrafts: true, mailboxMutations: true });
    await coordinator.provider.bind("grant-1");
    step(trace, "regrant preserves the original unknown operation", action("regrant"), observe(fixture, coordinator));
    assert.equal(recordFor(fixture, 1).requestId, request);
    coordinator.provider.render().provider.check();
    await fixture.settle();
    step(trace, "fresh receipt resolves the retained operation without redispatch", [action("checkReceipt", true), action("cleanup", "saved")], observe(fixture, coordinator));
    assert.equal(fixture.state.dispatches, 1);
    coordinator.dispose();
  }
  {
    const fixture = await createInboxFixture(), app = fixture.mount();
    const projected = { provider: { render: () => ({ provider: app.render().provider }) }, drafts: { email: () => {
      const c = app.render().c;
      return c ? { proposal: { bodyText: c.body, attachments: [] } } : null;
    } } };
    const trace = { name: "full-adapter-read-withdrawal-and-regrant", init: action("init"), expect: observe(fixture, projected), steps: [] };
    traces.push(trace);
    app.render();
    await fixture.settle();
    step(trace, "actual adapter discovers and binds the selected Gmail account", [action("bind", 1), action("regrant")], observe(fixture, projected));
    app.render().compose();
    await fixture.settle();
    let composer = app.render().c;
    composer.onTo({ target: { value: "recipient@example.test" } });
    app.render().c.addRaw();
    app.render().c.onBody({ target: { value: "original" } });
    await fixture.settle();
    step(trace, "normal Inbox compose entrypoint retains the email", action("newDraft"), observe(fixture, projected));
    app.render().c.send();
    await fixture.settle();
    step(trace, "normal Send entrypoint prepares a review", [action("prepare", "send"), action("reviewed", true)], observe(fixture, projected));
    fixture.capability(1, { read: false, send: false, providerDrafts: false, mailboxMutations: false });
    fixture.capability(2, null);
    app.shell.inboxAccountsChanged(new Event("change"));
    await fixture.settle();
    step(trace, "account reread withdraws read access and discards only unsent review", [action("withdraw", true), action("applyWithdrawal"), action("unbind")], observe(fixture, projected));
    assert.equal(recordFor(fixture, 1), null);
    assert.equal(fixture.state.dispatches, 0);
    fixture.capability(1, { read: true, send: true, providerDrafts: true, mailboxMutations: true });
    app.shell.inboxAccountsChanged(new Event("change"));
    app.render();
    await fixture.settle();
    step(trace, "read grant restoration leaves the old review absent", [action("bind", 1), action("regrant"), action("resumeDraft")], observe(fixture, projected));
    const draftsFolder = app.render().extraFolders.find((row) => row.value === "drafts");
    assert.ok(draftsFolder);
    draftsFolder.pick();
    await fixture.settle();
    const resume = app.render().rows.find((row) => row.label === "Draft, (No subject)" && row.subj === "original");
    assert.ok(resume);
    resume.open();
    await fixture.settle();
    step(trace, "retained local text opens through the actual Inbox adapter", null, observe(fixture, projected));
    app.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("confirmation-storage-failure-and-retry", traces);
    await compose(fixture, coordinator, trace, { save: true });
    await review(fixture, coordinator, trace);
    const request = recordFor(fixture, 1).requestId;
    fixture.state.failStore = true;
    coordinator.provider.render().provider.confirm();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    assert.equal(recordFor(fixture, 1).requestId, request);
    step(trace, "failed durable commit keeps the review and all local copies", [action("reserve"), action("storageRefused", 1)], observe(fixture, coordinator));
    fixture.state.failStore = false;
    fixture.advance();
    const gate = await startSend(fixture, coordinator, trace);
    gate.resolve();
    await fixture.settle();
    assert.equal(recordFor(fixture, 1).requestId, request);
    step(trace, "explicit retry uses the same request and cleans only after success", [action("result", "succeeded"), action("cleanup", "saved")], observe(fixture, coordinator));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("owner-changes-before-confirmation", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    await coordinator.bind("grant-2");
    step(trace, "selecting another account closes the first review", [action("bind", 2), action("regrant")], observe(fixture, coordinator, 2));
    coordinator.provider.render().provider.confirm();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    step(trace, "an old confirm control cannot dispatch the prior account request", { ...action("reserve"), reject: true }, observe(fixture, coordinator, 2));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("cloud-owner-changes-before-confirmation", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    const oldRequest = recordFor(fixture, 1).requestId;
    fixture.switchOwner(2);
    await coordinator.bind("grant-1");
    step(trace, "a new Cloud owner cannot adopt a matching Google connection ID", [action("bind", 2), action("regrant")], observe(fixture, coordinator));
    coordinator.provider.render().provider.confirm();
    await fixture.settle();
    assert.equal(fixture.state.dispatches, 0);
    assert.equal(recordFor(fixture, 1), null);
    assert.ok([...fixture.slots.values()].some(value => value?.requestId === oldRequest && JSON.parse(value.owner)[1] === "user-1"));
    step(trace, "old Cloud owner retains its review without exposing it to the new owner", { ...action("reserve"), reject: true }, observe(fixture, coordinator));
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("old-account-capability-readback", traces);
    const gate = deferred();
    let entered = false;
    fixture.gates({ capability: grant => {
      if (grant === "grant-1") {
        entered = true;
        return gate.promise;
      }
      return { from: "owner-2@example.test", send: false, providerDrafts: false, mailboxMutations: false };
    } });
    const oldRead = coordinator.provider.bind("grant-1");
    await until(() => entered, "held old account capability read");
    step(trace, "a capability refresh is pending for the old account", action("startCapabilityRead"), observe(fixture, coordinator));
    const rebound = coordinator.bind("grant-2");
    await until(() => coordinator.provider.capabilities()?.from === "owner-2@example.test" && coordinator.drafts.ready, "new account is bound");
    step(trace, "new account has its own negative capability result", [action("bind", 2), action("capabilities", 1, 2, 1, true, false, false, false)], {
      ...observe(fixture, coordinator, 2), "s.send": coordinator.provider.capabilities().send,
      "s.drafts": coordinator.provider.capabilities().providerDrafts, "s.mailbox": coordinator.provider.capabilities().mailboxMutations,
    });
    gate.resolve({ send: true, providerDrafts: true, mailboxMutations: true });
    await oldRead;
    await rebound;
    await fixture.settle();
    step(trace, "old account callback cannot authorize the replacement account", action("capabilities", 1, 1, 0, true, true, true, true), {
      ...observe(fixture, coordinator, 2), "s.send": coordinator.provider.capabilities().send,
      "s.drafts": coordinator.provider.capabilities().providerDrafts, "s.mailbox": coordinator.provider.capabilities().mailboxMutations,
    });
    coordinator.dispose();
  }
  {
    const { fixture, coordinator, trace } = await setup("old-account-cas-refusal-keeps-review", traces);
    await compose(fixture, coordinator, trace);
    await review(fixture, coordinator, trace);
    const gate = deferred();
    let entered = false;
    fixture.gates({ store: async event => {
      if (event.value?.phase === "dispatching") {
        entered = true;
        await gate.promise;
        throw Error("Fixture refused old confirmation write");
      }
    } });
    coordinator.provider.render().provider.confirm();
    await until(() => entered, "old confirmation CAS is pending");
    step(trace, "old confirmation awaits local persistence", action("reserve"), observe(fixture, coordinator));
    const rebound = coordinator.bind("grant-2");
    await until(() => coordinator.provider.capabilities()?.from === "owner-2@example.test" && coordinator.drafts.ready, "new account is bound");
    step(trace, "replacement account is independent of old persistence", [action("bind", 2), action("regrant")], observe(fixture, coordinator, 2));
    gate.resolve();
    await rebound;
    await fixture.settle();
    step(trace, "failed old write leaves the old durable review intact", action("storageRefused", 1), observe(fixture, coordinator, 2));
    assert.equal(recordFor(fixture, 1).phase, "review");
    assert.equal(fixture.state.dispatches, 0);
    fixture.gates({});
    await coordinator.bind("grant-1");
    step(trace, "returning to the first account restores its unsent review", [action("bind", 1), action("regrant")], observe(fixture, coordinator));
    assert.equal(coordinator.provider.render().provider.canConfirm, true);
    coordinator.dispose();
  }
  const receipt = await checkTraces({ model: "InboxCoordinator", sources, driverHashes, traces, scope: "bounded-orchestration", assumptions: [
    "Actual provider controls, composer, InboxOperation, inboxUnsaved and AssistantDraftController execute in isolated JavaScript realms. Primitive storage, Gmail, attachment picker and native lifecycle ports are controlled.",
    "Two logical account/grant identities, one dispatched request per identity, and fixed original/edited body and attachment equivalence classes bound these schedules.",
    "The imported InboxDelivery committing phase records the awaited CAS boundary. Network dispatch is observed separately. Already-admitted requests may remain uncertain after permission changes.",
    "HTML body rendering, installed Keystore/provider behavior and real Gmail delivery remain separate obligations."
  ] });
  return { receipts: [receipt], obligations: [{ model: "InboxCoordinator", obligation: "installed Gmail and persistence qualification", reason: "The source coordination executes with controlled external ports and bounded identities/content classes." }, { model: "InboxCoordinator", obligation: "Inbox row reconciliation and wider cleanup interleavings", reason: "Repeated message/draft/part IDs, interrupted individual cleanup writes, arbitrary shelf collections and provider-draft/forward orchestration need additional source schedules." }] };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runInboxCoordinatorRefinement();
  console.log(JSON.stringify({ traces: result.receipts[0].traces, checkpoints: result.receipts[0].checkpoints }));
}

export {action, observe, step, setup, compose, review, startSend};
