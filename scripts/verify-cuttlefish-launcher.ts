#!/usr/bin/env node
/**
 * Read-only Alpha Cuttlefish image checks through the shared launcher image verifier
 * (vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs). No install, role
 * change, alarm, or runtime request.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {main, parseArgs: parseShared, validateExpectation: validateShared, verifyLauncherImage} = await import(new URL("../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs", import.meta.url).href);

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8')).appId;

export function validateExpectation(expected: any) {
  if (expected?.packageName !== PACKAGE) throw Error('Descriptor must belong to Alpha Phone');
  return validateShared(expected);
}

/** Injected runner enables controlled negative tests; all commands are read-only. */
export function verifyCuttlefishLauncher(run: any, expected: any, user: any) {
  return verifyLauncherImage(run, validateExpectation(expected), user, 'cuttlefish');
}

export function parseArgs(args: any) {
  const parse = parseShared as unknown as (args:string[],target:string)=>ReturnType<typeof parseShared>;
  return parse(args, 'cuttlefish');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  (main as unknown as (args:string[],options:{target:string;admitDescriptor:typeof validateExpectation})=>ReturnType<typeof main>)(process.argv.slice(2), {target: 'cuttlefish', admitDescriptor: validateExpectation});
