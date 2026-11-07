// Device-day evidence templates and the evidence class check (issue #673). Fixture records only: no
// device, Cuttlefish boot, flash or drill is run or implied.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANNEL, DRILLS, GATES, GATE_CLASSES, TEMPLATES, evidenceClassProblems } from "../scripts/owner/evidence-class-check.mjs";
import { CHECKS } from "../scripts/human-actions.mjs";
import { placeholderFields } from "../scripts/owner/production-staging-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (base, rel) => JSON.parse(fs.readFileSync(path.join(base, rel), "utf8"));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(value, null, 2)); };
  const cited = Object.values(read(root, GATES).gates).flatMap(gate => gate.evidence ?? []).map(entry => entry.ref).filter(ref => /^docs\/.*\.json$/.test(ref));
  for (const rel of [GATES, CHANNEL, ...Object.values(TEMPLATES), ...cited]) write(rel, read(root, rel));
  return { dir, write, readBack: rel => read(dir, rel) };
}

/** A template filled as an executed, passed run would fill it (values are synthetic). */
function filled(evidenceClass, extra = {}) {
  const fill = value => {
    if (typeof value === "string") return /^unset$/i.test(value) ? "synthetic-value" : value === "not run" ? "passed" : value;
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "description" ? item : fill(item)]));
    return value;
  };
  const { template, ...record } = fill(read(root, TEMPLATES[evidenceClass]));
  return { ...record, ...extra };
}

const cite = (repo, gate, ref, { status = "passed", level = "release" } = {}) => {
  const gates = repo.readBack(GATES);
  gates.gates[gate] = { ...gates.gates[gate], status, evidence: [...gates.gates[gate].evidence, { ref, level, summary: "synthetic" }] };
  repo.write(GATES, gates);
};

test("the three templates carry distinct evidence classes for distinct gates and claim nothing", () => {
  const classes = new Set();
  for (const [evidenceClass, rel] of Object.entries(TEMPLATES)) {
    const template = read(root, rel);
    assert.equal(template.evidenceClass, evidenceClass, rel);
    assert.equal(GATE_CLASSES[template.gate], evidenceClass, `${rel} names its gate`);
    assert.equal(template.result, "not run", rel);
    assert.ok(placeholderFields(template).length > 0, `${rel} has fields to fill`);
    for (const flag of ["imageBooted", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified", "imageBuiltFromAdmittedSource"])
      if (flag in template) assert.equal(template[flag], false, `${rel} ${flag}`);
    assert.doesNotMatch(JSON.stringify(template), /"passed"/, `${rel} records no pass`);
    assert.doesNotMatch(JSON.stringify(template), /password|passphrase|private_key|BEGIN [A-Z ]*PRIVATE|\bPIN\b/i, `${rel} asks for no secret`);
    classes.add(evidenceClass);
  }
  assert.equal(classes.size, 3);
  assert.deepEqual(read(root, TEMPLATES["physical-device-drill"]).allowedDrills, DRILLS);
  assert.deepEqual(DRILLS, Object.keys(read(root, CHANNEL).drills), "the drill template lists the channel's drills");
});

test("the committed gates have no class problem; their pre-class development entries are notes", () => {
  const { problems, notes } = evidenceClassProblems(root);
  assert.deepEqual(problems, []);
  assert.ok(notes.every(note => /development evidence .* has no evidenceClass/.test(note)), notes.join("\n"));
});

test("a Cuttlefish record never satisfies the device gate, a device record never satisfies the Cuttlefish gate", t => {
  const repo = fixture(t);
  repo.write("docs/evidence/cf.json", filled("cuttlefish-image-boot"));
  repo.write("docs/evidence/unit-a.json", filled("physical-device"));
  cite(repo, "physicalDevice", "docs/evidence/cf.json");
  cite(repo, "cuttlefishBoot", "docs/evidence/unit-a.json");
  const { problems } = evidenceClassProblems(repo.dir);
  assert.ok(problems.some(problem => /physicalDevice: evidence docs\/evidence\/cf\.json is cuttlefish-image-boot evidence; physicalDevice accepts only physical-device/.test(problem)), problems.join("\n"));
  assert.ok(problems.some(problem => /cuttlefishBoot: evidence docs\/evidence\/unit-a\.json is physical-device evidence/.test(problem)), problems.join("\n"));
});

test("correctly classed, filled records pass; templates, unfilled copies, shared files and unclassified release entries do not", t => {
  const repo = fixture(t);
  repo.write("docs/evidence/unit-a.json", filled("physical-device"));
  repo.write("docs/evidence/cf.json", filled("cuttlefish-image-boot"));
  cite(repo, "physicalDevice", "docs/evidence/unit-a.json");
  cite(repo, "cuttlefishBoot", "docs/evidence/cf.json");
  assert.deepEqual(evidenceClassProblems(repo.dir).problems, []);

  repo.write("docs/evidence/unit-b.json", { ...read(root, TEMPLATES["physical-device"]), template: undefined });
  cite(repo, "physicalDevice", "docs/evidence/unit-b.json");
  cite(repo, "physicalDevice", TEMPLATES["physical-device"]);
  repo.write("docs/evidence/legacy.json", { schema: 1, level: "release" });
  cite(repo, "cuttlefishBoot", "docs/evidence/legacy.json");
  repo.write("docs/evidence/failed-unit.json", filled("physical-device", { result: "failed" }));
  cite(repo, "physicalDevice", "docs/evidence/failed-unit.json");
  cite(repo, "signedUpdateRecovery", "docs/evidence/unit-a.json");
  const { problems } = evidenceClassProblems(repo.dir);
  for (const pattern of [/unit-b\.json still has UNSET fields/, /cites the template/, /legacy\.json has no evidenceClass \(release evidence must be made from/, /physicalDevice is passed, but docs\/evidence\/failed-unit\.json records result "failed"/, /unit-a\.json is cited by physicalDevice and signedUpdateRecovery/])
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}\n${problems.join("\n")}`);
});

test("a channel drill marked passed needs its own passed drill record", t => {
  const repo = fixture(t);
  const channel = repo.readBack(CHANNEL);
  repo.write(CHANNEL, { ...channel, drills: { ...channel.drills, signedUpdate: "passed", stockRecovery: "passed" } });
  repo.write("docs/evidence/drill-signed-update.json", filled("physical-device-drill", { drill: "signedUpdate" }));
  cite(repo, "signedUpdateRecovery", "docs/evidence/drill-signed-update.json", { status: "development", level: "release" });
  const { problems } = evidenceClassProblems(repo.dir);
  assert.ok(!problems.some(problem => /drills\.signedUpdate/.test(problem)), problems.join("\n"));
  assert.ok(problems.some(problem => /drills\.stockRecovery is "passed" without a passed physical-device-drill record/.test(problem)), problems.join("\n"));
  repo.write("docs/evidence/drill-bad.json", filled("physical-device-drill", { drill: "factoryReset" }));
  cite(repo, "signedUpdateRecovery", "docs/evidence/drill-bad.json", { status: "development" });
  assert.ok(evidenceClassProblems(repo.dir).problems.some(problem => /names drill "factoryReset"/.test(problem)));
});

test("human:status reads the physicalDevice gate for H-24, and every channel drill plus the signedUpdateRecovery gate for H-25", t => {
  const repo = fixture(t);
  assert.deepEqual(CHECKS["H-24"](repo.dir), { state: "open", detail: "physicalDevice gate: development" });
  assert.equal(CHECKS["H-25"](repo.dir).state, "open");
  assert.match(CHECKS["H-25"](repo.dir).detail, /signedUpdate not run, interruptedUpdate not run, compatibleRollback not run, stockRecovery not run; signedUpdateRecovery gate: not run/);
  const gates = repo.readBack(GATES);
  gates.gates.physicalDevice.status = "passed";
  gates.gates.signedUpdateRecovery.status = "passed";
  repo.write(GATES, gates);
  assert.equal(CHECKS["H-24"](repo.dir).state, "done");
  assert.equal(CHECKS["H-25"](repo.dir).state, "open", "the gate alone does not close H-25 while drills are not run");
  const channel = repo.readBack(CHANNEL);
  repo.write(CHANNEL, { ...channel, drills: Object.fromEntries(DRILLS.map(drill => [drill, "passed"])) });
  assert.equal(CHECKS["H-25"](repo.dir).state, "done");
  // human:status trusts the recorded status; only the shared gate rules and this class check judge the evidence behind it.
  assert.ok(evidenceClassProblems(repo.dir).problems.some(problem => /drills\.signedUpdate is "passed" without/.test(problem)));
});
