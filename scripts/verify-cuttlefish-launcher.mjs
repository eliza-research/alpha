#!/usr/bin/env node
/**
 * Read-only Alpha Cuttlefish image checks through the shared launcher image verifier
 * (vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs). No install, role
 * change, alarm, or runtime request.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main, parseArgs as parseShared, validateExpectation as validateShared, verifyLauncherImage} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8')).appId;

export function validateExpectation(expected) {
  if (expected?.packageName !== PACKAGE) throw Error('Descriptor must belong to Alpha Phone');
  return validateShared(expected);
}

/** Injected runner enables controlled negative tests; all commands are read-only. */
export function verifyCuttlefishLauncher(run, expected, user) {
  return verifyLauncherImage(run, validateExpectation(expected), user, 'cuttlefish');
}

export function parseArgs(args) {
  return parseShared(args, 'cuttlefish');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2), {target: 'cuttlefish', admitDescriptor: validateExpectation});
