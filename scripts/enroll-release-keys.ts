#!/usr/bin/env node
/**
 * Record the public identities from Alpha's release key ceremony in its release records.
 *
 *   node scripts/enroll-release-keys.ts --fingerprints CEREMONY_DIR/fingerprints.json
 *     [--certificates CEREMONY_DIR] [--debug-fingerprint HEX ...] [--replace] [--write]
 *
 * The ceremony is the pinned upstream offline generator run with Alpha's key list:
 *   node vendor/eliza/packages/os/scripts/android/generate-release-keys.ts \
 *     --manifest android/signing/alpha-key-manifest.json --output /media/USB1/<new dir> ...
 * Its fingerprints.json holds public digests only. This maps them onto Alpha's records (H-09):
 *
 *   android/release-signer.json            signerSha256                       <- alphaphone_app
 *   android/aosp/pixel10a-product.json     signer.platformCertificateSha256   <- platform
 *                                          signer.releaseCertificates.<name>  <- shared, media, networkstack,
 *                                                                                sdk_sandbox, bluetooth, nfc, apex
 *                                          signer.apexPayloadAvbPublicKeySha256 <- apex_payload
 *                                          avb.publicKeySha256                <- avb (SHA-256 of avb_pkmd.bin)
 *   android/aosp/pixel10a-ota-channel.json otaCertificateSha256               <- releasekey
 *                                          avbPublicKeySha256                 <- avb
 *
 * It refuses a test-key ceremony (testKeys:true, a TEST ONLY subject, the public AOSP test-key
 * or Android debug subject), a key list that differs from android/signing/alpha-key-manifest.json,
 * one certificate recorded under two names, a debug signing certificate (verify-apks debug rows in
 * artifacts/apk-manifest.json and each --debug-fingerprint), and replacing a digest that is already
 * recorded unless --replace is given (platform, AVB and the other image keys cannot change on a
 * device in the field without a data wipe; the application key only through a v3 rotation lineage).
 * With --certificates (the ceremony directory, or any directory with its public files) every
 * certificate, avb_pkmd.bin and apex_payload.avbpubkey are checked against fingerprints.json; private key
 * files are never read. The application certificate's SHA-1 and colon-form SHA-256 are printed for
 * the Google Android OAuth client and the App Links association (H-12, H-13).
 *
 * Without --write it prints the planned changes and writes nothing. It never records lastRelease
 * (that follows the first signed release, H-10) and never reads or writes key material.
 */
import { X509Certificate, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KEY_MANIFEST = "android/signing/alpha-key-manifest.json";
export const RELEASE_SIGNER = "android/release-signer.json";
export const PRODUCT = "android/aosp/pixel10a-product.json";
export const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const APPLICATION_KEY = "alphaphone_app";
export const IMAGE_CERTIFICATES = Object.freeze(["shared", "media", "networkstack", "sdk_sandbox", "bluetooth", "nfc", "apex"]);
const HEX64 = /^[0-9a-f]{64}$/;
const UNSET = new Set(["unset", "UNSET"]);
const USAGE = "Usage: node scripts/enroll-release-keys.ts --fingerprints FILE [--certificates DIR] [--debug-fingerprint HEX ...] [--replace] [--write]";

interface FingerprintEntry {name:string;kind:string;subject?:string;certificateSha256?:string;avbPublicKeySha256?:string;}
interface Fingerprints {keys:FingerprintEntry[];}
interface Enrollment {file:string;field:string[];key:string;digest:'certificateSha256'|'avbPublicKeySha256';initial?:string;}
interface EnrollmentOptions {debug:string[];replace:boolean;write:boolean;fingerprints?:string;certificates?:string;}

/** Each recorded field: the file, the path inside it and the fingerprints.json key and digest that fill it. */
export const ENROLLMENT: ReadonlyArray<Enrollment> = Object.freeze([
  { file: RELEASE_SIGNER, field: ["signerSha256"], key: APPLICATION_KEY, digest: "certificateSha256" },
  { file: PRODUCT, field: ["signer", "platformCertificateSha256"], key: "platform", digest: "certificateSha256" },
  ...IMAGE_CERTIFICATES.map((name: string): Enrollment => ({ file: PRODUCT, field: ["signer", "releaseCertificates", name], key: name, digest: "certificateSha256" })),
  { file: PRODUCT, field: ["signer", "apexPayloadAvbPublicKeySha256"], key: "apex_payload", digest: "avbPublicKeySha256", initial: "UNSET" },
  { file: PRODUCT, field: ["avb", "publicKeySha256"], key: "avb", digest: "avbPublicKeySha256" },
  { file: CHANNEL, field: ["otaCertificateSha256"], key: "releasekey", digest: "certificateSha256" },
  { file: CHANNEL, field: ["avbPublicKeySha256"], key: "avb", digest: "avbPublicKeySha256" },
]);

const sha256 = (bytes: any) => createHash("sha256").update(bytes).digest("hex");
const normalizeDigest = (value: any) => String(value ?? "").replace(/:/g, "").toLowerCase();
const readJson = (root: any, file: any) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const get = (object: any, field: any) => field.reduce((value: any, key: any) => (value == null ? undefined : value[key]), object);
function set(object: any, field: any, value: any) {
  const parent = get(object, field.slice(0, -1));
  if (!parent || typeof parent !== "object") throw new Error(`missing ${field.slice(0, -1).join(".")}`);
  parent[field.at(-1)] = value;
}

/** Subjects of keys that must never be recorded as release keys. */
export function testSubjectProblem(subject: any) {
  const text = String(subject ?? "");
  if (/\bOU=TEST ONLY\b|\bCN=TEST-ONLY\b/i.test(text)) return "a test-key ceremony (TEST ONLY subject)";
  if (/\bemailAddress=android@android\.com\b/i.test(text) && /\bO=Android\b/.test(text)) return "the public AOSP test-key subject";
  if (/\bCN=Android Debug\b/.test(text)) return "the Android debug-keystore subject";
  return null;
}

/** Debug signing certificates verify-apks recorded for this build machine (artifacts/apk-manifest.json). */
export function recordedDebugSigners(root: any) {
  const file = path.join(root, "artifacts/apk-manifest.json");
  if (!fs.existsSync(file)) return [];
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")).results ?? []).filter((row: any) => row?.mode === "debug" && HEX64.test(row.signerSha256 ?? "")).map((row: any) => row.signerSha256);
  } catch { return []; }
}

/**
 * Problems with a ceremony's fingerprints.json for Alpha's key list. An empty list means every
 * required public digest is present, well-formed, distinct and not a test or debug identity.
 */
export function fingerprintProblems(fingerprints: any, manifest: any, { debugSigners = [] }: any = {}) {
  const problems: any[] = [];
  if (fingerprints?.schemaVersion !== 1 || !Array.isArray(fingerprints?.keys)) return ["fingerprints.json must be schemaVersion 1 with a keys array"];
  if (fingerprints.testKeys !== false) problems.push(`fingerprints.json records testKeys:${JSON.stringify(fingerprints.testKeys)}; only a release ceremony (testKeys:false) can be enrolled`);
  const byName = new Map();
  for (const entry of fingerprints.keys) {
    if (byName.has(entry?.name)) problems.push(`fingerprints.json lists ${entry?.name} twice`);
    byName.set(entry?.name, entry);
  }
  const expected = manifest.keys.map((key: any) => key.name);
  for (const name of byName.keys()) if (!expected.includes(name)) problems.push(`fingerprints.json has ${name}, which ${KEY_MANIFEST} does not list (wrong --manifest at the ceremony?)`);
  const debug = new Set(debugSigners.map(normalizeDigest));
  const seen = new Map();
  for (const key of manifest.keys) {
    const entry = byName.get(key.name);
    if (!entry) { problems.push(`fingerprints.json lacks ${key.name} (generate with --manifest ${KEY_MANIFEST})`); continue; }
    if (entry.kind !== key.kind) problems.push(`${key.name} is ${entry.kind}, not ${key.kind}`);
    if (key.kind === "x509-pk8") {
      if (!HEX64.test(entry.certificateSha256 ?? "")) { problems.push(`${key.name}.certificateSha256 is not a lower-case SHA-256`); continue; }
      const subject = testSubjectProblem(entry.subject);
      if (subject) problems.push(`${key.name} has ${subject}: ${entry.subject}`);
      if (debug.has(entry.certificateSha256)) problems.push(`${key.name} is a debug signing certificate (${entry.certificateSha256})`);
      if (seen.has(entry.certificateSha256)) problems.push(`${key.name} and ${seen.get(entry.certificateSha256)} share one certificate; every key must be distinct`);
      seen.set(entry.certificateSha256, key.name);
    } else if (key.kind === "avb-rsa" && !HEX64.test(entry.avbPublicKeySha256 ?? "")) problems.push(`${key.name}.avbPublicKeySha256 is not a lower-case SHA-256`);
  }
  return problems;
}

/** Re-hash the ceremony's public files; private keys are never opened. */
export function certificateProblems(directory: any, fingerprints: any) {
  const problems: any[] = [];
  const byName = new Map<string,FingerprintEntry>((fingerprints.keys ?? []).map((entry: FingerprintEntry):[string,FingerprintEntry] => [entry.name, entry]));
  for (const entry of byName.values()) {
    if (entry.kind === "x509-pk8") {
      const file = path.join(directory, `${entry.name}.x509.pem`);
      if (!fs.existsSync(file)) { problems.push(`${file} is missing`); continue; }
      let certificate;
      try { certificate = new X509Certificate(fs.readFileSync(file)); } catch { problems.push(`${file} is not an X.509 certificate`); continue; }
      const digest = normalizeDigest(certificate.fingerprint256);
      if (digest !== entry.certificateSha256) problems.push(`${file} is ${digest}, not fingerprints.json ${entry.certificateSha256}`);
      const subject = testSubjectProblem(certificate.subject.replace(/\n/g, ", "));
      if (subject) problems.push(`${file} has ${subject}`);
    }
  }
  for (const [name, filename] of [["avb", "avb_pkmd.bin"], ["apex_payload", "apex_payload.avbpubkey"]]) {
    const entry = byName.get(name);
    if (!entry) continue;
    const file = path.join(directory, filename);
    const info = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!info) problems.push(`${file} is missing`);
    else if (!info.isFile()) problems.push(`${file} is not a regular file`);
    else if (sha256(fs.readFileSync(file)) !== entry.avbPublicKeySha256) problems.push(`${file} does not hash to fingerprints.json ${name}.avbPublicKeySha256`);
  }
  return problems;
}

/**
 * The changes enrollment makes to Alpha's records. Each row is {file, field, from, to, state}:
 * state "set" (from unset), "same" (already recorded) or "conflict" (a different digest is
 * recorded). Conflicts become changes only with replace.
 */
export function plannedChanges(root: any, fingerprints: any, { replace = false }: any = {}) {
  const byName = new Map<string,FingerprintEntry>(fingerprints.keys.map((entry: FingerprintEntry):[string,FingerprintEntry] => [entry.name, entry]));
  const records = new Map();
  const rows: any[] = [];
  for (const row of ENROLLMENT) {
    if (!records.has(row.file)) records.set(row.file, readJson(root, row.file));
    const record = records.get(row.file);
    const recorded = get(record, row.field);
    const from = recorded === undefined ? row.initial : recorded;
    if (from === undefined) throw new Error(`${row.file} has no ${row.field.join(".")}`);
    const to = byName.get(row.key)?.[row.digest];
    const state = UNSET.has(from) ? "set" : from === to ? "same" : "conflict";
    rows.push({ file: row.file, field: row.field.join("."), key: row.key, from, to, state });
    if (state === "set" || (state === "conflict" && replace)) set(record, row.field, to);
  }
  return { rows, records };
}

/**
 * JSON in the records' committed style: two-space indentation, with short arrays of strings kept
 * on one line (pixel10a-product.json `chainedPartitions`), so enrollment changes only the digests.
 */
export function formatRecord(value: any) {
  return `${JSON.stringify(value, null, 2).replace(/\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g, (whole: any, items: any) => {
    const inline = `[${items.split(/,\n\s+/).join(", ")}]`;
    return inline.length <= 80 ? inline : whole;
  })}\n`;
}

/** Application certificate identities the Cloud console steps need (H-12, H-13). */
export function applicationIdentities(directory: any) {
  const file = path.join(directory, `${APPLICATION_KEY}.x509.pem`);
  if (!fs.existsSync(file)) return null;
  const certificate = new X509Certificate(fs.readFileSync(file));
  return { sha1: certificate.fingerprint, sha256: certificate.fingerprint256 };
}

function parseArgs(argv: any) {
  const options: EnrollmentOptions = { debug: [], replace: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--replace") options.replace = true;
    else if (arg === "--write") options.write = true;
    else if (["--fingerprints", "--certificates", "--debug-fingerprint"].includes(arg) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      const value = argv[++i];
      if (arg === "--debug-fingerprint") options.debug.push(value);
      else options[arg.slice(2) as "fingerprints"|"certificates"] = value;
    } else throw new Error(USAGE);
  }
  if (!options.fingerprints) throw new Error(USAGE);
  return options as EnrollmentOptions & {fingerprints:string};
}

export function main(argv: any, { root = process.cwd(), log = console.log, error = console.error }: any = {}) {
  let options;
  try { options = parseArgs(argv); } catch (problem: any) { error(problem.message); return 2; }
  const fingerprints = JSON.parse(fs.readFileSync(options.fingerprints, "utf8"));
  const manifest = readJson(root, KEY_MANIFEST);
  const problems = fingerprintProblems(fingerprints, manifest, { debugSigners: [...recordedDebugSigners(root), ...options.debug] });
  if (options.certificates) problems.push(...certificateProblems(options.certificates, fingerprints));
  if (problems.length) { error(`Refusing to enroll ${options.fingerprints}:\n  - ${problems.join("\n  - ")}`); return 1; }
  const { rows, records } = plannedChanges(root, fingerprints, { replace: options.replace });
  const conflicts = rows.filter((row: any) => row.state === "conflict");
  log(`Release identities from ${options.fingerprints} (${fingerprints.organization ?? "organization not recorded"}, generated ${fingerprints.generatedAt ?? "at an unrecorded time"}):`);
  for (const row of rows) log(`  ${row.file} ${row.field}: ${row.state === "same" ? `${row.to} (already recorded)` : `${row.from} -> ${row.to}${row.state === "conflict" ? (options.replace ? " (REPLACES a recorded digest)" : " (CONFLICT: a different digest is recorded)") : ""}`}`);
  if (conflicts.length && !options.replace) {
    error(`\n${conflicts.length} recorded digest(s) differ. Replacing the platform, AVB or other image keys strands devices in the field unless they are wiped, and the application key changes only through an APK signature scheme v3 rotation lineage. Re-run with --replace only for a reviewed key rotation.`);
    return 1;
  }
  const identities = options.certificates ? applicationIdentities(options.certificates) : null;
  if (identities) {
    log(`\nApplication certificate (${APPLICATION_KEY}):`);
    log(`  SHA-1 for the Google Android OAuth client of package ai.alphacompute.alphaphone (H-12): ${identities.sha1}`);
    log(`  SHA-256 for ELIZA_ANDROID_ASSET_LINKS_JSON (H-13): ${identities.sha256}`);
  }
  const changed = rows.some((row: any) => row.state === "set" || (row.state === "conflict" && options.replace));
  if (!options.write) {
    log(`\nDry run: nothing written.${changed ? " Re-run with --write, then commit the three records in one reviewed change." : " Every digest is already recorded."}`);
    return 0;
  }
  for (const [file, record] of records) fs.writeFileSync(path.join(root, file), formatRecord(record));
  log(`\nWrote ${[...records.keys()].join(", ")}. Review the diff and commit the updated signer records together.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
