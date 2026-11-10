#!/usr/bin/env node
/**
 * Read-only checks of a booted alpha_stallion_phone image on a Pixel 10a through the shared
 * launcher image verifier: exact fingerprint, Alpha's nonprivileged system launcher bytes as
 * HOME, a remaining recovery HOME, Clock handlers, WebView, a locked (green or yellow) verified
 * boot state and, with --listener, the Sense listener's privileges. The shared pixel10a target
 * refuses orange (unlocked) and red. Device facts only; no install or role change.
 *
 *   node scripts/verify-pixel10a-image.ts --serial SERIAL --user 0 --descriptor LAUNCHER_JSON \
 *     --fingerprint EXACT --apk-path /product/app/AlphaPhone/AlphaPhone.apk --out NEW_REPORT [--listener]
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {main: mainShared, verifiedBootProblem: sharedVerifiedBootProblem, verifyLauncherImage} = await import(new URL("../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs", import.meta.url).href);
import {validateExpectation} from './verify-cuttlefish-launcher.ts';

export const verifiedBootProblem = (report: any) => sharedVerifiedBootProblem('pixel10a', report?.verifiedBoot?.state);

/** Injected runner enables controlled negative tests; all commands are read-only. */
export const verifyPixel10aImage = (run: any, expected: any, user: any) =>
  verifyLauncherImage(run, validateExpectation(expected), user, 'pixel10a');

export const main = (argv: any = process.argv.slice(2)) =>
  (mainShared as unknown as (args:string[],options:{target:string;admitDescriptor:typeof validateExpectation})=>ReturnType<typeof mainShared>)(argv, {target: 'pixel10a', admitDescriptor: validateExpectation});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
