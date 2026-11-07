#!/usr/bin/env node
/**
 * Owner review report for the MVP rows of the app QA checklist (issue #678, human action H-38).
 *
 *   node scripts/owner/qa-approval-report.mjs [--json] [--out <file.md>]
 *
 * Reads docs/app-qa-checklist.json and docs/app-qa-checklist.md only. For every MVP row it shows,
 * grouped by surface (the checklist's `area`), whether the agent-filled columns are filled
 * (`implementation`, and `preview`, the preview QA column), whether a Seeker result is recorded,
 * the owner's `userApproval`, and the preview and prompt-proof links an owner opens for that row.
 * It also cross-checks the counts `npm run human:status` prints for H-38 and lists rows where the
 * Markdown page disagrees with the JSON record.
 *
 * It never writes `userApproval` or `seeker`: only the owner (and the device operator for the
 * Seeker column) records those. Writes nothing unless --out is given, and then only that file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHECKLIST_JSON = "docs/app-qa-checklist.json";
export const CHECKLIST_MD = "docs/app-qa-checklist.md";

const text = value => String(value ?? "").trim();
/** human:status counts a row approved when userApproval starts with "Approved" (scripts/human-actions.mjs H-38). */
export const approved = item => /^approved\b/i.test(text(item.userApproval));
/** human:status counts a row as having no Seeker result when seeker starts with "Pending". */
export const seekerPendingStrict = item => /^pending\b/i.test(text(item.seeker));
/**
 * A Seeker cell that does not start with "Pending" but still says the Seeker result is pending,
 * unproven or not attempted. human:status counts these as having a result.
 */
export const seekerPendingWording = item => !seekerPendingStrict(item) && /\b(pending|unproven|not attempted|not applicable)\b/i.test(text(item.seeker));
export const implementationFilled = item => text(item.implementation) !== "" && !/^(needs review|pending)\b/i.test(text(item.implementation));
export const previewFilled = item => text(item.preview) !== "" && !/^pending\b/i.test(text(item.preview));

/** Anchor GitHub generates for a "## Area" heading of docs/app-qa-checklist.md. */
export const areaAnchor = area => area.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-");

/** Evidence entries and paths named in the row's text that look like prompt proof. */
export function promptProof(item) {
  const named = [...(item.evidence ?? [])];
  for (const field of ["implementation", "preview", "seeker", "notes"])
    for (const match of text(item[field]).matchAll(/docs\/evidence\/[A-Za-z0-9._-]+\.json/g)) named.push(match[0]);
  const unique = [...new Set(named)];
  return {
    evidence: unique,
    prompt: unique.filter(file => /prompt|send|read|agent/i.test(file)),
    mentionsPrompt: /\bprompt\b/i.test([item.preview, item.seeker, item.notes].map(text).join(" ")),
  };
}

/** Table rows of the Markdown page, keyed by ID: {viewOrFlow, preview, seeker, userApproval}. */
export function markdownRows(markdown) {
  const rows = new Map();
  for (const match of markdown.matchAll(/^\| ([a-z0-9][a-z0-9-]*) \| (.*) \|$/gm)) {
    const cells = match[2].split(" | ");
    if (cells.length !== 4) continue;
    rows.set(match[1], { viewOrFlow: cells[0], preview: cells[1], seeker: cells[2], userApproval: cells[3] });
  }
  return rows;
}

export function buildReport(checklist, markdown, { root = null } = {}) {
  const items = (checklist.items ?? []).filter(item => item?.scope === "MVP");
  const md = markdownRows(markdown);
  const rows = items.map(item => {
    const proof = promptProof(item);
    const page = md.get(item.id);
    const disagreements = page ? ["preview", "seeker", "userApproval"].filter(field => page[field] !== text(item[field])) : ["not on the page"];
    const missingEvidence = root ? proof.evidence.filter(file => !fs.existsSync(path.join(root, file))) : [];
    return {
      id: item.id, area: item.area, viewOrFlow: item.viewOrFlow,
      implemented: implementationFilled(item), tested: previewFilled(item),
      seeker: seekerPendingStrict(item) ? "pending" : seekerPendingWording(item) ? "pending-wording" : "recorded",
      userApproval: approved(item) ? "approved" : text(item.userApproval) || "unset",
      previewLink: `${checklist.preview ?? "(no preview URL recorded)"}`, pageLink: `${CHECKLIST_MD}#${areaAnchor(item.area)}`,
      evidence: proof.evidence, promptProof: proof.prompt, mentionsPrompt: proof.mentionsPrompt, missingEvidence, pageDisagrees: disagreements,
    };
  });
  const areas = [];
  for (const row of rows) {
    let area = areas.find(entry => entry.area === row.area);
    if (!area) areas.push(area = { area: row.area, rows: [] });
    area.rows.push(row);
  }
  const count = predicate => rows.filter(predicate).length;
  return {
    format: "alpha-owner-qa-approval-report-v1",
    source: { json: CHECKLIST_JSON, md: CHECKLIST_MD, updatedAt: checklist.updatedAt ?? null, productSource: checklist.productSource ?? null, preview: checklist.preview ?? null },
    columns: { implemented: "implementation is filled and not 'Needs review…'/'Pending'", tested: "preview (agent preview QA) is filled and not 'Pending…'", testedNote: "The JSON has no separate `implemented` or `tested` field; `implementation` and `preview` are the agent-filled columns." },
    totals: {
      mvpRows: rows.length, approved: count(row => row.userApproval === "approved"),
      implementedFilled: count(row => row.implemented), testedFilled: count(row => row.tested),
      seekerPendingAsHumanStatusCounts: count(row => row.seeker === "pending"),
      seekerPendingWordingCountedAsRecorded: count(row => row.seeker === "pending-wording"),
      seekerRecorded: count(row => row.seeker === "recorded"),
      withEvidence: count(row => row.evidence.length > 0), withPromptProof: count(row => row.promptProof.length > 0),
      pageDisagreements: count(row => row.pageDisagrees.length > 0), missingEvidenceFiles: rows.reduce((sum, row) => sum + row.missingEvidence.length, 0),
    },
    areas: areas.map(area => ({ area: area.area, rows: area.rows.length, approved: area.rows.filter(row => row.userApproval === "approved").length,
      implemented: area.rows.filter(row => row.implemented).length, tested: area.rows.filter(row => row.tested).length,
      seekerPending: area.rows.filter(row => row.seeker !== "recorded").length, items: area.rows })),
  };
}

/** The H-38 detail human:status prints, rebuilt from the same predicates (for the cross-check). */
export const humanStatusDetail = report => `${report.totals.approved} of ${report.totals.mvpRows} MVP rows approved by the owner; ${report.totals.seekerPendingAsHumanStatusCounts} still have no Seeker result`;

const yes = value => (value ? "yes" : "no");
const cell = value => String(value).replace(/\|/g, "/");
export function formatMarkdown(report) {
  const t = report.totals;
  const lines = [
    `Generated by \`node scripts/owner/qa-approval-report.mjs\` from \`${report.source.json}\` (updated ${report.source.updatedAt ?? "?"}, product ${String(report.source.productSource ?? "?").slice(0, 9)}). Regenerate before each review; do not edit the table by hand.`,
    "",
    `- MVP rows: ${t.mvpRows}; owner-approved: ${t.approved}.`,
    `- Agent columns: implementation filled on ${t.implementedFilled}, preview QA filled on ${t.testedFilled}. ${report.columns.testedNote}`,
    `- Seeker: ${t.seekerRecorded} rows record a result; ${t.seekerPendingAsHumanStatusCounts} start with "Pending" (what \`npm run human:status\` counts); ${t.seekerPendingWordingCountedAsRecorded} more say pending/unproven/not attempted without starting with "Pending" and are counted by human:status as having a result.`,
    `- Rows with any evidence file: ${t.withEvidence}; with a prompt-proof file: ${t.withPromptProof}; evidence files named but missing: ${t.missingEvidenceFiles}.`,
    `- Rows where ${CHECKLIST_MD} disagrees with the JSON (preview, Seeker or approval cell): ${t.pageDisagreements}. The JSON is the record human:status reads.`,
    `- Preview: ${report.source.preview ?? "none recorded"} (one loopback preview for every row; it exists only on the machine that serves it).`,
    "",
    "| Surface | MVP rows | Implementation filled | Preview QA filled | Seeker pending | Approved |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.areas.map(area => `| [${area.area}](../app-qa-checklist.md#${areaAnchor(area.area)}) | ${area.rows} | ${area.implemented} | ${area.tested} | ${area.seekerPending} | ${area.approved} |`),
  ];
  for (const area of report.areas) {
    lines.push("", `### ${area.area}`, "", "| ID | View / flow | Impl. | Preview QA | Seeker | Approval | Prompt proof / evidence | Page agrees |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of area.items) {
      const proof = row.evidence.length ? row.evidence.map(file => (file.startsWith("docs/") ? `[${path.basename(file)}](../${file.slice(5)})` : `\`${file}\``)).join(", ") : row.mentionsPrompt ? "prompt named in text, no file" : "none";
      lines.push(`| ${row.id} | ${cell(row.viewOrFlow)} | ${yes(row.implemented)} | ${yes(row.tested)} | ${row.seeker} | ${row.userApproval} | ${proof}${row.missingEvidence.length ? ` (missing: ${row.missingEvidence.join(", ")})` : ""} | ${row.pageDisagrees.length ? `no (${row.pageDisagrees.join(", ")})` : "yes"} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  if (args.some((arg, index) => !["--json", "--out"].includes(arg) && index !== outIndex + 1) || (outIndex >= 0 && !out)) {
    console.error("Usage: node scripts/owner/qa-approval-report.mjs [--json] [--out <file>]"); process.exit(2);
  }
  const root = path.resolve(import.meta.dirname, "../..");
  const report = buildReport(JSON.parse(fs.readFileSync(path.join(root, CHECKLIST_JSON), "utf8")), fs.readFileSync(path.join(root, CHECKLIST_MD), "utf8"), { root });
  const output = args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report);
  if (out) fs.writeFileSync(out, output); else process.stdout.write(output);
  console.error(`H-38 as human:status reports it: ${humanStatusDetail(report)}`);
}
