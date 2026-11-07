// AlphaTelephony renderer contract (issues #420, #421) against a recording stub. No Android device,
// SIM, contact, call or message is involved; a handoff here proves nothing about delivery.
import test from "node:test";
import assert from "node:assert/strict";
import { createAospTelephony, TelephonyUnavailable, parseTelephonyStatus, parseContacts, parseHandoff, normalizePhoneNumber, reviewSms, advanceSmsState, smsMayBeReviewedAgain } from "../apps/app/src/runtime/aosp-telephony.ts";

const status = (patch = {}) => ({
  version: 2, voiceCapable: true, smsCapable: true,
  permissions: { contacts: "granted", phoneState: "granted", sms: "prompt", sendSms: "prompt" }, sendMode: "handoff",
  roles: { dialer: { available: true, held: false, eligible: false }, sms: { available: true, held: false, eligible: false } },
  defaultDialer: "com.android.dialer", defaultSms: "com.android.messaging",
  subscriptions: [{ id: 1, slot: 0, displayName: "Work", carrierName: "Carrier A", defaultSms: true, defaultVoice: true }],
  defaultSmsSubscriptionId: 1,
  ...patch,
});
function stub(answers = {}) {
  const calls = [];
  const plugin = new Proxy({}, { get: (_, method) => async options => { calls.push([method, options]); return typeof answers[method] === "function" ? answers[method](options) : answers[method]; } });
  return { plugin, calls };
}

test("off the verified image nothing reaches native code", async () => {
  const { plugin, calls } = stub({ status: status() });
  for (const client of [createAospTelephony(null, false), createAospTelephony(plugin, false), createAospTelephony(null, true)]) {
    assert.equal(client.available, false);
    await assert.rejects(client.status(), TelephonyUnavailable);
    await assert.rejects(client.searchContacts("Ada"), TelephonyUnavailable);
    await assert.rejects(client.dial("+15555550100"), TelephonyUnavailable);
    await assert.rejects(client.composeSms({ recipients: ["+15555550100"], body: "Hi", subscriptionId: null }), TelephonyUnavailable);
    await assert.rejects(client.requestRole("sms"), TelephonyUnavailable);
    await assert.rejects(client.requestAccess("contacts"), TelephonyUnavailable);
  }
  assert.deepEqual(calls, [], "a standalone install or agent request never reaches the native boundary");
});

test("status is validated; an unread SIM list is never shown as no SIM", () => {
  assert.equal(parseTelephonyStatus(status()).subscriptions.length, 1);
  assert.equal(parseTelephonyStatus(status({ permissions: { contacts: "prompt", phoneState: "denied", sms: "prompt", sendSms: "prompt" }, subscriptions: null, defaultSmsSubscriptionId: null })).subscriptions, null);
  assert.throws(() => parseTelephonyStatus(status({ permissions: { contacts: "granted", phoneState: "denied", sms: "prompt", sendSms: "prompt" } })), /subscriptions/, "a list without phone-state access is refused");
  assert.throws(() => parseTelephonyStatus(status({ roles: { dialer: { available: false, held: true, eligible: false }, sms: { available: true, held: false, eligible: false } } })), /dialer role/);
  assert.throws(() => parseTelephonyStatus(status({ roles: { dialer: { available: true, held: false }, sms: { available: true, held: false, eligible: false } } })), /dialer role/, "eligibility is required");
  assert.throws(() => parseTelephonyStatus(status({ subscriptions: [{ id: 1, slot: 0, displayName: "A", carrierName: "B", defaultSms: true, defaultVoice: true }, { id: 1, slot: 1, displayName: "C", carrierName: "D", defaultSms: false, defaultVoice: false }], defaultSmsSubscriptionId: null })), /subscription/, "duplicate subscription ids");
  assert.throws(() => parseTelephonyStatus({ ...status(), version: 1 }), /version/, "the version 1 status without SMS access is refused");
});

test("contacts are read-only records within the requested limit", async () => {
  const contact = { id: "7", lookupKey: "k", displayName: "Ada Lovelace", phoneNumbers: ["+1 555 0100"], emailAddresses: [], starred: false };
  const { plugin, calls } = stub({ searchContacts: { contacts: [contact] } });
  const client = createAospTelephony(plugin, true);
  assert.deepEqual(await client.searchContacts("Ada", 5), [contact]);
  assert.deepEqual(calls, [["searchContacts", { query: "Ada", limit: 5 }]]);
  await assert.rejects(client.searchContacts("Ada", 0), RangeError);
  await assert.rejects(client.searchContacts("Ada", 101), RangeError);
  assert.throws(() => parseContacts({ contacts: [contact, contact] }, 1), /contacts/, "more rows than asked for are refused");
});

test("dial and SMS are handoffs: the receipt never says called, sent or delivered", async () => {
  const { plugin, calls } = stub({
    dial: { status: "handed-off", target: "dialer", handler: "com.android.dialer", message: "Place the call there." },
    composeSms: { status: "handed-off", target: "sms", handler: null, message: "Send it there." },
  });
  const client = createAospTelephony(plugin, true);
  assert.equal((await client.dial(" +1 (555) 555-0100 ")).status, "handed-off");
  assert.deepEqual(calls[0], ["dial", { number: "+15555550100" }]);
  await assert.rejects(client.dial("*#06#"), RangeError, "MMI and USSD stay in the system dialer");
  const review = reviewSms({ recipients: ["+1 555 555 0100", "+15555550100"], body: "Running late" }, parseTelephonyStatus(status()));
  assert.deepEqual(review, { review: { recipients: ["+15555550100"], body: "Running late", subscriptionId: null } });
  assert.equal((await client.composeSms(review.review)).status, "handed-off");
  assert.deepEqual(calls[1], ["composeSms", { recipients: ["+15555550100"], body: "Running late" }]);
  await assert.rejects(client.composeSms({ ...review.review, subscriptionId: 1 }), RangeError, "a handoff cannot honour a SIM choice");
  for (const status of ["sent", "delivered", "called"]) assert.throws(() => parseHandoff({ status, target: "sms", handler: null, message: "" }, "sms"), /handoff/);
  assert.throws(() => parseHandoff({ status: "handed-off", target: "dialer", handler: null, message: "" }, "sms"), /handoff/, "a receipt for another target is refused");
});

test("SMS review: recipients, body and SIM selection", () => {
  const one = parseTelephonyStatus(status()), none = parseTelephonyStatus(status({ subscriptions: null, defaultSmsSubscriptionId: null, permissions: { contacts: "granted", phoneState: "prompt", sms: "prompt", sendSms: "prompt" } }));
  const two = parseTelephonyStatus(status({ subscriptions: [...status().subscriptions, { id: 2, slot: 1, displayName: "Personal", carrierName: "Carrier B", defaultSms: false, defaultVoice: false }] }));
  assert.deepEqual(reviewSms({ recipients: [], body: "x" }, one), { problem: "no-recipient" });
  assert.deepEqual(reviewSms({ recipients: ["abc"], body: "x" }, one), { problem: "invalid-recipient" });
  assert.deepEqual(reviewSms({ recipients: Array.from({ length: 11 }, (_, i) => `+1555555010${i}`), body: "x" }, one), { problem: "too-many-recipients" });
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "  " }, one), { problem: "empty-body" });
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "x".repeat(5001) }, one), { problem: "body-too-long" });
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "x", subscriptionId: 1 }, one), { problem: "sim-not-selectable" }, "handoff mode refuses a SIM choice rather than dropping it");
  assert.equal(reviewSms({ recipients: ["5550100"], body: "x" }, two).review.subscriptionId, null, "the SMS app chooses the SIM for a handoff");
  // Direct sends (only when status.sendMode is "direct"): the SIM is explicit among several.
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "x" }, two, "direct"), { problem: "sim-required" });
  assert.equal(reviewSms({ recipients: ["5550100"], body: "x", subscriptionId: 2 }, two, "direct").review.subscriptionId, 2);
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "x", subscriptionId: 9 }, two, "direct"), { problem: "sim-unknown" }, "an inactive SIM is never silently replaced");
  assert.equal(reviewSms({ recipients: ["5550100"], body: "x" }, one, "direct").review.subscriptionId, 1);
  assert.deepEqual(reviewSms({ recipients: ["5550100"], body: "x" }, none, "direct"), { problem: "sim-unknown" });
});

test("outgoing message states never allow an automatic repeat after an unknown outcome", () => {
  assert.equal(advanceSmsState(advanceSmsState("reviewed", "dispatched"), "outcome-unknown"), "outcome-unknown");
  assert.throws(() => advanceSmsState("outcome-unknown", "dispatched"));
  assert.throws(() => advanceSmsState("handed-off", "sent"), /cannot move/, "Alpha does not learn what happened after a handoff");
  assert.throws(() => advanceSmsState("failed", "dispatched"));
  assert.equal(advanceSmsState("sent", "delivered"), "delivered");
  assert.deepEqual(["reviewed", "handed-off", "dispatched", "sent", "delivered", "failed", "outcome-unknown"].filter(smsMayBeReviewedAgain), ["reviewed", "failed"]);
});

test("phone number normalisation", () => {
  assert.equal(normalizePhoneNumber("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhoneNumber("911"), "911", "emergency numbers go to the system dialer like any other");
  for (const bad of ["", "1", "tel:5550100", "555-CALL-NOW", "*#06#", "5550100;ext=2", 5550100, "+1".padEnd(30, "1")]) assert.equal(normalizePhoneNumber(bad), null, String(bad));
});

test("only the verified image's client becomes the shared Messages and Phone profile", async () => {
  const { registerTelephonyProfile } = await import("../apps/app/src/runtime/aosp-telephony.ts");
  const { telephonyProfile } = await import("../.eliza/client-features/packages/contracts/src/native-telephony.ts");
  const { plugin } = stub({ status: status() });
  let clear = registerTelephonyProfile(createAospTelephony(plugin, false));
  assert.equal(telephonyProfile(), null, "a standalone or unverified install leaves the shared views on their own path");
  clear();
  const image = createAospTelephony(plugin, true);
  clear = registerTelephonyProfile(image);
  assert.equal(telephonyProfile(), image);
  clear();
  assert.equal(telephonyProfile(), null);
});
