#!/usr/bin/env bun
// Keep gzip web assets intact in the APK.
//
//   bun scripts/android-gzip-assets.ts protect   wrap every *.gz in the synced Android web payload
//
// The Android Gradle plugin's asset merger treats a file named *.gz as a compressed asset: it
// gunzips it and drops the suffix, so `ocr/eng.traineddata.gz` was packaged as
// `ocr/eng.traineddata`. The pinned scan engine asks for exactly `eng.traineddata.gz`, got a 404
// from the app's own origin and every Android scan ended with "The image could not be read by
// the local scan engine". The merger unwraps one layer only, so each *.gz in the synced payload
// is gzipped once more (`name.gz` -> `name.gz.gz`): the APK then carries the original bytes
// under the original name. Deterministic (no timestamp), and a no-op for an already wrapped file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ANDROID_PUBLIC = 'android/app/src/main/assets/public';
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
export const isGzip = (bytes: Buffer) => bytes.length > 2 && bytes.subarray(0, 2).equals(GZIP_MAGIC);

/** Wraps each *.gz below `directory` once. Returns the wrapped paths, relative to it. */
export function protectGzipAssets(directory = path.join(ROOT, ANDROID_PUBLIC)) {
  const wrapped: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to follow a linked ${file}`);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.name.endsWith('.gz') || entry.name.endsWith('.gz.gz')) continue;
      if (fs.existsSync(`${file}.gz`)) throw new Error(`${file}.gz already exists beside ${file}; sync the Android web payload again`);
      const bytes = fs.readFileSync(file);
      if (!isGzip(bytes)) throw new Error(`${file} is named .gz but is not gzip data`);
      fs.writeFileSync(`${file}.gz`, zlib.gzipSync(bytes, {level: 1}));
      fs.rmSync(file);
      wrapped.push(path.relative(directory, file));
    }
  };
  if (fs.existsSync(directory)) walk(directory);
  return wrapped.sort();
}

/**
 * Problems with the gzip assets of an extracted APK web payload, compared with the web build
 * it was synced from: every *.gz the web build publishes must be in the APK under the same name
 * with the same bytes.
 */
export function packagedGzipProblems(apkPublic: string, webDist = path.join(ROOT, 'web-dist')) {
  const problems: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.name.endsWith('.gz')) continue;
      const relative = path.relative(webDist, file), packaged = path.join(apkPublic, relative);
      if (!fs.existsSync(packaged)) problems.push(`${relative} is missing from the APK web payload (the asset merger unpacks *.gz; run bun run android:sync before Gradle)`);
      else if (!fs.readFileSync(packaged).equals(fs.readFileSync(file))) problems.push(`${relative} in the APK differs from the web build`);
    }
  };
  if (fs.existsSync(webDist)) walk(webDist);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'protect') { console.error('Usage: bun scripts/android-gzip-assets.ts protect'); process.exit(2); }
  const wrapped = protectGzipAssets();
  console.log(wrapped.length ? `Wrapped gzip assets for the Android asset merger: ${wrapped.join(', ')}` : 'Android web payload has no gzip assets to wrap.');
}
