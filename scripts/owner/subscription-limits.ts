#!/usr/bin/env node
/**
 * Owner prep for #665 (docs/human-actions.md H-02, H-03, H-04). Read-only.
 *
 *   node scripts/owner/subscription-limits.ts catalog [--environment production|staging] [--recorded FILE] [--json]
 *   node scripts/owner/subscription-limits.ts rate-limits FILE [--catalog FILE]
 *   node scripts/owner/subscription-limits.ts maps-allowances FILE [--rate-limits FILE] [--catalog FILE]
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudApi, errorMessage, isRecord, isSafeInteger, option, readJson } from "./input.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RECORDED_CATALOG = "docs/runbooks/drafts/665-recorded-catalog-v1.json";
const USAGE = `Usage: node scripts/owner/subscription-limits.ts catalog [--environment production|staging] [--recorded FILE] [--json]
       node scripts/owner/subscription-limits.ts rate-limits FILE [--catalog FILE]
       node scripts/owner/subscription-limits.ts maps-allowances FILE [--rate-limits FILE] [--catalog FILE]`;
const PLACEHOLDER = /^<.*>$/s;

/** Every "<...>" placeholder string left in a draft, as JSON paths. */
export function placeholders(value: unknown, at = "$"): string[] {
  if (typeof value === "string") return PLACEHOLDER.test(value) ? [at] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholders(item, `${at}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => placeholders(item, `${at}.${key}`));
  return [];
}

function catalogBody(value: unknown) {
  if (!isRecord(value)) return undefined;
  return isRecord(value.catalog) ? value.catalog : value;
}

function catalogPlans(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Plan keys of a catalog body ({catalogVersion, plans:[{key}]}) or a recorded-catalog file. */
export function catalogPlanKeys(catalog: unknown) {
  return catalogPlans(catalogBody(catalog)?.plans).map(plan => plan.key).filter(key => typeof key === "string");
}

function bucket(value: unknown, at: string, problems: string[]) {
  if (!isRecord(value)) { problems.push(`${at} must be {capacity, refillPerSecond}`); return; }
  if (!isSafeInteger(value.capacity) || value.capacity < 1) problems.push(`${at}.capacity must be an integer >= 1`);
  if (typeof value.refillPerSecond !== "number" || !Number.isFinite(value.refillPerSecond) || value.refillPerSecond <= 0)
    problems.push(`${at}.refillPerSecond must be a number > 0`);
}

/**
 * ELIZA_CLOUD_PLAN_RATE_LIMITS rules: {"selected":bool,"plans":{"default":P,...}} where P is
 * {burst:B, sustained:B, maps?:{burst:B, sustained:B}} and B {capacity:int>=1, refillPerSecond:>0}.
 * Returns {problems, notes, selected}. `planKeys` (from the catalog) adds unknown-key notes.
 */
export function checkRateLimits(config: unknown, { planKeys = [] }: { planKeys?: readonly string[] } = {}) {
  const problems: string[] = [], notes: string[] = [];
  const left = placeholders(config);
  if (left.length) return { selected: false, problems: [`${left.length} placeholder(s) still to fill: ${left.join(", ")}`], notes };
  if (!isRecord(config)) return { selected: false, problems: ["must be a JSON object (or the literal placeholder, which is for tests only)"], notes };
  if (config.selected !== undefined && typeof config.selected !== "boolean") problems.push("selected must be a boolean");
  if (!isRecord(config.plans)) problems.push("plans must be an object");
  else {
    if (!Object.hasOwn(config.plans, "default")) problems.push("plans.default is required (cache misses, ended plan windows and billing outages use it)");
    for (const [key, plan] of Object.entries(config.plans)) {
      if (!isRecord(plan)) { problems.push(`plans.${key} must be an object`); continue; }
      bucket(plan.burst, `plans.${key}.burst`, problems);
      bucket(plan.sustained, `plans.${key}.sustained`, problems);
      if (plan.maps !== undefined) {
        if (!isRecord(plan.maps)) problems.push(`plans.${key}.maps must be an object`);
        else { bucket(plan.maps.burst, `plans.${key}.maps.burst`, problems); bucket(plan.maps.sustained, `plans.${key}.maps.sustained`, problems); }
      } else notes.push(`plans.${key} has no maps entry: Maps uses this plan's own numbers`);
      if (planKeys.length && key !== "default" && !planKeys.includes(key)) notes.push(`plans.${key} is not a catalog plan key (${planKeys.join(", ")}); it is never selected`);
      for (const name of ["burst", "sustained"]) {
        const row = plan[name];
        if (isRecord(row) && isSafeInteger(row.capacity) && typeof row.refillPerSecond === "number" && row.refillPerSecond > 0)
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
export function checkMapsAllowances(config: unknown, { planKeys = [], rateLimits = null }: { planKeys?: readonly string[]; rateLimits?: unknown } = {}) {
  const problems: string[] = [], notes: string[] = [];
  const left = placeholders(config);
  if (left.length) return { selected: false, problems: [`${left.length} placeholder(s) still to fill: ${left.join(", ")}`], notes };
  if (!isRecord(config)) return { selected: false, problems: ["must be a JSON object"], notes };
  if (config.selected !== true) problems.push("selected must be true; anything else leaves every plan at maps_allowance_unconfigured");
  if (!isRecord(config.plans)) problems.push("plans must be an object");
  else {
    for (const [key, plan] of Object.entries(config.plans)) {
      if (!isRecord(plan)) { problems.push(`plans.${key} must be {requests, windowSeconds}`); continue; }
      if (!isSafeInteger(plan.requests) || plan.requests < 0) problems.push(`plans.${key}.requests must be an integer >= 0`);
      if (!isSafeInteger(plan.windowSeconds) || plan.windowSeconds < 1 || plan.windowSeconds > 8_640_000_000_000)
        problems.push(`plans.${key}.windowSeconds must be an integer from 1 to 8640000000000`);
      if (plan.requests === 0) notes.push(`plans.${key} is a closed allowance (0 requests): its Maps requests are refused as allowance exhausted`);
      if (isSafeInteger(plan.windowSeconds) && plan.windowSeconds >= 86_400 && plan.windowSeconds % 86_400)
        notes.push(`plans.${key}.windowSeconds is not a whole number of days; windows start at UTC epoch multiples of it`);
      if (isSafeInteger(plan.windowSeconds) && plan.windowSeconds > 86_400 && plan.windowSeconds % 86_400 === 0)
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

const round = (value: number) => Math.round(value * 1000) / 1000;
const COMPARED = ["key", "name", "catalogVersion", "active", "interval", "intervalCount", "currency", "amountCents", "allowance", "fundingClasses", "rateLimits", "resourceCeilings"];

/** Field-by-field differences between a live catalog body and the recorded one. */
export function compareCatalog(published: unknown, recorded: unknown) {
  const differences: string[] = [];
  const live = isRecord(published) ? published : undefined;
  const want = catalogBody(recorded);
  if (live?.catalogVersion !== want?.catalogVersion) differences.push(`catalogVersion: published ${JSON.stringify(live?.catalogVersion)}, recorded ${JSON.stringify(want?.catalogVersion)}`);
  const index = (plans: unknown) => new Map(catalogPlans(plans).map(plan => [plan.key, plan]));
  const got = index(live?.plans), expected = index(want?.plans);
  for (const key of new Set([...got.keys(), ...expected.keys()])) {
    if (!got.has(key)) { differences.push(`plan ${String(key)}: recorded but not published`); continue; }
    if (!expected.has(key)) { differences.push(`plan ${String(key)}: published but not recorded`); continue; }
    for (const field of COMPARED) {
      const a = JSON.stringify(got.get(key)?.[field]), b = JSON.stringify(expected.get(key)?.[field]);
      if (a !== b) differences.push(`plan ${String(key)}.${field}: published ${a}, recorded ${b}`);
    }
  }
  return differences;
}

/** One readable line per plan, for the memo and the console. */
export function describePlan(plan: Record<string, unknown>) {
  const limits = isRecord(plan.rateLimits) ? plan.rateLimits : {};
  const allowance = isRecord(plan.allowance) ? plan.allowance : {};
  const currency = typeof plan.currency === "string" ? plan.currency.toUpperCase() : undefined;
  const intervalCount = Number(plan.intervalCount);
  return `${plan.name} (${plan.key}): ${currency} ${(Number(plan.amountCents) / 100).toFixed(2)} per ${intervalCount > 1 ? `${plan.intervalCount} ` : ""}${plan.interval}, allowance ${currency} ${Number(allowance.amountUsd).toFixed(2)}${allowance.rollover ? " with rollover" : ", no rollover"}, per-minute limits ${limits.completionsRpm}/${limits.embeddingsRpm}/${limits.standardRpm}/${limits.strictRpm} (completions/embeddings/standard/strict)`;
}

export async function fetchCatalog(api: string, fetchImpl = globalThis.fetch): Promise<{ status: number; body: Record<string, unknown> | null; error?: string }> {
  try {
    const response = await fetchImpl(`${api}/api/v1/subscriptions/plans`, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    let body: unknown = null;
    try { body = JSON.parse(await response.text()); } catch { body = null; }
    return { status: response.status, body: isRecord(body) ? body : null };
  } catch (error) { return { status: 0, body: null, error: errorMessage(error) }; }
}

export async function main(argv: readonly string[], { fetchImpl = globalThis.fetch, log = console.log, error = console.error, root = ROOT } = {}) {
  const [command, ...rest] = argv;
  if (command === "catalog") {
    const environment = option(rest, "--environment") ?? "production";
    const api = cloudApi(root, environment);
    if (!api) { error(USAGE); return 2; }
    const recorded = readJson(option(rest, "--recorded") ?? path.join(root, RECORDED_CATALOG));
    const live = await fetchCatalog(api, fetchImpl);
    const body = isRecord(live.body?.data) ? live.body.data : null;
    const differences = live.status === 200 && live.body?.success === true && body ? compareCatalog(body, recorded)
      : [`${api}/api/v1/subscriptions/plans answered ${live.status ? `HTTP ${live.status}` : `nothing (${live.error})`}${typeof live.body?.code === "string" ? ` ${live.body.code}` : ""}`];
    const plans = catalogPlans(body?.plans).map(describePlan);
    if (rest.includes("--json")) log(JSON.stringify({ environment, api, status: live.status, matches: !differences.length, differences, plans }, null, 2));
    else {
      log(`Subscription catalog, ${environment} (${api}): ${differences.length ? "DIFFERS from" : "matches"} the recorded catalog.`);
      for (const plan of plans) log(`  ${plan}`);
      for (const line of differences) log(`  - ${line}`);
    }
    return differences.length ? 1 : 0;
  }
  if ((command === "rate-limits" || command === "maps-allowances") && rest[0] && !rest[0].startsWith("--")) {
    const catalogFile = option(rest, "--catalog") ?? path.join(root, RECORDED_CATALOG);
    const planKeys = catalogPlanKeys(readJson(catalogFile));
    const config = readJson(rest[0]);
    const rateLimitsFile = option(rest, "--rate-limits");
    const result = command === "rate-limits" ? checkRateLimits(config, { planKeys })
      : checkMapsAllowances(config, { planKeys, rateLimits: rateLimitsFile ? readJson(rateLimitsFile) : null });
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
