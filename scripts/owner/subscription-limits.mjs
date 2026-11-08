#!/usr/bin/env node
/**
 * Owner prep for #665 (docs/human-actions.md H-02, H-03, H-04). Read-only.
 *
 *   node scripts/owner/subscription-limits.mjs catalog [--environment production|staging] [--recorded FILE] [--json]
 *   node scripts/owner/subscription-limits.mjs rate-limits FILE [--catalog FILE]
 *   node scripts/owner/subscription-limits.mjs maps-allowances FILE [--rate-limits FILE] [--catalog FILE]
 *
 * `catalog` makes one unauthenticated GET {api}/api/v1/subscriptions/plans (the public catalog, no
 * credential) and compares it field by field with the recorded catalog
 * (docs/runbooks/drafts/665-recorded-catalog-v1.json by default). Exit 0 when they match.
 *
 * `rate-limits` and `maps-allowances` validate a candidate ELIZA_CLOUD_PLAN_RATE_LIMITS or
 * ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES value with the same rules as the pinned upstream parsers
 * (packages/cloud/shared/src/lib/services/plan-request-limiter.ts parsePlanRequestLimitConfig and
 * maps-request-policy.ts mapsRequestAllowance at upstream.lock.json), plus the cross-checks the
 * Maps admission controller applies (maps-request-allowance-controller.ts): Maps is refused with
 * maps_allowance_unconfigured unless the rate limits are selected, and a plan key missing from the
 * allowance has no default fallback. A draft that still holds "<...>" placeholders is reported as
 * unselected. Nothing is sent anywhere; the files hold numbers, never credentials.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RECORDED_CATALOG = "docs/runbooks/drafts/665-recorded-catalog-v1.json";
const USAGE = `Usage: node scripts/owner/subscription-limits.mjs catalog [--environment production|staging] [--recorded FILE] [--json]
       node scripts/owner/subscription-limits.mjs rate-limits FILE [--catalog FILE]
       node scripts/owner/subscription-limits.mjs maps-allowances FILE [--rate-limits FILE] [--catalog FILE]`;
const PLACEHOLDER = /^<.*>$/s;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Every "<...>" placeholder string left in a draft, as JSON paths. */
export function placeholders(value, at = "$") {
  if (typeof value === "string") return PLACEHOLDER.test(value) ? [at] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholders(item, `${at}[${index}]`));
  if (isObject(value)) return Object.entries(value).flatMap(([key, item]) => placeholders(item, `${at}.${key}`));
  return [];
}

/** Plan keys of a catalog body ({catalogVersion, plans:[{key}]}) or a recorded-catalog file. */
export function catalogPlanKeys(catalog) {
  const body = isObject(catalog?.catalog) ? catalog.catalog : catalog;
  return Array.isArray(body?.plans) ? body.plans.map(plan => plan?.key).filter(key => typeof key === "string") : [];
}

function bucket(value, at, problems) {
  if (!isObject(value)) { problems.push(`${at} must be {capacity, refillPerSecond}`); return; }
  if (!Number.isSafeInteger(value.capacity) || value.capacity < 1) problems.push(`${at}.capacity must be an integer >= 1`);
  if (typeof value.refillPerSecond !== "number" || !Number.isFinite(value.refillPerSecond) || value.refillPerSecond <= 0)
    problems.push(`${at}.refillPerSecond must be a number > 0`);
}

/**
 * ELIZA_CLOUD_PLAN_RATE_LIMITS rules: {"selected":bool,"plans":{"default":P,...}} where P is
 * {burst:B, sustained:B, maps?:{burst:B, sustained:B}} and B {capacity:int>=1, refillPerSecond:>0}.
 * Returns {problems, notes, selected}. `planKeys` (from the catalog) adds unknown-key notes.
 */
export function checkRateLimits(config, { planKeys = [] } = {}) {
  const problems = [], notes = [];
  const left = placeholders(config);
  if (left.length) return { selected: false, problems: [`${left.length} placeholder(s) still to fill: ${left.join(", ")}`], notes };
  if (!isObject(config)) return { selected: false, problems: ["must be a JSON object (or the literal placeholder, which is for tests only)"], notes };
  if (config.selected !== undefined && typeof config.selected !== "boolean") problems.push("selected must be a boolean");
  if (!isObject(config.plans)) problems.push("plans must be an object");
  else {
    if (!Object.hasOwn(config.plans, "default")) problems.push("plans.default is required (cache misses, ended plan windows and billing outages use it)");
    for (const [key, plan] of Object.entries(config.plans)) {
      if (!isObject(plan)) { problems.push(`plans.${key} must be an object`); continue; }
      bucket(plan.burst, `plans.${key}.burst`, problems);
      bucket(plan.sustained, `plans.${key}.sustained`, problems);
      if (plan.maps !== undefined) {
        if (!isObject(plan.maps)) problems.push(`plans.${key}.maps must be an object`);
        else { bucket(plan.maps.burst, `plans.${key}.maps.burst`, problems); bucket(plan.maps.sustained, `plans.${key}.maps.sustained`, problems); }
      } else notes.push(`plans.${key} has no maps entry: Maps uses this plan's own numbers`);
      if (planKeys.length && key !== "default" && !planKeys.includes(key)) notes.push(`plans.${key} is not a catalog plan key (${planKeys.join(", ")}); it is never selected`);
      for (const name of ["burst", "sustained"]) {
        const row = plan[name];
        if (isObject(row) && Number.isSafeInteger(row.capacity) && row.refillPerSecond > 0)
          notes.push(`plans.${key}.${name}: ${row.capacity} requests at once, refilled at ${round(row.refillPerSecond * 60)}/minute (full in ${round(row.capacity / row.refillPerSecond)} s)`);
      }
    }
    for (const key of planKeys) if (!Object.hasOwn(config.plans, key)) notes.push(`catalog plan ${key} has no entry: it uses plans.default`);
  }
  if (config.selected !== true) notes.push("selected is not true: inference treats this as unselected, and Maps refuses every request with maps_allowance_unconfigured");
  return { selected: config.selected === true && !problems.length, problems, notes };
}

/**
 * ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES rules: {"selected":true,"plans":{<planKey>:{requests:int>=0,
 * windowSeconds:int 1..8640000000000}}}. A plan key that is not listed has no fallback.
 */
export function checkMapsAllowances(config, { planKeys = [], rateLimits = null } = {}) {
  const problems = [], notes = [];
  const left = placeholders(config);
  if (left.length) return { selected: false, problems: [`${left.length} placeholder(s) still to fill: ${left.join(", ")}`], notes };
  if (!isObject(config)) return { selected: false, problems: ["must be a JSON object"], notes };
  if (config.selected !== true) problems.push("selected must be true; anything else leaves every plan at maps_allowance_unconfigured");
  if (!isObject(config.plans)) problems.push("plans must be an object");
  else {
    for (const [key, plan] of Object.entries(config.plans)) {
      if (!isObject(plan)) { problems.push(`plans.${key} must be {requests, windowSeconds}`); continue; }
      if (!Number.isSafeInteger(plan.requests) || plan.requests < 0) problems.push(`plans.${key}.requests must be an integer >= 0`);
      if (!Number.isSafeInteger(plan.windowSeconds) || plan.windowSeconds < 1 || plan.windowSeconds > 8_640_000_000_000)
        problems.push(`plans.${key}.windowSeconds must be an integer from 1 to 8640000000000`);
      if (plan.requests === 0) notes.push(`plans.${key} is a closed allowance (0 requests): its Maps requests are refused as allowance exhausted`);
      if (Number.isSafeInteger(plan.windowSeconds) && plan.windowSeconds >= 86_400 && plan.windowSeconds % 86_400)
        notes.push(`plans.${key}.windowSeconds is not a whole number of days; windows start at UTC epoch multiples of it`);
      if (Number.isSafeInteger(plan.windowSeconds) && plan.windowSeconds > 86_400 && plan.windowSeconds % 86_400 === 0)
        notes.push(`plans.${key}: a ${plan.windowSeconds / 86_400}-day window starts at UTC epoch multiples, not on the billing period or calendar month`);
      if (planKeys.length && !planKeys.includes(key)) notes.push(`plans.${key} is not a catalog plan key (${planKeys.join(", ")})`);
    }
    for (const key of planKeys) if (!Object.hasOwn(config.plans, key)) problems.push(`catalog plan ${key} has no allowance: there is no default fallback, so it answers maps_allowance_unconfigured`);
  }
  if (rateLimits !== null) {
    const limits = checkRateLimits(rateLimits, { planKeys });
    if (!limits.selected) problems.push("ELIZA_CLOUD_PLAN_RATE_LIMITS is not a valid selected value; Maps admission refuses with maps_allowance_unconfigured until it is");
  } else notes.push("pass --rate-limits FILE: Maps also requires a selected ELIZA_CLOUD_PLAN_RATE_LIMITS");
  return { selected: !problems.length, problems, notes };
}

const round = value => Math.round(value * 1000) / 1000;
const COMPARED = ["key", "name", "catalogVersion", "active", "interval", "intervalCount", "currency", "amountCents", "allowance", "fundingClasses", "rateLimits", "resourceCeilings"];

/** Field-by-field differences between a live catalog body and the recorded one. */
export function compareCatalog(live, recorded) {
  const differences = [];
  const want = isObject(recorded?.catalog) ? recorded.catalog : recorded;
  if (live?.catalogVersion !== want?.catalogVersion) differences.push(`catalogVersion: published ${JSON.stringify(live?.catalogVersion)}, recorded ${JSON.stringify(want?.catalogVersion)}`);
  const index = plans => new Map((Array.isArray(plans) ? plans : []).map(plan => [plan?.key, plan]));
  const got = index(live?.plans), expected = index(want?.plans);
  for (const key of new Set([...got.keys(), ...expected.keys()])) {
    if (!got.has(key)) { differences.push(`plan ${key}: recorded but not published`); continue; }
    if (!expected.has(key)) { differences.push(`plan ${key}: published but not recorded`); continue; }
    for (const field of COMPARED) {
      const a = JSON.stringify(got.get(key)?.[field]), b = JSON.stringify(expected.get(key)?.[field]);
      if (a !== b) differences.push(`plan ${key}.${field}: published ${a}, recorded ${b}`);
    }
  }
  return differences;
}

/** One readable line per plan, for the memo and the console. */
export function describePlan(plan) {
  const limits = plan.rateLimits ?? {};
  return `${plan.name} (${plan.key}): ${plan.currency?.toUpperCase()} ${(plan.amountCents / 100).toFixed(2)} per ${plan.intervalCount > 1 ? `${plan.intervalCount} ` : ""}${plan.interval}, allowance ${plan.currency?.toUpperCase()} ${Number(plan.allowance?.amountUsd).toFixed(2)}${plan.allowance?.rollover ? " with rollover" : ", no rollover"}, per-minute limits ${limits.completionsRpm}/${limits.embeddingsRpm}/${limits.standardRpm}/${limits.strictRpm} (completions/embeddings/standard/strict)`;
}

export async function fetchCatalog(api, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`${api}/api/v1/subscriptions/plans`, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    let body = null;
    try { body = JSON.parse(await response.text()); } catch { body = null; }
    return { status: response.status, body };
  } catch (error) { return { status: 0, body: null, error: error?.message ?? String(error) }; }
}

const readJson = file => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const option = (rest, name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

export async function main(argv, { fetchImpl = globalThis.fetch, log = console.log, error = console.error, root = ROOT } = {}) {
  const [command, ...rest] = argv;
  if (command === "catalog") {
    const environment = option(rest, "--environment") ?? "production";
    const deployment = readJson(path.join(root, "config/cloud-deployment.json"))[environment];
    if (!deployment) { error(USAGE); return 2; }
    const recorded = readJson(option(rest, "--recorded") ?? path.join(root, RECORDED_CATALOG));
    const live = await fetchCatalog(deployment.api, fetchImpl);
    const body = isObject(live.body?.data) ? live.body.data : null;
    const differences = live.status === 200 && live.body?.success === true && body ? compareCatalog(body, recorded)
      : [`${deployment.api}/api/v1/subscriptions/plans answered ${live.status ? `HTTP ${live.status}` : `nothing (${live.error})`}${typeof live.body?.code === "string" ? ` ${live.body.code}` : ""}`];
    if (rest.includes("--json")) log(JSON.stringify({ environment, api: deployment.api, status: live.status, matches: !differences.length, differences, plans: body?.plans?.map(describePlan) ?? [] }, null, 2));
    else {
      log(`Subscription catalog, ${environment} (${deployment.api}): ${differences.length ? "DIFFERS from" : "matches"} the recorded catalog.`);
      for (const plan of body?.plans ?? []) log(`  ${describePlan(plan)}`);
      for (const line of differences) log(`  - ${line}`);
    }
    return differences.length ? 1 : 0;
  }
  if ((command === "rate-limits" || command === "maps-allowances") && rest[0] && !rest[0].startsWith("--")) {
    const catalogFile = option(rest, "--catalog") ?? path.join(root, RECORDED_CATALOG);
    const planKeys = catalogPlanKeys(readJson(catalogFile));
    const config = readJson(rest[0]);
    const result = command === "rate-limits" ? checkRateLimits(config, { planKeys })
      : checkMapsAllowances(config, { planKeys, rateLimits: option(rest, "--rate-limits") ? readJson(option(rest, "--rate-limits")) : null });
    const name = command === "rate-limits" ? "ELIZA_CLOUD_PLAN_RATE_LIMITS" : "ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES";
    log(`${name} candidate ${rest[0]}: ${result.selected ? "valid and selected" : "NOT ready"}`);
    for (const line of result.problems) log(`  - ${line}`);
    for (const line of result.notes) log(`  note: ${line}`);
    if (result.selected) log(`  Value for the Cloud operator (one line): ${JSON.stringify(config)}`);
    return result.selected ? 0 : 1;
  }
  error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
