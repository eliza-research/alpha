#!/usr/bin/env bun
/**
 * Read-only Alpha Cuttlefish image checks through the shared launcher image verifier
 * (vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs). No install, role
 * change, alarm, or runtime request.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main as sharedMain, parseArgs as parseShared, validateExpectation as validateShared, verifyLauncherImage} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';

const PACKAGE: string = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8')).appId;

type ImageTarget = 'cuttlefish' | 'pixel10a';
interface ImageExpectation {
  packageName: string;
  apkSha256: string;
  certificateSha256: string;
  fingerprint: string;
  apkPath: string;
  homeActivity?: string;
  listener?: boolean;
}
type AdbRead = (...args: string[]) => string;

export function validateExpectation(expected: unknown): ImageExpectation {
  if (!expected || typeof expected !== 'object' || !('packageName' in expected) || expected.packageName !== PACKAGE)
    throw Error('Descriptor must belong to Alpha Phone');
  return validateShared(expected);
}

export function verifyAlphaLauncherImage(run: AdbRead, expected: unknown, user: string, target: ImageTarget) {
  return verifyLauncherImage(run, validateExpectation(expected), user, target);
}

export function runAlphaLauncherVerifier(argv: string[], target: ImageTarget) {
  // The shared JS entry supports the target strings as well as its null default.
  const main = sharedMain as unknown as (
    args: string[], options: {target: ImageTarget; admitDescriptor: typeof validateExpectation},
  ) => ReturnType<typeof sharedMain>;
  return main(argv, {target, admitDescriptor: validateExpectation});
}

/** Injected runner enables controlled negative tests; all commands are read-only. */
export function verifyCuttlefishLauncher(run: AdbRead, expected: unknown, user: string) {
  return verifyAlphaLauncherImage(run, expected, user, 'cuttlefish');
}

export function parseArgs(args: string[]) {
  const parse = parseShared as unknown as (args: string[], target: ImageTarget) => ReturnType<typeof parseShared>;
  return parse(args, 'cuttlefish');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runAlphaLauncherVerifier(process.argv.slice(2), 'cuttlefish');
