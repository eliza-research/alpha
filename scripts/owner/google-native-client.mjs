#!/usr/bin/env node
/**
 * Owner prep for #669 (docs/human-actions.md H-12): check that the Android OAuth client the Cloud
 * operator configured for native Google sign-in matches Alpha's enrolled release certificate.
 * Reads local public files only; contacts nothing and handles no secret.
 *
 *   node scripts/owner/google-native-client.mjs --certificate CEREMONY_DIR/alphaphone_app.x509.pem
 *     [--configured-sha1 HEX] [--client-id ID] [--steward-client-ids FILE] [--debug-fingerprint HEX ...]
 *
 * android/release-signer.json records only the release certificate's SHA-256 (signerSha256), and a
 * SHA-1 cannot be derived from it, so the public certificate from the ceremony directory is
 * required: its SHA-256 must equal signerSha256 (so the certificate is the enrolled one), it must
 * not be a debug signing certificate, and its SHA-1 is what Google binds the Android OAuth client
 * to. The optional inputs are what the operator configured:
 *   --configured-sha1      the SHA-1 shown on the Android OAuth client in Google Cloud console
 *   --client-id            that client's ID (NNN-xxxx.apps.googleusercontent.com, a public identifier)
 *   --steward-client-ids   a file holding the STEWARD_GOOGLE_NATIVE_CLIENT_IDS JSON (app client ->
 *                          [Android client IDs]; client IDs are public, the file holds no secret)
 * Exit 0 when every given input matches; 1 otherwise; 2 for a usage error.
 */
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordedDebugSigners } from "../enroll-release-keys.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE = "ai.elizaresearch.alphaphone";
export const STEWARD_APP_CLIENT = "alpha-phone";
export const CLIENT_ID = /^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/;
const USAGE = "Usage: node scripts/owner/google-native-client.mjs --certificate FILE [--configured-sha1 HEX] [--client-id ID] [--steward-client-ids FILE] [--debug-fingerprint HEX ...]";
const hex = value => String(value ?? "").replace(/:/g, "").toLowerCase();
const colon = value => hex(value).toUpperCase().match(/../g)?.join(":") ?? "";

/**
 * Compare a public certificate with the release record and the configured values.
 * Returns {sha1, sha256, problems, passed:[...]}; never throws for a mismatch.
 */
export function checkNativeClient({ certificatePem, signerSha256, configuredSha1 = null, clientId = null, stewardClientIds = null, debugFingerprints = [] }) {
  const problems = [], passed = [];
  let certificate;
  try { certificate = new X509Certificate(certificatePem); } catch { return { sha1: null, sha256: null, problems: ["the certificate file is not an X.509 certificate"], passed }; }
  const sha1 = colon(certificate.fingerprint), sha256 = colon(certificate.fingerprint256);
  if (!signerSha256 || ["unset", "UNSET"].includes(signerSha256)) problems.push('android/release-signer.json signerSha256 is "unset": enroll the release identities first (H-09, node scripts/enroll-release-keys.mjs)');
  else if (hex(signerSha256) !== hex(sha256)) problems.push("the certificate's SHA-256 differs from android/release-signer.json signerSha256: it is not the enrolled release certificate");
  else passed.push("the certificate is the enrolled release certificate (SHA-256 equals signerSha256)");
  if (debugFingerprints.map(hex).includes(hex(sha256))) problems.push("the certificate is a debug signing certificate");
  if (configuredSha1 !== null) {
    if (!/^[0-9a-f]{40}$/.test(hex(configuredSha1))) problems.push("--configured-sha1 is not a SHA-1 digest");
    else if (hex(configuredSha1) !== hex(sha1)) problems.push("the Android OAuth client's SHA-1 differs from the release certificate's SHA-1: Google will refuse native sign-in from release builds");
    else passed.push("the Android OAuth client's SHA-1 equals the release certificate's SHA-1");
  }
  if (clientId !== null && !CLIENT_ID.test(clientId)) problems.push("--client-id is not a Google OAuth client ID (NNN-xxxx.apps.googleusercontent.com)");
  if (stewardClientIds !== null) {
    const listed = stewardClientIds?.[STEWARD_APP_CLIENT];
    if (typeof stewardClientIds !== "object" || Array.isArray(stewardClientIds)) problems.push("STEWARD_GOOGLE_NATIVE_CLIENT_IDS must be a JSON object of app client -> [client IDs]");
    else if (!Array.isArray(listed) || !listed.length) problems.push(`STEWARD_GOOGLE_NATIVE_CLIENT_IDS has no ${STEWARD_APP_CLIENT} entry: Steward will not advertise googleNative for Alpha`);
    else {
      const malformed = listed.filter(id => typeof id !== "string" || !CLIENT_ID.test(id));
      if (malformed.length) problems.push(`STEWARD_GOOGLE_NATIVE_CLIENT_IDS.${STEWARD_APP_CLIENT} holds ${malformed.length} value(s) that are not Google client IDs`);
      if (clientId !== null && !listed.includes(clientId)) problems.push(`the release Android client ID is not listed under ${STEWARD_APP_CLIENT}`);
      else if (clientId !== null) passed.push(`the release Android client ID is listed under ${STEWARD_APP_CLIENT} (${listed.length} client(s) there)`);
    }
  }
  return { sha1, sha256, problems, passed };
}

export function main(argv, { root = ROOT, log = console.log, error = console.error } = {}) {
  const options = { debug: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[i + 1];
    if (!["--certificate", "--configured-sha1", "--client-id", "--steward-client-ids", "--debug-fingerprint"].includes(flag) || value === undefined || value.startsWith("--")) { error(USAGE); return 2; }
    if (flag === "--debug-fingerprint") options.debug.push(value); else options[flag.slice(2)] = value;
    i++;
  }
  if (!options.certificate) { error(USAGE); return 2; }
  const signer = JSON.parse(fs.readFileSync(path.join(root, "android/release-signer.json"), "utf8")).signerSha256;
  const result = checkNativeClient({
    certificatePem: fs.readFileSync(path.resolve(options.certificate)), signerSha256: signer,
    configuredSha1: options["configured-sha1"] ?? null, clientId: options["client-id"] ?? null,
    stewardClientIds: options["steward-client-ids"] ? JSON.parse(fs.readFileSync(path.resolve(options["steward-client-ids"]), "utf8")) : null,
    debugFingerprints: [...recordedDebugSigners(root), ...options.debug],
  });
  log(`Native Google client for ${PACKAGE} (H-12):`);
  if (result.sha1) log(`  release certificate SHA-1 (for the Google Android OAuth client): ${result.sha1}\n  release certificate SHA-256: ${result.sha256}`);
  for (const line of result.passed) log(`  [pass] ${line}`);
  for (const line of result.problems) log(`  [FAIL] ${line}`);
  if (options["configured-sha1"] === undefined) log("  (pass --configured-sha1 with the SHA-1 shown on the Android OAuth client to compare it)");
  return result.problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
