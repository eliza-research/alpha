// The accessibility sweep (MVP-48, renderer part) must keep visiting every retained view. A view
// added to the MVP without a state in the sweep, or a state dropped from it, fails here instead
// of quietly leaving a screen unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function enabledViews() {
  const source = read('apps/app/src/prototype/mvp-features.ts');
  const body = source.match(/export const ENABLED_MVP_VIEWS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(body, 'ENABLED_MVP_VIEWS is declared as a literal set');
  // Deferred views are commented out in the literal; only uncommented entries are retained.
  const live = body[1].split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
  return [...live.matchAll(/"([a-z]+)"/g)].map(match => match[1]);
}

const states = read('test/browser/accessibility-states.ts');
const sweep = read('test/browser/accessibility-sweep.spec.ts');
const production = read('test/browser/accessibility-sweep.production.spec.ts');

test('every retained MVP view has a live state and a populated state in the sweep', () => {
  const views = enabledViews();
  assert.ok(views.length, 'retained views are discoverable');
  const liveBlock = states.slice(states.indexOf('export const LIVE_STATES'), states.indexOf('export const MOCK_STATES'));
  const mockBlock = states.slice(states.indexOf('export const MOCK_STATES'), states.indexOf('export const FAILURE_STATES'));
  for (const view of views) {
    const title = view[0].toUpperCase() + view.slice(1);
    assert.match(liveBlock, new RegExp(`live\\('[^']*', \\['${title}'`), `live state opens ${title}`);
    assert.match(mockBlock, new RegExp(`'${view}'`), `fixture state opens ${view}`);
    assert.match(mockBlock, new RegExp(`'${view}:[a-z]+'`), `fixture state opens a ${view} subview`);
  }
  for (const surface of ["live('Home')", "live('All apps'", "live('Conversation'", "'shade'", "'sheet'", "'full'"])
    assert.ok(states.includes(surface), `${surface} is swept`);
  assert.match(states, /name: 'render failure recovery'/);
  assert.match(states, /name: 'startup failure recovery'/);
});

test('every subview of a retained view is opened by a state that asserts it is the exposed one', () => {
  const template = read('apps/app/src/prototype/template.html');
  const retained = new Set(enabledViews());
  // Subview ids are "<view>-<name>"; the automation editor lives in the Workflows view.
  const owner = id => id.startsWith('automations-') ? 'workflows' : id.split('-')[0];
  const subviews = [...new Set([...template.matchAll(/data-alpha-subview="([^"]+)"/g)].map(match => match[1]))].filter(id => retained.has(owner(id)));
  assert.ok(subviews.length >= 25, 'the template still marks its subviews');
  // The base list of a view is what its plain state shows; only layered subviews need a named state.
  // photos-empty (the viewer left open after its photo disappears) has no tap path; a fixture state
  // opens it directly and asserts it like the others.
  const table = states.slice(states.indexOf('const SUBVIEW'), states.indexOf('export const MOCK_STATES'));
  assert.match(states, /\.map\(start => mock\(start, \[\], SUBVIEW\[start\]\)\)/, 'deep-link states assert their subview');
  assert.match(states, /const showing = async[\s\S]*?\[data-alpha-subview="\$\{subview\}"\]:not\(\[inert\]\)[\s\S]*?toBeVisible\(\)/, 'a declared subview is asserted when the state opens');
  const asserted = new Set([
    ...[...table.matchAll(/'[a-z]+:[a-z]+': '([a-zA-Z-]+)'/g)].map(match => match[1]),
    ...[...states.matchAll(/(?:live|mock)\([^\n]*, '([a-zA-Z-]+)'\),/g)].map(match => match[1]),
    ...[...states.matchAll(/shows: '([a-zA-Z-]+)'/g)].map(match => match[1]),
  ]);
  for (const id of subviews) {
    if (id.endsWith('-list')) continue;
    assert.ok(asserted.has(id), `a state opens and asserts the ${id} subview`);
  }
  // Menus, search fields, sheets and the Undo toast are states of their own.
  for (const step of ["['New automation', 'Edit When step']", "['Add Read step']", "['Browser', 'Menu']", "['Photos', 'Search photos']", "['Notes', 'Search notes']", "['Files', 'Search files']", "['Search email']", "['Menu', 'Share']", "['Share photo']", "['View and sort']", "['Move file']", "['Delete file']"])
    assert.ok(states.includes(step), `${step} is swept`);
  // The Settings pages and sheets the browser build reaches (docs/ui-refresh-2026-11).
  for (const page of ['About', 'Scheduled digests', 'Agent', 'Eliza Cloud', 'Google', 'In-app alerts', 'Calendars'])
    assert.ok(states.includes(`['Settings', '${page}']`), `Settings > ${page} is swept`);
  for (const page of ['Problem log', 'Open source licenses'])
    assert.ok(states.includes(`['Settings', 'About', '${page}']`), `Settings > About > ${page} is swept`);
});

test('the sweep applies every dimension and cannot be narrowed silently', () => {
  assert.match(sweep, /const STATES = \[\.\.\.LIVE_STATES, \.\.\.DEVELOPMENT_STATES, \.\.\.MOCK_STATES, \.\.\.CONNECTED_STATES, \.\.\.FAILURE_STATES\];/);
  assert.match(sweep, /for \(const theme of \['light', 'dark'\] as const\)/);
  assert.match(sweep, /auditTree\(page\)/);
  // Round 10: every lane also applies the dock and toast rules (nothing on Home under the
  // composer, an app's content scrollable clear of it, no toast under a dialog).
  assert.match(sweep, /auditPage\(page, \{ contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true \}\)/);
  assert.match(sweep, /auditTabOrder\(page\)/);
  assert.doesNotMatch(sweep, /auditPage\(page, \{[^}]*overlap: true \}\)/, 'no lane of the sweep runs without the dock rules');
  assert.doesNotMatch(production, /auditPage\(page, \{[^}]*overlap: true \}\)/, 'no lane of the production sweep runs without the dock rules');
  assert.match(sweep, /setTextScale\(page, 2\)/);
  // 200% text is checked for overlap as well as clipping (text printed over text, a label split
  // mid-word, a control on or cut by another box): the round-7 Home defect was not a clipping defect.
  assert.match(sweep, /setTextScale\(page, 2\);[\s\S]{0,400}auditPage\(page, \{ clipping: true, overlap: true, dock: true \}\)/);
  // At 200% the tab order is walked too (a stop left under the composer is a focus-obscured finding).
  assert.match(sweep, /200% text is not clipped[\s\S]*?auditTabOrder\(page\)[\s\S]*?test\.describe\('landscape'/);
  // Landscape and 200% text together is a lane of its own.
  assert.match(sweep, /landscape at 200% text keeps every control on screen[\s\S]*?toHaveClass\(\/alpha-landscape\/\);\s*await setTextScale\(page, 2\);[\s\S]{0,200}auditPage\(page, \{ clipping: true, overlap: true, dock: true \}\), \.\.\.await auditTree\(page\), \.\.\.await auditTabOrder\(page\)/);
  assert.match(sweep, /viewport: \{ width: 915, height: 412 \}/);
  for (const spec of [sweep, production]) assert.match(spec, /toHaveClass\(\/alpha-landscape\/\)/, 'the landscape lane asserts the landscape layout is active');
  // Only deliberate truncation is tolerated; nothing else is filtered out of the results.
  assert.doesNotMatch(sweep, /process\.env/);
  assert.match(sweep, /lines\.filter\(line => !line\.startsWith\('text-truncated:'\) \|\| appTitle\(line\)\)/);
  // A cut app title is never tolerated (AP-15): it names the screen and has room to wrap.
  assert.match(sweep, /const appTitle = \(line: string\) => \/\^text-truncated: \.\*<\[\^>\]\*\\bdata-alpha-app-title\\b\/\.test\(line\);/);
  // The fixture lock screen and photos-empty viewer and the launcher presentation run at 100%
  // and 200% with names, focus, contrast and the dock rules (provider-connected states are in STATES).
  assert.match(sweep, /for \(const state of \[\.\.\.FIXTURE_STATES, \.\.\.LAUNCHER_STATES\]\) \{\s*for \(const scale of \[1, 2\]\)/);
  for (const name of ["mock('lock')", "shows: 'photos-empty'", "launcher('Home')", "launcher('All apps'", "connected('Inbox'", "connected('Settings Google'", "name: 'connected Calendar with events'", "CONNECTED_STATES.push(calendarWithEvents)"])
    assert.ok(states.includes(name), `${name} is swept`);
  // No state is skipped, marked fixme or exempted from a dimension.
  assert.doesNotMatch(sweep, /test\.skip|test\.fixme|\.only\(/);
  assert.doesNotMatch(production, /test\.skip|test\.fixme|\.only\(/);
  assert.doesNotMatch(states, /fixme|largeTextOpen/);
  assert.match(production, /for \(const state of LIVE_STATES\)/);
  assert.match(production, /auditPage\(page, \{ contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true \}\)/);
});

test('provider-connected screens are swept, against a synthetic mailbox only', () => {
  const block = states.slice(states.indexOf('export const CONNECTED_STATES'), states.indexOf('export const DEVELOPMENT_STATES'));
  for (const state of ["connected('Home'", "connected('Inbox')", "connected('Inbox sent (empty)'", "connected('Inbox search'", "connected('Inbox message'", "connected('Inbox long subject'", "connected('Inbox compose'", "connected('Settings',", "connected('Settings Google'"])
    assert.ok(block.includes(state), `${state} is swept`);
  assert.doesNotMatch(block, /fixme|skip/);
  // The provider boundary is replaced in the page; nothing is fetched and no real address is used.
  const fixture = states.slice(states.indexOf('async function connectMailbox'), states.indexOf('const connected ='));
  assert.match(fixture, /controller\.getCloudClient = \(\) => \(\{ client,/);
  assert.match(fixture, /initiateGmail: async \(\) => \{ throw Error\('No live OAuth in fixture'\); \}/);
  assert.doesNotMatch(fixture, /fetch\(|https?:\/\//);
  for (const address of fixture.matchAll(/[\w.-]+@[\w.-]+/g)) assert.match(address[0], /@example\.test$/, `${address[0]} is a reserved test address`);
});
