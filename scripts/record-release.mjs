#!/usr/bin/env node
/**
 * Record a distributed release as android/release-signer.json lastRelease (docs/human-actions.md H-32).
 *
 *   node scripts/record-release.mjs --apk-manifest DIR/apk-manifest.json [--date YYYY-MM-DD] [--write]
 *
 * verify-apks admits a release only when its versionCode is greater than lastRelease.versionCode, so
 * recording a release makes every later build advance. Record it once the release has gone out
 * (installed on the pilot units or otherwise distributed), never before: the recorded release itself
 * is refused by provisioning and verify-apks from then on.
 *
 * Both release rows of the verify-apks manifest (standalone and launcher) must still be admissible
 * against the committed descriptor exactly as provisioning admits them (scripts/provision-unit.mjs
 * admitUnitApk: the APK file matches its row, signed by the recorded certificate, an advancing
 * versionCode, flag-off, packaged runtime, qualified speech, no unresolved blocker), and both must
 * carry the same versionCode and versionName. Without --write it prints the change and writes
 * nothing. It reads no key and writes only lastRelease; commit the change in a reviewed pull request.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_SIGNER_FILE, validateReleaseSigner } from "./build-android.mjs";
import { admitUnitApk } from "./provision-unit.mjs";

export const VARIANTS = Object.freeze(["standalone", "launcher"]);
const USAGE = "Usage: node scripts/record-release.mjs --apk-manifest FILE [--date YYYY-MM-DD] [--write]";

/** A real YYYY-MM-DD day: Date.parse alone rolls 2026-02-30 over to March 2. */
export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function parseArgs(argv) {
  const options = { write: false, date: null, apkManifest: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") options.write = true;
    else if ((arg === "--apk-manifest" || arg === "--date") && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options[arg === "--date" ? "date" : "apkManifest"] = argv[++i];
    else return null;
  }
  if (!options.apkManifest) return null;
  if (options.date !== null && !isCalendarDate(options.date)) return null;
  return options;
}

/**
 * The lastRelease a verify-apks manifest supports, or the problems that refuse it.
 * Returns {release, problems}; release is {versionCode, versionName} when problems is empty.
 */
export function releaseToRecord(manifestFile, descriptor) {
  const problems = [];
  const admitted = [];
  for (const variant of VARIANTS) {
    try { admitted.push(admitUnitApk(manifestFile, { variant, build: "release" }, { descriptor })); }
    catch (error) { problems.push(`${variant}: ${error.message}`); }
  }
  if (problems.length) return { release: null, problems };
  const [first, second] = admitted;
  if (first.versionCode !== second.versionCode || first.versionName !== second.versionName)
    problems.push(`the standalone (${first.versionName} ${first.versionCode}) and launcher (${second.versionName} ${second.versionCode}) releases are different versions`);
  if (!Number.isInteger(first.versionCode) || first.versionCode < 1) problems.push(`versionCode ${JSON.stringify(first.versionCode)} is not a positive integer`);
  if (typeof first.versionName !== "string" || !first.versionName.trim()) problems.push("the release has no versionName");
  return problems.length ? { release: null, problems } : { release: { versionCode: first.versionCode, versionName: first.versionName }, problems };
}

export function main(argv, { root = process.cwd(), now = new Date(), log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv);
  if (!options) { error(USAGE); return 2; }
  const signerFile = path.join(root, RELEASE_SIGNER_FILE);
  const descriptor = validateReleaseSigner(JSON.parse(fs.readFileSync(signerFile, "utf8")));
  const manifestFile = path.resolve(root, options.apkManifest);
  const { release, problems } = releaseToRecord(manifestFile, descriptor);
  if (problems.length) { error(`Refusing to record ${options.apkManifest} as the last release:\n  - ${problems.join("\n  - ")}`); return 1; }
  const lastRelease = { ...release, recordedAt: options.date ?? now.toISOString().slice(0, 10) };
  const previous = descriptor.lastRelease;
  log(`${RELEASE_SIGNER_FILE} lastRelease: ${previous.versionCode === null ? "none" : `${previous.versionName} (${previous.versionCode}, ${previous.recordedAt})`} -> ${lastRelease.versionName} (${lastRelease.versionCode}, ${lastRelease.recordedAt})`);
  if (!options.write) { log("Dry run: nothing written. Re-run with --write once this release has been distributed, then commit the change in a reviewed pull request."); return 0; }
  fs.writeFileSync(signerFile, `${JSON.stringify({ ...descriptor, lastRelease }, null, 2)}\n`);
  log(`Wrote ${RELEASE_SIGNER_FILE}. Every later release must have a versionCode above ${lastRelease.versionCode}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
