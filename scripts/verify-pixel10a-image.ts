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
import {verifiedBootProblem as sharedVerifiedBootProblem} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';
import {runAlphaLauncherVerifier, verifyAlphaLauncherImage} from './verify-cuttlefish-launcher.ts';

export const verifiedBootProblem = (report: {verifiedBoot?: {state?: string} | null} | null) =>
  sharedVerifiedBootProblem('pixel10a', report?.verifiedBoot?.state);

/** Injected runner enables controlled negative tests; all commands are read-only. */
export const verifyPixel10aImage = (run: Parameters<typeof verifyAlphaLauncherImage>[0], expected: unknown, user: string) =>
  verifyAlphaLauncherImage(run, expected, user, 'pixel10a');

export const main = (argv = process.argv.slice(2)) => runAlphaLauncherVerifier(argv, 'pixel10a');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
