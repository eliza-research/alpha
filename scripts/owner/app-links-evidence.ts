#!/usr/bin/env node
/**
 * Owner prep for #670 (docs/human-actions.md H-13): read a saved
 * `adb shell pm get-app-links ai.elizaresearch.alphaphone` output and decide the device step.
 * Reads a local text file only; runs no adb command and contacts nothing.
 *
 *   adb shell pm get-app-links ai.elizaresearch.alphaphone > pm-get-app-links.txt
 *   node scripts/owner/app-links-evidence.ts pm-get-app-links.txt [--host eliza.app] [--json]
 *
 * Passes only when the package block lists the host with state `verified` (Android's own
 * verification against assetlinks.json) and the installed signature equals
 * android/release-signer.json signerSha256. `approved` (set by `pm set-app-links` or the user),
 * `none`, `denied`, `legacy_failure` and error codes do not pass: forcing a state through adb does
 * not prove the server association. Device evidence only; it says nothing about a sign-in.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDigest } from "../enroll-release-keys.ts";
import { isRecord, option, readJson } from "./input.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE = "ai.elizaresearch.alphaphone";
const USAGE = "Usage: node scripts/owner/app-links-evidence.ts PM_OUTPUT_FILE [--host eliza.app] [--json]";

/** {found, signatures:[hex], domains:{host: state}} for one package in `pm get-app-links` output. */
export function parseGetAppLinks(text: string, packageName = PACKAGE) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `${packageName}:`);
  if (start < 0) return { found: false, signatures: [], domains: {} };
  const indent = lines[start].search(/\S/);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    block.push(line);
  }
  const signatures = (block.join("\n").match(/Signatures:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map(value => normalizeDigest(value.trim())).filter(Boolean);
  const domains: Record<string, string> = {};
  const at = block.findIndex(line => /Domain verification state:/.test(line));
  if (at >= 0) for (const line of block.slice(at + 1)) {
    const match = line.match(/^\s+([a-z0-9.-]+):\s*(\S+)\s*$/i);
    if (match) domains[match[1].toLowerCase()] = match[2];
    else if (line.trim() && !/^\s+/.test(line)) break;
  }
  return { found: true, signatures, domains };
}

export function decide(parsed: ReturnType<typeof parseGetAppLinks>, { host = "eliza.app", signerSha256 = null }: { host?: string; signerSha256?: string | null } = {}) {
  const problems = [];
  if (!parsed.found) return { passed: false, problems: [`${PACKAGE} is not in the output (not installed for this user, or the wrong package)`] };
  const state = parsed.domains[host];
  if (state === undefined) problems.push(`${host} is not declared: the build has no verified filter for it (build with ELIZAOS_APP_LINK_HOST=${host})`);
  else if (state !== "verified") problems.push(`${host} is ${state}, not verified${state === "approved" ? " (approved is a user or adb override, not server verification)" : ""}`);
  if (!signerSha256 || ["unset", "UNSET"].includes(signerSha256)) problems.push('android/release-signer.json signerSha256 is "unset": a device result cannot be tied to a release certificate yet');
  else if (!parsed.signatures.includes(normalizeDigest(signerSha256))) problems.push("the installed signature is not the enrolled release certificate");
  return { passed: !problems.length, state: state ?? null, problems };
}

export function main(argv: readonly string[], { root = ROOT, log = console.log, error = console.error } = {}) {
  const [file, ...rest] = argv;
  if (!file || file.startsWith("--")) { error(USAGE); return 2; }
  const host = option(rest, "--host") ?? "eliza.app";
  const signer = readJson(path.join(root, "android/release-signer.json"));
  const signerSha256 = isRecord(signer) && typeof signer.signerSha256 === "string" ? signer.signerSha256 : null;
  const parsed = parseGetAppLinks(fs.readFileSync(path.resolve(file), "utf8"));
  const result = decide(parsed, { host, signerSha256 });
  if (rest.includes("--json")) log(JSON.stringify({ package: PACKAGE, host, ...result, domains: parsed.domains }, null, 2));
  else {
    log(`App Links on the device for ${PACKAGE}, host ${host}: ${result.passed ? "verified for the release certificate" : "NOT verified"}`);
    for (const line of result.problems) log(`  - ${line}`);
  }
  return result.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
