// Owner prep for #666: the deployed latency benchmark config check, the committed report schema
// and the credential scan. Synthetic numbers only; no benchmark runs and nothing is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheMissKeysNeeded, checkConfig, checkReport, credentialFindings, main, requestBudget } from "../scripts/owner/latency-report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const template = JSON.parse(fs.readFileSync(path.join(root, "docs/runbooks/drafts/666-latency-config.staging.template.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "docs/runbooks/drafts/666-latency-report.schema.json"), "utf8"));
const filled = { ...structuredClone(template), inference: { model: "cerebras/qwen-3.8-27b" } };
filled.conditions["billing-outage"].apiBase = "https://api-outage.staging.example";
const summary = (p50, n = 50) => ({ n, p50, p95: p50 * 1.5, mean: p50 * 1.1 });
const row = (condition, service, outcome, p50, mismatches = 0) => ({
  condition, service, expected: [outcome], outcomes: { [outcome]: 50 - mismatches, ...(mismatches ? { unexpected: mismatches } : {}) }, statuses: { 200: 50 },
  mismatches, client: summary(p50), gatewayAuth: summary(3), gatewayPreforward: null, addedOverBaseline: condition === "baseline" ? null : { p50: p50 - 40, p95: (p50 - 40) * 1.5 },
});
const report = () => ({
  schema: 1, kind: "plan-admission-deployed-latency", environment: "staging", upstreamRevision: "1f2a922f86e2a1f3d6cd62e097145492bd49ebfc",
  harness: "packages/cloud/scripts/plan-admission-deployed-latency.ts",
  operatorConfirmation: { confirmedBy: "Cloud operator", confirmedAt: "2026-11-02T10:00:00Z", billingOutageProducedBy: "billing store binding detached on the outage deployment" },
  result: { schema: 1, generatedAt: "2026-11-02T10:30:00.000Z", apiBase: "https://api-staging.eliza.app", iterations: 50, warmup: 3,
    baseline: row("baseline", "network", "admitted", 40),
    series: [row("normal", "inference", "admitted", 55), row("exhausted", "inference", "rate-limited", 48)], expectationsMet: true },
});

test("the staging template names keys by environment variable and is refused until its placeholders are filled", () => {
  const problems = checkConfig(template);
  assert.ok(problems.some(line => /inference\.model/.test(line)));
  assert.ok(problems.some(line => /billing-outage\.apiBase/.test(line)));
  assert.deepEqual(checkConfig(filled), []);
  assert.equal(cacheMissKeysNeeded(filled), 50);
  assert.deepEqual(requestBudget(filled).normal, { requests: 53, counted: true });
  assert.deepEqual(requestBudget(filled)["cache-miss"], { requests: 50, counted: true });
});

test("a literal credential in the config, a production target or a shared outage target is refused", () => {
  const leaked = structuredClone(filled); leaked.conditions.normal = { keyEnv: "eliza_live_0123456789abcdef" };
  assert.ok(checkConfig(leaked).some(line => /Eliza Cloud key/.test(line)));
  const production = { ...structuredClone(filled), apiBase: "https://api.eliza.app" };
  assert.ok(checkConfig(production).some(line => /production/.test(line)));
  assert.ok(!checkConfig(production, { allowProduction: true }).some(line => /apiBase is production/.test(line)));
  const shared = structuredClone(filled); delete shared.conditions["billing-outage"].apiBase;
  assert.ok(checkConfig(shared).some(line => /outage deployment/.test(line)));
  const lowercase = structuredClone(filled); lowercase.conditions.expired.keyEnv = "bench_key";
  assert.ok(checkConfig(lowercase).some(line => /expired needs keyEnv/.test(line)));
});

test("a harness-shaped report passes the committed schema and the credential scan", () => {
  assert.deepEqual(checkReport(report()), []);
  assert.equal(schema.properties.result.$ref, "#/$defs/result");
  assert.deepEqual(Object.keys(schema.$defs.series.properties).sort(), Object.keys(report().result.baseline).sort(), "the schema and the harness series agree");
});

test("extra fields, inconsistent counts and credential-shaped strings are refused by path, without the value", () => {
  const extra = report(); extra.result.series[0].authorization = "redacted";
  assert.ok(checkReport(extra).some(line => /authorization is not in the report schema/.test(line)));
  const leaked = report(); leaked.operatorConfirmation.confirmedBy = "Bearer abcdefghijklmnop";
  const problems = checkReport(leaked);
  assert.ok(problems.some(line => line.includes("$.operatorConfirmation.confirmedBy looks like a bearer token")));
  assert.ok(problems.every(line => !line.includes("abcdefghijklmnop")), "the value is never echoed");
  const email = report(); email.operatorConfirmation.billingOutageProducedBy = "done by ops@example.com";
  assert.ok(checkReport(email).some(line => /email address/.test(line)));
  const pathUrl = report(); pathUrl.result.apiBase = "https://api-staging.eliza.app/api/v1/chat/completions";
  assert.ok(checkReport(pathUrl).some(line => /apiBase must be an exact https origin/.test(line)));
  const mismatch = report(); mismatch.result.series[1] = row("exhausted", "inference", "rate-limited", 48, 2);
  assert.ok(checkReport(mismatch).some(line => /expectationsMet disagrees/.test(line)));
  const counts = report(); counts.result.series[0].outcomes.admitted = 49;
  assert.ok(checkReport(counts).some(line => /outcome counts/.test(line)));
});

test("credential patterns cover the shapes a run could leak", () => {
  for (const value of ["Bearer abcdefgh12345678", "eliza_mobile_abcdef123456", "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sig", "csk-abcdefghijklmnop1234", "sess_abcdefghijklmnop1234"])
    assert.equal(credentialFindings({ value }).length, 1, value);
  for (const value of ["admitted", "rate-limited", "Cloud operator", "https://api-staging.eliza.app"]) assert.deepEqual(credentialFindings({ value }), [], value);
});

test("wrap adds provenance and refuses an unsafe result", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-latency-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const results = path.join(dir, "results.json"), out = path.join(dir, "report.json");
  fs.writeFileSync(results, JSON.stringify(report().result));
  const lines = [];
  const args = ["wrap", results, "--environment", "staging", "--upstream-revision", "1f2a922f86e2a1f3d6cd62e097145492bd49ebfc", "--confirmed-by", "Cloud operator", "--confirmed-at", "2026-11-02T10:00:00Z", "--out", out];
  assert.equal(main(args, { log: line => lines.push(line) }), 0);
  assert.equal(main(["check", out], { log: line => lines.push(line) }), 0);
  fs.writeFileSync(results, JSON.stringify({ ...report().result, apiKey: "eliza_abcdefghijklmnop" }));
  assert.equal(main(args, { log: line => lines.push(line) }), 1);
  assert.ok(!lines.join("\n").includes("eliza_abcdefghijklmnop"));
});
