// Pilot evidence templates (issues #675 and #677): no template asks for a credential or a personal
// identifier, the provisioning record keeps its secret-free field set, and npm run human:status
// reports the pilot resource steps H-07 and H-26 to H-29 as recorded outside the repository.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { humanActionStates } from "../scripts/human-actions.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
// A column header or record field that would collect a secret or identify a person, number or device.
const forbidden = /\b(password|passphrase|pin|token|secret|api key|grant code|otp|recovery code|phone number|e-?mail( address)?|imei|iccid|serial( number)?|account id)\b/i;

/** Header cells of every Markdown table and first cells of key/value tables in `text`. */
function templateFields(text) {
  const fields = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\|.*\|$/.test(lines[i]) || !/^\|( ?-+ ?\|)+$/.test(lines[i + 1].replace(/:/g, ""))) continue;
    const header = lines[i].slice(1, -1).split("|").map(cell => cell.trim());
    fields.push(...header);
    if (header[0] === "Field") for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) fields.push(lines[j].slice(1).split("|")[0].trim());
  }
  return fields;
}

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, heading);
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next < 0 ? undefined : next);
}

test("the per-unit evidence record and the pilot drafts have no credential or identifier field", () => {
  const runbook = section(read("docs/pilot-acceptance-runbook.md"), "## Per-unit evidence record");
  const drafts = [
    section(read("docs/runbooks/675-pilot-roles-and-resources.md"), "## H-07 Role assignment (draft)"),
    section(read("docs/runbooks/675-pilot-roles-and-resources.md"), "## H-07 Per-unit table (draft for the runbook's per-unit record)"),
    section(read("docs/runbooks/677-pixel10a-device-pilot.md"), "## Blank unit records"),
    section(read("docs/runbooks/677-pixel10a-device-pilot.md"), "## Acceptance form (one per person)"),
  ];
  for (const text of [runbook, ...drafts]) {
    const fields = templateFields(text);
    assert.ok(fields.length > 3);
    for (const field of fields) assert.doesNotMatch(field, forbidden, field);
  }
  // The detector itself catches the fields it exists to keep out.
  for (const field of ["Grant code", "Account password", "Phone number", "Device serial", "Email address"]) assert.match(field, forbidden);
});

test("the provisioning record keeps only its secret-free fields", () => {
  const source = read("scripts/provision-unit.mjs");
  const body = /const record = \{([\s\S]*?)\n  \};/.exec(source)[1];
  const keys = [...body.matchAll(/^\s{4}([a-zA-Z]+)[:,]/gm)].map(match => match[1]);
  assert.deepEqual(keys, ["schema", "alias", "createdAt", "sourceCommit", "evidence", "notEvidenceFor", "device", "apk", "installed", "runtimeIdentity", "homeRole"]);
  assert.match(source, /buildFingerprintSha256: sha256\(/);
});

test("human:status reports the pilot resource steps as recorded outside the repository", () => {
  const states = Object.fromEntries(humanActionStates(root, {}).map(row => [row.id, row]));
  for (const id of ["H-07", "H-26", "H-27", "H-28", "H-29"]) {
    assert.equal(states[id].state, "external", id);
    assert.match(states[id].detail, /^verify: /, id);
  }
  assert.match(states["H-07"].detail, /unit alias, SKU and assigned operator/);
});
