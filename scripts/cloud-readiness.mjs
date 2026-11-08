#!/usr/bin/env node
/**
 * Alpha Phone's Eliza Cloud registration values and a credential-free readiness probe.
 *
 *   node scripts/cloud-readiness.mjs registration [--environment production|staging] [--json]
 *   node scripts/cloud-readiness.mjs probe [--environment production|staging] [--signer SHA256] [--json]
 *
 * `registration` prints the values an Eliza Cloud operator enters for Alpha
 * (docs/human-actions.md H-11 to H-15), derived from committed product configuration:
 * app.config.json (package and App Auth client), config/cloud-deployment.json (hosts, tenant and
 * entitlement audience) and the sign-in callback path and Steward app client that Alpha's native
 * sign-in registers. It reads no secret and contacts nothing. Values only the operator knows (the
 * Cloud apps-row UUID, Google's Android OAuth client ID) are named, never invented.
 *
 * `probe` makes the same unauthenticated requests Alpha's sign-in readiness and plan check make,
 * once each, and reports each deployment gate with the step that owns it:
 *   registration      GET  {api}/api/v1/app-auth/mobile/config for this client, environment and return URL (H-11)
 *   sign-in methods   GET  {api}/steward/auth/providers?tenantId=..., and POST {api}/steward/auth/email/code/send
 *                     with an empty body, which Steward refuses as invalid without sending any email (H-12)
 *   native Google     googleNative in that providers answer (H-12)
 *   browser return    GET  {api}/steward/auth/oauth/google/authorize with a fresh state and S256 challenge;
 *                     the tenant allowlist admits the return URL when it redirects to Google (H-12; nothing is followed)
 *   App Links         GET  https://{web}/.well-known/assetlinks.json: production must grant the recorded release
 *                     signer; staging (test-mocks builds only) any certificate, or the one --signer names (H-13)
 *   callback page     GET  https://{web}/alphaphone/auth/callback, the hosted fallback (H-13)
 *   service documents GET  {api}/api/public/service, the Terms and Privacy text the sign-in screen shows (H-14)
 *   entitlement keys  GET  {api}/api/v1/subscription/entitlement-keys (H-15)
 * Two rows need an account and are listed without a request (state "account"): the Maps route
 * (H-16) and the Google connector routes for Gmail and Calendar (H-17). Cloud's global auth gate
 * answers every non-public /api/ path that carries no credential with 401 before routing, so an
 * unauthenticated 401 cannot tell a deployed route from a missing one; they are checked with an
 * authenticated read on a signed-in phone (H-32).
 * It never signs in, sends a code, redeems anything or follows a redirect. Exit 0 when every
 * checkable gate passes, 1 otherwise, 2 for a usage error. A pass is deployment configuration
 * evidence only, not a completed sign-in, plan admission or device result.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCloudDeployment } from "./cloud-deployment.mjs";
import { assetLinksGrants, publishedAssetLinksCheck, readAssetLinksSource } from "./render-assetlinks.mjs";

/** The return path and Steward app client Alpha's native sign-in registers (AlphaCloudSignInPlugin). */
export const CALLBACK_PATH = "/alphaphone/auth/callback";
export const STEWARD_APP_CLIENT = "alpha-phone";
const TIMEOUT_MS = 15_000;
const USAGE = "Usage: node scripts/cloud-readiness.mjs registration [--environment production|staging] [--json]\n       node scripts/cloud-readiness.mjs probe [--environment production|staging] [--signer SHA256] [--json]";
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const base64url = bytes => Buffer.from(bytes).toString("base64url");

/** Alpha's product registration for one Cloud environment, from committed configuration. */
export function productRegistration(root = process.cwd(), environment = "production") {
  const deployment = validateCloudDeployment(readJson(root, "config/cloud-deployment.json"))[environment];
  if (!deployment) throw new Error(`Unknown Cloud environment ${environment}`);
  const identity = readJson(root, "app.config.json");
  return {
    environment,
    api: deployment.api,
    web: deployment.web,
    tenant: deployment.tenant,
    entitlementAudience: deployment.entitlementAudience ?? "cloud-subscription",
    packageName: identity.appId,
    clientId: identity.appId,
    appName: identity.appName,
    callback: `${deployment.web}${CALLBACK_PATH}`,
    stewardAppClient: STEWARD_APP_CLIENT,
    signerSha256: readJson(root, "android/release-signer.json").signerSha256,
  };
}

/** The operator entries for one environment (docs/human-actions.md H-11 to H-15). */
export function registrationValues(registration) {
  const { environment, api, web, tenant, clientId, callback, packageName, appName, stewardAppClient, entitlementAudience } = registration;
  return [
    { step: "H-11", where: `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON (GitHub Environment secret "${environment}" of the Cloud release workflow), Alpha's entry`,
      value: { clientId, appId: "<UUID of Alpha's active, approved Cloud apps row>", redirectUri: callback, enabled: true },
      then: `Run the "Mobile App Auth Registration Admin" workflow on main with client ${clientId}: repair, then diagnose.` },
    { step: "H-12", where: `Steward tenant ${tenant} redirect allowlist (owner/admin session with recent MFA)`,
      value: { method: "POST", url: `${api}/steward/tenants/${tenant}/redirect-urls`, body: { url: callback } },
      then: "Read the list back; it appends and keeps other callbacks." },
    { step: "H-12", where: `STEWARD_GOOGLE_NATIVE_CLIENT_IDS (Steward deployment), key ${stewardAppClient}`,
      value: { [stewardAppClient]: [`<Android OAuth client ID for package ${packageName} and the release certificate SHA-1>`] },
      then: `Merge with the other app clients' keys. The tenant app client ${stewardAppClient} must allow Google; create the Android OAuth client in the Google Cloud project whose web client is Steward's Google audience, using the SHA-1 node scripts/enroll-release-keys.mjs prints. A debug or staging build needs its own Android client for its signer.` },
    { step: "H-13", where: "ELIZA_ANDROID_ASSET_LINKS_JSON (GitHub variable of the Cloud environment)",
      value: `node scripts/render-assetlinks.mjs --cloud-config --published ${web}/.well-known/assetlinks.json`,
      then: `Set the printed value, deploy, then node scripts/render-assetlinks.mjs --check ${web}/.well-known/assetlinks.json.` },
    { step: "H-13", where: `ELIZA_NATIVE_AUTH_CALLBACKS_JSON (Pages environment of ${new URL(web).host}), Alpha's entry`,
      value: { redirectUri: callback, androidPackage: packageName, appName },
      then: "Keep every other app's entry." },
    { step: "H-15", where: "Entitlement issuer audience", value: entitlementAudience,
      then: "Cloud's ELIZA_ENTITLEMENT_* signer must issue this audience (config/cloud-deployment.json entitlementAudience)." },
  ];
}

async function request(fetchImpl, url, init = {}) {
  try {
    const response = await fetchImpl(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    const text = await response.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status, location: response.headers.get("location"), body };
  } catch (error) {
    return { status: 0, location: null, body: null, error: error?.message ?? String(error) };
  }
}
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const reached = response => response.status === 0 ? `unreachable (${response.error})` : `HTTP ${response.status}`;

/** Service documents in the exact form the sign-in screen accepts (apps/app/src/runtime/cloud-service-info.ts). */
async function serviceDocumentsProblem(body) {
  try {
    const { parseCloudServiceInfo } = await import("../apps/app/src/runtime/cloud-service-info.ts");
    parseCloudServiceInfo(body);
    return null;
  } catch { return "the documents are missing or not in the form the sign-in screen shows"; }
}

/**
 * Run every gate once. Returns [{gate, step, passed, detail}] in a fixed order. `fetchImpl` is
 * injectable for tests; the real probe uses global fetch with manual redirects.
 */
export async function probe(registration, { fetchImpl = globalThis.fetch, debugFingerprints = [], signer = null } = {}) {
  const { api, web, tenant, clientId, environment, callback, packageName, signerSha256 } = registration;
  const gates = [];
  const gate = (name, step, passed, detail) => gates.push({ gate: name, step, passed, detail });

  const config = await request(fetchImpl, `${api}/api/v1/app-auth/mobile/config?clientId=${encodeURIComponent(clientId)}&environment=${environment}&redirectUri=${encodeURIComponent(callback)}`);
  const configBody = object(config.body);
  const registered = config.status === 200 && configBody.success === true && configBody.clientId === clientId && configBody.environment === environment
    && configBody.redirectUri === callback && configBody.codeChallengeMethod === "S256";
  gate("registration", "H-11", registered, registered ? `${clientId} is registered for ${callback} with S256`
    : `${reached(config)}${typeof configBody.error === "string" ? `: ${configBody.error}` : ""}; expected success for ${clientId}, ${environment}, ${callback} and S256`);

  const providers = await request(fetchImpl, `${api}/steward/auth/providers?tenantId=${encodeURIComponent(tenant)}`);
  const offered = object(providers.body), captcha = object(offered.captcha);
  const captchaFor = Array.isArray(captcha.requiredFor) ? captcha.requiredFor : [];
  const emailOffered = providers.status === 200 && offered.email === true && !(captcha.enabled === true && (captchaFor.includes("email_otp") || captchaFor.includes("email")));
  const emailRoute = await request(fetchImpl, `${api}/steward/auth/email/code/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const routePresent = emailRoute.status >= 400 && emailRoute.status < 500 && ![404, 405].includes(emailRoute.status);
  gate("email sign-in", "H-12", registered && emailOffered && routePresent,
    `${providers.status === 200 ? `email ${emailOffered ? "offered without a captcha" : "not offered (or behind a captcha)"}` : `providers ${reached(providers)}`}; code route ${routePresent ? "present" : reached(emailRoute)}${registered ? "" : "; needs the registration gate"}`);
  gate("native Google", "H-12", providers.status === 200 && offered.googleNative === true,
    providers.status === 200 ? `google ${offered.google === true ? "offered" : "not offered"}, googleNative ${offered.googleNative === true ? "advertised" : "not advertised (STEWARD_GOOGLE_NATIVE_CLIENT_IDS has no Android client for an app client of this tenant)"}` : `providers ${reached(providers)}`);

  const challenge = createHash("sha256").update(base64url(randomBytes(32))).digest("base64url");
  const authorize = await request(fetchImpl, `${api}/steward/auth/oauth/google/authorize?response_type=code&tenant_id=${encodeURIComponent(tenant)}&redirect_uri=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256&state=${base64url(randomBytes(32))}&prompt=select_account&mfa=exchange`);
  const admitted = [302, 303, 307].includes(authorize.status) && String(authorize.location ?? "").startsWith("https://accounts.google.com/");
  gate("browser return", "H-12", admitted, admitted ? `the ${tenant} allowlist admits ${callback}` : `${reached(authorize)}${typeof object(authorize.body).error === "string" ? `: ${object(authorize.body).error}` : ""}`);

  // Production must grant the recorded release certificate. Staging serves only test-mocks (debug-signed)
  // builds, so any grant passes there unless a specific build's certificate is named with `signer`.
  const expected = signer ?? (environment === "production" ? signerSha256 : null);
  let links;
  try {
    const source = await readAssetLinksSource(`${web}/.well-known/assetlinks.json`, { fetchImpl });
    if (expected === null) {
      const { granted, problems } = assetLinksGrants(source.text, packageName);
      const all = [...source.problems, ...problems];
      links = { passed: !all.length && granted.length > 0, detail: all.length ? all.join("; ") : `${packageName} is granted to ${granted.join(", ")} (debug-signed test-mocks builds; pass --signer to require one)` };
    } else {
      const result = publishedAssetLinksCheck(source.text, { packageName, signerSha256: expected, debugFingerprints });
      links = { passed: !source.problems.length && result.granted, detail: [...source.problems, ...result.problems, ...result.notes].join("; ") || `${packageName} is granted to ${signer ? "the named" : "the release"} certificate` };
    }
  } catch (error) { links = { passed: false, detail: `unreachable (${error?.message ?? error})` }; }
  gate("App Links", "H-13", links.passed, links.detail);

  const page = await request(fetchImpl, callback);
  gate("callback page", "H-13", page.status === 200, page.status === 200 ? `${callback} serves the fallback page` : reached(page));

  const service = await request(fetchImpl, `${api}/api/public/service`);
  const documents = service.status === 200 ? await serviceDocumentsProblem(service.body) : `${reached(service)} (Cloud answers 503 until CLOUD_PUBLIC_SERVICE_JSON is set)`;
  gate("service documents", "H-14", documents === null, documents === null ? `Terms and Privacy published by ${object(object(service.body).service).name}` : documents);

  const keys = await request(fetchImpl, `${api}/api/v1/subscription/entitlement-keys`);
  const keyList = Array.isArray(object(keys.body).keys) ? object(keys.body).keys : Array.isArray(object(object(keys.body).data).keys) ? object(object(keys.body).data).keys : null;
  const usable = (keyList ?? []).filter(key => object(key).kty === "EC" && object(key).crv === "P-256" && typeof object(key).kid === "string" && object(key).d === undefined);
  gate("entitlement keys", "H-15", keys.status === 200 && usable.length > 0, keys.status === 200 ? `${usable.length} ES256 signing key(s)${usable.length ? `: ${usable.map(key => key.kid).join(", ")}` : ""}` : `${reached(keys)} (Cloud answers 503 until ELIZA_ENTITLEMENT_* is set)`);

  for (const row of ACCOUNT_GATES) gate(row.gate, row.step, null, row.detail);
  return gates;
}

/**
 * Rows no unauthenticated request can decide, listed with `passed: null` and never requested.
 * Cloud's global auth middleware (packages/cloud/api/src/middleware/auth.ts) answers every
 * non-public /api/ path that carries no credential with 401 before the router runs, so the same
 * 401 comes back whether the route is deployed or not.
 */
export const ACCOUNT_GATES = Object.freeze([
  { gate: "Maps route", step: "H-16", detail: "needs an account: Cloud answers every protected /api/ path with 401 before routing, so only GET /api/v1/maps/capabilities with a signed-in plan shows the route, its coverage and its dataset revision (H-32)" },
  { gate: "Google connector", step: "H-17", detail: "needs an account: the Gmail and Calendar routes under /api/v1/eliza/google answer 401 without a session whether or not they are deployed; a signed-in connect, and inbox-v1/capabilities for readState, show them (H-27)" },
]);

const mark = passed => (passed === true ? "pass" : passed === false ? "FAIL" : "account");

export function formatProbe(registration, gates) {
  const lines = [`Eliza Cloud readiness for ${registration.packageName}, ${registration.environment} (${registration.api}):`];
  for (const row of gates) lines.push(`  [${mark(row.passed)}] ${row.gate} (${row.step}): ${row.detail}`);
  const failed = gates.filter(row => row.passed === false);
  const account = gates.filter(row => row.passed === null).length;
  lines.push("", failed.length ? `${failed.length} gate(s) open. Each names its step in docs/human-actions.md. This is deployment configuration evidence only.`
    : "Every checkable gate passes. This is deployment configuration evidence only, not a sign-in, plan admission or device result.");
  if (account) lines.push(`${account} row(s) need a signed-in account and were not requested.`);
  return lines.join("\n");
}

export function formatRegistration(registration, values) {
  const lines = [`Eliza Cloud registration for ${registration.appName} (${registration.packageName}), ${registration.environment} (${registration.api}):`, ""];
  values.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.where} (${row.step}):`, `   ${typeof row.value === "string" ? row.value : JSON.stringify(row.value)}`, `   ${row.then}`);
  });
  return lines.join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["registration", "probe"].includes(command)) return null;
  const options = { command, environment: "production", json: false, signer: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--json") options.json = true;
    else if (rest[i] === "--environment" && ["production", "staging"].includes(rest[i + 1])) options.environment = rest[++i];
    else if (rest[i] === "--signer" && command === "probe" && /^[0-9A-Fa-f]{64}$/.test(String(rest[i + 1] ?? "").replace(/:/g, ""))) options.signer = rest[++i].replace(/:/g, "").toLowerCase();
    else return null;
  }
  return options;
}

export async function main(argv, { root = process.cwd(), fetchImpl = globalThis.fetch, log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv);
  if (!options) { error(USAGE); return 2; }
  const registration = productRegistration(root, options.environment);
  if (options.command === "registration") {
    const values = registrationValues(registration);
    log(options.json ? JSON.stringify({ registration, values }, null, 2) : formatRegistration(registration, values));
    return 0;
  }
  const gates = await probe(registration, { fetchImpl, signer: options.signer });
  log(options.json ? JSON.stringify({ environment: registration.environment, api: registration.api, gates }, null, 2) : formatProbe(registration, gates));
  return gates.some(row => row.passed === false) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
