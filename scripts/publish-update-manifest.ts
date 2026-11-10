#!/usr/bin/env node
/**
 * Write the one-tap update manifest from a verified release.
 *
 *   node scripts/publish-update-manifest.ts --variant launcher|standalone [--apk-manifest FILE] [--out-dir DIR] [--notes TEXT]
 *
 * Phones install whatever alpha-update-stable.json names, so it is written only for a release row of
 * the verify-apks manifest that is distributable, signed and signed by android/release-signer.json, and
 * still admissible as provisioning admits it (scripts/provision-unit.ts admitUnitApk). The APK is
 * copied to DIR as alpha-phone-<versionCode>.apk, and the manifest's sha256 and sizeBytes are read from
 * that copy and must match the row. The fields are the ones parseUpdateManifest
 * (apps/app/src/prototype/settings-adapter.ts) and AlphaDevicePlugin.installUpdate check. It uploads
 * nothing: the owner runs gh release upload with the two files it names.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_SIGNER_FILE, validateReleaseSigner } from "./build-android.ts";
import { admitUnitApk } from "./provision-unit.ts";
import { inspectUpdateApk } from "./update-apk-admission.ts";
import { updateArtifactDigest } from "./update-artifact.ts";

export const MANIFEST_NAME = "alpha-update-stable.json";
// parseUpdateManifest's UPDATE_MAX_BYTES: phones silently drop a manifest naming a larger APK.
const UPDATE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const USAGE = "Usage: node scripts/publish-update-manifest.ts --variant launcher|standalone [--apk-manifest FILE] [--out-dir DIR] [--notes TEXT]";

function parseArgs(argv: any) {
  interface Options {variant:string|null;apkManifest:string;outDir:string;notes:string|null}
  const options:Options = { variant: null, apkManifest: "artifacts/apk-manifest.json", outDir: "artifacts/app-stable", notes: null };
  const names:Record<string,keyof Options> = { "--variant": "variant", "--apk-manifest": "apkManifest", "--out-dir": "outDir", "--notes": "notes" };
  for (let i = 0; i < argv.length; i++) {
    const key = names[argv[i]];
    if (!key || argv[i + 1] === undefined || argv[i + 1].startsWith("--")) return null;
    options[key] = argv[++i];
  }
  if (options.variant !== "launcher" && options.variant !== "standalone") return null;
  return options;
}

/** The release row behind an update, or the reasons it may not be offered to phones. */
export function updateRow(manifestFile: any, variant: any, descriptor: any) {
  const problems: any[] = [];
  let admitted: any = null;
  try { admitted = admitUnitApk(manifestFile, { variant, build: "release" }, { descriptor }); }
  catch (error: any) { problems.push(error.message); }
  const row = JSON.parse(fs.readFileSync(manifestFile, "utf8")).results?.find((entry: any) => entry.variant === variant && entry.mode === "release");
  if (row) {
    if (row.distributable !== true) problems.push(`the ${variant} release is not distributable in ${manifestFile}`);
    if (row.signed !== true) problems.push(`the ${variant} release is unsigned`);
    if (row.releaseAdmission?.signerMatches !== true) problems.push(`the ${variant} release is not recorded as signed by ${RELEASE_SIGNER_FILE}`);
  }
  return problems.length ? { row: null, admitted: null, problems: [...new Set(problems)] } : { row, admitted, problems };
}

export function main(argv: any, { root = process.cwd(), log = console.log, error = console.error, inspectApk = inspectUpdateApk }: any = {}) {
  const options = parseArgs(argv);
  if (!options) { error(USAGE); return 2; }
  if (options.notes !== null && options.notes.length > 500) { error("--notes must be at most 500 characters; phones do not show longer notes."); return 2; }
  const descriptor = validateReleaseSigner(JSON.parse(fs.readFileSync(path.join(root, RELEASE_SIGNER_FILE), "utf8")));
  const manifestFile = path.resolve(root, options.apkManifest);
  const { row, admitted, problems } = updateRow(manifestFile, options.variant, descriptor);
  if (problems.length) { error(`Refusing to publish ${options.variant} as an update:\n  - ${problems.join("\n  - ")}`); return 1; }
  const { updateManifestUrl } = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
  const apkName = `alpha-phone-${row.versionCode}.apk`;
  const outDir = path.resolve(root, options.outDir);
  const apk = path.join(outDir, apkName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(path.join(outDir, MANIFEST_NAME), { force: true });
  fs.copyFileSync(admitted.file, apk);
  const {size,sha256} = updateArtifactDigest(apk);
  if (sha256 !== row.sha256) { fs.rmSync(apk, { force: true }); error(`${apk} does not match its verified manifest row`); return 1; }
  if (size > UPDATE_MAX_BYTES) { fs.rmSync(apk, { force: true }); error(`${apk} is over 2 GiB; phones do not offer it.`); return 1; }
  // A release row is not an authority for its own assertions. Inspect the copy
  // whose digest we just verified, not a separate source path that can move
  // between admission and staging.
  let signerRootSha256;
  try {
    ({ signerRootSha256 } = inspectApk({...admitted,file:apk}, { descriptor }));
    if (!/^[0-9a-f]{64}$/.test(signerRootSha256 || '')) throw Error('Verified signing-family root is missing');
  }
  catch (failed: any) { fs.rmSync(apk,{force:true}); error(`Refusing to publish ${options.variant}: ${failed.message}`); return 1; }

  const update = {
    schema: "alpha-update/v1",
    versionCode: row.versionCode,
    versionName: row.versionName,
    variant: options.variant,
    signerSha256: signerRootSha256,
    apkUrl: new URL(apkName, updateManifestUrl).href,
    sha256,
    sizeBytes: size,
    ...(options.notes !== null ? { notes: options.notes } : {}),
  };
  fs.writeFileSync(path.join(outDir, MANIFEST_NAME), `${JSON.stringify(update, null, 2)}\n`);
  log(`Wrote ${path.relative(root, apk)} and ${path.relative(root, path.join(outDir, MANIFEST_NAME))} for ${options.variant} ${row.versionName} (${row.versionCode}). Upload the APK first, then the manifest.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
