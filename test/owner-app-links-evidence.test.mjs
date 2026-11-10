// Owner prep for #670: deciding the device App Links step from saved `pm get-app-links` output.
// The outputs below are synthetic samples in Android's printed format; no device or network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, main, parseGetAppLinks } from "../scripts/owner/app-links-evidence.mjs";

const RELEASE = "c3".repeat(32);
const colon = value => value.toUpperCase().match(/../g).join(":");
const sample = (state, signature = RELEASE) => `  ai.elizaresearch.alphaphone:
    ID: 01234567-89ab-cdef-0123-456789abcdef
    Signatures: [${colon(signature)}]
    Domain verification state:
      eliza.app: ${state}
  com.example.other:
    ID: 11111111-2222-3333-4444-555555555555
    Signatures: [${colon("ab".repeat(32))}]
    Domain verification state:
      example.com: verified
`;

test("the package block, its signature and its domain states are parsed", () => {
  const parsed = parseGetAppLinks(sample("verified"));
  assert.equal(parsed.found, true);
  assert.deepEqual(parsed.signatures, [RELEASE]);
  assert.deepEqual(parsed.domains, { "eliza.app": "verified" }, "another package's domains are not mixed in");
});

test("only verified for the enrolled release certificate passes", () => {
  assert.equal(decide(parseGetAppLinks(sample("verified")), { signerSha256: RELEASE }).passed, true);
  for (const state of ["approved", "none", "legacy_failure", "1024"]) assert.equal(decide(parseGetAppLinks(sample(state)), { signerSha256: RELEASE }).passed, false, state);
  assert.match(decide(parseGetAppLinks(sample("approved")), { signerSha256: RELEASE }).problems[0], /not server verification/);
  assert.match(decide(parseGetAppLinks(sample("verified", "dd".repeat(32))), { signerSha256: RELEASE }).problems[0], /not the enrolled release certificate/);
  assert.match(decide(parseGetAppLinks(sample("verified")), { signerSha256: "unset" }).problems[0], /unset/);
  assert.match(decide(parseGetAppLinks(sample("verified").replace("eliza.app", "staging.eliza.app")), { signerSha256: RELEASE }).problems[0], /not declared/);
  assert.equal(decide(parseGetAppLinks("Package not found"), { signerSha256: RELEASE }).passed, false);
});

test("the command uses android/release-signer.json from the root", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-app-links-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "android"));
  fs.writeFileSync(path.join(dir, "android/release-signer.json"), JSON.stringify({ signerSha256: RELEASE }));
  fs.writeFileSync(path.join(dir, "pm.txt"), sample("verified"));
  assert.equal(main([path.join(dir, "pm.txt")], { root: dir, log: () => {} }), 0);
  fs.writeFileSync(path.join(dir, "pm.txt"), sample("none"));
  assert.equal(main([path.join(dir, "pm.txt")], { root: dir, log: () => {} }), 1);
});
