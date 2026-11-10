#!/usr/bin/env node
/**
 * Assemble the folder the archive-based campaigns read (`ALPHA_BUILD_ARCHIVE`) from a build that
 * verify-apks has already recorded. It builds nothing.
 *
 *   node scripts/developer-archive.ts [--test-mocks] [--apk-dir artifacts] test-results/<new-folder>
 *
 * `scripts/build-archive.ts` is the qualified route: it verifies, builds and proves its inputs did
 * not change, and it needs the strict packaged build. This script is for the developer APKs of
 * `npm run android:build -- --allow-unpackaged-runtime` (or `-- --test-mocks`): it copies both
 * distributions' debug APK and the instrumentation APK built with it, each admitted against
 * `apk-manifest.json` exactly as `npm run test:android:instrumentation` admits them, under the
 * names the campaigns expect, with their name-to-SHA-256 `apk-manifest.json`.
 * `archive-source.json` records the commit and that this is a developer archive. Results taken
 * from it are emulator-class evidence for those exact APKs, never a distributable-build result.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admitApks } from "./android-instrumentation.ts";

const USAGE = "Use: node scripts/developer-archive.ts [--test-mocks] [--apk-dir <dir>] test-results/<new-folder>";
const sha = (file: any) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function parseDeveloperArchiveArgs(argv: any) {
  const options:{testMocks:boolean;apkDir:string|null;destination:string|null} = { testMocks: false, apkDir: null, destination: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--test-mocks") options.testMocks = true;
    else if (arg === "--apk-dir" || arg.startsWith("--apk-dir=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value) throw new Error(`--apk-dir needs a value. ${USAGE}`);
      options.apkDir = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else if (options.destination) throw new Error(USAGE);
    else options.destination = arg;
  }
  if (!options.destination) throw new Error(USAGE);
  options.apkDir ??= options.testMocks ? "artifacts/test-mocks" : "artifacts";
  return options;
}

/** Copies the admitted pair of each distribution and writes both manifests. Returns what it wrote. */
export function assembleDeveloperArchive({ apkDir, destination, testMocks, root = process.cwd(), source = null }: any) {
  const target = path.resolve(root, destination);
  if (!target.startsWith(path.resolve(root, "test-results") + path.sep)) throw new Error("Use a new folder beneath test-results");
  if (fs.existsSync(target)) throw new Error(`${destination} already exists; earlier evidence is never replaced`);
  const directory = path.resolve(root, apkDir);
  // Admission first: nothing is created when an APK is missing or differs from the verified manifest.
  const admitted = ["standalone", "launcher"].flatMap((variant: any) => admitApks(directory, variant, { testMocks }));
  const manifest: Record<string, any> = {};
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const apk of admitted) {
      const name = `${apk.variant}-${apk.role === "app" ? "debug" : "androidTest"}.apk`;
      fs.copyFileSync(apk.file, path.join(target, name), fs.constants.COPYFILE_EXCL);
      if (sha(path.join(target, name)) !== apk.sha256) throw new Error(`${name} changed while it was being archived`);
      manifest[name] = apk.sha256;
    }
    const record = {
      kind: "developer-archive", qualifiedBuildArchive: false, testMocks,
      note: "Copied from a verify-apks build; scripts/build-archive.ts was not run. Emulator-class evidence for these APKs only, never a distributable-build result.",
      apkDirectory: path.relative(root, directory) || ".", verifiedManifestSha256: sha(path.join(directory, "apk-manifest.json")),
      versionCodes: Object.fromEntries(admitted.filter((apk: any) => apk.role === "app").map((apk: any) => [apk.variant, apk.versionCode ?? null])),
      ...(source ? { source } : {}), createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(target, "apk-manifest.json"), `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`, { flag: "wx" });
    fs.writeFileSync(path.join(target, "archive-source.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return { target, manifest, record };
  } catch (error: any) {
    fs.rmSync(target, { recursive: true, force: true }); // A partial archive must not look usable.
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseDeveloperArchiveArgs(process.argv.slice(2));
  const git = (...args: any[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const source = { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=no") !== "" };
  const { target, manifest } = assembleDeveloperArchive({ ...options, source });
  for (const [name, digest] of Object.entries(manifest)) console.log(`${digest}  ${name}`);
  console.log(`${path.relative(process.cwd(), target)} (developer archive; not a build-archive.ts archive)`);
}
