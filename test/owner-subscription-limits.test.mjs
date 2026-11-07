// Owner prep for #665: catalog comparison and the H-03/H-04 candidate validators. A stubbed fetch
// stands in for Cloud; nothing here contacts a network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RECORDED_CATALOG, catalogPlanKeys, checkMapsAllowances, checkRateLimits, compareCatalog, main, placeholders } from "../scripts/owner/subscription-limits.mjs";

const root = path.resolve(import.meta.dirname, "..");
const recorded = JSON.parse(fs.readFileSync(path.join(root, RECORDED_CATALOG), "utf8"));
const draft = name => JSON.parse(fs.readFileSync(path.join(root, "docs/runbooks/drafts", name), "utf8"));
const B = (capacity, refillPerSecond) => ({ capacity, refillPerSecond });
const limits = { selected: true, plans: { default: { burst: B(10, 0.5), sustained: B(120, 2) }, plus_monthly: { burst: B(20, 2), sustained: B(120, 2), maps: { burst: B(5, 0.2), sustained: B(60, 1) } }, pro_monthly: { burst: B(50, 5), sustained: B(300, 5) } } };
const allowances = { selected: true, plans: { plus_monthly: { requests: 200, windowSeconds: 86_400 }, pro_monthly: { requests: 1000, windowSeconds: 86_400 } } };
const planKeys = catalogPlanKeys(recorded);

test("the recorded catalog is v1 with the two published plans", () => {
  assert.equal(recorded.catalog.catalogVersion, "v1");
  assert.deepEqual(planKeys, ["plus_monthly", "pro_monthly"]);
  const [plus, pro] = recorded.catalog.plans;
  assert.deepEqual([plus.amountCents, plus.allowance.amountUsd, plus.allowance.rollover], [3000, "25.000000", false]);
  assert.deepEqual([pro.amountCents, pro.allowance.amountUsd, pro.allowance.rollover], [10000, "90.000000", false]);
  assert.deepEqual(Object.values(plus.rateLimits), [120, 200, 60, 10]);
  assert.deepEqual(Object.values(pro.rateLimits), [300, 600, 120, 30]);
});

test("catalog comparison reports each changed field and a missing plan", () => {
  assert.deepEqual(compareCatalog(recorded.catalog, recorded), []);
  const changed = structuredClone(recorded.catalog);
  changed.plans[0].amountCents = 3500;
  changed.plans.pop();
  const differences = compareCatalog(changed, recorded);
  assert.ok(differences.some(line => line.startsWith("plan plus_monthly.amountCents")));
  assert.ok(differences.some(line => line === "plan pro_monthly: recorded but not published"));
});

test("the catalog command makes one unauthenticated GET and exits by the comparison", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ success: true, data: recorded.catalog }), { status: 200 }); };
  const lines = [];
  assert.equal(await main(["catalog"], { fetchImpl, log: line => lines.push(line), root }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://api.eliza.app/api/v1/subscriptions/plans");
  assert.equal(calls[0][1].headers.authorization, undefined, "no credential is sent");
  const unavailable = async () => new Response(JSON.stringify({ success: false, code: "service_unavailable" }), { status: 503 });
  assert.equal(await main(["catalog", "--environment", "staging"], { fetchImpl: unavailable, log: line => lines.push(line), root }), 1);
  assert.match(lines.at(-1), /HTTP 503 service_unavailable/);
});

test("the committed drafts are recognised as unselected placeholders", () => {
  const rate = checkRateLimits(draft("665-plan-rate-limits.draft.json"), { planKeys });
  assert.equal(rate.selected, false);
  assert.match(rate.problems[0], /placeholder/);
  const maps = checkMapsAllowances(draft("665-maps-request-allowances.draft.json"), { planKeys });
  assert.equal(maps.selected, false);
  assert.equal(placeholders(draft("665-maps-request-allowances.draft.json")).length, 5);
});

test("rate limits follow the upstream parser: default required, integer capacity >= 1, refill > 0", () => {
  assert.equal(checkRateLimits(limits, { planKeys }).selected, true);
  const withoutDefault = structuredClone(limits); delete withoutDefault.plans.default;
  assert.ok(checkRateLimits(withoutDefault).problems.some(line => /plans\.default/.test(line)));
  const zero = structuredClone(limits); zero.plans.plus_monthly.burst.capacity = 0;
  assert.ok(checkRateLimits(zero).problems.some(line => /capacity must be an integer >= 1/.test(line)));
  const fractional = structuredClone(limits); fractional.plans.pro_monthly.sustained.capacity = 2.5;
  assert.ok(checkRateLimits(fractional).problems.length);
  const stopped = structuredClone(limits); stopped.plans.default.sustained.refillPerSecond = 0;
  assert.ok(checkRateLimits(stopped).problems.some(line => /refillPerSecond must be a number > 0/.test(line)));
  const unselected = { ...structuredClone(limits), selected: false };
  assert.equal(checkRateLimits(unselected).selected, false);
  assert.ok(checkRateLimits(limits, { planKeys }).notes.some(line => /pro_monthly has no maps entry/.test(line)));
});

test("Maps allowances need every catalog plan, selected rate limits and integer bounds", () => {
  assert.equal(checkMapsAllowances(allowances, { planKeys, rateLimits: limits }).selected, true);
  const missing = structuredClone(allowances); delete missing.plans.pro_monthly;
  assert.ok(checkMapsAllowances(missing, { planKeys, rateLimits: limits }).problems.some(line => /pro_monthly has no allowance/.test(line)));
  assert.equal(checkMapsAllowances(allowances, { planKeys, rateLimits: { ...limits, selected: false } }).selected, false);
  const closed = structuredClone(allowances); closed.plans.plus_monthly.requests = 0;
  const result = checkMapsAllowances(closed, { planKeys, rateLimits: limits });
  assert.equal(result.selected, true, "zero is a valid closed allowance");
  assert.ok(result.notes.some(line => /closed allowance/.test(line)));
  const negative = structuredClone(allowances); negative.plans.plus_monthly.requests = -1;
  assert.equal(checkMapsAllowances(negative, { planKeys, rateLimits: limits }).selected, false);
  const window = structuredClone(allowances); window.plans.plus_monthly.windowSeconds = 0;
  assert.equal(checkMapsAllowances(window, { planKeys, rateLimits: limits }).selected, false);
  assert.equal(checkMapsAllowances({ ...allowances, selected: false }, { planKeys, rateLimits: limits }).selected, false);
  const monthly = structuredClone(allowances); monthly.plans.pro_monthly.windowSeconds = 30 * 86_400;
  assert.ok(checkMapsAllowances(monthly, { planKeys, rateLimits: limits }).notes.some(line => /UTC epoch multiples, not on the billing period/.test(line)));
});
