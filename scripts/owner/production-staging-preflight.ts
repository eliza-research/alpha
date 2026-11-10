#!/usr/bin/env node
/**
 * Read-only production staging preflight for the Alpha Phone image (issue #672, docs/human-actions.md
 * H-21 to H-23). It lists every UNSET or placeholder field the production Pixel 10a and Cuttlefish
 * staging, signing and channel records still carry, and the person's step that fills each one:
 *
 *   node scripts/owner/production-staging-preflight.ts [--json] [--strict]
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
import { errorCode, errorMessage, isRecord } from "./input.ts";

export const CUTTLEFISH_PRODUCT = "android/aosp/product.json";
export const PIXEL10A_PRODUCT = "android/aosp/pixel10a-product.json";
export const RELEASE_SIGNER = "android/release-signer.json";
export const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const GATES = "android/aosp/pixel10a-qualification-gates.json";

interface Placeholder {
  field: string;
  value: string;
}

function placeholders(value: unknown, at: string): Placeholder[] {
  if (typeof value === "string")
    return /^(unset|todo|tbd)$/i.test(value.trim()) || /placeholder/i.test(value) ? [{ field: at || "(value)", value }] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholders(item, `${at}[${index}]`));
  if (isRecord(value))
    return Object.entries(value).filter(([key]) => key !== "description").flatMap(([key, item]) => placeholders(item, at ? `${at}.${key}` : key));
  return [];
}

/** The shared placeholder rule, reimplemented so the preflight runs without the pinned checkout. */
export function placeholderFields(value: unknown, at = ""): string[] {
  return placeholders(value, at).map(item => item.field);
}

/**
 * Which person's step fills a field (docs/human-actions.md). Rules are tried in order; the first
 * whose file matches and whose pattern matches the field path wins.
 */
export const FILLED_BY = Object.freeze([
  { file: RELEASE_SIGNER, field: /^signerSha256$/, step: "H-09", how: "scripts/enroll-release-keys.ts --write (alphaphone_app certificate)" },
  { file: PIXEL10A_PRODUCT, field: /^signer\.|^avb\.publicKeySha256$/, step: "H-09", how: "scripts/enroll-release-keys.ts --write" },
  { file: CHANNEL, field: /^(otaCertificateSha256|avbPublicKeySha256)$/, step: "H-09", how: "scripts/enroll-release-keys.ts --write" },
  { file: CHANNEL, field: /^recovery\.knownGoodRelease\./, step: "H-22", how: "release owner records the signed release and its release-record.json" },
  { file: CUTTLEFISH_PRODUCT, field: /^hostPackages\[\d+\]\.(version|sha256)$/, step: "A-01 / H-23", how: "image host operator records the reviewed cuttlefish-base and cuttlefish-user package versions and SHA-256s" },
  // enroll-release-keys.ts writes pixel10a-product.json, not product.json: this one is a separate reviewed edit.
  { file: CUTTLEFISH_PRODUCT, field: /^signer\.platformCertificateSha256$/, step: "H-09 (manual)", how: "copy the enrolled platform certificate SHA-256 by hand; enroll-release-keys.ts does not write android/aosp/product.json" },
]);

export function filledBy(file: string, field: string) {
  const rule = FILLED_BY.find(item => item.file === file && item.field.test(field));
  return rule ? { step: rule.step, how: rule.how } : { step: "unmapped", how: "no documented step names this field; review it before staging" };
}

interface SourceRecord {
  file: string;
  value?: Record<string, unknown>;
  sha256?: string;
  error?: string;
}

interface OpenField extends Placeholder {
  step: string;
  how: string;
}

interface RecordSummary {
  file: string;
  role: string;
  error: string | null;
  open: OpenField[];
}

interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function readRecord(root: string, file: string): SourceRecord {
  const at = path.join(root, file);
  if (!fs.existsSync(at)) return { file, error: "missing" };
  try {
    const bytes = fs.readFileSync(at);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) return { file, error: "unreadable: expected a JSON object" };
    return { file, value, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    return { file, error: `unreadable: ${errorMessage(error)}` };
  }
}

function openFields(file: string, value: unknown, prefix = ""): OpenField[] {
  return placeholders(value, prefix).map(item => ({ ...item, ...filledBy(file, item.field) }));
}

/**
 * The whole preflight, read from `root`. Returns {records, checks, open, ready}. `records` has one
 * entry per file with its open fields; `checks` are the non-placeholder conditions staging also
 * refuses on (source lock pin and flags, qualification claims, drills, gates). `ready` is true only
 * when nothing is open; it is a records check, never staging admission.
 */
export function stagingPreflight(root = process.cwd()) {
  const records: RecordSummary[] = [];
  const checks: PreflightCheck[] = [];
  const add = (record: SourceRecord, { role }: { role: string }) => {
    const entry = { file: record.file, role, error: record.error ?? null, open: openFields(record.file, record.value) };
    records.push(entry);
    return record;
  };
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const cuttlefish = add(readRecord(root, CUTTLEFISH_PRODUCT), { role: "Cuttlefish product descriptor" });
  if (typeof cuttlefish.value?.brandConfig === "string") add(readRecord(root, cuttlefish.value.brandConfig), { role: "Cuttlefish brand config" });
  const cfLock = cuttlefish.value?.sourceLock;
  if (isRecord(cfLock) && typeof cfLock.file === "string" && typeof cfLock.profile === "string") {
    const lock = readRecord(root, cfLock.file);
    if (lock.error) records.push({ file: cfLock.file, role: "shared Cuttlefish source lock", error: lock.error, open: [] });
    else {
      const profiles = lock.value?.profiles;
      const profile = isRecord(profiles) ? profiles[cfLock.profile] : undefined;
      check(`${cfLock.file} profile ${cfLock.profile} exists`, Boolean(profile), profile ? "present" : "the profile product.json names is absent");
      if (profile) records.push({ file: cfLock.file, role: `shared Cuttlefish source lock (profile ${cfLock.profile})`, error: null, open: openFields(lock.file, profile, `profiles.${cfLock.profile}`) });
    }
  }

  const pixel = add(readRecord(root, PIXEL10A_PRODUCT), { role: "Pixel 10a production descriptor" });
  const pinned = pixel.value?.sourceLock;
  if (isRecord(pinned) && typeof pinned.file === "string") {
    const lock = add(readRecord(root, pinned.file), { role: "Pixel 10a source lock" });
    if (!lock.error) {
      check("Pixel 10a source lock bytes match sourceLock.sha256", typeof pinned.sha256 === "string" && lock.sha256 === pinned.sha256, typeof pinned.sha256 === "string" && lock.sha256 === pinned.sha256 ? pinned.sha256 : `lock is ${lock.sha256}, descriptor pins ${pinned.sha256}`);
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
    for (const [drill, status] of Object.entries(isRecord(channel.value.drills) ? channel.value.drills : {}))
      check(`drill ${drill} passed (H-25)`, status === "passed", `"${status}"`);
  }
  const gates = readRecord(root, GATES);
  if (gates.error) check(`${GATES} readable`, false, gates.error);
  const gateRecords = gates.value?.gates;
  if (isRecord(gateRecords)) for (const [name, gate] of Object.entries(gateRecords)) {
    const status = isRecord(gate) ? gate.status : undefined;
    const evidence = isRecord(gate) && Array.isArray(gate.evidence) ? gate.evidence : [];
    const levels = new Set(evidence.map(item => isRecord(item) ? item.level : undefined));
    check(`gate ${name} passed`, status === "passed", `"${status}"${levels.size ? `, evidence levels: ${[...levels].join(", ")}` : ", no evidence"}`);
  }


  const open = records.flatMap(record => record.open.map(item => ({ file: record.file, ...item })));
  const unreadable = records.filter(record => record.error);
  return { records, checks, open, unreadable, ready: !open.length && !unreadable.length && checks.every(item => item.ok) };
}

/**
 * The authoritative shared checks the staging scripts themselves run, when the pinned checkout is
 * present: {pixel10a: [...], cuttlefish: [...]} or {error} per product. Read-only.
 */
type SharedProblems = Record<"pixel10a" | "cuttlefish", string[] | { error: string }>;

export async function sharedProblems(root = process.cwd()): Promise<SharedProblems> {
  let pixel10a: SharedProblems["pixel10a"];
  let cuttlefish: SharedProblems["cuttlefish"];
  try {
    const { pixel10aProductProblems } = await import("../aosp-pixel10a.ts");
    pixel10a = pixel10aProductProblems(root);
  } catch (error) { pixel10a = { error: `shared Pixel 10a check unavailable (${errorCode(error) ?? errorMessage(error)}); run git submodule update --init vendor/eliza` }; }
  try {
    const { cuttlefishProductProblems } = await import(new URL("../../vendor/eliza/packages/os/scripts/android/cuttlefish-product.mjs", import.meta.url).href);
    const product = JSON.parse(fs.readFileSync(path.join(root, CUTTLEFISH_PRODUCT), "utf8"));
    const appId = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8")).appId;
    cuttlefish = cuttlefishProductProblems(product, { root, file: CUTTLEFISH_PRODUCT, appId, productDirectory: "android/aosp", sharedSourceLock: "vendor/eliza/packages/os/android/aosp.lock.json", applicationSignerFile: RELEASE_SIGNER });
  } catch (error) { cuttlefish = { error: `shared Cuttlefish check unavailable (${errorCode(error) ?? errorMessage(error)}); run git submodule update --init vendor/eliza` }; }
  return { pixel10a, cuttlefish };
}

export function formatPreflight(result: ReturnType<typeof stagingPreflight> & { shared?: SharedProblems }) {
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
    console.error("Usage: node scripts/owner/production-staging-preflight.ts [--json] [--strict]");
    process.exitCode = 2;
  } else {
    const root = path.resolve(import.meta.dirname, "../..");
    const result = { ...stagingPreflight(root), shared: await sharedProblems(root) };
    console.log(args.includes("--json") ? JSON.stringify(result, (key, value) => (value instanceof RegExp ? String(value) : value), 2) : formatPreflight(result));
    if (args.includes("--strict") && !result.ready) process.exitCode = 1;
  }
}
