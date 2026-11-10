#!/usr/bin/env node
/**
 * Owner prep for Google OAuth production verification (issue #668, docs/human-actions.md H-17).
 *
 *   node scripts/owner/google-oauth-scopes.ts matrix [--json] [--vendor <eliza checkout>]
 *   node scripts/owner/google-oauth-scopes.ts probe  [--environment production|staging] [--json]
 *
 * `matrix` is offline. It lists every Google consent request Alpha can start, the Eliza Cloud
 * capabilities each one names, and the Google OAuth scopes Cloud maps them to, then the union the
 * consent screen must list with Google's sensitivity class for each scope. Alpha never names raw
 * scopes: it posts capabilities to /api/v1/eliza/google/connect/initiate
 * (apps/app/src/runtime/cloud-protocol.ts) and Cloud's `capabilitiesToScopes`
 * (CLOUD_MAPPING_SOURCE in the pinned vendor/eliza) chooses the scopes. When that checkout is
 * present the mapping is parsed from it and compared with the embedded copy; otherwise the
 * embedded copy is used and the output says so. test/owner-google-oauth-scopes.test.mjs pins the
 * consent paths below to the real CloudProtocol request bodies and the Settings UI calls.
 *
 * `probe` makes exactly one unauthenticated GET, {api}/api/public/service, the Terms and Privacy
 * text the sign-in screen shows, and reports whether the privacy text discloses Google user data
 * (Google, Gmail, Calendar, the API Services User Data Policy, Limited Use). It sends no
 * credential, follows no redirect and changes nothing. It reads Cloud's served copy only: the web
 * privacy page Google reviewers open is a client-rendered page this probe cannot read.
 *
 * Exit 0 on success (probe: privacy text discloses Google data), 1 on a failed check, 2 for usage.
 * This is configuration and source evidence only. It is not a Google verification result, an
 * OAuth grant, a real mailbox read or device evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudApi, errorMessage, isRecord, option } from "./input.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CLOUD_MAPPING_SOURCE = "packages/cloud/shared/src/lib/services/agent-google-connector/shared.ts";
const G = "https://www.googleapis.com/auth/";

/** Scopes Cloud always adds for identity, whatever capabilities are named. */
export const IDENTITY_SCOPES = Object.freeze([`${G}userinfo.email`, `${G}userinfo.profile`]);

/**
 * Embedded copy of Cloud's capabilitiesToScopes at the eliza pin in upstream.lock.json.
 * `google.gmail.manage` exists in Cloud but Alpha never requests it.
 */
type CapabilityScopes = Readonly<Record<string, readonly string[]>>;

export const EMBEDDED_CAPABILITY_SCOPES: CapabilityScopes = Object.freeze({
  "google.basic_identity": [],
  "google.calendar.read": [`${G}calendar.readonly`],
  "google.calendar.write": [`${G}calendar.events`],
  "google.gmail.triage": [`${G}gmail.readonly`],
  "google.gmail.send": [`${G}gmail.send`],
  "google.gmail.drafts": [`${G}gmail.compose`],
  "google.gmail.mailbox": [`${G}gmail.modify`],
  "google.gmail.manage": [`${G}gmail.modify`, `${G}gmail.settings.basic`],
});

/**
 * Google's published sensitivity class for each scope (OAuth 2.0 Scopes for Google APIs and the
 * Gmail/Calendar scope pages). The Cloud Console Data Access page is authoritative; recheck there.
 * Restricted Gmail scopes need verification plus the annual third-party security assessment.
 */
type ScopeClass = "non-sensitive" | "sensitive" | "restricted";

export const GOOGLE_SCOPE_CLASS: Readonly<Record<string, ScopeClass | undefined>> = Object.freeze({
  [`${G}userinfo.email`]: "non-sensitive",
  [`${G}userinfo.profile`]: "non-sensitive",
  [`${G}calendar.readonly`]: "sensitive",
  [`${G}calendar.events`]: "sensitive",
  [`${G}gmail.send`]: "sensitive",
  [`${G}gmail.readonly`]: "restricted",
  [`${G}gmail.compose`]: "restricted",
  [`${G}gmail.modify`]: "restricted",
  [`${G}gmail.settings.basic`]: "restricted",
});

const IDENTITY = "google.basic_identity", TRIAGE = "google.gmail.triage";
const MODIFY_STEP = ["google.gmail.send", "google.gmail.drafts", "google.gmail.mailbox"];

/**
 * Every consent request Alpha can start, with the exact capability body it posts. `ui` paths are
 * buttons in apps/app/src/runtime/google-connection-ui.tsx (all go through initiateGoogle);
 * `api` paths exist in CloudProtocol but no shipped screen calls them today.
 */
export const ALPHA_CONSENT_PATHS = Object.freeze([
  { id: "connect", surface: "ui", ui: "Settings > Google: Connect / Add Google account, or turn on a Gmail changes / Calendar edits switch whose grant is missing", call: ["initiateGoogle", "write", "send"],
    capabilities: [IDENTITY, TRIAGE, "google.calendar.read", "google.calendar.write", "google.gmail.send"] },
  { id: "switch-upgrade-modify", surface: "ui", ui: "Settings > Google: turn on a switch whose grant is missing while an account already holds Gmail changes", call: ["initiateGoogle", "write", "modify"],
    capabilities: [IDENTITY, TRIAGE, ...MODIFY_STEP, "google.calendar.read", "google.calendar.write"] },
  { id: "calendar-connect", surface: "ui", ui: "Calendar > Connect Google Calendar (Google accounts opened with the Calendar intent) when no account holds Gmail send or changes; otherwise that intent reuses connect or switch-upgrade-modify", call: ["initiateGoogle", "write", "read"],
    capabilities: [IDENTITY, TRIAGE, "google.calendar.read", "google.calendar.write"] },
  { id: "enable-gmail-changes", surface: "api", call: ["initiateGoogle", "read", "modify"],
    capabilities: [IDENTITY, TRIAGE, ...MODIFY_STEP, "google.calendar.read"] },
  { id: "api-drafts", surface: "api", call: ["initiateGoogle", "read", "drafts"],
    capabilities: [IDENTITY, TRIAGE, "google.calendar.read", "google.gmail.drafts"] },
  { id: "api-mailbox", surface: "api", call: ["initiateGoogle", "read", "mailbox"],
    capabilities: [IDENTITY, TRIAGE, "google.calendar.read", "google.gmail.mailbox"] },
  { id: "api-gmail-read", surface: "api", call: ["initiateGmail", "read"], capabilities: [IDENTITY, TRIAGE] },
  { id: "api-gmail-modify", surface: "api", call: ["initiateGmail", "modify"], capabilities: [IDENTITY, TRIAGE, ...MODIFY_STEP] },
]);

/** Parse Cloud's capabilitiesToScopes body: `capability === "x"` followed by `scopes.add("y")` lines. */
export function parseCloudMapping(source: string) {
  const start = source.indexOf("export function capabilitiesToScopes");
  if (start < 0) throw new Error("capabilitiesToScopes not found in the Cloud source");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const mapping: Record<string, string[]> = { [IDENTITY]: [] };
  let current: string | undefined;
  for (const line of body.split("\n")) {
    const cap = line.match(/capability === "([^"]+)"/);
    if (cap) { current = cap[1]; mapping[current] ??= []; }
    const add = line.match(/scopes\.add\("([^"]+)"\)/);
    if (add && current) mapping[current].push(add[1]);
  }
  const always = [...body.matchAll(/new Set<string>\(\[([\s\S]*?)\]\)/g)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
  return { mapping, identity: always };
}

const sortedMapping = (mapping: CapabilityScopes) =>
  Object.keys(mapping).sort().map(key => [key, [...mapping[key]].sort()]);

/** Load the mapping from the pinned checkout when it exists; report drift against the embedded copy. */
export function loadMapping(vendor = path.join(ROOT, "vendor/eliza")) {
  const file = path.join(vendor, CLOUD_MAPPING_SOURCE);
  if (!fs.existsSync(file)) return { source: "embedded (vendor/eliza not checked out)", mapping: EMBEDDED_CAPABILITY_SCOPES, identity: IDENTITY_SCOPES, drift: null };
  const parsed = parseCloudMapping(fs.readFileSync(file, "utf8"));
  const drift = JSON.stringify(sortedMapping(parsed.mapping)) === JSON.stringify(sortedMapping(EMBEDDED_CAPABILITY_SCOPES)) && JSON.stringify([...parsed.identity].sort()) === JSON.stringify([...IDENTITY_SCOPES].sort())
    ? null : "the pinned Cloud mapping differs from the embedded copy; update EMBEDDED_CAPABILITY_SCOPES and the runbook";
  return { source: path.relative(ROOT, file), ...parsed, drift };
}

export function scopesFor(capabilities: readonly string[], mapping = EMBEDDED_CAPABILITY_SCOPES, identity = IDENTITY_SCOPES) {
  const scopes = new Set(identity);
  for (const capability of new Set([IDENTITY, ...capabilities])) {
    if (!Object.hasOwn(mapping, capability)) throw new Error(`Unknown Cloud capability ${capability}`);
    for (const scope of mapping[capability]) scopes.add(scope);
  }
  return [...scopes];
}

/** Notes a Google reviewer is likely to raise, derived from the scope sets rather than asserted. */
export function reviewNotes(paths: readonly { id: string; scopes: readonly string[] }[]) {
  const notes = [];
  for (const p of paths) {
    const s = new Set(p.scopes);
    if (s.has(`${G}gmail.modify`) && (s.has(`${G}gmail.send`) || s.has(`${G}gmail.compose`)))
      notes.push(`${p.id}: requests gmail.modify together with ${[s.has(`${G}gmail.send`) && "gmail.send", s.has(`${G}gmail.compose`) && "gmail.compose"].filter(Boolean).join(" and ")}; Google documents gmail.modify as covering read, compose and send, so a reviewer may ask why the narrower scopes are also requested (see the runbook's decision D-1)`);
  }
  return notes;
}

export function matrix({ vendor }: { vendor?: string } = {}) {
  const loaded = loadMapping(vendor);
  const paths = ALPHA_CONSENT_PATHS.map(p => ({ ...p, scopes: scopesFor(p.capabilities, loaded.mapping, loaded.identity) }));
  const shipped = [...new Set(paths.filter(p => p.surface === "ui").flatMap(p => p.scopes))];
  const all = [...new Set(paths.flatMap(p => p.scopes))];
  const classify = (scope: string) => ({ scope, class: GOOGLE_SCOPE_CLASS[scope] ?? "unknown" });
  return {
    mappingSource: loaded.source, drift: loaded.drift,
    capabilities: Object.fromEntries(Object.entries(loaded.mapping).map(([k, v]) => [k, [...v]])),
    paths,
    consentScreen: { shippedUi: shipped.map(classify), includingApiOnly: all.map(classify) },
    restricted: all.filter(s => GOOGLE_SCOPE_CLASS[s] === "restricted"),
    neverRequested: Object.keys(loaded.mapping).filter(c => !paths.some(p => p.capabilities.includes(c))),
    reviewNotes: reviewNotes(paths),
  };
}

const DISCLOSURES = Object.freeze({
  google: /google/i, gmail: /gmail/i, calendar: /calendar/i,
  userDataPolicy: /API Services User Data Policy/i, limitedUse: /limited use/i,
});

/** One read-only GET of the served Terms/Privacy text. Never sends a credential. */
export async function probeServiceDocument(api: string, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const url = `${api}/api/public/service`;
  let status = 0;
  let body: unknown = null, error: string | null = null;
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    status = response.status;
    try { body = JSON.parse(await response.text()); } catch { body = null; }
  } catch (e) { error = errorMessage(e); }
  const service = isRecord(body) ? body.service : undefined;
  const privacy = isRecord(service) ? service.privacy : undefined;
  if (status !== 200 || !isRecord(privacy)) return { url, status, error, privacy: null, disclosesGoogleData: false };
  const text = JSON.stringify(privacy);
  const found = {
    google: DISCLOSURES.google.test(text),
    gmail: DISCLOSURES.gmail.test(text),
    calendar: DISCLOSURES.calendar.test(text),
    userDataPolicy: DISCLOSURES.userDataPolicy.test(text),
    limitedUse: DISCLOSURES.limitedUse.test(text),
  };
  return {
    url, status, error,
    privacy: { title: privacy.title ?? null, revision: privacy.revision ?? null, sections: Array.isArray(privacy.sections) ? privacy.sections.map(section => isRecord(section) ? section.title ?? "" : "") : [] },
    found,
    disclosesGoogleData: found.google && found.gmail && found.calendar && (found.userDataPolicy || found.limitedUse),
  };
}

function printMatrix(m: ReturnType<typeof matrix>) {
  console.log(`Cloud mapping: ${m.mappingSource}${m.drift ? `\nDRIFT: ${m.drift}` : ""}`);
  console.log("\nCapability -> Google scopes (identity scopes are always added):");
  for (const [c, s] of Object.entries(m.capabilities)) console.log(`  ${c.padEnd(24)} ${s.length ? s.map(x => x.replace(G, "")).join(", ") : "(userinfo.email, userinfo.profile)"}`);
  console.log("\nAlpha consent requests:");
  for (const p of m.paths) console.log(`  [${p.surface}] ${p.id}: ${p.call.join(" ")}\n      capabilities ${p.capabilities.join(", ")}\n      scopes       ${p.scopes.map(x => x.replace(G, "")).join(", ")}`);
  console.log("\nConsent screen (shipped UI):");
  for (const s of m.consentScreen.shippedUi) console.log(`  ${s.class.padEnd(14)} ${s.scope}`);
  console.log(`\nRestricted scopes (security assessment): ${m.restricted.map(x => x.replace(G, "")).join(", ")}`);
  console.log(`Cloud capabilities Alpha never requests: ${m.neverRequested.join(", ") || "none"}`);
  for (const n of m.reviewNotes) console.log(`NOTE ${n}`);
}

async function main(argv: readonly string[]) {
  const [mode, ...rest] = argv;
  const flag = (name: string) => rest.includes(name);
  if (mode === "matrix") {
    const m = matrix({ vendor: option(rest, "--vendor") });
    if (flag("--json")) console.log(JSON.stringify(m, null, 2)); else printMatrix(m);
    return m.drift ? 1 : 0;
  }
  if (mode === "probe") {
    const environment = option(rest, "--environment") ?? "production";
    const api = cloudApi(ROOT, environment);
    if (!api) { console.error(`Unknown environment ${environment}`); return 2; }
    const result = await probeServiceDocument(api);
    if (flag("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`GET ${result.url} -> ${result.status || `unreachable (${result.error})`}`);
      if (result.privacy) {
        console.log(`Privacy: ${result.privacy.title} (${result.privacy.revision}); sections: ${result.privacy.sections.join(" / ")}`);
        for (const [k, v] of Object.entries(result.found)) console.log(`  mentions ${k.padEnd(15)} ${v ? "yes" : "NO"}`);
      }
      console.log(result.disclosesGoogleData ? "Privacy text discloses Google user data." : "Privacy text does NOT disclose Google user data use (needed for Google verification; runbook step 2).");
    }
    return result.disclosesGoogleData ? 0 : 1;
  }
  console.error("Usage: node scripts/owner/google-oauth-scopes.ts matrix [--json] [--vendor <dir>]\n       node scripts/owner/google-oauth-scopes.ts probe [--environment production|staging] [--json]");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = await main(process.argv.slice(2));
