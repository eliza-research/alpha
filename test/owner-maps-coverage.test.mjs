// Owner prep for #667: ELIZA_MAPS_COVERAGE_JSON validation (the pinned upstream parser's rules) and
// the H-16 checklist, which reads setting names only. Local files only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SETTINGS, contains, coverageProblems, main, namesFrom } from "../scripts/owner/maps-coverage.mjs";

const root = path.resolve(import.meta.dirname, "..");
const example = JSON.parse(fs.readFileSync(path.join(root, "docs/runbooks/drafts/667-maps-coverage.example.json"), "utf8"));
const region = (id, bounds, name = id) => ({ id, name, bounds });

test("the example coverage is the upstream example and passes", () => {
  assert.deepEqual(coverageProblems(example), []);
  assert.ok(contains(example[0].bounds, 43.7397, 7.4276));
  assert.ok(!contains(example[0].bounds, 48.85, 2.35));
});

test("coverage follows the upstream parser: 1..64 regions, id pattern, unique ids, names, ordered bounds", () => {
  assert.deepEqual(coverageProblems([]), ["must list 1 to 64 regions"]);
  assert.deepEqual(coverageProblems(Array.from({ length: 65 }, (_, i) => region(`r${i}`, [0, 0, 1, 1]))), ["must list 1 to 64 regions"]);
  assert.equal(coverageProblems(Array.from({ length: 64 }, (_, i) => region(`r${i}`, [0, 0, 1, 1]))).length, 0);
  assert.ok(coverageProblems([region("Monaco", [7.409, 43.724, 7.449, 43.752])])[0].includes(".id"));
  assert.ok(coverageProblems([region("a", [0, 0, 1, 1]), region("a", [1, 1, 2, 2])])[0].includes("repeated"));
  assert.ok(coverageProblems([region("a", [0, 0, 1, 1], " ")])[0].includes(".name"));
  assert.ok(coverageProblems([region("a", [0, 0, 1, 1], "x".repeat(101))])[0].includes(".name"));
  assert.ok(coverageProblems([region("a", [1, 0, 0, 1])]).some(line => line.includes(".bounds")));
  assert.ok(coverageProblems([region("fiji", [177, -19, -178, -16])]).some(line => /antimeridian/.test(line)));
  assert.ok(coverageProblems([region("a", [0, 0, 181, 1])]).length);
});

test("the coverage command checks regions against the extract and reports points", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-maps-coverage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "coverage.json");
  fs.writeFileSync(file, JSON.stringify([region("monaco", [7.409, 43.724, 7.449, 43.752]), region("nice", [7.2, 43.65, 7.3, 43.75])]));
  const lines = [];
  assert.equal(main(["coverage", file, "--extract-bounds", "7.40,43.72,7.45,43.76"], { log: line => lines.push(line) }), 1);
  assert.ok(lines.some(line => /nice\) is not inside the extract bounds/.test(line)));
  lines.length = 0;
  assert.equal(main(["coverage", file, "--point", "43.70,7.25"], { log: line => lines.push(line) }), 0);
  assert.ok(lines.some(line => /inside nice/.test(line)));
});

test("the checklist reads names only and requires every mandatory H-16 setting", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-maps-names-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const required = SETTINGS.filter(row => row.required).map(row => row.name);
  assert.deepEqual(required, ["ELIZA_MAPS_GEOCODER_URL", "ELIZA_MAPS_ROUTER_URL", "ELIZA_MAPS_COVERAGE_JSON", "ELIZA_MAPS_DATASET_REVISION", "ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES", "ELIZA_CLOUD_PLAN_RATE_LIMITS", "INFERENCE_STRONG_REVOCATION_ENABLED"]);
  const file = path.join(dir, "names.json");
  fs.writeFileSync(file, JSON.stringify(required.slice(1).map(name => ({ name, type: "secret_text" }))));
  const lines = [];
  assert.equal(main(["checklist", "--environment", "staging", "--names", file], { log: line => lines.push(line) }), 1);
  assert.ok(lines.some(line => line.startsWith("  [MISSING] ELIZA_MAPS_GEOCODER_URL")));
  fs.writeFileSync(file, JSON.stringify(required));
  assert.equal(main(["checklist", "--names", file], { log: () => {} }), 0);
  assert.deepEqual([...namesFrom({ names: ["A"] })], ["A"]);
});
