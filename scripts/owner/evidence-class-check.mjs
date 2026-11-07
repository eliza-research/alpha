#!/usr/bin/env node
/**
 * Read-only check that Pixel 10a image evidence keeps its classes apart (issue #673, docs/human-actions.md
 * H-23 to H-25):
 *
 *   node scripts/owner/evidence-class-check.mjs [--json] [--strict]
 *
 * The shared gate rules (scripts/pixel10a-gates.mjs) check each gate's status against development or
 * release evidence levels, but not which kind of run an evidence file records. This adds that, for the
 * evidence files made from docs/runbooks/templates/:
 *
 *   cuttlefishBoot        evidenceClass "cuttlefish-image-boot"   (virtual target, H-23)
 *   physicalDevice        evidenceClass "physical-device"         (one file per Pixel 10a unit, H-24)
 *   signedUpdateRecovery  evidenceClass "physical-device-drill"   (one file per executed drill, H-25)
 *
 * Problems: a local evidence file of another class under a gate; a release-level local JSON entry with
 * no evidenceClass; a referenced file that still holds UNSET template fields or is not a result of
 * "passed" under a passed gate; one file cited by two of these gates; a channel drill recorded
 * "passed" without a drill record for it. Development entries without a class are notes only (the
 * records before this check). Files only; exits 0 unless --strict and a problem is found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderFields } from "./production-staging-preflight.mjs";

export const GATES = "android/aosp/pixel10a-qualification-gates.json";
export const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const GATE_CLASSES = Object.freeze({
  cuttlefishBoot: "cuttlefish-image-boot",
  physicalDevice: "physical-device",
  signedUpdateRecovery: "physical-device-drill",
});
export const TEMPLATES = Object.freeze({
  "cuttlefish-image-boot": "docs/runbooks/templates/cuttlefish-boot-evidence.template.json",
  "physical-device": "docs/runbooks/templates/pixel10a-unit-evidence.template.json",
  "physical-device-drill": "docs/runbooks/templates/pixel10a-drill-evidence.template.json",
});
export const DRILLS = Object.freeze(["signedUpdate", "interruptedUpdate", "compatibleRollback", "stockRecovery"]);

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const localJson = ref => typeof ref === "string" && !/^[a-z]+:\/\//i.test(ref) && ref.endsWith(".json") && !path.isAbsolute(ref) && !ref.split("/").includes("..");

/** {problems, notes} for the gates and channel read from `root`. */
export function evidenceClassProblems(root = process.cwd()) {
  const problems = [], notes = [];
  let gates, channel;
  try { gates = readJson(root, GATES).gates ?? {}; } catch (error) { return { problems: [`${GATES} is unreadable: ${error.message}`], notes }; }
  try { channel = readJson(root, CHANNEL); } catch (error) { problems.push(`${CHANNEL} is unreadable: ${error.message}`); }
  const citedBy = new Map();
  const drillRecords = new Map();
  for (const [gate, expected] of Object.entries(GATE_CLASSES)) {
    const record = gates[gate];
    if (!record) { problems.push(`${GATES} has no ${gate} gate`); continue; }
    for (const entry of record.evidence ?? []) {
      const ref = entry?.ref;
      if (!localJson(ref)) { if (entry?.level === "release") notes.push(`${gate}: release evidence ${ref} is not a local JSON record; its class cannot be checked here`); continue; }
      citedBy.set(ref, [...(citedBy.get(ref) ?? []), gate]);
      let evidence;
      try { evidence = readJson(root, ref); } catch (error) { problems.push(`${gate}: evidence ${ref} is unreadable (${error.code ?? error.message})`); continue; }
      const actual = evidence?.evidenceClass;
      if (actual === undefined) {
        (entry.level === "release" ? problems : notes).push(`${gate}: ${entry.level} evidence ${ref} has no evidenceClass${entry.level === "release" ? ` (release evidence must be made from ${TEMPLATES[expected]})` : " (recorded before evidence classes)"}`);
        continue;
      }
      if (actual !== expected) { problems.push(`${gate}: evidence ${ref} is ${actual} evidence; ${gate} accepts only ${expected}`); continue; }
      if (evidence.template && ref === TEMPLATES[actual]) { problems.push(`${gate}: cites the template ${ref} itself`); continue; }
      const open = placeholderFields(evidence);
      if (open.length) problems.push(`${gate}: evidence ${ref} still has UNSET fields (${open.slice(0, 5).join(", ")}${open.length > 5 ? ", ..." : ""})`);
      if (record.status === "passed" && entry.level === "release" && evidence.result !== "passed") problems.push(`${gate} is passed, but ${ref} records result ${JSON.stringify(evidence.result)}`);
      if (evidence.level !== entry.level) problems.push(`${gate}: ${ref} says level ${JSON.stringify(evidence.level)}, the gate entry says ${JSON.stringify(entry.level)}`);
      if (actual === "physical-device-drill") {
        if (!DRILLS.includes(evidence.drill)) problems.push(`${gate}: ${ref} names drill ${JSON.stringify(evidence.drill)}, not one of ${DRILLS.join(", ")}`);
        else if (evidence.result === "passed") drillRecords.set(evidence.drill, ref);
      }
    }
  }
  for (const [ref, cited] of citedBy) if (cited.length > 1) problems.push(`${ref} is cited by ${cited.join(" and ")}; each gate needs evidence of its own`);
  for (const drill of DRILLS) {
    const status = channel?.drills?.[drill];
    if (status === "passed" && !drillRecords.has(drill)) problems.push(`${CHANNEL} drills.${drill} is "passed" without a passed physical-device-drill record under signedUpdateRecovery`);
  }
  return { problems, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--json", "--strict"].includes(arg))) {
    console.error("Usage: node scripts/owner/evidence-class-check.mjs [--json] [--strict]");
    process.exitCode = 2;
  } else {
    const result = evidenceClassProblems(path.resolve(import.meta.dirname, "../.."));
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log("Pixel 10a evidence classes (read-only):");
      for (const problem of result.problems) console.log(`  PROBLEM ${problem}`);
      for (const note of result.notes) console.log(`  note    ${note}`);
      console.log(`${result.problems.length} problem(s), ${result.notes.length} note(s). Device, Cuttlefish and drill evidence stay separate; none proves another.`);
    }
    if (args.includes("--strict") && result.problems.length) process.exitCode = 1;
  }
}
