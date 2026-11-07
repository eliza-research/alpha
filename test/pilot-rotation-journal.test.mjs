import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginPilotRotation, claimPilotInstall, completePilotRotation, inspectPilotRotation, observePilotRotation,
} from "../scripts/owner/pilot-rotation-journal.mjs";

const device = { serialSha256: "a".repeat(64), sdk: 37, buildFingerprintSha256: "b".repeat(64) };
const before = { userId: "10123", firstInstallTime: "fixture", versionCode: 44 };
const intent = {
  deviceApi: device.sdk,
  deviceBuildFingerprintSha256: device.buildFingerprintSha256,
  installedApkSha256: "c".repeat(64),
  replacementApkSha256: "d".repeat(64),
  installedVersionCode: before.versionCode,
  replacementVersionCode: 45,
  userId: before.userId,
  firstInstallTime: before.firstInstallTime,
};
function journalFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-rotation-journal-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "private", "journal");
}

test("a lost installer response survives the lock release and forbids another dispatch", t => {
  const directory = journalFixture(t);
  const id = device.serialSha256;
  assert.deepEqual(inspectPilotRotation(directory, id), { state: "none" });
  const release = claimPilotInstall(directory, id);
  try {
    assert.throws(() => claimPilotInstall(directory, id), /lock is held/);
    beginPilotRotation(directory, id, intent);
  } finally { release(); }

  const next = claimPilotInstall(directory, id);
  try {
    const pending = inspectPilotRotation(directory, id);
    assert.deepEqual(observePilotRotation(pending, { device, installed: before, apkSha256: intent.installedApkSha256 }),
      { state: "unknown", observation: "previous-observed", replayAllowed: false });
    assert.deepEqual(observePilotRotation(pending, {
      device, installed: { ...before, versionCode: 45 }, apkSha256: intent.replacementApkSha256,
    }), { state: "unknown", observation: "replacement-observed", replayAllowed: false });
    assert.equal(inspectPilotRotation(directory, id).state, "unknown");
    assert.throws(() => beginPilotRotation(directory, id, intent), /do not dispatch again/);
  } finally { next(); }
});

test("a terminal result must match the durable intent and still consumes the migration", t => {
  const directory = journalFixture(t);
  const id = device.serialSha256;
  const release = claimPilotInstall(directory, id);
  try {
    const pin = beginPilotRotation(directory, id, intent);
    assert.throws(() => completePilotRotation(directory, id, "0".repeat(64), intent.replacementApkSha256),
      /does not match/);
    completePilotRotation(directory, id, pin, intent.replacementApkSha256);
    const applied = inspectPilotRotation(directory, id);
    assert.equal(applied.state, "verified-applied");
    assert.throws(() => beginPilotRotation(directory, id, intent), /do not dispatch again/);
    assert.deepEqual(observePilotRotation(applied, {
      device, installed: { ...before, userId: "wrong", versionCode: 45 }, apkSha256: intent.replacementApkSha256,
    }), { state: "verified-applied", observation: "unmatched", replayAllowed: false });
  } finally { release(); }
});
