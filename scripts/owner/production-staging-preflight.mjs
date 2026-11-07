#!/usr/bin/env node
/**
 * Read-only production staging preflight for the Alpha Phone image (issue #672, docs/human-actions.md
 * H-21 to H-23). It lists every UNSET or placeholder field the production Pixel 10a and Cuttlefish
 * staging, signing and channel records still carry, and the person's step that fills each one:
 *
 *   node scripts/owner/production-staging-preflight.mjs [--json] [--strict]
 *
 * Records read (files only, never the network, never key material):
 *   android/aosp/product.json                 Cuttlefish product (host packages, platform signer)
 *   android/aosp/brand.alphaphone.json        Cuttlefish brand config
 *   <product.json sourceLock.file>            shared Cuttlefish source lock, its named profile only
 *   android/aosp/pixel10a-product.json        Pixel 10a production descriptor
 *   <pixel10a-product.json sourceLock.file>   Pixel 10a source lock (also: pinned SHA-256, developmentOnly)
 *   android/release-signer.json               APK release signer
 *   android/aosp/pixel10a-ota-channel.json    update channel (digests, known-good release, drills)
 *   android/aosp/pixel10a-qualification-gates.json  distribution gate statuses
 *
 * "Placeholder" follows the shared Pixel 10a rule (vendor/eliza/packages/os/scripts/android/
 * pixel10a-release.mjs placeholderFields): a string that is exactly unset, todo or tbd (any case), or
 * contains "placeholder"; `description` keys are skipped. The shared staging and signing checks stay
 * authoritative: an empty report here does not admit staging, and it is never an image build, signed
 * image, boot, device or release result. Exits 0 unless --strict is given and a field is open.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CUTTLEFISH_PRODUCT = "android/aosp/product.json";
export const PIXEL10A_PRODUCT = "android/aosp/pixel10a-product.json";
export const RELEASE_SIGNER = "android/release-signer.json";
export const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const GATES = "android/aosp/pixel10a-qualification-gates.json";

/** The shared placeholder rule, reimplemented so the preflight runs without the pinned checkout. */
export function placeholderFields(value, at = "") {
  if (typeof value === "string")
    return /^(unset|todo|tbd)$/i.test(value.trim()) || /placeholder/i.test(value) ? [at || "(value)"] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholderFields(item, `${at}[${index}]`));
  if (value && typeof value === "object")
    return Object.entries(value).filter(([key]) => key !== "description").flatMap(([key, item]) => placeholderFields(item, at ? `${at}.${key}` : key));
  return [];
}

/**
 * Which person's step fills a field (docs/human-actions.md). Rules are tried in order; the first
 * whose file matches and whose pattern matches the field path wins.
 */
export const FILLED_BY = Object.freeze([
  { file: RELEASE_SIGNER, field: /^signerSha256$/, step: "H-09", how: "scripts/enroll-release-keys.mjs --write (alphaphone_app certificate)" },
  { file: PIXEL10A_PRODUCT, field: /^signer\.|^avb\.publicKeySha256$/, step: "H-09", how: "scripts/enroll-release-keys.mjs --write" },
  { file: CHANNEL, field: /^(otaCertificateSha256|avbPublicKeySha256)$/, step: "H-09", how: "scripts/enroll-release-keys.mjs --write" },
  { file: CHANNEL, field: /^recovery\.knownGoodRelease\./, step: "H-22", how: "release owner records the signed release and its release-record.json" },
  { file: CUTTLEFISH_PRODUCT, field: /^hostPackages\[\d+\]\.(version|sha256)$/, step: "A-01 / H-23", how: "image host operator records the reviewed cuttlefish-base and cuttlefish-user package versions and SHA-256s" },
  // enroll-release-keys.mjs writes pixel10a-product.json, not product.json: this one is a separate reviewed edit.
  { file: CUTTLEFISH_PRODUCT, field: /^signer\.platformCertificateSha256$/, step: "H-09 (manual)", how: "copy the enrolled platform certificate SHA-256 by hand; enroll-release-keys.mjs does not write android/aosp/product.json" },
]);

export function filledBy(file, field) {
  const rule = FILLED_BY.find(item => item.file === file && item.field.test(field));
  return rule ? { step: rule.step, how: rule.how } : { step: "unmapped", how: "no documented step names this field; review it before staging" };
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function readRecord(root, file) {
  const at = path.join(root, file);
  if (!fs.existsSync(at)) return { file, error: "missing" };
  const bytes = fs.readFileSync(at);
  try { return { file, value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) }; }
  catch (error) { return { file, error: `unreadable: ${error.message}` }; }
}

/** One record's open fields: {field, value, step, how}. */
function openFields(record, { prefix = "", value = record.value } = {}) {
  return placeholderFields(value).map(field => {
    const full = prefix ? `${prefix}.${field}` : field;
    const current = full.split(/\.|\[|\]\.?/).filter(Boolean).reduce((item, key) => (item == null ? item : item[key]), record.value);
    return { field: full, value: current, ...filledBy(record.file, full) };
  });
}

/**
 * The whole preflight, read from `root`. Returns {records, checks, open, ready}. `records` has one
 * entry per file with its open fields; `checks` are the non-placeholder conditions staging also
 * refuses on (source lock pin and flags, qualification claims, drills, gates). `ready` is true only
 * when nothing is open; it is a records check, never staging admission.
 */
export function stagingPreflight(root = process.cwd()) {
  const records = [];
  const checks = [];
  const add = (record, extra = {}) => {
    const entry = { file: record.file, role: extra.role, error: record.error ?? null, open: record.error ? [] : openFields(record, extra) };
    records.push(entry);
    return record;
  };
  const check = (name, ok, detail) => checks.push({ name, ok, detail });

  const cuttlefish = add(readRecord(root, CUTTLEFISH_PRODUCT), { role: "Cuttlefish product descriptor" });
  if (cuttlefish.value?.brandConfig) add(readRecord(root, cuttlefish.value.brandConfig), { role: "Cuttlefish brand config" });
  const cfLock = cuttlefish.value?.sourceLock;
  if (cfLock?.file) {
    const lock = readRecord(root, cfLock.file);
    if (lock.error) records.push({ file: cfLock.file, role: "shared Cuttlefish source lock", error: lock.error, open: [] });
    else {
      const profile = lock.value?.profiles?.[cfLock.profile];
      check(`${cfLock.file} profile ${cfLock.profile} exists`, Boolean(profile), profile ? "present" : "the profile product.json names is absent");
      if (profile) records.push({ file: cfLock.file, role: `shared Cuttlefish source lock (profile ${cfLock.profile})`, error: null, open: openFields(lock, { prefix: `profiles.${cfLock.profile}`, value: profile }) });
    }
  }

  const pixel = add(readRecord(root, PIXEL10A_PRODUCT), { role: "Pixel 10a production descriptor" });
  const pinned = pixel.value?.sourceLock;
  if (pinned?.file) {
    const lock = add(readRecord(root, pinned.file), { role: "Pixel 10a source lock" });
    if (!lock.error) {
      check("Pixel 10a source lock bytes match sourceLock.sha256", lock.sha256 === pinned.sha256, lock.sha256 === pinned.sha256 ? pinned.sha256 : `lock is ${lock.sha256}, descriptor pins ${pinned.sha256}`);
      check("Pixel 10a source lock is not developmentOnly", lock.value?.developmentOnly === false, `developmentOnly: ${JSON.stringify(lock.value?.developmentOnly)}`);
    }
  }
  if (pixel.value) {
    for (const flag of ["releaseQualified", "deviceAcceptanceVerified"])
      check(`${PIXEL10A_PRODUCT} ${flag} stays false before release evidence`, pixel.value[flag] === false, `${flag}: ${JSON.stringify(pixel.value[flag])}`);
  }

  add(readRecord(root, RELEASE_SIGNER), { role: "APK release signer" });
  const channel = add(readRecord(root, CHANNEL), { role: "Pixel 10a update channel" });
  if (channel.value) {
    check(`${CHANNEL} downgradeAllowed is false`, channel.value.downgradeAllowed === false, `downgradeAllowed: ${JSON.stringify(channel.value.downgradeAllowed)}`);
    for (const [drill, status] of Object.entries(channel.value.drills ?? {}))
      check(`drill ${drill} passed (H-25)`, status === "passed", `"${status}"`);
  }
  const gates = readRecord(root, GATES);
  if (gates.error) check(`${GATES} readable`, false, gates.error);
  else for (const [name, gate] of Object.entries(gates.value?.gates ?? {}))
    check(`gate ${name} passed`, gate?.status === "passed", `"${gate?.status}"${(gate?.evidence ?? []).length ? `, evidence levels: ${[...new Set(gate.evidence.map(item => item.level))].join(", ")}` : ", no evidence"}`);

  const open = records.flatMap(record => record.open.map(item => ({ file: record.file, ...item })));
  const unreadable = records.filter(record => record.error);
  return { records, checks, open, unreadable, ready: !open.length && !unreadable.length && checks.every(item => item.ok) };
}

/**
 * The authoritative shared checks the staging scripts themselves run, when the pinned checkout is
 * present: {pixel10a: [...], cuttlefish: [...]} or {error} per product. Read-only.
 */
export async function sharedProblems(root = process.cwd()) {
  const result = {};
  try {
    const { pixel10aProductProblems } = await import(new URL("../aosp-pixel10a.mjs", import.meta.url));
    result.pixel10a = pixel10aProductProblems(root);
  } catch (error) { result.pixel10a = { error: `shared Pixel 10a check unavailable (${error.code ?? error.message}); run git submodule update --init vendor/eliza` }; }
  try {
    const { cuttlefishProductProblems } = await import(new URL("../../vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs", import.meta.url));
    const product = JSON.parse(fs.readFileSync(path.join(root, CUTTLEFISH_PRODUCT), "utf8"));
    const appId = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8")).appId;
    result.cuttlefish = cuttlefishProductProblems(product, { root, file: CUTTLEFISH_PRODUCT, appId, productDirectory: "android/aosp", sharedSourceLock: "vendor/eliza/packages/os/android/aosp.lock.json", applicationSignerFile: RELEASE_SIGNER });
  } catch (error) { result.cuttlefish = { error: `shared Cuttlefish check unavailable (${error.code ?? error.message}); run git submodule update --init vendor/eliza` }; }
  return result;
}

export function formatPreflight(result) {
  const lines = ["Production staging preflight (read-only; records only, not staging admission):", ""];
  for (const record of result.records) {
    lines.push(`${record.file}${record.role ? `  [${record.role}]` : ""}`);
    if (record.error) { lines.push(`  ERROR: ${record.error}`); continue; }
    if (!record.open.length) lines.push("  no UNSET or placeholder field");
    for (const item of record.open) lines.push(`  UNSET ${item.field} = ${JSON.stringify(item.value)}  -> ${item.step}: ${item.how}`);
  }
  lines.push("", "Other conditions staging, signing and distribution check:");
  for (const item of result.checks) lines.push(`  ${item.ok ? "ok  " : "OPEN"} ${item.name} (${item.detail})`);
  const steps = [...new Set(result.open.map(item => item.step))];
  lines.push("", `${result.open.length} UNSET field(s) across ${result.records.filter(record => record.open.length).length} record(s); filled by: ${steps.join(", ") || "none"}.`,
    `${result.checks.filter(item => !item.ok).length} other condition(s) open.`,
    "None of this is an image build, signature, boot, device or release result.");
  if (result.shared) {
    lines.push("", "Shared staging checks (authoritative; what aosp:stage --production refuses on):");
    for (const [name, problems] of Object.entries(result.shared)) {
      if (!Array.isArray(problems)) { lines.push(`  ${name}: ${problems.error}`); continue; }
      lines.push(`  ${name}: ${problems.length ? `${problems.length} problem(s)` : "no problem"}`, ...problems.map(problem => `    - ${problem}`));
    }
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--json", "--strict"].includes(arg))) {
    console.error("Usage: node scripts/owner/production-staging-preflight.mjs [--json] [--strict]");
    process.exitCode = 2;
  } else {
    const root = path.resolve(import.meta.dirname, "../..");
    const result = { ...stagingPreflight(root), shared: await sharedProblems(root) };
    console.log(args.includes("--json") ? JSON.stringify(result, (key, value) => (value instanceof RegExp ? String(value) : value), 2) : formatPreflight(result));
    if (args.includes("--strict") && !result.ready) process.exitCode = 1;
  }
}
