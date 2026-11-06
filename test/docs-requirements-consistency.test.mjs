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


test('October 12 owner choices map all 32 reviewed issues to open implementation TODOs', () => {
  const decisions = read('docs/decisions.md');
  const pending = section(decisions, 'Pending owner decisions');
  assert.match(pending, /No reviewed/);
  assert.equal(pending.split('\n').filter(line => /^\| A-\d\d \|/.test(line)).length, 0);
  const resolved = table(decisions, 'Resolved decision index');
  const active = resolved.filter(row => row.State === 'TODO');
  assert.equal(active.length, 32);
  const numbers = active.map(row => Number(row.Implementation.match(/#(\d+)/)[1]));
  assert.deepEqual(numbers, Array.from({ length: 32 }, (_, i) => 394 + i));
  assert.equal(new Set(active.map(row => row.ID)).size, 32);
  for (const row of active) {
    assert.ok(section(decisions, 'October 12 owner decisions').includes(`**${row.Policy} — ${row.ID}`));
    assert.ok(read('docs/owner-approved-mvp-plan-2026-10-12.md').includes(`## ${row.Implementation.match(/#\d+/)[0]} — ${row.ID}:`));
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
  // October 12 entries are written "**P-22 — A-16 (...)", later ones "**P-43**".
  for (const [policy] of status.matchAll(/\bP-\d\d\b/g)) assert.ok(decisions.includes(`**${policy}**`) || decisions.includes(`**${policy} — `), `${policy} is named in docs/mvp-current-status.md but is not an owner decision`);
});

// GitHub's heading anchor: lowercased, punctuation dropped, spaces to hyphens, repeats numbered.
function headingSlugs(markdown) {
  const seen = new Map(), slugs = new Set();
  for (const [, heading] of markdown.matchAll(/^#{1,6} +(.+?) *#*$/gm)) {
    const base = heading.replace(/[`*_]|\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count ? `${base}-${count}` : base);
  }
  return slugs;
}
const LEDGERS = ['docs/mvp-current-status.md', 'docs/requirements.json', 'docs/agent-integration.md', 'docs/core-loop-status.md'];

test('every link from the ledgers into decisions.md names one of its headings', () => {
  const slugs = headingSlugs(read('docs/decisions.md'));
  assert.ok(slugs.has('resolved-decision-index') && slugs.has('october-12-owner-decisions'));
  for (const file of LEDGERS) {
    for (const [, fragment] of read(file).matchAll(/decisions\.md#([^)\s"'`]+)/g)) {
      assert.ok(slugs.has(fragment), `${file} links decisions.md#${fragment}, which is not a heading`);
    }
  }
});

test('the ledgers do not call a resolved decision pending', () => {
  const resolved = new Map(table(read('docs/decisions.md'), 'Resolved decision index').map(row => [row.ID, row.Policy]));
  // Link targets hold full stops (decisions.md), so read each link as its text.
  const text = [status, ...requirements.requirements.map(requirement => `${requirement.remaining}\n${requirement.gate}`)].join('\n').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  for (const [, id, word] of text.matchAll(/\b(A-\d\d)\b[^.\n]*?\b(pending|undecided)\b/gi)) {
    assert.ok(!/^P-\d\d$/.test(resolved.get(id) ?? ''), `${id} is called ${word}, but the resolved decision index maps it to ${resolved.get(id)}`);
  }
});

test('an S gate does not call software "not implemented" when every evidence file exists', () => {
  for (const requirement of requirements.requirements) {
    if (requirement.status !== 'partial' || !/^S:/.test(requirement.gate) || !/not implemented/.test(requirement.remaining)) continue;
    assert.ok(!requirement.evidence.every(evidence => fs.existsSync(path.join(root, evidence))),
      `${requirement.id}: "remaining" says not implemented, yet every evidence file it lists exists; name what is missing or change the gate`);
  }
});

test('no status cell says one instrumented class both never ran and passed', () => {
  const unrun = /never run|no recorded run|has not run|not run/;
  for (const row of capabilities) {
    for (const cell of Object.values(row)) {
      const sentences = cell.split(/(?<=[.;])\s+/);
      for (const [, name] of cell.matchAll(/`(\w+InstrumentedTest)`/g)) {
        const about = sentences.filter(sentence => sentence.includes(name));
        const never = about.some(sentence => /never run|no recorded run/.test(sentence));
        const passed = about.some(sentence => /\bpassed\b/.test(sentence) && !unrun.test(sentence));
        assert.ok(!(never && passed), `${row.Area}: ${name} is both unrun and passed in one cell`);
      }
    }
  }
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

// Always-on listening and hardware invocation (MVP-52) gate AP-06 and AP-14 and are owner-gated.
test('AP-06 and AP-14 name MVP-52 as open and owner-gated', () => {
  const byId = new Map(requirements.requirements.map(requirement => [requirement.id, requirement]));
  for (const id of ['AP-06', 'AP-14']) assert.match(byId.get(id).remaining, /always-on listening and hardware invocation \(MVP-52\) (?:is|are) open and owner-gated/i, `${id}: MVP-52`);
  const item = JSON.parse(read('docs/mvp-remaining-work-2026-10-09.json')).items.find(entry => entry.id === 'MVP-52');
  assert.ok(item.blocked_on.some(entry => entry.startsWith('HUMAN: ')), 'MVP-52 must stay blocked on an owner decision');
  for (const id of ['AP-06', 'AP-14']) assert.ok(item.requirements.includes(id), `MVP-52 must be tagged ${id}`);
});
