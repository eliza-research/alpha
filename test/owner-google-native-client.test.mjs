// Owner prep for #669: the release certificate SHA-1 versus the configured Android OAuth client and
// STEWARD_GOOGLE_NATIVE_CLIENT_IDS. A throwaway self-signed certificate stands in for the release
// certificate; no real key, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STEWARD_APP_CLIENT, checkNativeClient, main } from "../scripts/owner/google-native-client.mjs";

function throwaway(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-native-client-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pem = path.join(dir, "alphaphone_app.x509.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", "/O=Example Release/CN=alphaphone_app", "-days", "1",
    "-keyout", path.join(dir, "key.tmp"), "-out", pem], { stdio: "ignore" });
  fs.rmSync(path.join(dir, "key.tmp"));
  const certificate = new X509Certificate(fs.readFileSync(pem));
  return { dir, pem, sha1: certificate.fingerprint, sha256: certificate.fingerprint256.replaceAll(":", "").toLowerCase() };
}
const CLIENT = "123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com";

test("an unenrolled checkout refuses the comparison and says why", t => {
  const cert = throwaway(t);
  const result = checkNativeClient({ certificatePem: fs.readFileSync(cert.pem), signerSha256: "unset" });
  assert.equal(result.sha1, cert.sha1);
  assert.ok(result.problems.some(line => /enroll the release identities first/.test(line)));
});

test("the enrolled certificate, a matching SHA-1 and a listed client pass", t => {
  const cert = throwaway(t);
  const result = checkNativeClient({ certificatePem: fs.readFileSync(cert.pem), signerSha256: cert.sha256, configuredSha1: cert.sha1.toLowerCase(), clientId: CLIENT, stewardClientIds: { [STEWARD_APP_CLIENT]: [CLIENT], other: ["987654321098-zyxwvutsrqponmlk.apps.googleusercontent.com"] } });
  assert.deepEqual(result.problems, []);
  assert.equal(result.passed.length, 3);
});

test("a different certificate, SHA-1, missing client or debug signer is reported", t => {
  const cert = throwaway(t), other = throwaway(t);
  const pem = fs.readFileSync(cert.pem);
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: other.sha256 }).problems.some(line => /not the enrolled release certificate/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: cert.sha256, configuredSha1: other.sha1 }).problems.some(line => /SHA-1 differs/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: cert.sha256, clientId: CLIENT, stewardClientIds: { [STEWARD_APP_CLIENT]: ["987654321098-zyxwvutsrqponmlk.apps.googleusercontent.com"] } }).problems.some(line => /not listed under alpha-phone/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: cert.sha256, stewardClientIds: { other: [CLIENT] } }).problems.some(line => /no alpha-phone entry/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: cert.sha256, debugFingerprints: [cert.sha256] }).problems.some(line => /debug signing certificate/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: pem, signerSha256: cert.sha256, clientId: "not-a-client" }).problems.some(line => /not a Google OAuth client ID/.test(line)));
  assert.ok(checkNativeClient({ certificatePem: Buffer.from("not a certificate"), signerSha256: cert.sha256 }).problems.length);
});

test("the command reads android/release-signer.json from the given root", t => {
  const cert = throwaway(t);
  fs.mkdirSync(path.join(cert.dir, "android"));
  fs.writeFileSync(path.join(cert.dir, "android/release-signer.json"), JSON.stringify({ signerSha256: cert.sha256 }));
  const lines = [];
  assert.equal(main(["--certificate", cert.pem, "--configured-sha1", cert.sha1], { root: cert.dir, log: line => lines.push(line) }), 0);
  assert.ok(lines.some(line => line.includes(cert.sha1)));
  assert.equal(main(["--certificate"], { root: cert.dir, log: () => {}, error: () => {} }), 2);
});
