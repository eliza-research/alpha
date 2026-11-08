#!/usr/bin/env node
/**
 * Update a provisioned pilot unit in place with a higher-versionCode signed APK.
 *
 *   node scripts/pilot-update.mjs --serial <adb serial> --alias <unit-name> \
 *     --apk-manifest <new build>/apk-manifest.json [--variant launcher|standalone] \
 *     [--build release|debug] [--units test-results/pilot-units] [--stock-home <package/activity>]
 *
 * Generalizes scripts/test-installed-upgrade.mjs from one domain to the whole app:
 *  1. admit the new APK (as provision-unit.mjs does) and the unit's provisioning record;
 *  2. require the installed signer to equal the new APK's signer (the pulled installed
 *     APK is digested with apksigner) and the new versionCode to be greater;
 *  3. stop the app and read back every app-data domain (files, no_backup, databases,
 *     shared_prefs, app_webview, ...) as per-file SHA-256 inventories;
 *  4. `adb install -r` (data kept), then read back again without launching the app:
 *     the package uid and first-install time must be unchanged and every domain
 *     byte-identical. When Alpha holds HOME, the role is moved to the stock launcher for
 *     the whole window (Android relaunches its HOME app after a force-stop or an install)
 *     and put back afterwards; Alpha's main process must be absent before each readback;
 *  5. force-stop (which also ends the export's own :integrity process, a same-UID process
 *     the resident agent refuses to start beside), restore HOME, start Alpha and wait for
 *     the on-device agent to report running. A refused or failed start fails the update.
 * Readback uses run-as, which Android allows only for debuggable builds. A release unit
 * is read through the in-app integrity export instead (release/DataIntegrityProvider,
 * `content query` as adb's shell, which holds the DUMP permission it requires): every file
 * as an HMAC-SHA-256 of its path and bytes under one random nonce per update, so before and
 * after compare file by file without any name or content leaving the device. An installed
 * build without the export gets the package-identity readback only and the record says so.
 *
 * Rollback is not offered: a lower versionCode cannot replace an install without
 * erasing data, and the rollback design (A-06) is still blocked.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signerDigest } from "./apk.mjs";
import { readHome, restoreHome } from "./android-instrumentation.mjs";
import { adbFor, admitUnitApk, deviceFacts, homeRoleHolder, installedApkSha256, PACKAGE, packageFacts, parseUnitArgs, requireConsistentApk } from "./provision-unit.mjs";
import { apkUpdateAdmission, compareDomains, DOMAIN_SCRIPT, inPlaceUpdateFailures, integrityQuery as sharedIntegrityQuery, parseDomainInventory, parseIntegrityExport, readbackInventory } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// The comparison, inventory and export parsers are shared with every product
// (vendor/eliza/packages/os/scripts/android/apk-release-record.mjs); Alpha binds its package.
export { compareDomains, DOMAIN_SCRIPT, parseDomainInventory, parseIntegrityExport, readbackInventory };
export const updateAdmission = apkUpdateAdmission;

/** Both variants share one package id, so an update never switches the unit's variant or build type. */
export function unitApkMismatch(unit, apk) {
  if (unit?.apk?.variant === apk.variant && unit?.apk?.build === apk.build) return null;
  return `provisioned with the ${unit?.apk?.variant ?? "unknown"} ${unit?.apk?.build ?? "unknown"} APK, not ${apk.variant} ${apk.build}; pass the same --variant and --build`;
}

export const INTEGRITY_AUTHORITY = `${PACKAGE}.integrity`;
/** The export query for one nonce; the URI is single-quoted for the device shell ("?" must not glob). */
export const integrityQuery = nonce => sharedIntegrityQuery(INTEGRITY_AUTHORITY, nonce);

function readExport(adb, nonce) {
  return parseIntegrityExport(adb(integrityQuery(nonce), { allowFailure: true, withStderr: true }));
}

function readDomains(adb) {
  return readbackInventory(adb(["shell", "run-as", PACKAGE, "sh", "-c", `'${DOMAIN_SCRIPT}'`], { allowFailure: true, withStderr: true }));
}

const HOME_ROLE = "android.app.role.HOME";
const MAIN_ACTIVITY = `${PACKAGE}/.MainActivity`;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** HOME activities other than Alpha's and Android's FallbackHome, from `cmd package query-activities --brief`. */
export function stockHomeCandidates(output) {
  const components = String(output ?? "").split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z][\w.]*\/[\w.$]+$/.test(line));
  return [...new Set(components.filter(component => !component.startsWith(`${PACKAGE}/`) && !/^com\.android\.settings\/.*FallbackHome$/.test(component)))];
}

/** Read before anything changes. Null when Alpha does not hold HOME; otherwise the launcher that holds it for the readback. */
export function planHome(adb, { stockHome = null } = {}) {
  if (homeRoleHolder(adb) !== PACKAGE) return null;
  const user = adb(["shell", "am", "get-current-user"]).trim();
  const original = readHome(adb, user);
  const candidates = stockHomeCandidates(adb(["shell", "cmd", "package", "query-activities", "--brief", "--user", user, "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"]));
  const stock = stockHome ?? (candidates.length === 1 ? candidates[0] : null);
  if (!stock || !candidates.includes(stock))
    throw new Error(`Alpha holds HOME, so the readback needs another HOME app to hold it; pass --stock-home with one of ${JSON.stringify(candidates)}`);
  return { user, original, stock, selected: false, restoration: null };
}

/** Hand HOME to the stock launcher. From the first change on, restoreHome must put Alpha back. */
function moveHomeAway(adb, home) {
  home.selected = true;
  const stockPackage = home.stock.split("/")[0];
  adb(["shell", "cmd", "role", "add-role-holder", "--user", home.user, HOME_ROLE, stockPackage]);
  adb(["shell", "cmd", "package", "set-home-activity", "--user", home.user, home.stock]);
  const held = readHome(adb, home.user);
  if (held.holders.length !== 1 || held.holders[0] !== stockPackage)
    throw new Error(`HOME did not move to ${home.stock} (holders ${JSON.stringify(held.holders)})`);
}

const mainPids = adb => adb(["shell", "pidof", PACKAGE], { allowFailure: true }).trim();

const AGENT_RUNNING = /Detached agent health check passed|adopting it \(no relaunch\)|Agent health restored|Detached agent health restored/;
const AGENT_REFUSED = /Private IPC recovery refused[^\n]*|Detached agent did not become healthy[^\n]*|Agent process exited early[^\n]*/;

/** Start Alpha and wait for its on-device agent; logcat is read from the start time, never cleared. */
export function restartAgent(adb, { sleep = pause, attempts = 150, intervalMs = 2000 } = {}) {
  const since = adb(["shell", "date", "+%s"]).trim();
  adb(["shell", "am", "start", "-W", "-n", MAIN_ACTIVITY]);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const log = adb(["shell", "logcat", "-d", "-v", "epoch", "-T", `${since}.000`, "-s", "ElizaAgent:V"], { allowFailure: true });
    const refused = AGENT_REFUSED.exec(log)?.[0];
    if (refused) return { state: "refused", reason: refused.trim() };
    if (AGENT_RUNNING.test(log)) return { state: "running" };
    sleep(intervalMs);
  }
  if (!mainPids(adb)) return { state: "not-running", reason: "Alpha's main process is not running after the start" };
  if (/ElizaAgentService/.test(adb(["shell", "dumpsys", "activity", "services", PACKAGE], { allowFailure: true })))
    return { state: "not-running", reason: `the agent service did not report running within ${Math.round(attempts * intervalMs / 1000)}s` };
  return { state: "not-verified", reason: "no on-device agent service started; a unit whose runtime is not on-device does not start one" };
}

/**
 * Stop, read back, install, read back, then leave the unit running. Throws only before anything
 * changed; once HOME moves, every problem is a failure in the returned record.
 */
export function updateUnit({ adb, apk, before, home = null, nonce = randomBytes(32).toString("hex"), timing = {} }) {
  const failures = [];
  const appStopped = {};
  let after = null, installedSha256 = null, method = null, domainsBefore = null, domainsAfter = null, installed = false;
  /** The main process must be absent: a running Alpha (relaunched as HOME, or by a receiver) can change its data. */
  const stopped = label => {
    const pids = mainPids(adb);
    appStopped[label] = pids ? { running: pids } : { running: null };
    if (pids) throw new Error(`Alpha was running before the ${label} readback (pid ${pids})`);
  };
  try {
    if (home) moveHomeAway(adb, home);
    adb(["shell", "am", "force-stop", PACKAGE]);
    stopped("pre-update");
    // run-as on a debuggable rehearsal; the in-app integrity export on a release.
    const runAs = readDomains(adb);
    method = runAs ? "run-as" : "integrity-export";
    domainsBefore = runAs ?? readExport(adb, nonce);
    adb(["install", "-r", apk.file], { timeout: 600_000 });
    installed = true;
    after = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    installedSha256 = installedApkSha256(adb);
    stopped("post-update");
    domainsAfter = !domainsBefore ? null : method === "run-as" ? readDomains(adb) : readExport(adb, nonce);
    failures.push(...inPlaceUpdateFailures({ apk, before, after, installedSha256, domainsBefore, domainsAfter }));
  } catch (error) {
    failures.push(error.message);
  } finally {
    // Ends every process of the package, including the :integrity process the last export left cached.
    try { adb(["shell", "am", "force-stop", PACKAGE]); } catch (error) { failures.push(error.message); }
    if (home?.selected) restoreHome(adb, home, { sleep: timing.sleep });
  }
  if (!installed) failures.push("the update was not installed");
  if (home?.restoration && !home.restoration.restored)
    failures.push("HOME was not restored to Alpha");
  let agentRestart = null;
  if (installed && (!home || home.restoration?.restored)) {
    try { agentRestart = restartAgent(adb, { sleep: timing.sleep, attempts: timing.agentAttempts }); } catch (error) { agentRestart = { state: "not-running", reason: error.message }; }
    if (agentRestart.state === "refused" || agentRestart.state === "not-running") failures.push(`the agent did not restart: ${agentRestart.reason}`);
  }
  return {
    installed,
    packageIdentityPreserved: Boolean(after) && after.userId === before.userId && after.firstInstallTime === before.firstInstallTime,
    appStopped,
    home: home ? { moved: home.selected, stock: home.stock, restoration: home.restoration,
      ...(home.restoration?.restored ? {} : { recovery: `adb -s <serial> shell cmd role add-role-holder --user ${home.user} ${HOME_ROLE} ${PACKAGE} && adb -s <serial> shell cmd package set-home-activity --user ${home.user} ${home.original.activity}` }) } : null,
    dataReadback: domainsBefore
      ? { method: method === "run-as" ? "run-as per-file SHA-256" : "in-app integrity export: per-file HMAC-SHA-256 of path and bytes under one per-update nonce",
        domains: Object.fromEntries(Object.entries(domainsBefore).map(([domain, files]) => [domain, Object.keys(files).length])) }
      : { method: "unavailable", reason: method ? "run-as is refused for a non-debuggable release and the installed build has no integrity export; only package identity was read back" : "the readback did not run" },
    agentRestart,
    failures,
    passed: failures.length === 0,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const unitsIndex = argv.findIndex(arg => arg === "--units" || arg.startsWith("--units="));
  let units = "test-results/pilot-units";
  if (unitsIndex >= 0) { units = argv[unitsIndex].includes("=") ? argv[unitsIndex].split("=")[1] : argv[unitsIndex + 1]; argv.splice(unitsIndex, argv[unitsIndex].includes("=") ? 1 : 2); }
  const homeIndex = argv.findIndex(arg => arg === "--stock-home" || arg.startsWith("--stock-home="));
  let stockHome = null;
  if (homeIndex >= 0) { stockHome = argv[homeIndex].includes("=") ? argv[homeIndex].split("=")[1] : argv[homeIndex + 1]; argv.splice(homeIndex, argv[homeIndex].includes("=") ? 1 : 2); }
  const options = parseUnitArgs(argv);
  const recordFile = path.resolve(units, `${options.alias}.json`);
  if (!fs.existsSync(recordFile)) throw new Error(`${recordFile} is missing; provision the unit with scripts/provision-unit.mjs first`);
  const unit = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const apk = admitUnitApk(options.apkManifest, options);
  const mismatch = unitApkMismatch(unit, apk);
  if (mismatch) throw new Error(`Unit ${options.alias}: ${mismatch}`);
  const adb = adbFor(options.serial);
  const device = deviceFacts(adb, options.serial);
  if (!Number.isSafeInteger(device.sdk) || device.sdk < 1) throw new Error("Device Android API level is unavailable");
  requireConsistentApk(apk, {apiLevel: device.sdk});
  if (device.serialSha256 !== unit.device?.serialSha256) throw new Error(`Serial does not belong to unit ${options.alias}`);
  if (apk.rehearsal && !device.emulator) throw new Error("--build debug is an emulator rehearsal only");

  const before = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
  const pulled = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-installed-"));
  let installedSigner;
  try {
    const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", PACKAGE]))?.[1];
    if (!apkPath) throw new Error("Alpha Phone is not installed on this unit");
    adb(["pull", apkPath, path.join(pulled, "installed.apk")], { timeout: 600_000 });
    installedSigner = signerDigest(path.join(pulled, "installed.apk"), {apiLevel: device.sdk});
  } finally { fs.rmSync(pulled, { recursive: true, force: true }); }
  const newSigner = signerDigest(apk.file, {apiLevel: device.sdk});
  const problems = updateAdmission({ installedVersionCode: before.versionCode, installedSigner, newVersionCode: apk.versionCode, newSigner });
  if (problems.length) throw new Error(`Update refused: ${problems.join("; ")}`);

  const update = {
    createdAt: new Date().toISOString(),
    signerApiLevel: device.sdk,
    from: { versionCode: before.versionCode, versionName: before.versionName, signerSha256: installedSigner },
    to: { versionCode: apk.versionCode, versionName: apk.versionName, sha256: apk.sha256, signerSha256: newSigner, build: apk.build },
    ...updateUnit({ adb, apk, before, home: planHome(adb, { stockHome }) }),
    rollback: "not offered (A-06 rollback design blocked)",
  };
  unit.updates = [...(unit.updates ?? []), update];
  fs.writeFileSync(recordFile, `${JSON.stringify(unit, null, 2)}\n`);
  const domains = update.dataReadback.domains;
  console.log(`${options.alias}: ${update.passed ? "updated" : "UPDATE FAILED"} ${update.from.versionCode} -> ${update.to.versionCode}; ${domains ? `${Object.keys(domains).length} data domains read back` : "package identity readback only"}; agent ${update.agentRestart?.state ?? "not started"}${update.failures.length ? `\n  ${update.failures.join("\n  ")}` : ""}${update.home?.recovery ? `\n  HOME was not restored; run: ${update.home.recovery}` : ""}`);
  process.exitCode = update.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { sha256 };
