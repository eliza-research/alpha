// Alpha's agent routes against the pinned agent's owner-only API gate (packages/agent/src/api/server.ts,
// isOwnerOnlyApiRequest). The gate answers 403 "Owner role required" to a request whose session is not the owner.
// Alpha's native enrollment pairs with the operator code, so its session keeps OWNER authority; this test also
// checks that no route Alpha issues falls under that gate. Upstream has separate owner checks outside it: the
// trigger and automation routes resolve the presented credential without loopback promotion and need OWNER, and
// Alpha's automations surface uses them, so it depends on the owner-paired session. The last tests pin that set.
// Source-level evidence only: no APK, emulator or device result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const SERVER = 'vendor/eliza/packages/agent/src/api/server.ts';
const PAIRING = 'vendor/eliza/packages/app/src/api/auth-pairing-routes.ts';
const LOCAL_AGENT = 'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java';
// SHA-256 of isOwnerOnlyApiRequest as reviewed at elizaOS/eliza develop fbc2d23d4b (#37702, #37733, #37786, #37840,
// #37861, #38121, #38126 /api/logs and /api/security/audit, and the other owner-only gates since 1f2a922f86). A pin that changes the gate fails here until its
// new routes are checked against Alpha's route surface below and this hash is updated.
const REVIEWED_GATE_SHA256 = 'f501638a182cf387e51057d23563fb45c1a2243980a6775de92fb90af4f468a0';

function gateSource() {
  const text = fs.readFileSync(SERVER, 'utf8');
  const start = text.indexOf('function isOwnerOnlyApiRequest(');
  assert.ok(start >= 0, `${SERVER} no longer defines isOwnerOnlyApiRequest; re-review the owner gate`);
  const end = text.indexOf('\n}\n', start);
  assert.ok(end > start);
  return text.slice(start, end + 2);
}

/** The gate's prefixes and exact paths, split into all-method and write-only clauses. Carve-outs are ignored, which only over-reports. */
function gateModel(source) {
  const split = source.indexOf('(write &&');
  assert.ok(split > 0, 'the owner gate no longer has a write-only clause; re-review it');
  const read = (part) => ({
    prefixes: [
      ...[...part.matchAll(/under\("([^"]+)"\)/g)].map((m) => m[1]),
      // under(`/api/agent/${op}`) over a literal op list.
      ...[...part.matchAll(/\[([^\]]*)\]\s*\.some\(\s*\(op\)\s*=>\s*under\(`([^`$]*)\$\{op\}`\)\s*\)/g)].flatMap((m) =>
        [...m[1].matchAll(/"([^"]+)"/g)].map((op) => `${m[2]}${op[1]}`)),
    ],
    starts: [...part.matchAll(/pathname\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]),
    exact: [...part.matchAll(/pathname === "([^"]+)"/g)].map((m) => m[1]),
  });
  return {all: read(source.slice(0, split)), write: read(source.slice(split))};
}

function ownerOnly(model, method, pathname) {
  const hit = ({prefixes, starts, exact}) =>
    prefixes.some((base) => pathname === base || pathname.startsWith(`${base}/`)) ||
    starts.some((base) => pathname.startsWith(base)) ||
    exact.includes(pathname);
  return hit(model.all) || (method !== 'GET' && method !== 'HEAD' && hit(model.write));
}

function walk(dir, pattern, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, pattern, out);
    else if (pattern.test(entry.name)) out.push(file);
  }
  return out;
}

/** Every agent API path literal in Alpha's renderer and Android sources. Cloud API (/api/v1/...) is another origin. */
function alphaAgentPathLiterals() {
  const files = [
    ...walk('apps/app/src', /\.(?:ts|tsx|js|mjs)$/),
    ...walk('android/app/src/main/java', /\.java$/),
  ];
  const found = new Map();
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/["'`](\/api\/[A-Za-z0-9_./{}-]*)/g)) {
      const literal = match[1];
      if (literal.startsWith('/api/v1/')) continue;
      if (!found.has(literal)) found.set(literal, file);
    }
  }
  return found;
}

function ownerRouteTable() {
  const table = JSON.parse(fs.readFileSync('config/owner-routes.json', 'utf8'));
  const routes = [];
  for (const group of Object.values(table.groups))
    for (const route of group.routes)
      for (const method of route.methods)
        for (const raw of route.paths) routes.push([method, raw.split('?')[0].replaceAll('{id}', 'id-1')]);
  return routes;
}

test('the pinned owner-only gate is the reviewed one', () => {
  const digest = createHash('sha256').update(gateSource()).digest('hex');
  assert.equal(digest, REVIEWED_GATE_SHA256,
    'isOwnerOnlyApiRequest changed at this pin: check its routes against Alpha below, then record the new hash');
});

test('the gate model reads the clauses Alpha was reviewed against', () => {
  const model = gateModel(gateSource());
  // Account/provider (#37702), model-config (#37733), Cloud connection (#37786), voice profile reads (#37840),
  // character experiences (#37861) and the combined gates (#38121).
  for (const [method, pathname] of [
    ['POST', '/api/accounts'], ['PUT', '/api/providers/x'], ['POST', '/api/subscription/x'], ['POST', '/api/provider/switch'],
    ['PUT', '/api/models/config'], ['POST', '/api/runtime/model-switch'],
    ['POST', '/api/cloud/disconnect'], ['POST', '/api/cloud/login'], ['POST', '/api/cloud/login/persist'],
    ['GET', '/api/voice/profiles'], ['GET', '/v1/voice/speaker-profiles/x'], ['GET', '/api/character/experiences'],
    ['GET', '/api/database/tables'], ['GET', '/api/workbench/overview'], ['POST', '/api/views/events/broadcast'],
    ['GET', '/api/memories/browse'], ['POST', '/api/config'], ['POST', '/api/agent/restart'], ['POST', '/api/agent/reset'],
  ]) assert.ok(ownerOnly(model, method, pathname), `${method} ${pathname} should be owner-only at the pin`);
  // Reads the gate leaves open, and routes Alpha depends on.
  for (const [method, pathname] of [
    ['GET', '/api/config'], ['GET', '/api/cloud/login/status'], ['GET', '/api/auth/me'], ['POST', '/api/conversations/x/messages'],
    ['POST', '/api/views/interact-claim'], ['POST', '/api/workflow/phone/validate'], ['GET', '/api/notes/state'],
    ['GET', '/api/agent/restart'],
  ]) assert.ok(!ownerOnly(model, method, pathname), `${method} ${pathname} should stay open to the session gate`);
});

test('no route Alpha issues to its agent is behind the owner-only gate', () => {
  const model = gateModel(gateSource());
  const refused = [];
  for (const [method, pathname] of ownerRouteTable())
    if (ownerOnly(model, method, pathname)) refused.push(`${method} ${pathname} (config/owner-routes.json)`);
  const literals = alphaAgentPathLiterals();
  assert.ok(literals.size > 20, 'Alpha agent path literals were not found');
  // A literal carries no method: check it as a write, which the gate treats most strictly.
  for (const [literal, file] of literals)
    if (ownerOnly(model, 'POST', literal.replace(/[{}]/g, ''))) refused.push(`${literal} (${file})`);
  assert.deepEqual(refused, []);
});

test('native enrollment pairs as the owner, never through a guest invitation', () => {
  const local = fs.readFileSync(LOCAL_AGENT, 'utf8');
  assert.match(local, /enrollmentJson\(epoch,"\/api\/auth\/pair-code","GET"/);
  assert.match(local, /enrollmentJson\(epoch,"\/api\/auth\/pair","POST"/);
  assert.doesNotMatch(local, /guest-pair-code|guest-pair/);
  const pairing = fs.readFileSync(PAIRING, 'utf8');
  // Upstream: the operator code preserves OWNER; guest authority is a separate owner-minted grant.
  assert.match(pairing, /Owner\s+\*?\s*pairing preserves OWNER authority/);
  assert.match(pairing, /pair endpoint never accepts a caller-selected role/);
});

test('Alpha routes behind upstream owner checks outside the gate are only the reviewed automation routes', () => {
  const server = fs.readFileSync(SERVER, 'utf8');
  // The separate owner checks this review covered: trajectories, triggers/automations, and first-run after setup.
  assert.match(server, /pathname === "\/api\/trajectories" \|\|\s*pathname\.startsWith\("\/api\/trajectories\/"\)/);
  assert.match(server, /pathname\.startsWith\("\/api\/triggers"\) \|\| pathname === "\/api\/automations"/);
  assert.match(server, /pathname === "\/api\/first-run" &&\s*hasPersistedFirstRunState/);
  const gated = [...alphaAgentPathLiterals().keys()].filter((literal) =>
    /^\/api\/(?:trajectories|triggers|automations|first-run|onboarding)(?:\/|$)/.test(literal));
  assert.ok(gated.length > 0, 'Alpha automations routes were not found');
  // Only the trigger and automation routes, which the owner-paired native session (Bearer from /api/auth/pair) serves.
  for (const literal of gated) assert.match(literal, /^\/api\/(?:triggers|automations)(?:\/|$)/, `${literal} needs a new owner review`);
});
