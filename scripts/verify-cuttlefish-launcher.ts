#!/usr/bin/env bun
/**
 * Read-only Alpha Cuttlefish image checks through the shared launcher image verifier
 * (vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs), plus Alpha's own check that
 * the launcher holds every first-boot runtime grant its descriptor names
 * (scripts/stage-aosp.ts LAUNCHER_DEFAULT_PERMISSIONS). No install, role change, alarm, or runtime request.
 */
import {execFileSync} from 'node:child_process';
import {sha256} from './sha256.ts';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs as parseShared, validateExpectation as validateShared, verifyLauncherImage} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';

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
  defaultPermissions?: string[];
}
type AdbRead = (...args: string[]) => string;

export function validateExpectation(expected: unknown): ImageExpectation {
  if (!expected || typeof expected !== 'object' || !('packageName' in expected) || expected.packageName !== PACKAGE)
    throw Error('Descriptor must belong to Alpha Phone');
  return validateShared(expected);
}

/**
 * Refuses an image whose launcher does not hold, for `user`, every runtime permission its descriptor says
 * the image grants at first boot. A descriptor that names none is refused: such an image makes the owner
 * accept each Android permission dialog. Returns the granted list for the report.
 */
export function verifyFirstBootGrants(run: AdbRead, expected: unknown, user: string): string[] {
  const {packageName, defaultPermissions} = validateExpectation(expected);
  if (!Array.isArray(defaultPermissions) || !defaultPermissions.length || defaultPermissions.some(name => typeof name !== 'string' || !/^android\.permission\.[A-Z0-9_]+$/.test(name)))
    throw Error('Descriptor names no first-boot runtime grants (defaultPermissions)');
  const dump = run('shell', 'dumpsys', 'package', packageName);
  // Runtime grants are listed per user under the package's own entry. Earlier sections (for example
  // "Domain verification status:" for App Links) also carry "User N:" lines, so read the selected
  // user's block only after the package entry, or after the Packages: header when no entry line is shown.
  const entry = new RegExp(`^\\s*Package \\[${packageName.replace(/\./g, '\\.')}\\]`, 'm').exec(dump) ?? /^Packages:/m.exec(dump);
  const section = entry ? dump.slice(entry.index + entry[0].length) : dump;
  const head = new RegExp(`^\\s*User ${user}:`, 'm').exec(section);
  const rest = head ? section.slice(head.index + head[0].length) : '';
  // The block ends at the next user, or at the next top-level section header.
  const end = rest.search(/^(?:\s*User \d+:|\S)/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const missing = defaultPermissions.filter(name => !new RegExp(`^\\s*${name.replace(/\./g, '\\.')}: granted=true\\b`, 'm').test(block));
  if (missing.length) throw Error(`First-boot grants missing for the launcher: ${missing.join(', ')}`);
  return defaultPermissions;
}

export function verifyAlphaLauncherImage(run: AdbRead, expected: unknown, user: string, target: ImageTarget) {
  const reviewed = validateExpectation(expected);
  // Capture the boot the shared verifier admits, then extend its observation through the grant read.
  let bootId = '';
  const report = verifyLauncherImage((...args: string[]) => {
    const value = run(...args);
    if (!bootId && args.join(' ') === 'shell cat /proc/sys/kernel/random/boot_id') bootId = value.trim();
    return value;
  }, reviewed, user, target);
  const firstBootGrants = verifyFirstBootGrants(run, reviewed, user);
  const shell = (...args: string[]) => run('shell', ...args).trim();
  if (shell('cat', '/proc/sys/kernel/random/boot_id') !== bootId ||
      shell('getprop', 'ro.build.fingerprint') !== reviewed.fingerprint ||
      shell('am', 'get-current-user') !== user || shell('am', 'get-started-user-state', user) !== 'RUNNING_UNLOCKED' ||
      shell('pm', 'path', '--user', user, reviewed.packageName) !== `package:${reviewed.apkPath}` ||
      shell('sha256sum', reviewed.apkPath).split(/\s+/)[0] !== reviewed.apkSha256)
    throw Error('Image, user or APK changed during runtime-grant verification');
  return {...report, bootId, firstBootGrants, scope: report.scope + '; first-boot runtime grants for the same boot, user and APK'};
}

export function runAlphaLauncherVerifier(argv: string[], target: ImageTarget) {
  let output: number | undefined;
  try {
    const options = (parseShared as unknown as (args: string[], target: ImageTarget) => Record<string, string>)(argv, target);
    // Own one report so a grant refusal has the same durable failure result as the shared image checks.
    output = fs.openSync(options['--out'], 'wx', 0o600);
    const descriptor = fs.readFileSync(options['--descriptor']);
    const expected = {...JSON.parse(descriptor.toString('utf8')), fingerprint: options['--fingerprint'], apkPath: options['--apk-path'], ...(options['--listener'] ? {listener: true} : {})};
    const run: AdbRead = (...args) => {
      try { return execFileSync(options['--adb'] ?? 'adb', ['-s', options['--serial'], ...args], {encoding: 'utf8', timeout: 15_000, maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe']}); }
      catch { throw Error('ADB observation failed or timed out'); }
    };
    const report = {...verifyAlphaLauncherImage(run, expected, options['--user'], target), descriptorSha256: sha256(descriptor), observedAt: new Date().toISOString()};
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`PASS ${options['--out']}: ${report.evidence} checks only`);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 1024);
    if (output !== undefined) fs.writeFileSync(output, `${JSON.stringify({passed: false, evidence: `${target}-launcher-postboot`, error: message, observedAt: new Date().toISOString()}, null, 2)}\n`);
    console.error(message);
    process.exitCode = 1;
  } finally { if (output !== undefined) fs.closeSync(output); }
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
