// docs/requirements.json, the PRD table and the status index must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const requirements = JSON.parse(read('docs/requirements.json'));
const status = read('docs/mvp-current-status.md');
const prd = read('docs/prd.md');
const STATUSES = ['implemented', 'partial', 'deferred', 'blocked'];

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(' | ').map(cell => cell.trim());
function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `missing section "## ${heading}"`);
  const end = text.indexOf('\n## ', start + heading.length + 4);
  return text.slice(start, end === -1 ? undefined : end);
}
function table(text, heading) {
  const rows = section(text, heading).split('\n').filter(line => line.startsWith('|'));
  assert.ok(rows.length > 2, `no table under "## ${heading}"`);
  const header = cells(rows[0]);
  return rows.slice(2).map(line => {
    const values = cells(line);
    assert.equal(values.length, header.length, `malformed row under "## ${heading}": ${line.slice(0, 80)}`);
    return Object.fromEntries(header.map((name, index) => [name, values[index]]));
  });
}

const capabilities = table(status, 'Capabilities and remaining acceptance');
const areas = new Set(capabilities.map(row => row.Area));
const index = new Map(table(status, 'PRD requirement status').map(row => [row.Requirement, row]));
const prdRows = new Map(table(prd, 'Scope and requirements').map(row => [row.ID, row]));

test('requirements.json defines exactly the four statuses and lists AP-01 to AP-15 in order', () => {
  assert.equal(requirements.schema, 2);
  assert.equal(requirements.source, 'docs/prd.md');
  assert.deepEqual(Object.keys(requirements.statuses), STATUSES);
  const ids = requirements.requirements.map(requirement => requirement.id);
  assert.deepEqual(ids, Array.from({ length: 15 }, (_, index) => `AP-${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(ids, [...prdRows.keys()], 'requirements.json and the PRD table list different requirements');
});

test('every requirement has a valid status, existing evidence paths, a gate and known status rows', () => {
  for (const requirement of requirements.requirements) {
    assert.ok(STATUSES.includes(requirement.status), `${requirement.id}: status "${requirement.status}"`);
    assert.ok(typeof requirement.gate === 'string' && requirement.gate.length > 10, `${requirement.id}: gate`);
    assert.ok(typeof requirement.remaining === 'string' && requirement.remaining.length > 0, `${requirement.id}: remaining`);
    assert.ok(Array.isArray(requirement.evidence) && requirement.evidence.length > 0, `${requirement.id}: evidence`);
    for (const evidence of requirement.evidence) {
      assert.ok(!path.isAbsolute(evidence) && !evidence.includes('..'), `${requirement.id}: ${evidence} must be repository-relative`);
      assert.ok(fs.existsSync(path.join(root, evidence)), `${requirement.id}: evidence path ${evidence} does not exist`);
    }
    assert.ok(requirement.statusRows.length > 0, `${requirement.id}: statusRows`);
    for (const area of requirement.statusRows) assert.ok(areas.has(area), `${requirement.id}: "${area}" is not a row in docs/mvp-current-status.md`);
  }
});

test('the status index table matches requirements.json exactly', () => {
  assert.deepEqual([...index.keys()], requirements.requirements.map(requirement => requirement.id));
  for (const requirement of requirements.requirements) {
    const row = index.get(requirement.id);
    assert.equal(row.Status, requirement.status, `${requirement.id}: status differs between docs/mvp-current-status.md and docs/requirements.json`);
    assert.deepEqual(row['Status rows'].split('; '), requirement.statusRows, `${requirement.id}: status rows differ`);
    assert.equal(row['Next gate'], requirement.gate, `${requirement.id}: gate differs`);
  }
});

test('deferred requirements are exactly the PRD rows marked deferred', () => {
  for (const requirement of requirements.requirements) {
    const deferredInPrd = /^Deferred\b/i.test(prdRows.get(requirement.id)['Priority / acceptance']);
    assert.equal(requirement.status === 'deferred', deferredInPrd, `${requirement.id}: PRD priority and status disagree on deferral`);
  }
});

test('every capability row labels its evidence class', () => {
  const known = /^(?:not applicable|(?:[SBEIRD](?: and [SBEIRD])?(?: [^;]+)?)(?:; [SBEIRD](?: [^;]+)?)*)$/;
  for (const row of capabilities) {
    assert.ok(row['Evidence class'], `${row.Area}: evidence class missing`);
    assert.match(row['Evidence class'], known, `${row.Area}: "${row['Evidence class']}" does not start each entry with an S, B, E, I, R or D class`);
  }
  for (const code of ['(S)', '(B)', '(E)', '(I)', '(R)', '(D)']) assert.ok(status.includes(code), `class ${code} is not defined`);
});

test('every open owner choice maps to an implementation issue and its plan section', () => {
  const decisions = read('docs/decisions.md');
  const pending = section(decisions, 'Pending owner decisions');
  assert.match(pending, /No reviewed/);
  assert.equal(pending.split('\n').filter(line => /^\| A-\d\d \|/.test(line)).length, 0);
  const resolved = table(decisions, 'Resolved decision index');
  assert.equal(new Set(resolved.map(row => row.ID)).size, resolved.length, 'each decision has one row');
  // The State column is the owner's tracker; any value is accepted here.
  for (const row of resolved) {
    assert.match(row.Policy, /^P-\d\d$/, `${row.ID} maps to a P- policy`);
    assert.ok(row.State, `${row.ID} has a state`);
  }
  const implemented = resolved.filter(row => /#\d+/.test(row.Implementation));
  const issues = implemented.map(row => Number(row.Implementation.match(/#(\d+)/)[1])).sort((a, b) => a - b);
  assert.deepEqual(issues, Array.from({length: 32}, (_, index) => 394 + index), 'the October 12 decisions are issues #394 to #425');
  const plan = read('docs/owner-approved-mvp-plan-2026-10-12.md');
  const owner = section(decisions, 'October 12 owner decisions');
  for (const row of implemented) {
    const issue = row.Implementation.match(/#\d+/)[0];
    assert.ok(owner.includes(`**${row.Policy} — ${row.ID}`), `${row.ID} is an October 12 owner decision`);
    assert.ok(plan.includes(`## ${issue} — ${row.ID}:`), `${row.ID} has a plan section for ${issue}`);
  }
  const licence = resolved.find(row => row.ID === 'A-21');
  assert.equal(licence.State, 'Policy closed');
  assert.match(licence.Implementation, /no licence document, name, number, scope or terms has been seen or recorded/);
  assert.match(section(decisions, 'October 10 owner product decision'), /\*\*P-09\*\*[\s\S]*closes A-21 as licensed/);
});

// The contradictions the October 10 refresh found had three shapes: a ledger naming a retired
// upstream pin, a gate whose first step was a source check the same entry already listed as
// met, and a reference to a decision that has no row. Each is checked here.
test('the status index names the pinned upstream commit and no gate starts with a source check', () => {
  const pin = JSON.parse(read('upstream.lock.json')).commit;
  assert.ok(section(status, 'Product boundaries').includes(`\`${pin.slice(0, 10)}\``), `Product boundaries must name the pin ${pin.slice(0, 10)} from upstream.lock.json`);
  assert.ok(requirements.note.includes(pin.slice(0, 10)), 'requirements.json note must name the pin it was refreshed against');
  for (const requirement of requirements.requirements) {
    if (requirement.status !== 'partial') continue;
    // A gate that opens with "S:" says software is the next step; then "remaining" must name where that software is.
    if (/^S:/.test(requirement.gate)) assert.match(requirement.remaining, /not on main|not implemented|MVP-\d\d/, `${requirement.id}: an S gate needs the missing software named in "remaining"`);
  }
});

test('every decision ID named in the requirement ledgers is a row in decisions.md', () => {
  const decisions = read('docs/decisions.md');
  const named = new Set([...status.matchAll(/\bA-\d\d\b/g), ...JSON.stringify(requirements).matchAll(/\bA-\d\d\b/g)].map(match => match[0]));
  for (const id of named) assert.ok(decisions.includes(`| ${id} |`), `${id} is named in the ledgers but has no row in docs/decisions.md`);
  for (const [policy] of status.matchAll(/\bP-\d\d\b/g)) assert.ok(decisions.includes(`**${policy}**`), `${policy} is named in docs/mvp-current-status.md but is not an owner decision`);
});

// An MVP item that a requirement's remaining text or gate names must be tagged with that
// requirement in the inventory, so the two ledgers describe the same scope (AP-10 named
// Reminders and Clock while MVP-27 was tagged only AP-09 and AP-11).
test('every MVP item a requirement names is tagged with that requirement in the inventory', () => {
  const inventory = new Map(JSON.parse(read('docs/mvp-remaining-work-2026-10-09.json')).items.map(item => [item.id, item]));
  for (const requirement of requirements.requirements) {
    for (const [id] of `${requirement.remaining} ${requirement.gate}`.matchAll(/\bMVP-\d\d\b/g)) {
      assert.ok(inventory.has(id), `${requirement.id}: ${id} is not an inventory item`);
      assert.ok(inventory.get(id).requirements.includes(requirement.id), `${requirement.id} names ${id}, which is not tagged ${requirement.id} in docs/mvp-remaining-work-2026-10-09.json`);
    }
  }
});
