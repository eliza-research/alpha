// scripts/owner/qa-approval-report.mjs (issue #678): grouping, column predicates and the H-38
// cross-check against scripts/human-actions.mjs, on the committed checklist and on fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHECKS } from "../scripts/human-actions.mjs";
import { areaAnchor, buildReport, formatMarkdown, humanStatusDetail, markdownRows, seekerPendingWording } from "../scripts/owner/qa-approval-report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const checklist = JSON.parse(fs.readFileSync(path.join(root, "docs/app-qa-checklist.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "docs/app-qa-checklist.md"), "utf8");

test("the report counts exactly what npm run human:status prints for H-38", () => {
  const report = buildReport(checklist, markdown, { root });
  assert.equal(CHECKS["H-38"](root).detail, humanStatusDetail(report));
  assert.equal(report.totals.mvpRows, checklist.items.filter(item => item.scope === "MVP").length);
  assert.equal(report.areas.reduce((sum, area) => sum + area.rows, 0), report.totals.mvpRows);
  assert.equal(report.totals.seekerRecorded + report.totals.seekerPendingAsHumanStatusCounts + report.totals.seekerPendingWordingCountedAsRecorded, report.totals.mvpRows);
});

test("non-MVP rows are left out and only an owner 'Approved' value counts", () => {
  const items = [
    { id: "a-01", area: "A", viewOrFlow: "One", scope: "MVP", implementation: "Built", preview: "Pending", seeker: "Pending", userApproval: "Approved 2026-11-01", evidence: [] },
    { id: "a-02", area: "A", viewOrFlow: "Two", scope: "MVP", implementation: "Needs review against current source", preview: "Passed", seeker: "Native retest pending", userApproval: "Pending", evidence: ["docs/evidence/x-prompt.json"] },
    { id: "b-01", area: "B", viewOrFlow: "Three", scope: "AOSP only", implementation: "", preview: "", seeker: "", userApproval: "Pending", evidence: [] },
  ];
  const page = "| a-01 | One | Pending | Pending | Approved 2026-11-01 |\n| a-02 | Two | Passed | Pending | Pending |\n";
  const report = buildReport({ preview: "http://127.0.0.1:5209/", items }, page);
  assert.equal(report.totals.mvpRows, 2);
  assert.equal(report.totals.approved, 1);
  assert.equal(report.totals.implementedFilled, 1);
  assert.equal(report.totals.testedFilled, 1);
  assert.equal(report.totals.seekerPendingAsHumanStatusCounts, 1);
  assert.equal(report.totals.seekerPendingWordingCountedAsRecorded, 1);
  assert.equal(report.totals.withPromptProof, 1);
  assert.deepEqual(report.areas[0].items[1].pageDisagrees, ["seeker"]);
  assert.ok(seekerPendingWording(items[1]));
  const text = formatMarkdown(report);
  assert.match(text, /\| a-02 \| Two \| no \| yes \| pending-wording \| Pending \| \[x-prompt\.json\]\(\.\.\/evidence\/x-prompt\.json\) \| no \(seeker\) \|/);
});

test("area anchors match the checklist page headings", () => {
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map(match => areaAnchor(match[1]));
  for (const area of new Set(checklist.items.filter(item => item.scope === "MVP").map(item => item.area))) assert.ok(headings.includes(areaAnchor(area)), area);
  assert.equal(markdownRows("| x-1 | a | b | c | d |\n| --- | --- | --- | --- | --- |\n").size, 1);
});

test("the report never writes the checklist", () => {
  const before = fs.readFileSync(path.join(root, "docs/app-qa-checklist.json"));
  formatMarkdown(buildReport(checklist, markdown, { root }));
  assert.deepEqual(fs.readFileSync(path.join(root, "docs/app-qa-checklist.json")), before);
});
