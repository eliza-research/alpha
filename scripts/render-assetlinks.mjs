#!/usr/bin/env node
/**
 * Render the /.well-known/assetlinks.json for the verified App Links return host from the
 * committed release-signer descriptor, and check rendered or published copies.
 *
 *   node scripts/render-assetlinks.mjs [--out FILE] [--debug-fingerprint HEX ...]
 *
 * The fingerprint comes only from android/release-signer.json signerSha256. It is refused while
 * that is "unset", when the template placeholder would remain, and when it equals a debug signing
 * certificate: every debug row's signerSha256 in artifacts/apk-manifest.json and each
 * --debug-fingerprint given. Writes artifacts/assetlinks.json by default. The file holds no secret;
 * publishing it is the release owner's step (docs/mvp-owner-actions.md action 6). The https
 * autoVerify filter is generated from the configured Cloud web host
 * (android/app/build.gradle); appLinkFilters() reads it back from an APK manifest dump.
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

/** Require a complete sign-in return filter for each configured host in the packaged manifest. */
export function signInAppLinkProblems(xmltree, expectedHosts) {
  const lines = String(xmltree ?? "").split("\n"), returns = new Set();
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)E: intent-filter\b/.exec(lines[i]);
    if (!start) continue;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || /^(\s*)/.exec(lines[end])[1].length > start[1].length)) end++;
    const block = lines.slice(i, end).join("\n");
    if (!/android:autoVerify\([^)]*\)=(?:\(type 0x12\)0xffffffff|true)/.test(block)
      || !/android:scheme\([^)]*\)="https"/.test(block)
      || !/android:path\([^)]*\)="\/alphaphone\/auth\/callback"/.test(block)
      || !['android.intent.action.VIEW', 'android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'].every(value => block.includes(`="${value}"`))) continue;
    for (const host of block.matchAll(/android:host\([^)]*\)="([^"]+)"/g)) returns.add(host[1]);
  }
  return expectedHosts.filter(host => !returns.has(host)).map(host => `Missing verified sign-in return for https://${host}/alphaphone/auth/callback`);
}

function main(argv) {
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : DEFAULT_OUTPUT;
  const debugFingerprints = argv.flatMap((arg, index) => arg === "--debug-fingerprint" ? [argv[index + 1]] : []);
  const known = argv.every((arg, index) => ["--out", "--debug-fingerprint"].includes(arg) || ["--out", "--debug-fingerprint"].includes(argv[index - 1]));
  if (!known || !out || debugFingerprints.some(value => !value)) {
    console.error("Usage: node scripts/render-assetlinks.mjs [--out FILE] [--debug-fingerprint HEX ...]");
    return 2;
  }
  try {
    const text = renderAssetLinks({
      template: fs.readFileSync(TEMPLATE, "utf8"),
      signerSha256: JSON.parse(fs.readFileSync(SIGNER_FILE, "utf8")).signerSha256,
      packageName: JSON.parse(fs.readFileSync("app.config.json", "utf8")).appId,
      debugFingerprints: [...debugFingerprints, ...recordedDebugFingerprints("artifacts/apk-manifest.json")],
    });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`Wrote ${out}. Publish it at the configured Cloud web host's /.well-known/assetlinks.json.`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
