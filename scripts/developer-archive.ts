#!/usr/bin/env bun
/**
 * Assemble the folder the archive-based campaigns read (`ALPHA_BUILD_ARCHIVE`) from a build that
 * verify-apks has already recorded. It builds nothing.
 *
 *   bun scripts/developer-archive.ts [--apk-dir artifacts] test-results/<new-folder>
 *
 * `scripts/build-archive.ts` is the qualified route: it verifies, builds and proves its inputs did
 * not change. This script reuses an existing `bun run android:build`: it copies the launcher
 * debug APK and the instrumentation APK built with it, each admitted against
 * `apk-manifest.json` exactly as `bun run test:android:instrumentation` admits them, under the
 * names the campaigns expect, with their name-to-SHA-256 `apk-manifest.json`.
 * `archive-source.json` records the commit and that this is a developer archive. Results taken
 * from it are emulator-class evidence for those exact APKs, never a qualified-archive result.
 */
import { execFileSync } from "node:child_process";
import {sha256File as sha} from "./sha256.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admitApks } from "./android-instrumentation.ts";

const USAGE = "Use: bun scripts/developer-archive.ts [--apk-dir <dir>] test-results/<new-folder>";

export function parseDeveloperArchiveArgs(argv: readonly string[]) {
  const options: {apkDir: string | null; destination: string | null} = { apkDir: null, destination: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apk-dir" || arg.startsWith("--apk-dir=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value) throw new Error(`--apk-dir needs a value. ${USAGE}`);
      options.apkDir = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else if (options.destination) throw new Error(USAGE);
    else options.destination = arg;
  }
  if (!options.destination) throw new Error(USAGE);
  options.apkDir ??= "artifacts";
  return { ...options, apkDir: options.apkDir, destination: options.destination };
}

/** Copies the admitted app and test APK pair and writes both manifests. Returns what it wrote. */
interface ArchiveOptions {
  apkDir: string;
  destination: string;
  root?: string;
  source?: {commit: string; dirty: boolean} | null;
}
export function assembleDeveloperArchive({ apkDir, destination, root = process.cwd(), source = null }: ArchiveOptions) {
  const target = path.resolve(root, destination);
  if (!target.startsWith(path.resolve(root, "test-results") + path.sep)) throw new Error("Use a new folder beneath test-results");
  if (fs.existsSync(target)) throw new Error(`${destination} already exists; earlier evidence is never replaced`);
  const directory = path.resolve(root, apkDir);
  // Admission first: nothing is created when an APK is missing or differs from the verified manifest.
  const admitted = admitApks(directory);
  const manifest: Record<string, string> = {};
  fs.mkdirSync(target, { recursive: true });
  try {
    for (const apk of admitted) {
      const name = `${apk.variant}-${apk.role === "app" ? "debug" : "androidTest"}.apk`;
      fs.copyFileSync(apk.file, path.join(target, name), fs.constants.COPYFILE_EXCL);
      if (sha(path.join(target, name)) !== apk.sha256) throw new Error(`${name} changed while it was being archived`);
      manifest[name] = apk.sha256;
    }
    const record = {
      kind: "developer-archive", qualifiedBuildArchive: false, testMocks: false,
      note: "Copied from a verify-apks build; scripts/build-archive.ts was not run. Emulator-class evidence for these APKs only.",
      apkDirectory: path.relative(root, directory) || ".", verifiedManifestSha256: sha(path.join(directory, "apk-manifest.json")),
      versionCodes: Object.fromEntries(admitted.filter(apk => apk.role === "app").map(apk => [apk.variant, apk.versionCode ?? null])),
      ...(source ? { source } : {}), createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(target, "apk-manifest.json"), `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`, { flag: "wx" });
    fs.writeFileSync(path.join(target, "archive-source.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return { target, manifest, record };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true }); // A partial archive must not look usable.
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseDeveloperArchiveArgs(process.argv.slice(2));
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const source = { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=no") !== "" };
  const { target, manifest } = assembleDeveloperArchive({ ...options, source });
  for (const [name, digest] of Object.entries(manifest)) console.log(`${digest}  ${name}`);
  console.log(`${path.relative(process.cwd(), target)} (developer archive; not a build-archive.ts archive)`);
}
