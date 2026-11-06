#!/usr/bin/env node
// Read-only latency probe of the deployed Eliza Cloud subscription endpoints (#410).
// It sends unauthenticated GET requests only: the public plan catalog, the public
// entitlement verification keys and the entitlement route without a key (401). It
// measures the deployed network/edge path a phone sees, not authenticated admission,
// plan-bucket exhaustion, expiry, revocation or billing outage; those need a real
// signed-in account and are recorded as open in docs/eliza-cloud-subscription-entitlement-contract.md.
//
//   node scripts/cloud-subscription-latency.mjs [--samples 30] [--origin https://api.eliza.app] [--out file.json]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const samples = Number.parseInt(option('--samples', '30'), 10);
const origin = new URL(option('--origin', 'https://api.eliza.app')).origin;
const out = option('--out', '');
// Cloud's public routes share one per-client budget (100 requests per window on 2026-10-25);
// three probes stay inside it so a 429 is not mistaken for route latency.
if (!Number.isInteger(samples) || samples < 5 || samples > 30) throw new Error('--samples must be 5..30');

const probes = [
  { name: 'plan-catalog', path: '/api/v1/subscriptions/plans', expect: 200 },
  { name: 'entitlement-keys', path: '/api/v1/subscription/entitlement-keys', expect: 200 },
  { name: 'entitlement-unauthenticated', path: '/api/v1/subscription/entitlement', expect: 401 },
];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const round = (value) => Math.round(value * 10) / 10;

async function request(path) {
  const started = performance.now();
  const response = await fetch(origin + path, { headers: { accept: 'application/json' }, redirect: 'error' });
  const body = await response.text();
  return { status: response.status, ms: performance.now() - started, body, limit: response.headers.get('x-ratelimit-limit'), remaining: response.headers.get('x-ratelimit-remaining') };
}

const results = [];
for (const probe of probes) {
  const first = await request(probe.path);
  if (first.status !== probe.expect) throw new Error(`${probe.path} returned ${first.status}, expected ${probe.expect}`);
  const timings = [];
  const statuses = {};
  let last = first;
  for (let i = 0; i < samples; i += 1) {
    last = await request(probe.path);
    statuses[last.status] = (statuses[last.status] ?? 0) + 1;
    if (last.status === probe.expect) timings.push(last.ms);
  }
  if (timings.length < samples) throw new Error(`${probe.path}: ${JSON.stringify(statuses)}; only ${probe.expect} responses are timed`);
  timings.sort((a, b) => a - b);
  let observed;
  if (probe.name === 'plan-catalog') {
    const data = JSON.parse(first.body).data;
    observed = {
      catalogVersion: data.catalogVersion,
      plans: data.plans.map((plan) => ({ key: plan.key, amountCents: plan.amountCents, allowanceUsd: plan.allowance?.amountUsd, rateLimits: plan.rateLimits })),
    };
  } else if (probe.name === 'entitlement-keys') {
    observed = { keys: JSON.parse(first.body).keys.map(({ kid, alg, crv }) => ({ kid, alg, crv })) };
  } else {
    observed = { code: JSON.parse(first.body).code };
  }
  results.push({
    ...probe,
    statuses,
    rateLimit: { limit: last.limit, remainingAfter: last.remaining },
    firstRequestMs: round(first.ms),
    p50Ms: round(percentile(timings, 50)),
    p95Ms: round(percentile(timings, 95)),
    maxMs: round(timings.at(-1)),
    observed,
  });
}

const record = {
  measuredAt: new Date().toISOString(),
  origin,
  samplesPerProbe: samples,
  method: 'Sequential unauthenticated GET from one client, after one discarded first request; wall-clock time to full body, including DNS/TLS reuse by Node fetch.',
  boundary: 'Deployed public-route latency only. Not authenticated admission, plan-bucket, exhausted, expired, revoked or billing-outage latency, and not Android audio.',
  results,
};
const text = `${JSON.stringify(record, null, 2)}\n`;
if (out) writeFileSync(out, text);
process.stdout.write(text);
