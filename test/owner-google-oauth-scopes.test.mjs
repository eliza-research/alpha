// Issue #668 owner prep: the capability-to-scope matrix and the readState gate, against synthetic
// transports only. No Google account, OAuth consent, Cloud request or mailbox is involved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ALPHA_CONSENT_PATHS, EMBEDDED_CAPABILITY_SCOPES, GOOGLE_SCOPE_CLASS, loadMapping, matrix, parseCloudMapping, probeServiceDocument, scopesFor } from "../scripts/owner/google-oauth-scopes.mjs";

const G = "https://www.googleapis.com/auth/";
const vendorFile = "vendor/eliza/packages/cloud/shared/src/lib/services/agent-google-connector/shared.ts";
const prepared = fs.existsSync(".eliza/client-features/plugins/plugin-inbox/src/mailbox/managed-gmail-client.ts");

/** Run a module snippet with type transforms (CloudProtocol uses parameter properties). */
function runTs(source) {
  const child = spawnSync(process.execPath, ["--import=tsx", "--no-warnings", "--input-type=module", "-e", source], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
}

test("embedded mapping matches the pinned Cloud capabilitiesToScopes", { skip: !fs.existsSync(vendorFile) && "vendor/eliza not checked out" }, () => {
  const loaded = loadMapping();
  assert.equal(loaded.drift, null);
  assert.deepEqual(parseCloudMapping(fs.readFileSync(vendorFile, "utf8")).mapping, Object.fromEntries(Object.entries(EMBEDDED_CAPABILITY_SCOPES).map(([k, v]) => [k, [...v]])));
});

test("the parser reads a capabilitiesToScopes body and refuses other source", () => {
  const src = `export function capabilitiesToScopes(c) {\n  const scopes = new Set<string>([\n    "a",\n  ]);\n  if (capability === "x") {\n    scopes.add("s1");\n  }\n  if (capability === "y")\n    scopes.add("s2");\n}\n`;
  assert.deepEqual(parseCloudMapping(src), { mapping: { "google.basic_identity": [], x: ["s1"], y: ["s2"] }, identity: ["a"] });
  assert.throws(() => parseCloudMapping("nothing here"), /not found/);
});

test("every scope Alpha can cause is classified and identity is always requested", () => {
  const m = matrix();
  for (const row of m.consentScreen.includingApiOnly) assert.notEqual(row.class, "unknown", row.scope);
  for (const p of m.paths) for (const s of [`${G}userinfo.email`, `${G}userinfo.profile`]) assert.ok(p.scopes.includes(s), p.id);
  assert.deepEqual(m.neverRequested, ["google.gmail.manage"], "Alpha never asks for Gmail settings access");
  assert.ok(!m.consentScreen.includingApiOnly.some(r => r.scope.endsWith("gmail.settings.basic")));
  assert.deepEqual(m.restricted.map(s => s.replace(G, "")).sort(), ["gmail.compose", "gmail.modify", "gmail.readonly"]);
  assert.equal(GOOGLE_SCOPE_CLASS[`${G}gmail.send`], "sensitive");
  assert.deepEqual(scopesFor(["google.gmail.triage"]).map(s => s.replace(G, "")), ["userinfo.email", "userinfo.profile", "gmail.readonly"]);
  assert.throws(() => scopesFor(["google.unknown"]), /Unknown Cloud capability/);
});

test("consent paths are exactly what CloudProtocol posts to connect/initiate", { skip: !prepared && "client features not prepared" }, () => {
  const calls = ALPHA_CONSENT_PATHS.map(p => p.call);
  const bodies = runTs(`
    const { CloudProtocol } = await import(${JSON.stringify(new URL("../apps/app/src/runtime/cloud-protocol.ts", import.meta.url).href)});
    const seen = [];
    const client = new CloudProtocol("production", async input => { seen.push({ path: new URL(input.url).pathname, body: input.body }); return { status: 200, data: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic" } }; },
      { read: async () => ({ credentialId: "c", token: "synthetic-only" }), write: async () => {}, clear: async () => {} }, async () => {});
    for (const [method, a, b] of ${JSON.stringify(calls)}) await (method === "initiateGoogle" ? client.initiateGoogle(new AbortController().signal, a, b) : client.initiateGmail(new AbortController().signal, a));
    console.log(JSON.stringify(seen));`);
  assert.equal(bodies.length, ALPHA_CONSENT_PATHS.length);
  bodies.forEach((call, i) => {
    assert.equal(call.path, "/api/v1/eliza/google/connect/initiate");
    assert.deepEqual(call.body, { side: "owner", capabilities: ALPHA_CONSENT_PATHS[i].capabilities }, ALPHA_CONSENT_PATHS[i].id);
  });
});

test("the Settings screen starts only the consent paths marked ui", () => {
  const ui = fs.readFileSync("apps/app/src/runtime/google-connection-ui.tsx", "utf8");
  const connects = [...ui.matchAll(/(?:onClick=\{\(\)=>void|await) connect\((.*?)\)(?:\}>|;)/g)].map(m => m[1].trim());
  assert.deepEqual(connects.sort(), ["heldGmailTier(accounts,'send')", "heldGmailTier(accounts,'send'),'write'", "heldGmailTier(connected,'read'),'write'"].sort(),
    "a new Settings consent button needs a row in ALPHA_CONSENT_PATHS and the runbook matrix");
  assert.doesNotMatch(ui, /initiateGmail/);
  const uiPaths = ALPHA_CONSENT_PATHS.filter(p => p.surface === "ui").map(p => p.call.slice(1).join("/")).sort();
  assert.deepEqual(uiPaths, ["write/modify", "write/read", "write/send"]);
  assert.match(ui, /const heldGmailTier=\(accounts:GmailAccount\[\],floor:'read'\|'send'\)=>accounts\.some\(account=>account\.connected&&gmailGrantTier\(account\)==='modify'\)\?'modify':accounts\.some\(account=>account\.connected&&account\.grantedCapabilities\.includes\('google\.gmail\.send'\)\)\?'send':floor;/, "every consent keeps the Gmail tier already granted; only the Calendar intent may ask Gmail read");
  assert.match(ui, /async function connect\(permission:'read'\|'modify'\|'send'='send',calendarPermission:'read'\|'write'='write'\)/, "Connect asks for every scope Cloud grants up front");
});

test("read state is unavailable unless inbox-v1/capabilities advertises readState", { skip: !prepared && "client features not prepared" }, () => {
  const results = runTs(`
    const { CloudProtocol } = await import(${JSON.stringify(new URL("../apps/app/src/runtime/cloud-protocol.ts", import.meta.url).href)});
    const base = { version: 1, from: "owner@example.invalid", threads: true, send: false, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false };
    let wire = base;
    const client = new CloudProtocol("production", async () => ({ status: 200, data: wire }), { read: async () => ({ credentialId: "c", token: "synthetic-only" }), write: async () => {}, clear: async () => {} }, async () => {});
    const out = {};
    for (const [name, value] of [["absent", base], ["false", { ...base, readState: false }], ["true", { ...base, readState: true }]]) { wire = value; out[name] = (await client.gmailInboxCapabilities("72475cd0-e135-4c42-a9e2-fb5fe0820ada", new AbortController().signal)).readState; }
    wire = { ...base, readState: "yes" };
    try { await client.gmailInboxCapabilities("72475cd0-e135-4c42-a9e2-fb5fe0820ada", new AbortController().signal); out.malformed = "accepted"; } catch (e) { out.malformed = e.code; }
    console.log(JSON.stringify(out));`);
  assert.deepEqual(results, { absent: false, false: false, true: true, malformed: "invalid-response" });
  // Every read-state entry point in the inbox adapter is gated on the advertised capability.
  const adapter = fs.readFileSync("apps/app/src/prototype/inbox-cloud-adapter.ts", "utf8");
  const sites = [...adapter.matchAll(/setRead\(/g)].length;
  const gated = [...adapter.matchAll(/capabilities\(\)\?\.readState/g)].length;
  assert.ok(sites >= 3 && gated >= 4, `expected the readState gate at each setRead entry point (setRead ${sites}, gates ${gated})`);
  assert.match(adapter, /!provider\.capabilities\(\)\?\.readState\) \{ if \(explicit\) api\?\.toast\("Can't change read state for this account\."\); return; \}/);
  assert.match(adapter, /canToggleRead: !!provider\.capabilities\(\)\?\.readState&&/);
});

test("the privacy probe is one credential-free GET and reports missing Google disclosures", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ success: true, service: { name: "Cloud", privacy: { title: "Privacy Policy", revision: "r1", sections: [{ title: "1. Intro", paragraphs: ["We collect email."] }] } } }), { status: 200 }); };
  const missing = await probeServiceDocument("https://api.example.invalid", { fetchImpl });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.invalid/api/public/service");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(missing.disclosesGoogleData, false);
  assert.deepEqual(missing.found, { google: false, gmail: false, calendar: false, userDataPolicy: false, limitedUse: false });
  const full = await probeServiceDocument("https://api.example.invalid", { fetchImpl: async () => new Response(JSON.stringify({ service: { privacy: { title: "P", sections: [{ title: "Google user data", paragraphs: ["Gmail and Calendar data obtained through Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements."] }] } } }), { status: 200 }) });
  assert.equal(full.disclosesGoogleData, true);
  const down = await probeServiceDocument("https://api.example.invalid", { fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual([down.status, down.error, down.disclosesGoogleData], [0, "offline", false]);
});
