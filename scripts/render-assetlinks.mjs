#!/usr/bin/env node
/**
 * Render the /.well-known/assetlinks.json for the verified App Links return host from the
 * committed release-signer descriptor, and check rendered or published copies.
 *
 *   node scripts/render-assetlinks.mjs [--out FILE] [--debug-fingerprint HEX ...]
 *   node scripts/render-assetlinks.mjs --cloud-config [--published FILE|URL] [--keep-fingerprint HEX ...]
 *   node scripts/render-assetlinks.mjs --check FILE|URL [--debug-fingerprint HEX ...]
 *
 * The fingerprint comes only from android/release-signer.json signerSha256. It is refused while
 * that is "unset", when the template placeholder would remain, and when it equals a debug signing
 * certificate: every debug row's signerSha256 in artifacts/apk-manifest.json and each
 * --debug-fingerprint given. Writes artifacts/assetlinks.json by default. The file holds no secret.
 *
 * Alpha's return host is the Eliza Cloud web host (ELIZAOS_APP_LINK_HOST must equal
 * config/cloud-deployment.json production.web), whose assetlinks.json Cloud builds only from the
 * operator variable ELIZA_ANDROID_ASSET_LINKS_JSON: one {package_name, sha256_cert_fingerprints,
 * relations?} entry per app, and any malformed entry or duplicate package publishes [] for every
 * app. --cloud-config prints that variable's value with Alpha's entry carrying the release
 * fingerprint (plus each --keep-fingerprint), keeping every other app's entry from the --published
 * document unchanged; the operator sets it (docs/human-actions.md H-13). --check reads a rendered
 * file or the published URL (HTTPS, HTTP 200 without a redirect, application/json, as Android's
 * verifier requires) and exits 0 only when it grants handle_all_urls to Alpha's package for the
 * recorded release signer.
 *
 * Publishing is the operator's step (docs/human-actions.md H-13). The https
 * autoVerify filter itself defaults to the configured production web host
 * (android/app/product.gradle); appLinkFilters() reads it back from an APK manifest dump.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE = "android/app/src/main/assetlinks.template.json";
export const SIGNER_FILE = "android/release-signer.json";
export const PLACEHOLDER = "RELEASE_CERT_SHA256_PLACEHOLDER";
export const DEFAULT_OUTPUT = "artifacts/assetlinks.json";
const HEX64 = /^[0-9a-f]{64}$/;

/** Lower-case hex or colon-separated SHA-256 as the AB:CD:... form assetlinks.json uses. */
export function fingerprint(value) {
  const hex = String(value ?? "").replace(/:/g, "").toLowerCase();
  if (!HEX64.test(hex)) throw new Error(`Not a SHA-256 certificate digest: ${JSON.stringify(value)}`);
  return hex.toUpperCase().match(/../g).join(":");
}

/** Problems with an assetlinks.json text: placeholders, unset or malformed digests, or a debug certificate. */
export function assetLinksProblems(text, { debugFingerprints = [] } = {}) {
  const problems = [];
  if (text.includes(PLACEHOLDER)) problems.push(`assetlinks.json still contains ${PLACEHOLDER}`);
  let statements;
  try { statements = JSON.parse(text); } catch { return [...problems, "assetlinks.json is not JSON"]; }
  if (!Array.isArray(statements) || !statements.length) return [...problems, "assetlinks.json holds no statement"];
  const debug = new Set(debugFingerprints.map(value => { try { return fingerprint(value); } catch { return null; } }).filter(Boolean));
  for (const statement of statements) {
    const prints = statement?.target?.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || !prints.length) { problems.push("a statement lists no sha256_cert_fingerprints"); continue; }
    for (const value of prints) {
      if (value === PLACEHOLDER) continue;
      if (value === "unset") { problems.push("a statement carries the unset release signer"); continue; }
      let normalized;
      try { normalized = fingerprint(value); } catch { problems.push(`malformed certificate fingerprint ${JSON.stringify(value)}`); continue; }
      if (normalized !== value) problems.push(`fingerprint ${value} is not in upper-case colon-separated form`);
      if (debug.has(normalized)) problems.push(`fingerprint ${normalized} is a debug signing certificate`);
    }
  }
  return problems;
}

/** Fill the template for `packageName` with the release signer, refusing anything but a reviewed release certificate. */
export function renderAssetLinks({ template, signerSha256, packageName, debugFingerprints = [] }) {
  if (signerSha256 === "unset") throw new Error(`${SIGNER_FILE} signerSha256 is "unset"; record the release certificate first (owner decision A-06)`);
  if (signerSha256 === PLACEHOLDER) throw new Error(`${SIGNER_FILE} signerSha256 is the template placeholder`);
  if (!HEX64.test(signerSha256 ?? "")) throw new Error(`${SIGNER_FILE} signerSha256 must be 64 lower-case hex characters`);
  const statements = JSON.parse(template);
  for (const statement of statements) {
    if (statement.target?.package_name !== packageName) throw new Error(`${TEMPLATE} names ${statement.target?.package_name}, not ${packageName}`);
    statement.target.sha256_cert_fingerprints = [fingerprint(signerSha256)];
  }
  const text = `${JSON.stringify(statements, null, 2)}\n`;
  const problems = assetLinksProblems(text, { debugFingerprints });
  if (problems.length) throw new Error(`Refusing to render assetlinks.json:\n  - ${problems.join("\n  - ")}`);
  return text;
}

/** Debug signing certificates verify-apks recorded (debug rows are signed by the build machine's debug key). */
export function recordedDebugFingerprints(manifestFile) {
  if (!fs.existsSync(manifestFile)) return [];
  try { return (JSON.parse(fs.readFileSync(manifestFile, "utf8")).results ?? []).filter(row => row.mode === "debug" && HEX64.test(row.signerSha256 ?? "")).map(row => row.signerSha256); }
  catch { return []; }
}

/**
 * https autoVerify intent filters in an `aapt dump xmltree` of AndroidManifest.xml.
 * @returns {{present: boolean, hosts: string[]}}
 */
export function appLinkFilters(xmltree) {
  const lines = String(xmltree ?? "").split("\n");
  const hosts = new Set();
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)E: intent-filter\b/.exec(lines[i]);
    if (!start) continue;
    const depth = start[1].length;
    let autoVerify = false, https = false;
    const found = [];
    for (let j = i + 1; j < lines.length; j++) {
      const indent = /^(\s*)/.exec(lines[j])[1].length;
      if (lines[j].trim() && indent <= depth) break;
      if (/android:autoVerify\([^)]*\)=\(type 0x12\)0xffffffff/.test(lines[j]) || /android:autoVerify\([^)]*\)=true/.test(lines[j])) autoVerify = true;
      if (/android:scheme\([^)]*\)="https"/.test(lines[j])) https = true;
      const host = /android:host\([^)]*\)="([^"]+)"/.exec(lines[j]);
      if (host) found.push(host[1]);
    }
    if (autoVerify && https) for (const host of found) hosts.add(host);
  }
  return { present: hosts.size > 0, hosts: [...hosts].sort() };
}

/** Required callback on a parsed aapt XMLtree (the shared parseXmlTree output). */
export function requiredAppLinkProblems(tree, {host, path: callbackPath, activity}) {
  const manifest = tree?.name === 'manifest' ? tree : tree?.children?.find(node => node.name === 'manifest');
  const application = manifest?.children?.find(node => node.name === 'application');
  const yes = value => value === '0xffffffff' || value === 'true';
  const qualified = name => name?.startsWith('.') ? manifest?.attrs?.package + name : name;
  const matches = (application?.children ?? []).filter(node => node.name === 'activity' && qualified(node.attrs.name) === activity)
    .filter(node => yes(node.attrs.exported) && !['0x0', 'false'].includes(node.attrs.enabled))
    .flatMap(node => node.children.filter(child => child.name === 'intent-filter'))
    .some(filter => {
      if (!yes(filter.attrs.autoVerify)) return false;
      const names = tag => filter.children.filter(node => node.name === tag).map(node => node.attrs.name);
      if (!names('action').includes('android.intent.action.VIEW') ||
          !names('category').includes('android.intent.category.DEFAULT') ||
          !names('category').includes('android.intent.category.BROWSABLE')) return false;
      const data = filter.children.filter(node => node.name === 'data');
      const values = name => [...new Set(data.map(node => node.attrs[name]).filter(value => value !== undefined))];
      // Android combines data attributes within one filter. Accept split exact attributes,
      // but never a prefix/pattern or an extra authority that broadens this callback filter.
      return values('scheme').length === 1 && values('scheme')[0] === 'https' &&
        values('host').length === 1 && values('host')[0] === host &&
        values('path').length === 1 && values('path')[0] === callbackPath &&
        data.every(node => Object.keys(node.attrs).every(name => ['scheme', 'host', 'path'].includes(name)));
    });
  return matches ? [] : [`Missing exported HTTPS autoVerify callback https://${host}${callbackPath} on ${activity}`];
}

/**
 * What Cloud accepts in ELIZA_ANDROID_ASSET_LINKS_JSON, mirrored from the pinned
 * packages/cloud/shared/src/lib/auth/android-asset-links.ts. Cloud publishes [] for every app when
 * any entry breaks one of these rules, so a value is checked here before an operator sets it.
 */
export const CLOUD_ASSET_LINKS = Object.freeze({
  variable: "ELIZA_ANDROID_ASSET_LINKS_JSON",
  maxBytes: 16_384,
  maxEntries: 16,
  maxFingerprints: 8,
  relations: Object.freeze(["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"]),
  defaultRelations: Object.freeze(["delegate_permission/common.handle_all_urls"]),
});
const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const COLON_SHA256 = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Problems with an ELIZA_ANDROID_ASSET_LINKS_JSON entry list under Cloud's rules; empty when Cloud would publish it. */
export function cloudEntryProblems(entries) {
  if (!Array.isArray(entries)) return ["the value must be a JSON array"];
  const problems = [];
  const text = JSON.stringify(entries);
  if (text.length > CLOUD_ASSET_LINKS.maxBytes) problems.push(`the value is ${text.length} bytes; Cloud accepts at most ${CLOUD_ASSET_LINKS.maxBytes}`);
  if (entries.length > CLOUD_ASSET_LINKS.maxEntries) problems.push(`${entries.length} entries; Cloud accepts at most ${CLOUD_ASSET_LINKS.maxEntries}`);
  const packages = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["package_name", "sha256_cert_fingerprints", "relations"].includes(key))) {
      problems.push(`entry ${JSON.stringify(entry)} has fields other than package_name, sha256_cert_fingerprints and relations`);
      continue;
    }
    const name = entry.package_name;
    if (typeof name !== "string" || name.length > 255 || !ANDROID_PACKAGE.test(name)) problems.push(`invalid package_name ${JSON.stringify(name)}`);
    else if (packages.has(name)) problems.push(`${name} appears twice; Cloud would publish [] for every app`);
    else packages.add(name);
    const prints = entry.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || !prints.length || prints.length > CLOUD_ASSET_LINKS.maxFingerprints || new Set(prints).size !== prints.length || prints.some(value => typeof value !== "string" || !COLON_SHA256.test(value)))
      problems.push(`${name}: sha256_cert_fingerprints must be 1 to ${CLOUD_ASSET_LINKS.maxFingerprints} distinct upper-case colon-separated SHA-256 values`);
    if (entry.relations !== undefined && (!Array.isArray(entry.relations) || !entry.relations.length || new Set(entry.relations).size !== entry.relations.length || entry.relations.some(value => !CLOUD_ASSET_LINKS.relations.includes(value))))
      problems.push(`${name}: relations must be distinct values from ${CLOUD_ASSET_LINKS.relations.join(", ")}`);
  }
  return problems;
}

/** A published assetlinks.json statement list as the ELIZA_ANDROID_ASSET_LINKS_JSON entries that produce it. */
export function statementsToCloudEntries(statements) {
  if (!Array.isArray(statements)) throw new Error("assetlinks.json is not a statement list");
  return statements.map(statement => {
    const target = statement?.target;
    if (target?.namespace !== "android_app" || !Array.isArray(statement.relation))
      throw new Error(`statement ${JSON.stringify(statement)} cannot be expressed in ${CLOUD_ASSET_LINKS.variable} (android_app targets only)`);
    const relation = [...statement.relation];
    return { package_name: target.package_name, sha256_cert_fingerprints: [...(target.sha256_cert_fingerprints ?? [])],
      ...(sameList(relation, CLOUD_ASSET_LINKS.defaultRelations) ? {} : { relations: relation }) };
  });
}

/**
 * The ELIZA_ANDROID_ASSET_LINKS_JSON value with Alpha's entry carrying the release certificate first
 * and then each kept fingerprint. Other apps' entries are returned unchanged; Alpha's relations are
 * kept when it already has an entry. Returns {entries, text, removed, keptDebug}: `removed` lists
 * fingerprints Alpha's previous entry had that the new one drops, `keptDebug` kept values that are
 * recorded debug signers (legitimate on staging, never a release identity).
 */
export function cloudAssetLinksConfig({ entries = [], packageName, signerSha256, keep = [], debugFingerprints = [] }) {
  if (signerSha256 === "unset") throw new Error(`${SIGNER_FILE} signerSha256 is "unset"; record the release certificate first (docs/human-actions.md H-09)`);
  if (!HEX64.test(signerSha256 ?? "")) throw new Error(`${SIGNER_FILE} signerSha256 must be 64 lower-case hex characters`);
  const release = fingerprint(signerSha256);
  const debug = new Set(debugFingerprints.map(value => { try { return fingerprint(value); } catch { return null; } }).filter(Boolean));
  if (debug.has(release)) throw new Error(`${SIGNER_FILE} names a debug signing certificate (${release})`);
  const kept = keep.map(fingerprint).filter(value => value !== release);
  const previous = entries.find(entry => entry?.package_name === packageName);
  const alpha = { package_name: packageName, sha256_cert_fingerprints: [...new Set([release, ...kept])], ...(previous?.relations ? { relations: previous.relations } : {}) };
  const next = previous ? entries.map(entry => (entry === previous ? alpha : entry)) : [...entries, alpha];
  const problems = cloudEntryProblems(next);
  if (problems.length) throw new Error(`Refusing to render ${CLOUD_ASSET_LINKS.variable}:\n  - ${problems.join("\n  - ")}`);
  return { entries: next, text: JSON.stringify(next), removed: (previous?.sha256_cert_fingerprints ?? []).filter(value => !alpha.sha256_cert_fingerprints.includes(value)),
    keptDebug: kept.filter(value => debug.has(value)) };
}

/**
 * The certificates (colon form) a published assetlinks.json grants handle_all_urls for
 * `packageName`, with the problems that make the document unusable. {granted, problems}.
 */
export function assetLinksGrants(text, packageName) {
  const problems = [];
  let statements;
  try { statements = JSON.parse(text); } catch { return { granted: [], problems: ["assetlinks.json is not JSON"] }; }
  if (!Array.isArray(statements)) return { granted: [], problems: ["assetlinks.json is not a statement list"] };
  if (!statements.length) problems.push("assetlinks.json is [] (Cloud publishes [] when its variable is unset or malformed)");
  const granted = new Set();
  for (const statement of statements)
    if (statement?.target?.namespace === "android_app" && statement.target.package_name === packageName && Array.isArray(statement.relation) && statement.relation.includes(HANDLE_ALL_URLS))
      for (const value of statement.target.sha256_cert_fingerprints ?? []) { try { granted.add(fingerprint(value)); } catch { problems.push(`malformed fingerprint ${JSON.stringify(value)} for ${packageName}`); } }
  if (statements.length && !granted.size) problems.push(`no statement grants ${HANDLE_ALL_URLS} to ${packageName}`);
  return { granted: [...granted], problems };
}

/**
 * Whether a published assetlinks.json grants handle_all_urls to `packageName` for the recorded
 * release signer. {granted, problems, notes}: problems explain a refusal, notes list other
 * certificates the document grants (debug signers named as such).
 */
export function publishedAssetLinksCheck(text, { packageName, signerSha256, debugFingerprints = [] }) {
  const notes = [];
  const parsed = assetLinksGrants(text, packageName);
  const problems = [...parsed.problems];
  const granted = new Set(parsed.granted);
  let release = null;
  if (signerSha256 === "unset") problems.push(`${SIGNER_FILE} signerSha256 is "unset"; the release certificate is not recorded yet (docs/human-actions.md H-09)`);
  else if (!HEX64.test(signerSha256 ?? "")) problems.push(`${SIGNER_FILE} signerSha256 is not a SHA-256`);
  else {
    release = fingerprint(signerSha256);
    if (granted.size && !granted.has(release)) problems.push(`${packageName} is granted, but not for the release certificate ${release}`);
  }
  const debug = new Set(debugFingerprints.map(value => { try { return fingerprint(value); } catch { return null; } }).filter(Boolean));
  for (const value of granted) if (value !== release) notes.push(`${packageName} is also granted to ${value}${debug.has(value) ? " (a recorded debug signing certificate)" : ""}`);
  return { granted: problems.length === 0 && release !== null && granted.has(release), problems, notes };
}

/**
 * Read a file, or fetch an https URL the way Android's verifier does: HTTP 200 with no redirect and
 * a JSON content type. Returns {text, problems}; any problem means the host would not verify.
 */
export async function readAssetLinksSource(source, { fetchImpl = globalThis.fetch } = {}) {
  if (!/^https?:\/\//i.test(source)) return { text: fs.readFileSync(source, "utf8"), problems: [] };
  const url = new URL(source);
  if (url.protocol !== "https:") return { text: "", problems: [`${source} is not https; Android verifies App Links only over HTTPS`] };
  const response = await fetchImpl(url.href, { redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const problems = [];
  if (response.status >= 300 && response.status < 400) problems.push(`${source} redirects (HTTP ${response.status}); Android does not follow redirects for assetlinks.json`);
  else if (response.status !== 200) problems.push(`${source} answered HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 200 && !/^application\/json\b/i.test(type)) problems.push(`${source} has content type ${JSON.stringify(type)}, not application/json`);
  return { text: response.status === 200 ? await response.text() : "", problems };
}

const USAGE = [
  "Usage: node scripts/render-assetlinks.mjs [--out FILE] [--debug-fingerprint HEX ...]",
  "       node scripts/render-assetlinks.mjs --cloud-config [--published FILE|URL] [--keep-fingerprint HEX ...] [--debug-fingerprint HEX ...]",
  "       node scripts/render-assetlinks.mjs --check FILE|URL [--debug-fingerprint HEX ...]",
].join("\n");

function parseArgs(argv) {
  const options = { mode: "render", out: DEFAULT_OUTPUT, debug: [], keep: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], value = argv[i + 1];
    if (arg === "--cloud-config") { if (options.mode !== "render") return null; options.mode = "cloud"; continue; }
    if (!["--out", "--debug-fingerprint", "--keep-fingerprint", "--published", "--check"].includes(arg) || value === undefined || value.startsWith("--")) return null;
    i++;
    if (arg === "--out") options.out = value;
    else if (arg === "--debug-fingerprint") options.debug.push(value);
    else if (arg === "--keep-fingerprint") options.keep.push(value);
    else if (arg === "--published") options.published = value;
    else { if (options.mode !== "render") return null; options.mode = "check"; options.check = value; }
  }
  if (options.mode !== "cloud" && (options.keep.length || options.published)) return null;
  if (options.mode !== "render" && argv.includes("--out")) return null;
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options) { console.error(USAGE); return 2; }
  const signerSha256 = JSON.parse(fs.readFileSync(SIGNER_FILE, "utf8")).signerSha256;
  const packageName = JSON.parse(fs.readFileSync("app.config.json", "utf8")).appId;
  const debugFingerprints = [...options.debug, ...recordedDebugFingerprints("artifacts/apk-manifest.json")];
  try {
    if (options.mode === "check") {
      const source = await readAssetLinksSource(options.check);
      const result = publishedAssetLinksCheck(source.text, { packageName, signerSha256, debugFingerprints });
      for (const note of result.notes) console.log(`note: ${note}`);
      const problems = [...source.problems, ...result.problems];
      if (problems.length || !result.granted) { console.error(`${options.check} does not verify ${packageName} for the release signer:\n  - ${problems.join("\n  - ")}`); return 1; }
      console.log(`${options.check} grants ${packageName} to the release certificate ${fingerprint(signerSha256)}.`);
      return 0;
    }
    if (options.mode === "cloud") {
      let entries = [];
      if (options.published) {
        const source = await readAssetLinksSource(options.published);
        if (source.problems.length) console.error(`warning: ${source.problems.join("; ")}`);
        if (source.text) entries = statementsToCloudEntries(JSON.parse(source.text));
        // Cloud publishes [] both while the variable is unset and when it is malformed; in the second
        // case the other apps' entries exist only in the variable, and this value would drop them.
        if (!entries.length) console.error(`warning: ${options.published} lists no statement, so no other app's entry could be read from it. If ${CLOUD_ASSET_LINKS.variable} is set (Cloud publishes [] for a malformed value), add Alpha's entry below to its current entries instead of replacing them.`);
      } else console.error(`warning: without --published the value below holds only Alpha's entry; setting it replaces every other app's entry in ${CLOUD_ASSET_LINKS.variable}. Pass --published https://<web host>/.well-known/assetlinks.json to keep them.`);
      const result = cloudAssetLinksConfig({ entries, packageName, signerSha256, keep: options.keep, debugFingerprints });
      for (const value of result.removed) console.error(`note: ${packageName} no longer lists ${value}; pass --keep-fingerprint ${value} to keep it`);
      for (const value of result.keptDebug) console.error(`warning: ${value} is a recorded debug signing certificate; keep it only where debug builds must verify (staging), never as a release identity`);
      console.error(`Set ${CLOUD_ASSET_LINKS.variable} on the Cloud environment to the value below (docs/human-actions.md H-13), deploy, then run: node scripts/render-assetlinks.mjs --check https://<web host>/.well-known/assetlinks.json`);
      console.log(result.text);
      return 0;
    }
    const text = renderAssetLinks({ template: fs.readFileSync(TEMPLATE, "utf8"), signerSha256, packageName, debugFingerprints });
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, text);
    console.log(`Wrote ${options.out}. Publish it at https://<ELIZAOS_APP_LINK_HOST>/.well-known/assetlinks.json before building with that host; for the Eliza Cloud web host use --cloud-config instead.`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
