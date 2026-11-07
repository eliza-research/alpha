// scripts/owner/voice-trial-export.mjs (issue #677, H-33): extraction from the diagnostics report,
// the export layout, and the dry run of scripts/aggregate-voice-latency.mjs on synthetic fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkLayout, dryRun, layoutPath, nativeExport, syntheticTrial } from "../scripts/owner/voice-trial-export.mjs";
import { rejection } from "../scripts/native-voice-latency.mjs";

test("synthetic trials have the shape the native aggregator accepts", () => {
  assert.equal(rejection(syntheticTrial(0)), null);
});

test("the aggregator CLI exits 0, 2, 3 and 1 on the dry-run cases", () => {
  for (const row of dryRun()) assert.equal(row.exit, row.expected, row.name);
});

test("extraction keeps only the native timing member and the layout refuses names that identify people or devices", () => {
  const native = { format: "alpha-native-voice-timing-v3", records: [syntheticTrial(1)] };
  assert.equal(nativeExport({ format: "alpha-diagnostics/v1", nativeVoiceTiming: native, connection: { account: "x" } }), native);
  assert.throws(() => nativeExport({ format: "alpha-diagnostics/v1", nativeVoiceTiming: null }));
  assert.throws(() => layoutPath("/r", { unit: "pixel-serial-123", variant: "launcher", session: "20261105T1430Z" }));
  assert.throws(() => layoutPath("/r", { unit: "unit-a", variant: "release", session: "20261105T1430Z" }));
  assert.equal(layoutPath("/r", { unit: "unit-b", variant: "standalone", session: "20261105T1430Z" }), path.join("/r", "unit-b", "standalone", "20261105T1430Z.native-voice-timing.json"));
});

test("check reports what each cohort still needs and a build that does not match its directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-voice-"));
  try {
    const file = layoutPath(root, { unit: "unit-a", variant: "launcher", session: "20261105T1430Z" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const rows = Array.from({ length: 30 }, (_, index) => syntheticTrial(index));
    rows.push(syntheticTrial(40, { build: "standalone-release" }));
    fs.writeFileSync(file, JSON.stringify({ format: "alpha-native-voice-timing-v3", records: rows }));
    const result = checkLayout(root);
    assert.equal(result.files, 1);
    assert.equal(result.problems.length, 1);
    const launcher = result.cohorts.find(row => row.build === "launcher-release");
    assert.deepEqual(launcher.needs, { passed: 20, warm: 0, cold: 0 });
    assert.equal(launcher.class, "acceptance-candidate");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
