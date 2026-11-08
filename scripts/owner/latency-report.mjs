#!/usr/bin/env node
/**
 * Owner prep for #666 (docs/human-actions.md H-15): check a deployed plan-admission latency
 * benchmark config before the run and the report before it is committed. Reads local files only;
 * it never runs the benchmark, contacts Cloud or reads an environment variable's value.
 *
 *   node scripts/owner/latency-report.mjs config FILE [--allow-production]
 *   node scripts/owner/latency-report.mjs check FILE
 *   node scripts/owner/latency-report.mjs wrap RESULTS.json --environment staging|production
 *       --upstream-revision SHA --confirmed-by ROLE --confirmed-at ISO [--billing-outage TEXT] [--out FILE]
 *
 * `config` applies the pinned harness's own rules (packages/cloud/scripts/
 * plan-admission-deployed-latency.ts parseDeployedLatencyConfig) and refuses anything that looks
 * like a credential written into the file: keys must be named by environment variable only.
 * `check` validates the committed form (docs/runbooks/drafts/666-latency-report.schema.json): only
 * the schema's fields, and no string anywhere that looks like a bearer token, Eliza Cloud key, JWT,
 * provider key, email address or URL with a path or query. A finding names the JSON path, never the
 * value. `wrap` adds the provenance block to the harness's results.json and then runs `check`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node scripts/owner/latency-report.mjs config FILE [--allow-production]
       node scripts/owner/latency-report.mjs check FILE
       node scripts/owner/latency-report.mjs wrap RESULTS.json --environment staging|production --upstream-revision SHA --confirmed-by ROLE --confirmed-at ISO [--billing-outage TEXT] [--out FILE]`;
export const CONDITIONS = ["normal", "cache-miss", "exhausted", "expired", "billing-outage"];
export const SERVICES = ["inference", "maps"];
export const OUTCOMES = ["admitted", "rate-limited", "allowance-exhausted", "subscription-required", "billing-refused", "cache-warming", "unauthorized", "unavailable", "unexpected"];
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const PRODUCTION_API = "https://api.eliza.app";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Credential-shaped strings. Each rule names what it found; the value itself is never reported. */
export const CREDENTIAL_PATTERNS = Object.freeze([
  ["bearer token", /\bbearer\s+\S{8,}/i],
  ["Eliza Cloud key", /\beliza_[A-Za-z0-9_-]{8,}/],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./],
  ["provider key", /\b(?:csk|sk|pk|rk)-[A-Za-z0-9_-]{16,}/],
  ["Steward or session token", /\b(?:stw|sess|session)_[A-Za-z0-9_-]{16,}/i],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["long opaque secret", /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/],
  ["URL with a path or query", /https?:\/\/[^\s"/]+\/[^\s"]+/],
]);

/** Every string (and object key) under `value` that matches a credential pattern, as {path, rule}. */
export function credentialFindings(value, at = "$", { allow = new Set() } = {}) {
  const findings = [];
  const visit = (item, where) => {
    if (typeof item === "string") {
      if (allow.has(where)) return;
      for (const [rule, pattern] of CREDENTIAL_PATTERNS) if (pattern.test(item)) { findings.push({ path: where, rule }); break; }
    } else if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, `${where}[${index}]`));
    else if (isObject(item)) for (const [key, entry] of Object.entries(item)) { visit(key, `${where}{key}`); visit(entry, `${where}.${key}`); }
  };
  visit(value, at);
  return findings;
}

const exactOrigin = value => { try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; } catch { return false; } };

/** The harness's config rules, plus "no literal credential". Returns problems (strings). */
export function checkConfig(config, { allowProduction = false } = {}) {
  const problems = [];
  if (!isObject(config)) return ["the config must be a JSON object"];
  for (const finding of credentialFindings(config)) problems.push(`${finding.path} looks like a ${finding.rule}; name keys by environment variable only`);
  if (!exactOrigin(config.apiBase)) problems.push("apiBase must be an exact https origin");
  if (config.apiBase === PRODUCTION_API && !allowProduction) problems.push("apiBase is production; run on staging first, or pass --allow-production after the operator confirms a production run");
  const iterations = config.iterations ?? 50, warmup = config.warmup ?? 3;
  if (!Number.isSafeInteger(iterations) || iterations < 5 || iterations > 2000) problems.push("iterations must be an integer from 5 to 2000");
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup > 50) problems.push("warmup must be an integer from 0 to 50");
  const services = config.services ?? SERVICES;
  if (!Array.isArray(services) || !services.length || services.some(service => !SERVICES.includes(service))) problems.push("services must list inference and/or maps");
  if (Array.isArray(services) && services.includes("inference") && (typeof config.inference?.model !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(config.inference.model)))
    problems.push("inference.model is required for inference (an exact model id)");
  if (Array.isArray(services) && services.includes("maps") && (typeof config.maps?.query !== "string" || !config.maps.query.trim() || config.maps.query.length > 300))
    problems.push("maps.query is required for maps");
  if (!isObject(config.conditions) || !Object.keys(config.conditions).length) problems.push("at least one condition is required");
  else for (const [name, item] of Object.entries(config.conditions)) {
    if (!CONDITIONS.includes(name)) { problems.push(`unknown condition ${name}`); continue; }
    const field = name === "cache-miss" ? "keysEnv" : "keyEnv";
    if (typeof item?.[field] !== "string" || !ENV_NAME.test(item[field])) problems.push(`${name} needs ${field} (an environment variable name)`);
    if (item?.apiBase !== undefined && !exactOrigin(item.apiBase)) problems.push(`${name}.apiBase must be an exact https origin`);
    if (name === "billing-outage" && (item?.apiBase === undefined || item.apiBase === config.apiBase))
      problems.push("billing-outage should point apiBase at the operator's outage deployment, never the shared deployment");
    if (item?.expect !== undefined) for (const [service, listed] of Object.entries(item.expect))
      if (!SERVICES.includes(service) || !Array.isArray(listed) || !listed.length || listed.some(outcome => !OUTCOMES.includes(outcome))) problems.push(`${name}.expect.${service} must list known outcomes`);
  }
  // The fresh-key count for cache-miss is checked by the harness at run time (cacheMissKeysNeeded).
  return problems;
}

/** Fresh keys the cache-miss condition consumes: one per measured request per service. */
export const cacheMissKeysNeeded = config => (config.iterations ?? 50) * (config.services ?? SERVICES).length;

/** Requests one run sends, per condition, so the operator can confirm what is billed or counted. */
export function requestBudget(config) {
  const iterations = config.iterations ?? 50, warmup = config.warmup ?? 3, services = (config.services ?? SERVICES).length;
  const rows = { baseline: { requests: warmup + iterations, counted: false } };
  for (const name of Object.keys(config.conditions ?? {}))
    rows[name] = { requests: (name === "cache-miss" ? iterations : warmup + iterations) * services, counted: name === "normal" || name === "cache-miss" };
  return rows;
}

const SUMMARY = ["n", "p50", "p95", "mean"];
const SERIES = ["condition", "service", "expected", "outcomes", "statuses", "mismatches", "client", "gatewayAuth", "gatewayPreforward", "addedOverBaseline"];
const RESULT = ["schema", "generatedAt", "apiBase", "iterations", "warmup", "baseline", "series", "expectationsMet"];
const TOP = ["schema", "kind", "environment", "upstreamRevision", "harness", "operatorConfirmation", "result"];
const CONFIRMATION = ["confirmedBy", "confirmedAt", "billingOutageProducedBy"];

function exactKeys(value, keys, at, problems) {
  if (!isObject(value)) { problems.push(`${at} must be an object`); return false; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) problems.push(`${at}.${key} is not in the report schema`);
  for (const key of keys) if (!Object.hasOwn(value, key)) problems.push(`${at}.${key} is missing`);
  return true;
}
const isoDate = value => typeof value === "string" && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);

function summary(value, at, problems) {
  if (value === null) return;
  if (!exactKeys(value, SUMMARY, at, problems)) return;
  if (!Number.isSafeInteger(value.n) || value.n < 1) problems.push(`${at}.n must be a positive integer`);
  for (const key of ["p50", "p95", "mean"]) if (typeof value[key] !== "number" || !Number.isFinite(value[key])) problems.push(`${at}.${key} must be a number`);
}
function series(row, at, problems, baseline = false) {
  if (!exactKeys(row, SERIES, at, problems)) return;
  if (baseline ? row.condition !== "baseline" || row.service !== "network" : !CONDITIONS.includes(row.condition) || !SERVICES.includes(row.service))
    problems.push(`${at} has condition ${JSON.stringify(row.condition)} and service ${JSON.stringify(row.service)}`);
  if (!Array.isArray(row.expected) || !row.expected.length || row.expected.some(outcome => !OUTCOMES.includes(outcome))) problems.push(`${at}.expected must list known outcomes`);
  if (!isObject(row.outcomes) || Object.entries(row.outcomes).some(([key, count]) => !OUTCOMES.includes(key) || !Number.isSafeInteger(count) || count < 0)) problems.push(`${at}.outcomes must count known outcomes`);
  if (!isObject(row.statuses) || Object.entries(row.statuses).some(([key, count]) => !/^\d{1,3}$/.test(key) || !Number.isSafeInteger(count) || count < 0)) problems.push(`${at}.statuses must count HTTP statuses`);
  if (!Number.isSafeInteger(row.mismatches) || row.mismatches < 0) problems.push(`${at}.mismatches must be a non-negative integer`);
  for (const key of ["client", "gatewayAuth", "gatewayPreforward"]) summary(row[key], `${at}.${key}`, problems);
  if (row.addedOverBaseline !== null && exactKeys(row.addedOverBaseline, ["p50", "p95"], `${at}.addedOverBaseline`, problems))
    for (const key of ["p50", "p95"]) if (typeof row.addedOverBaseline[key] !== "number") problems.push(`${at}.addedOverBaseline.${key} must be a number`);
  const counted = Object.values(row.outcomes ?? {}).reduce((sum, count) => sum + (Number.isSafeInteger(count) ? count : 0), 0);
  if (row.client && counted !== row.client.n) problems.push(`${at}: outcome counts (${counted}) differ from the client sample count (${row.client.n})`);
}

/** Problems with a committed report: schema shape, then the credential scan. */
export function checkReport(report) {
  const problems = [];
  if (!exactKeys(report, TOP, "$", problems)) return problems;
  if (report.schema !== 1) problems.push("$.schema must be 1");
  if (report.kind !== "plan-admission-deployed-latency") problems.push("$.kind must be plan-admission-deployed-latency");
  if (!["staging", "production"].includes(report.environment)) problems.push("$.environment must be staging or production");
  if (typeof report.upstreamRevision !== "string" || !/^[0-9a-f]{40}$/.test(report.upstreamRevision)) problems.push("$.upstreamRevision must be a full commit SHA");
  if (report.harness !== "packages/cloud/scripts/plan-admission-deployed-latency.ts") problems.push("$.harness must name the upstream harness");
  if (exactKeys(report.operatorConfirmation, CONFIRMATION, "$.operatorConfirmation", problems)) {
    const confirmation = report.operatorConfirmation;
    if (typeof confirmation.confirmedBy !== "string" || !confirmation.confirmedBy.trim() || confirmation.confirmedBy.length > 80) problems.push("$.operatorConfirmation.confirmedBy must name a role");
    if (!isoDate(confirmation.confirmedAt)) problems.push("$.operatorConfirmation.confirmedAt must be an ISO date-time");
    if (confirmation.billingOutageProducedBy !== null && (typeof confirmation.billingOutageProducedBy !== "string" || confirmation.billingOutageProducedBy.length > 200)) problems.push("$.operatorConfirmation.billingOutageProducedBy must be a short text or null");
  }
  const result = report.result;
  if (exactKeys(result, RESULT, "$.result", problems)) {
    if (result.schema !== 1) problems.push("$.result.schema must be 1 (the harness's DeployedLatencyResult)");
    if (!isoDate(result.generatedAt)) problems.push("$.result.generatedAt must be an ISO date-time");
    if (!exactOrigin(result.apiBase)) problems.push("$.result.apiBase must be an exact https origin");
    if (!Number.isSafeInteger(result.iterations) || result.iterations < 5 || result.iterations > 2000) problems.push("$.result.iterations is outside 5..2000");
    if (!Number.isSafeInteger(result.warmup) || result.warmup < 0 || result.warmup > 50) problems.push("$.result.warmup is outside 0..50");
    if (typeof result.expectationsMet !== "boolean") problems.push("$.result.expectationsMet must be a boolean");
    series(result.baseline, "$.result.baseline", problems, true);
    if (!Array.isArray(result.series)) problems.push("$.result.series must be an array");
    else result.series.forEach((row, index) => series(row, `$.result.series[${index}]`, problems));
    const mismatched = [result.baseline, ...(Array.isArray(result.series) ? result.series : [])].some(row => isObject(row) && row.mismatches > 0);
    if (typeof result.expectationsMet === "boolean" && result.expectationsMet === mismatched) problems.push("$.result.expectationsMet disagrees with the mismatch counts");
    if (report.environment === "production" && result.apiBase !== PRODUCTION_API) problems.push("$.environment is production but apiBase is not the production API");
  }
  const allow = new Set(["$.result.apiBase", "$.harness", "$.upstreamRevision"]);
  for (const finding of credentialFindings(report, "$", { allow })) problems.push(`${finding.path} looks like a ${finding.rule}; remove it before committing`);
  return problems;
}

const readJson = file => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const option = (rest, name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

export function main(argv, { log = console.log, error = console.error } = {}) {
  const [command, file, ...rest] = argv;
  if (!file || file.startsWith("--")) { error(USAGE); return 2; }
  if (command === "config") {
    const config = readJson(file);
    const problems = checkConfig(config, { allowProduction: rest.includes("--allow-production") });
    log(`Latency benchmark config ${file}: ${problems.length ? "NOT ready" : "ready"}`);
    for (const line of problems) log(`  - ${line}`);
    if (isObject(config.conditions?.["cache-miss"])) log(`  cache-miss consumes ${cacheMissKeysNeeded(config)} fresh keys, each used once (${config.conditions["cache-miss"].keysEnv}, comma-separated)`);
    for (const [name, row] of Object.entries(requestBudget(config))) log(`  ${name}: ${row.requests} request(s)${row.counted ? ", billed or counted against the prepared account" : ""}`);
    return problems.length ? 1 : 0;
  }
  if (command === "check") {
    const problems = checkReport(readJson(file));
    log(`Latency report ${file}: ${problems.length ? `${problems.length} problem(s)` : "matches the committed schema; no credential-shaped value found"}`);
    for (const line of problems) log(`  - ${line}`);
    return problems.length ? 1 : 0;
  }
  if (command === "wrap") {
    const environment = option(rest, "--environment");
    const report = {
      schema: 1, kind: "plan-admission-deployed-latency", environment,
      upstreamRevision: option(rest, "--upstream-revision"), harness: "packages/cloud/scripts/plan-admission-deployed-latency.ts",
      operatorConfirmation: { confirmedBy: option(rest, "--confirmed-by"), confirmedAt: option(rest, "--confirmed-at"), billingOutageProducedBy: option(rest, "--billing-outage") ?? null },
      result: readJson(file),
    };
    const problems = checkReport(report);
    if (problems.length) { log(`Not wrapped: ${problems.length} problem(s)`); for (const line of problems) log(`  - ${line}`); return 1; }
    const out = option(rest, "--out");
    if (out) { fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); log(`Wrote ${out}`); } else log(JSON.stringify(report, null, 2));
    return 0;
  }
  error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
