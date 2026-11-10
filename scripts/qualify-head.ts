/**
 * Qualify the current checkout HEAD from scratch and record one result file.
 *
 *   node scripts/qualify-head.ts [--allow-unpackaged-runtime] [--fresh]
 *                                 [--engines chromium,firefox,webkit] [--skip-android]
 *                                 [--candidate-archive <apk-manifest.json>]
 *   node scripts/qualify-head.ts --candidate [--candidate-archive <apk-manifest.json>]
 *                                 # re-read campaign evidence for HEAD's existing result
 *
 * Writes test-results/qualify/<sha>/result.json with the git SHA, the
 * upstream.lock.json commit, `npm run verify`, `npm run android:build` (standalone
 * and launcher, debug and release), the production bundle audit, and per-engine
 * results for the browser storage-domain specs, the full Chromium suite (`npm run test:browser`)
 * and the production-surface project (`npm run test:browser:production`). Every step runs now; no earlier
 * log, manifest or result is reused (--fresh deletes an older directory for the
 * same SHA, otherwise the script refuses to overwrite it). A dirty tree is
 * recorded and can never qualify.
 *
 * Qualification is not a distribution decision, but it never hides one: a test-mocks
 * build cannot qualify, and the result names every release blocker verify-apks recorded
 * (releaseBlockers; unsigned, unpackaged runtime, unqualified speech, and the proprietary-font
 * check unresolved-font-licence while its policy constant in scripts/licence-policy.ts is true)
 * and reports releasesDistributable:false while any remains. Open-source licence flags are
 * recorded by verify-apks (licenceFlags) and are never a blocker here (decision P-09).
 *
 * Evidence scope: source tests, browser engines on a development server and APK
 * builds. It is not an emulator, AOSP image, real-integration or device result.
 *
 * Candidate manifest: result.candidate lists each emulator and resident campaign (CAMPAIGNS) as
 * passed, failed, mismatched or missing, admitting a campaign only when the APKs it installed are
 * this run's apks[].sha256. candidateQualified is true only when the head qualified and every
 * campaign passed. `--candidate` recomputes it later, once campaign records exist, without
 * re-running any step. The campaigns never change `qualified`, which stays source and build only.
 * resident-android installs the CI archive's APKs, which CI signs differently from a local build, so it
 * stays mismatched against the local apks[] unless `--candidate-archive` names that archive's
 * apk-manifest.json; then it is bound to the archive's app APKs and the result records that set
 * (candidate.ciArchive, and candidateSet on the row).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const {checkRequiredPlaywrightResults} = await import(new URL("../vendor/eliza/packages/scripts/check-required-playwright-results.ts", import.meta.url).href);

import { STORAGE_SPECS } from "./storage-specs.ts";
import { releaseBlockers } from "./release-blockers.ts";
export { STORAGE_SPECS };
export const ENGINES = Object.freeze(["chromium", "firefox", "webkit"]);

export function parseQualifyArgs(argv: any) {
  const options = { allowUnpackagedRuntime: false, fresh: false, skipAndroid: false, candidateOnly: false, candidateArchive: undefined, engines: [...ENGINES] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-unpackaged-runtime") options.allowUnpackagedRuntime = true;
    else if (arg === "--fresh") options.fresh = true;
    else if (arg === "--skip-android") options.skipAndroid = true;
    else if (arg === "--candidate") options.candidateOnly = true;
    else if (arg === "--candidate-archive") {
      options.candidateArchive = argv[++i];
      if (!options.candidateArchive) throw new Error("--candidate-archive takes the CI archive's apk-manifest.json");
    }
    else if (arg === "--engines") {
      const value = argv[++i];
      const engines = (value ?? "").split(",").filter(Boolean);
      if (!engines.length || engines.some((engine: any) => !ENGINES.includes(engine)))
        throw new Error(`--engines takes a comma list of ${ENGINES.join(", ")}`);
      options.engines = engines;
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (options.candidateOnly && argv.length !== (options.candidateArchive ? 3 : 1)) throw new Error("--candidate takes no other option but --candidate-archive");
  return options;
}

/** Admit complete terminal evidence using the shared upstream report validator. */
export function qualifyPlaywrightReport(report: any) {
  const counts = checkRequiredPlaywrightResults(report,
    STORAGE_SPECS.map((file: any) => path.relative("test/browser", file)));
  return { ...counts, failures: [] };
}

/**
 * Overall verdict: every step ran now and passed on a clean, pinned tree, on all engines, with the
 * full Chromium suite and the production-surface project. Source and build classes (S/B) only:
 * emulator and resident campaigns are judged separately by candidateManifest().
 */
export function verdict(result: any) {
  const passed = (step: any) => step?.status === "passed";
  const browserPassed = (step: any) => passed(step) && Number.isSafeInteger(step.expected) && step.expected > 0
    && step.unexpected === 0 && step.flaky === 0 && step.skipped === 0
    && Array.isArray(step.failures) && step.failures.length === 0;
  return Boolean(result.clean && result.upstream?.matches
    && passed(result.verify) && passed(result.androidBuild) && result.androidBuild.testMocks === false && passed(result.bundleAudit)
    && ENGINES.every((engine: any) => browserPassed(result.storageSpecs?.[engine]))
    && passed(result.browserSuite) && passed(result.productionSurface));
}

/**
 * Emulator and resident campaigns a release candidate needs, with where their records live.
 * Each record must name the SHA-256 of the APKs it installed.
 */
export const CAMPAIGNS = Object.freeze([
  { id: "emulator-suite:instrumentation", kind: "emulator-suite", file: "test-results/emulator-suite/instrumentation.json" },
  { id: "emulator-suite:browser-reading", kind: "emulator-suite", file: "test-results/emulator-suite/browser-reading.json" },
  { id: "emulator-suite:fused-speech", kind: "emulator-suite", file: "test-results/emulator-suite/fused-speech.json" },
  // android-resident-instrumentation.ts output, which records the installed app APK's hash (apkSha256).
  { id: "resident-instrumentation", kind: "record-dir", dir: "test-results/resident-instrumentation" },
  // resident-android.yml artifacts: the archive's apk-manifest.json (file name -> SHA-256) and the native proofs.
  { id: "resident-android", kind: "resident-ci", manifest: "test-results/resident-ci-archive/apk-manifest.json", dir: "test-results/resident-ci-native" },
]);

const readJsonFile = (file: any) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } };
const jsonFiles = (dir: any) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((name: any) => name.endsWith(".json")).sort().map((name: any) => path.join(dir, name)) : [];
// App APKs a record installed. A separate test-mocks build is never the candidate, so its rows bind nothing.
const appHashes = (record: any) => [
  ...(Array.isArray(record?.apks) ? record.apks.filter((apk: any) => (!apk.role || apk.role === "app") && apk.testMocks !== true).map((apk: any) => apk.sha256) : []),
  ...(typeof record?.apkSha256 === "string" ? [record.apkSha256] : []),
];
// App APKs in a CI archive's apk-manifest.json (file name -> SHA-256); test and helper APKs are not the candidate.
const archiveAppHashes = (manifest: any) => Object.entries(manifest ?? {})
  .filter(([name]: any) => /^(standalone|launcher)-(debug|release[^.]*)\.apk$/.test(name)).map(([, sha256]: any) => sha256);
const testMocksOnly = (record: any) => Array.isArray(record?.apks) && record.apks.some((apk: any) => apk.testMocks === true) && !appHashes(record).length;

/**
 * Read each campaign's evidence as {id, present, passed, apkSha256[], records[]}. Pure apart from
 * reading files under `root`; nothing is run.
 */
export function readCampaigns(root: any = process.cwd(), campaigns: any = CAMPAIGNS) {
  return campaigns.map((campaign: any) => {
    const at = (rel: any) => path.join(root, rel);
    if (campaign.kind === "emulator-suite") {
      const report = readJsonFile(at(campaign.file));
      if (!report) return { id: campaign.id, kind: campaign.kind, present: false, passed: false, apkSha256: [], records: [] };
      // The suite report names each instrumentation record; those bind the installed APKs.
      // A test-mocks step (browser-reading) is recorded but cannot bind; every other record must name a flag-off app APK.
      const records = (report.steps ?? []).filter((step: any) => step.results).map((step: any) => step.results);
      const rows = records.map((rel: any) => readJsonFile(at(rel)));
      const bound = rows.filter((row: any) => !testMocksOnly(row));
      const hashes = bound.flatMap(appHashes);
      return { id: campaign.id, kind: campaign.kind, present: true, passed: report.passed === true, apkSha256: [...new Set(hashes)], records: [campaign.file, ...records],
        unbound: !bound.length || bound.some((row: any) => !appHashes(row).length) };
    }
    if (campaign.kind === "record-dir") {
      const files = jsonFiles(at(campaign.dir));
      const rows = files.map(readJsonFile);
      return { id: campaign.id, kind: campaign.kind, present: files.length > 0, passed: rows.length > 0 && rows.every((row: any) => row?.passed === true),
        apkSha256: [...new Set(rows.flatMap(appHashes))], records: files.map((file: any) => path.relative(root, file)), unbound: rows.some((row: any) => !appHashes(row).length) };
    }
    const manifest = readJsonFile(at(campaign.manifest));
    const proofs = jsonFiles(at(campaign.dir));
    if (!manifest) return { id: campaign.id, kind: campaign.kind, present: proofs.length > 0, passed: false, apkSha256: [], records: proofs.map((file: any) => path.relative(root, file)), unbound: proofs.length > 0 };
    // The app APKs the native job installed.
    const hashes = archiveAppHashes(manifest);
    const rows = proofs.map(readJsonFile).filter((row: any) => row && typeof row === "object" && "passed" in row);
    return { id: campaign.id, kind: campaign.kind, present: true, passed: rows.length > 0 && rows.every((row: any) => row.passed === true), apkSha256: [...new Set(hashes)],
      records: [campaign.manifest, ...proofs.map((file: any) => path.relative(root, file))] };
  });
}

/**
 * Admit campaign evidence for one candidate: a campaign counts only when every APK it installed is
 * one of this qualify run's apks[].sha256. Status per campaign: passed, failed (bound but did not
 * pass), mismatched (installed other APKs, or recorded no APK hash) or missing.
 * `ciArchive` ({manifest, apkSha256}) binds resident CI campaigns to that archive's app APKs instead.
 */
export function candidateManifest(apks: any, campaigns: any, ciArchive: any) {
  const hashSet = (list: any) => new Set((list ?? []).filter((sha: any) => /^[0-9a-f]{64}$/.test(sha ?? "")));
  const candidate = hashSet((apks ?? []).map((row: any) => row.sha256));
  const archive = ciArchive ? hashSet(ciArchive.apkSha256) : undefined;
  const rows = campaigns.map((campaign: any) => {
    const fromArchive = campaign.kind === "resident-ci" && archive !== undefined;
    const base = { id: campaign.id, records: campaign.records ?? [], apkSha256: campaign.apkSha256 ?? [],
      ...(campaign.kind === "resident-ci" ? { candidateSet: fromArchive ? `ci-archive ${ciArchive.manifest}` : "local-build" } : {}) };
    if (!campaign.present) return { ...base, status: "missing" };
    const foreign = base.apkSha256.filter((sha: any) => !(fromArchive ? archive : candidate).has(sha));
    if (!base.apkSha256.length || campaign.unbound) return { ...base, status: "mismatched", reason: "the record names no installed APK SHA-256" };
    if (foreign.length) return { ...base, status: "mismatched", reason: campaign.kind === "resident-ci" && !fromArchive
      ? "it installed the CI archive's APKs, which are signed differently from this local build; pass --candidate-archive <apk-manifest.json> to bind it to that archive"
      : `installed APKs that are not this candidate: ${foreign.join(", ")}` };
    return { ...base, status: campaign.passed ? "passed" : "failed" };
  });
  return { evidenceScope: "emulator (E) and resident CI campaigns bound to this candidate's APK hashes; not device or user acceptance",
    candidateApks: [...candidate].sort(),
    ...(archive ? { ciArchive: { manifest: ciArchive.manifest, apkSha256: [...archive].sort(),
      note: "resident CI campaigns are bound to this CI archive, not to the local build in apks[]" } } : {}),
    campaigns: rows, complete: rows.length > 0 && rows.every((row: any) => row.status === "passed") };
}

/** Read a CI archive's apk-manifest.json as the candidate set for resident CI campaigns. */
export function readCiArchive(file: any, name: any = file) {
  const manifest = readJsonFile(file);
  if (!manifest || typeof manifest !== "object") throw new Error(`${file} is not a readable apk-manifest.json`);
  const apkSha256 = archiveAppHashes(manifest);
  if (!apkSha256.length) throw new Error(`${file} names no standalone or launcher app APK`);
  return { manifest: name, apkSha256 };
}

/** Paths in `git status --porcelain=v1 -z` output; a rename or copy names its new path. */
export function dirtyPaths(status: any) {
  const entries = status.split("\0");
  const paths: any[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    // The original path of a rename or copy follows as its own entry.
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return paths;
}

/**
 * Distribution summary of a qualify run: distributable only when every release row is
 * recorded distributable with no named blocker; otherwise each blocker is listed once.
 */
export function releaseDistribution(apks: any) {
  const releases = (apks ?? []).filter((row: any) => row.mode === "release");
  const releaseBlockers = [...new Set(releases.flatMap((row: any) => row.distributionBlockers ?? ["release blockers were not recorded"]))];
  return { releasesDistributable: releases.length > 0 && releases.every((row: any) => row.distributable === true) && releaseBlockers.length === 0, releaseBlockers };
}

function git(args: any, { raw = false }: any = {}) {
  const out = spawnSync("git", args, { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
  return raw ? out.stdout : out.stdout.trim();
}

/** Record the candidate manifest in a result and derive candidateQualified. */
export function recordCandidate(result: any, root: any, ciArchive: any) {
  result.candidate = candidateManifest(result.androidBuild?.apks, readCampaigns(root), ciArchive);
  result.candidateQualified = result.qualified === true && result.candidate.complete;
  return result;
}

interface QualificationStep {status:string;exitCode?:number|null;signal?:NodeJS.Signals|null;durationMs?:number;log?:string;reason?:string;report?:string;failures?:{message:string}[];testMocks?:boolean;demoEntryPoints?:unknown;mapsProvider?:unknown;version?:unknown;signing?:unknown;apks?:unknown[];}
interface HeadQualification {schemaVersion:number;sha:string;clean:boolean;dirtyFiles:unknown[];upstream:{lockCommit:string;vendorHead:string;matches:boolean};startedAt:string;evidenceScope:string;verify?:QualificationStep;androidBuild?:QualificationStep;bundleAudit?:QualificationStep;storageSpecs?:Record<string,QualificationStep>;browserSuite?:QualificationStep;productionSurface?:QualificationStep;finishedAt?:string;qualified?:boolean;releaseBlockers?:string[];releasesDistributable?:boolean;candidate?:ReturnType<typeof candidateManifest>;candidateQualified?:boolean;}

function main() {
  const options = parseQualifyArgs(process.argv.slice(2));
  const root = path.resolve(import.meta.dirname, "..");
  const archiveFile = options.candidateArchive && path.resolve(options.candidateArchive);
  process.chdir(root);
  const sha = git(["rev-parse", "HEAD"]);
  const ciArchive = archiveFile ? readCiArchive(archiveFile, path.relative(root, archiveFile)) : undefined;
  if (options.candidateOnly) {
    const file = path.join("test-results/qualify", sha, "result.json");
    if (!fs.existsSync(file)) throw new Error(`${file} does not exist; qualify the head first`);
    const result = recordCandidate(JSON.parse(fs.readFileSync(file, "utf8")), root, ciArchive);
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    for (const row of result.candidate!.campaigns) console.log(`${row.id}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`);
    console.log(`${file}: candidate ${result.candidateQualified ? "QUALIFIED" : "NOT QUALIFIED"}`);
    if (!result.candidateQualified) process.exitCode = 1;
    return;
  }
  // Untracked (non-ignored) files can change what builds, so they make the tree dirty too.
  // Untrimmed: the first entry's leading space is part of its status code.
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], { raw: true });
  const lock = JSON.parse(fs.readFileSync("upstream.lock.json", "utf8"));
  const vendorHead = git(["-C", "vendor/eliza", "rev-parse", "HEAD"]);
  const directory = path.join("test-results/qualify", sha);
  if (fs.existsSync(directory)) {
    if (!options.fresh) throw new Error(`${directory} already exists; rerun with --fresh to replace it (older results are never reused)`);
    fs.rmSync(directory, { recursive: true, force: true });
  }
  fs.mkdirSync(directory, { recursive: true });
  const result: HeadQualification = {
    schemaVersion: 1,
    sha,
    clean: status === "",
    dirtyFiles: dirtyPaths(status),
    upstream: { lockCommit: lock.commit, vendorHead, matches: lock.commit === vendorHead },
    startedAt: new Date().toISOString(),
    evidenceScope: "source tests, browser engines against a development server and APK builds only; not emulator, AOSP image, real integration or device acceptance",
  };
  const write = () => fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  write();

  // Distribution steps always run flag-off; browser specs enable the flag
  // explicitly through the Playwright web server.
  const flagOff = { ...process.env };
  for (const name of ["ELIZA_DEV_ALLOW_TEST_MOCKS", "VITE_ELIZA_DEV_ALLOW_TEST_MOCKS", "ORG_GRADLE_PROJECT_ELIZA_DEV_ALLOW_TEST_MOCKS"]) delete flagOff[name];
  const step = (name: any, command: any, args: any, env: any = flagOff, timeout: any = 3600000) => {
    const started = Date.now();
    const log = path.join(directory, `${name}.log`);
    const out = spawnSync(command, args, { env, encoding: "utf8", timeout, maxBuffer: 256 * 1024 * 1024 });
    fs.writeFileSync(log, `$ ${command} ${args.join(" ")}\n${out.stdout ?? ""}${out.stderr ?? ""}${out.error ? `\n${out.error.message}` : ""}`);
    const record: QualificationStep = { status: out.status === 0 ? "passed" : "failed", exitCode: out.status, signal: out.signal ?? null, durationMs: Date.now() - started, log: path.relative(root, log) };
    console.log(`${name}: ${record.status}`);
    return record;
  };

  if (!result.upstream.matches) {
    result.verify = { status: "failed", reason: "vendor/eliza HEAD differs from upstream.lock.json" };
  } else {
    result.verify = step("verify", "npm", ["run", "verify"]);
  }
  write();

  if (options.skipAndroid) result.androidBuild = { status: "skipped", reason: "--skip-android" };
  else {
    // Remove the previous manifest first so a failed build can never report it.
    fs.rmSync("artifacts/apk-manifest.json", { force: true });
    result.androidBuild = step("android-build", "npm", ["run", "android:build", ...(options.allowUnpackagedRuntime ? ["--", "--allow-unpackaged-runtime"] : [])]);
    if (fs.existsSync("artifacts/apk-manifest.json")) {
      const manifest = JSON.parse(fs.readFileSync("artifacts/apk-manifest.json", "utf8"));
      fs.copyFileSync("artifacts/apk-manifest.json", path.join(directory, "apk-manifest.json"));
      result.androidBuild.testMocks = manifest.testMocks;
      result.androidBuild.demoEntryPoints = manifest.demoEntryPoints;
      result.androidBuild.mapsProvider = manifest.mapsProvider;
      result.androidBuild.version = manifest.version;
      result.androidBuild.signing = manifest.signing;
      result.androidBuild.apks = manifest.results.map((row: any) => ({
        variant: row.variant, mode: row.mode, file: row.file, sha256: row.sha256, signed: row.signed,
        runtime: row.runtime, distributable: row.distributable, bundleAudit: row.bundleAudit,
        ...(row.mode === "release" ? { distributionBlockers: releaseBlockers(row, { manifestTestMocks: manifest.testMocks }) } : {}),
      }));
      const expected = ["standalone/debug", "standalone/release", "launcher/debug", "launcher/release"];
      const built = manifest.results.map((row: any) => `${row.variant}/${row.mode}`).sort();
      if (JSON.stringify(built) !== JSON.stringify([...expected].sort())) {
        result.androidBuild.status = "failed";
        result.androidBuild.reason = `Expected ${expected.join(", ")}`;
      }
    } else if (result.androidBuild.status === "passed") {
      result.androidBuild.status = "failed";
      result.androidBuild.reason = "No APK manifest was produced";
    }
  }
  write();

  // The web bundle in web-dist is from the flag-off build above (android:sync
  // or verify's build). Audit it again here as its own recorded step.
  result.bundleAudit = fs.existsSync("scripts/audit-production-bundle.ts")
    ? step("bundle-audit", process.execPath, ["scripts/audit-production-bundle.ts", "web-dist"])
    : { status: "failed", reason: "scripts/audit-production-bundle.ts is missing" };
  write();

  // playwright.config.ts defines one project per engine; --browser is refused there.
  result.storageSpecs = {};
  for (const engine of options.engines) {
    const report = path.join(directory, `storage-${engine}.json`);
    const record = step(`storage-${engine}`, "npx", ["playwright", "test", ...STORAGE_SPECS, `--project=${engine}`, "--reporter=json"],
      { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: report }, 3600000);
    if (fs.existsSync(report)) {
      record.report = path.relative(root, report);
      try { Object.assign(record, qualifyPlaywrightReport(JSON.parse(fs.readFileSync(report, "utf8")))); }
      catch (error: any) {
        record.status = "failed";
        record.reason = error.message;
        record.failures = [{ message: error.message }];
      }
    } else {
      record.status = "failed";
      record.reason = "No Playwright JSON report was produced";
    }
    result.storageSpecs[engine] = record;
    write();
  }

  // The full Chromium suite (development project) and the flag-off production-surface project.
  result.browserSuite = step("browser-chromium", "npm", ["run", "test:browser"], { ...process.env });
  write();
  result.productionSurface = step("browser-production", "npm", ["run", "test:browser:production"], flagOff);
  write();

  result.finishedAt = new Date().toISOString();
  result.qualified = verdict(result);
  // Qualification of the head is not a distribution decision: releases without
  // the packaged resident runtime (--allow-unpackaged-runtime) stay non-distributable.
  Object.assign(result, releaseDistribution(result.androidBuild?.apks));
  recordCandidate(result, root, ciArchive);
  write();
  for (const blocker of result.releaseBlockers!) console.warn(`RELEASE BLOCKER ${blocker}`);
  for (const row of result.candidate!.campaigns) console.log(`campaign ${row.id}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`);
  console.log(`${path.join(directory, "result.json")}: ${result.qualified ? "QUALIFIED" : "NOT QUALIFIED"}; candidate ${result.candidateQualified ? "qualified" : "NOT qualified"}; releases ${result.releasesDistributable ? "distributable" : "NOT distributable"} (${result.evidenceScope})`);
  if (!result.qualified) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
