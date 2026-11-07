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
  assert.deepEqual([...views].sort(), ['browser', 'calendar', 'camera', 'files', 'inbox', 'maps', 'notes', 'photos', 'settings', 'workflows']);
  const liveBlock = states.slice(states.indexOf('export const LIVE_STATES'), states.indexOf('export const MOCK_STATES'));
  const mockBlock = states.slice(states.indexOf('export const MOCK_STATES'), states.indexOf('export const FAILURE_STATES'));
  for (const view of views) {
    const title = view[0].toUpperCase() + view.slice(1);
    assert.match(liveBlock, new RegExp(`live\\('[^']*', \\['${title}'`), `live state opens ${title}`);
    assert.match(mockBlock, new RegExp(`'${view}'`), `fixture state opens ${view}`);
    assert.match(mockBlock, new RegExp(`'${view}:[a-z]+'`), `fixture state opens a ${view} subview`);
  }
  for (const surface of ["live('Home')", "live('Apps'", "live('Conversation'", "'shade'", "'sheet'", "'full'"])
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
  const unreachable = new Set();
  // A subview is a screen a state exposes, so none is hidden from assistive technology by markup alone.
  // A blank cover, such as the one a Home calendar card opens its event over, is not a subview.
  const tags = [...template.matchAll(/<[a-z]+ [^>]*data-alpha-subview="([^"]+)"[^>]*>/g)];
  assert.equal(tags.length, [...template.matchAll(/data-alpha-subview="/g)].length, 'every subview tag is read');
  for (const [tag, id] of tags) assert.doesNotMatch(tag, /aria-hidden="true"/, `${id} can be the exposed subview`);
  const table = states.slice(states.indexOf('const SUBVIEW'), states.indexOf('export const MOCK_STATES'));
  assert.match(states, /\.map\(start => mock\(start, \[\], SUBVIEW\[start\]\)\)/, 'deep-link states assert their subview');
  assert.match(states, /const showing = async[\s\S]*?\[data-alpha-subview="\$\{subview\}"\]:not\(\[inert\]\)[\s\S]*?toBeVisible\(\)/, 'a declared subview is asserted when the state opens');
  assert.match(states, /const legacyNotes = [\s\S]*?await showing\(page, shows\);/, 'legacy source states assert their exposed subview too');
  const asserted = new Set([
    ...[...table.matchAll(/'[a-z]+:[a-z]+': '([a-zA-Z-]+)'/g)].map(match => match[1]),
    ...[...states.matchAll(/(?:live|mock|legacyNotes)\([^\n]*, '([a-zA-Z-]+)'\),/g)].map(match => match[1]),
    ...[...states.matchAll(/shows: '([a-zA-Z-]+)'/g)].map(match => match[1]),
  ]);
  for (const id of subviews) {
    if (id.endsWith('-list') || unreachable.has(id)) continue;
    assert.ok(asserted.has(id), `a state opens and asserts the ${id} subview`);
  }
  // Menus, search fields, sheets and the Undo toast are states of their own.
  for (const step of ["['New automation', 'Edit When step']", "['Add Read step']", "['Connections', 'Slack']", "['Browser', 'Menu']", "['New note', 'More']", "['Search email']", "['Menu', 'Share']", "['Share photo']", "['View and sort']", "['Move file']", "['Delete file']"])
    assert.ok(states.includes(step), `${step} is swept`);
  // Notes has no search field (PLAN.md decision P2); its folders, ⋯ menu and Recently deleted are swept.
  for (const state of ["legacyNotes('Notes new folder', ['New folder'])", "legacyNotes('Notes note menu', ['New note', 'More'])", "'notes-trash'", "'notes-recorder'"])
    assert.ok(states.includes(state), `${state} is swept`);
  assert.match(states, /const legacyNotes = [\s\S]*?await openLegacyNotes\(page\);[\s\S]*?await press\(page, steps\)/, 'retained Notes states select their source before opening controls');

  for (const page of ['Character', 'Accounts', 'Connections', 'Notifications', 'Calendar', 'Password manager', 'Models', 'Display', 'Privacy & data', 'About', 'Scheduled digests', 'Agent connection'])
    assert.ok(states.includes(`['Settings', '${page}']`), `Settings > ${page} is swept`);
});

test('the sweep applies every dimension and cannot be narrowed silently', () => {
  assert.match(sweep, /const STATES = \[\.\.\.LIVE_STATES, \.\.\.BROWSER_APP_STATES, \.\.\.DEVELOPMENT_STATES, \.\.\.MOCK_STATES, \.\.\.CONNECTED_STATES, \.\.\.FAILURE_STATES\];/);
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
  assert.equal([...sweep.matchAll(/\.filter\(/g)].length, 2);
  assert.doesNotMatch(sweep, /process\.env/);
  assert.match(sweep, /lines\.filter\(line => !line\.startsWith\('text-truncated:'\) \|\| appTitle\(line\)\)/);
  // A cut app title is never tolerated (AP-15): it names the screen and has room to wrap.
  assert.match(sweep, /const appTitle = \(line: string\) => \/\^text-truncated: \.\*<\[\^>\]\*\\bdata-alpha-app-title\\b\/\.test\(line\);/);
  // The fixture lock screen and photos-empty viewer and the launcher presentation run at 100%
  // and 200% with names, focus, contrast and the dock rules (provider-connected states are in STATES).
  assert.match(sweep, /for \(const state of \[\.\.\.FIXTURE_STATES, \.\.\.LAUNCHER_STATES\]\) \{\s*for \(const scale of \[1, 2\]\)/);
  for (const name of ["mock('lock')", "shows: 'photos-empty'", "launcher('Home')", "launcher('Apps'", "connected('Inbox'", "connected('Settings connections'", "name: 'connected Calendar with events'", "CONNECTED_STATES.push(calendarWithEvents)"])
    assert.ok(states.includes(name), `${name} is swept`);
  // Above 200%: the largest in-app size with the largest system font (300%), over every live and
  // launcher state, with the clipping, overlap, dock, name, tab-order and reading-order rules.
  assert.match(sweep, /for \(const state of \[\.\.\.LIVE_STATES, \.\.\.BROWSER_APP_STATES, \.\.\.LAUNCHER_STATES\]\) \{\s*test\(`300% text[\s\S]{0,400}setTextScale\(page, 3\);\s*const found = blocking\(format\(\[\.\.\.await auditPage\(page, \{ clipping: true, overlap: true, dock: true \}\), \.\.\.await auditTree\(page\), \.\.\.await auditTabOrder\(page\), \.\.\.await auditReadingOrder\(page\)\]\)\);/);
  // The 300% defects open when the lane was added (#701) run as expected failures; the list only shrinks.
  const open300 = sweep.match(/const OPEN_AT_300 = new Set\(\[([^\]]*)\]\);/)?.[1];
  assert.ok(open300 !== undefined, 'the open 300% defects are listed in one place');
  const recorded300 = ['live Camera (unavailable)', 'live Browser tabs', 'live Browser menu', 'live Settings display', 'launcher Calendar', 'launcher Camera', 'launcher Photos', 'launcher Workflows', 'launcher Settings display'];
  for (const name of [...open300.matchAll(/'([^']+)'/g)].map(match => match[1])) assert.ok(recorded300.includes(name), `${name} is not a recorded 300% defect; fix it instead of exempting it`);
  // An open entry must still report a layout defect from the audit itself; a timeout, a crash or a
  // state that no longer opens is not taken as the expected failure.
  assert.match(sweep, /if \(OPEN_AT_300\.has\(state\.name\)\) expect\(found, `\$\{state\.name\} now passes at 300%: remove it from OPEN_AT_300 \(issue #701\)`\)\.not\.toEqual\(\[\]\);\s*else expect\(found, found\.join\('\\n'\)\)\.toEqual\(\[\]\);/);
  assert.doesNotMatch(sweep, /test\.fail\(/, 'no lane has expected failures');
  // The launcher presentation of every retained app view, and the conversation.
  for (const view of ['Conversation', 'Inbox', 'Calendar', 'Browser', 'Camera', 'Photos', 'Maps', 'Notes', 'Files', 'Workflows', 'Settings'])
    assert.ok(states.includes(`launcher('${view}'`), `the launcher ${view} is swept`);
  // No state is skipped, marked fixme or exempted from a dimension.
  assert.doesNotMatch(sweep, /test\.skip|test\.fixme|\.only\(/);
  assert.doesNotMatch(production, /test\.skip|test\.fixme|\.only\(/);
  assert.doesNotMatch(states, /fixme|largeTextOpen/);
  assert.match(production, /const STATES = \[\.\.\.LIVE_STATES, PRODUCTION_APPS_STATE\];/);
  assert.match(production, /for \(const state of STATES\)/);
  assert.match(production, /auditPage\(page, \{ contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true \}\)/);
});

test('TalkBack reading order is checked in every lane, as Android checks it, across views and the lifecycle', () => {
  // Every lane of both sweeps reads the order (the light theme once; it does not depend on the theme).
  assert.match(sweep, /\.\.\.theme === 'light' \? await auditReadingOrder\(page\) : \[\]/);
  assert.match(sweep, /200% text is not clipped[\s\S]*?const order = format\(await auditReadingOrder\(page\)\);\s*expect\(order, order\.join\('\\n'\)\)\.toEqual\(\[\]\);/);
  assert.equal([...sweep.matchAll(/auditReadingOrder\(page\)/g)].length, 6, 'all six sweep lanes read the order');
  assert.equal([...production.matchAll(/auditReadingOrder\(page\)/g)].length, 2, 'both production lanes read the order');
  // The browser rule is the Android rule: the same geometry, the same assistant group, the same bars.
  const audit = read('test/browser/accessibility-audit.ts');
  const order = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/TalkBackOrder.java');
  assert.match(audit, /r\.top < p\.top - tallest \/ 2 && r\.left < p\.right/);
  assert.match(order, /r\.top < p\.top - Math\.max\(p\.height\(\), r\.height\(\)\) \/ 2 && r\.left < p\.right/);
  assert.match(audit, /export const ASSISTANT_GROUP = 'Assistant controls';/);
  assert.match(order, /ASSISTANT_GROUP = "Assistant controls";/);
  const groups = audit.match(/export const READING_GROUPS = '([^']+)';/)?.[1];
  assert.ok(groups, 'the bars are declared once in the audit');
  assert.ok(order.includes(groups.replaceAll('"', '\\"')), 'the Android rule reads the same bars');
  // Every retained view is visited on the emulator and in the lifecycle spec, by its Home tile name.
  const titles = enabledViews().map(view => view[0].toUpperCase() + view.slice(1)).sort();
  const views = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/AccessibilityViewsInstrumentedTest.java').match(/static final String\[\] VIEWS = \{([^}]*)\};/)?.[1];
  assert.deepEqual([...views.matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]).sort(), titles);
  const lifecycle = read('test/browser/accessibility-lifecycle.spec.ts').match(/const VIEWS = \[([^\]]*)\] as const;/)?.[1];
  assert.deepEqual([...lifecycle.matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]).sort(), titles);
  for (const name of ['AccessibilityLifecycleInstrumentedTest', 'AccessibilityHomeRoleInstrumentedTest'])
    assert.match(read(`android/app/src/androidTest/java/ai/elizaresearch/alphaphone/${name}.java`), /AccessibilityViewsInstrumentedTest\.VIEWS/, `${name} visits every view`);
  // What the order check found stays fixed. Maps reads what is drawn over the top of the map
  // (search, Back to event, chips, status, the route card, the turn banner) before the map, its
  // credits and Recenter; the browser page leaves the order while address suggestions cover it.
  const template = read('apps/app/src/prototype/template.html');
  const maps = template.slice(template.indexOf('data-alpha-maps-root'), template.indexOf('data-alpha-maps-sheet="results"'));
  const stack = ['maps.showSearch', 'maps.eventReturnFloating', 'maps.isBase', 'maps.nativeStatusVisible', 'data-alpha-maps-directions', 'maps.dr.nav.hasThen', 'data-alpha-map-plane', 'alpha-map-credits', 'aria-label="Recenter"'].map(hook => [hook, maps.indexOf(hook)]);
  for (const [hook, at] of stack) assert.ok(at > 0, `${hook} is in the Maps layer stack`);
  for (let index = 1; index < stack.length; index++) assert.ok(stack[index - 1][1] < stack[index][1], `Maps reads ${stack[index - 1][0]} before ${stack[index][0]}`);
  assert.match(template, /<div inert="\{\{browser\.pageCovered\}\}" aria-hidden="\{\{browser\.pageCovered\}\}"/);
  assert.match(read('apps/app/src/prototype/subview-accessibility.ts'), /pageCovered:!!out\.editing/);
  // Focus follows the screen: installed by the renderer, and asserted by the lifecycle spec and the emulator.
  assert.match(read('apps/app/src/main.tsx'), /installViewFocus\(\)/);
  // The behaviour is Eliza's shared screen focus; Alpha keeps only its selectors and screen-change wiring.
  const viewFocus = read('apps/app/src/runtime/view-focus.ts');
  assert.match(viewFocus, /from '@elizaos\/ui\/accessibility\/screen-focus'/);
  assert.match(viewFocus, /createScreenFocus\(/);
  assert.doesNotMatch(viewFocus, /setAttribute\('tabindex'|requestAnimationFrame/, 'no local copy of the focus mover');
  assert.match(read('scripts/prepare-client-features.mjs'), /'packages\/ui\/src\/accessibility\/screen-focus\.ts'/);
});

test('provider-connected screens are swept, against a synthetic mailbox only', () => {
  const block = states.slice(states.indexOf('export const CONNECTED_STATES'), states.indexOf('export const DEVELOPMENT_STATES'));
  for (const state of ["connected('Home'", "connected('Inbox')", "connected('Inbox sent (empty)'", "connected('Inbox search'", "connected('Inbox message'", "connected('Inbox long subject'", "connected('Inbox compose'", "connected('Settings',", "connected('Settings accounts'", "connected('Settings connections'"])
    assert.ok(block.includes(state), `${state} is swept`);
  // Connected states other than a mailbox (MVP-48): an agent's calendar, a linked Google Calendar
  // account's sync review and a connected agent's conversation. None writes to a provider.
  for (const state of ["agentCalendar('on Home')", "agentCalendar('in Calendar'", "googleCalendar('account', false)", "googleCalendar('review', true)", "developmentAgent('Settings', false)", "developmentAgent('Conversation', true)"])
    assert.ok(states.includes(state), `${state} is swept`);
  assert.match(states, /const googleCalendar = [\s\S]*?expect\(await page\.evaluate\(\(\) => \(window as any\)\.calendarSyncFixture\.writes\)\)\.toBe\(0\);/, 'the Google Calendar states make no provider write');
  assert.doesNotMatch(block, /fixme|skip/);
  // The provider boundary is replaced in the page; nothing is fetched and no real address is used.
  const fixture = states.slice(states.indexOf('async function connectMailbox'), states.indexOf('const connected ='));
  assert.match(fixture, /controller\.getCloudClient = \(\) => \(\{ client,/);
  assert.match(fixture, /initiateGmail: async \(\) => \{ throw Error\('No live OAuth in fixture'\); \}/);
  assert.doesNotMatch(fixture, /fetch\(|https?:\/\//);
  for (const address of fixture.matchAll(/[\w.-]+@[\w.-]+/g)) assert.match(address[0], /@example\.test$/, `${address[0]} is a reserved test address`);
});

test('the dock, title and toast fixes the sweep depends on stay in the source', () => {
  const css = read('apps/app/src/prototype/phone.css');
  const main = read('apps/app/src/main.tsx');
  // Home and the app library reserve measured clearance inside their full-height scroll content.
  assert.match(css, /--alpha-dock-reserve:max\(108px,calc\(var\(--alpha-dock-clearance,102px\) \+ 6px\)\)/);
  assert.match(css, /html:not\(\.alpha-landscape\) \.alpha-phone \[data-alpha-layer="home"\] \{ bottom:0!important; scroll-padding-bottom:var\(--alpha-dock-reserve\)!important;/);
  assert.match(css, /html:not\(\.alpha-landscape\) \.alpha-phone \[data-alpha-layer="drawer"\] \{ padding-bottom:0!important; \}/);
  assert.match(css, /\[data-alpha-home-layout\] \{ padding-bottom:var\(--alpha-dock-reserve\)!important; min-height:calc\(100% \+ var\(--alpha-dock-reserve\) - 108px\)!important; \}/);
  assert.match(css, /:is\(\[data-alpha-app-scroll\],\.calendar-timeline,\.calendar-draft-fields\) \{ scroll-padding-bottom:calc\(var\(--alpha-dock-clearance,102px\) \+ 16px\); \}/);
  assert.match(css, /\.inbox-compose-fields \{[^}]*padding-bottom:max\(64px,calc\(var\(--alpha-dock-clearance,102px\) \+ 8px\)\)!important/);
  assert.match(main, /installDockClearance\(\)/);
  const dock = read('apps/app/src/runtime/dock-clearance.ts');
  assert.match(dock, /'--alpha-dock-clearance'/);
  assert.match(dock, /'--alpha-dock-rest'/);
  // The dock moves without resizing when Android's insets arrive on the root element. The
  // publisher is shared Eliza code (projected from the pin); Alpha binds its own selectors to it.
  assert.match(dock, /installSharedDockClearance\(\{ screen: '\[data-screen\]', docks: DOCK, bar: '\[data-alpha-input-bar\]', clearanceProperty: DOCK_CLEARANCE_PROPERTY, restProperty: DOCK_REST_PROPERTY \}\)/);
  const shared = read('.eliza/client-features/packages/ui/src/components/shell/dock-clearance.ts');
  assert.match(shared, /root\.observe\(document\.documentElement, \{\s*attributes: true,\s*attributeFilter: \["class", "style"\],?\s*\}\)/);
  // Focus under the dock is scrolled clear, but never focus that came from a pointer.
  assert.match(read('apps/app/src/prototype/chat-overlay-motion-adapter.ts'), /if \(!sheet && !target\.matches\(":focus-visible"\)\) return;/);
  // A screen title is not shortened with a large system font: it takes its own row.
  assert.match(read('apps/app/src/runtime/text-scale.ts'), /classList\.toggle\(TEXT_XL_CLASS, scale > TEXT_XL_ABOVE\)/);
  assert.match(css, /\.alpha-text-xl\.standalone-app \[data-alpha-app-header\] \[data-alpha-app-title\] \{[^}]*flex:1 0 100%;[^}]*white-space:normal!important;[^}]*text-overflow:clip!important/);
  // A toast under a top-layer dialog is shown and announced inside that dialog.
  assert.match(main, /installToastLayer\(\)/);
  const toast = read('apps/app/src/runtime/toast-layer.ts');
  assert.match(toast, /region\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(toast, /dialog\.prepend\(region\)/);
  assert.doesNotMatch(toast, /showPopover|position:fixed/);
  assert.match(toast, /dialog\.matches\(':modal'\)/);
});

test('the layout fixes the sweep depends on stay in the stylesheet and template', () => {
  const css = read('apps/app/src/prototype/phone.css');
  const template = read('apps/app/src/prototype/template.html');
  for (const hook of ['data-alpha-camera-root', 'data-alpha-camera="viewfinder"', 'data-alpha-camera="capture"', 'data-alpha-camera="modes"', 'data-alpha-camera="zoom"', 'data-alpha-maps-sheet="results"', 'data-alpha-maps-sheet="place"', 'data-alpha-maps-sheet="directions"', 'data-alpha-maps-directions', 'data-alpha-map-canvas', 'class="calendar-block-text"'])
    assert.ok(template.includes(hook), `${hook} is in the template`);
  assert.match(css, /\.alpha-landscape \[data-alpha-camera="capture"\]\{[^}]*flex-direction:column-reverse/);
  assert.match(css, /\[data-alpha-maps-sheet="place"\],\[data-alpha-maps-sheet="directions"\]\{[^}]*max-height:calc\(100% - 104px\);overflow-y:auto/);
  assert.match(css, /\.calendar-block-text\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\[data-alpha-browser-menu\]>button\{[^}]*min-height:50px/);
  assert.match(css, /\[data-alpha-subview="photos-edit"\]\{[^}]*overflow-y:auto/);
  assert.match(css, /\[data-alpha-app-header\]\[data-alpha-header-grow\]\{height:auto!important\}/);
  assert.ok(template.includes('data-alpha-browser-menu') && template.includes('data-alpha-header-grow'));
  // Large text (PRD AP-15): Home cards grow with their text, tile grids drop a column when their
  // labels stop fitting, and both read the measured text scale.
  assert.match(css, /\.home-calendar-card \{[^}]*min-height:196px/);
  assert.doesNotMatch(css, /\.home-calendar-title \{[^}]*max-height/);
  // Above about 220% the empty-agenda title is held to a quarter of the card's width so a word of its
  // copy is not split across lines (#701); the cap reads the measured scale that text zoom multiplies back.
  assert.match(css, /\.home-calendar-card:not\(\[data-alpha-home-calendar-event="true"\]\) \{ container-type:inline-size; \}/);
  assert.match(css, /\.home-calendar-card:not\(\[data-alpha-home-calendar-event="true"\]\) \.home-calendar-title \{ font-size:calc\(min\(36px, 25cqi \/ var\(--alpha-text-scale,1\)\) \* var\(--browser-text-scale,1\)\); \}/);
  // The conversation's suggestion chips grow with their text and keep a 48px target.
  assert.match(template, /<button onClick="\{\{s\.go\}\}" style="flex-shrink: 0; min-height: 48px;[^"]*line-height: 1\.25; text-align: center; overflow-wrap: anywhere">/);
  assert.match(css, /\.alpha-fit-grid\{[^}]*repeat\(auto-fill,[^}]*var\(--alpha-text-scale,1\)/);
  // Home's app grid is the shared mobile shell's: four columns of at least 62px times its text scale,
  // which Alpha maps to the measured text size.
  assert.match(read('.eliza/client-features/packages/ui/src/mobile-shell/MobileHomeScreen.tsx'), /\[data-mobile-shell-apps\]\{display:grid;grid-template-columns:repeat\(auto-fill,[^}]*var\(--mobile-shell-grid-columns,4\)[^}]*var\(--mobile-shell-grid-min,62px\) \* var\(--mobile-shell-text-scale,1\)/);
  assert.match(css, /\[data-alpha-layer="home"\] \{ --mobile-shell-text-scale:var\(--alpha-text-scale,1\); \}/);
  assert.match(read('apps/app/src/prototype/home-shell.ts'), /const gridProps: Bag = \{\s*'data-alpha-home-apps': ''/);
  // The Apps drawer's icon grid is four columns of at least 62px times the text scale too.
  assert.match(read('apps/app/src/prototype/apps-drawer.tsx'), /className="alpha-fit-grid" data-alpha-apps-grid="" style=\{\{'--fit-columns': 4, '--fit-min': '62px'/);
  assert.doesNotMatch(template, /data-alpha-home-(calendar|workflows|inbox)\b[^>]*height: 196px/);
  assert.match(read('apps/app/src/main.tsx'), /installTextScale\(\)/);
  assert.match(read('apps/app/src/runtime/text-scale.ts'), /font-size:100px;line-height:1/);
  // Search fields may shrink below the input's intrinsic width, so Close search stays on screen.
  for (const label of ['Search mail']) {
    const at = template.indexOf(`aria-label="${label}" placeholder`);
    assert.ok(at > 0, `${label} field is in the template`);
    const wrappers=[...template.slice(0,at).matchAll(/<(?:div|form)\b[^>]*style="flex-grow: 1;[^>]*>/g)];
    const wrapper=wrappers.at(-1)?.[0]||'';
    assert.match(wrapper, /style="flex-grow: 1; min-width: 0;/, `${label} wrapper can shrink`);
  }
  // Every menu or sheet over a scrim owns focus: the scrim is out of the tab order, the panel is
  // a named dialog, and both sit in a container bound to a focus-owning ref.
  const lines = template.split('\n');
  const retained = enabledViews();
  let scrims = 0;
  lines.forEach((line, index) => {
    const scrim = line.match(/^\s*<button[^>]*aria-label="Close[^"]*"[^>]*onClick="\{\{([a-z]+)\.[^"]*"[^>]*inset: ?0/);
    if (!scrim || !retained.includes(scrim[1])) return;
    scrims++;
    assert.match(line, /tabindex="-1"/, `scrim on line ${index + 1} is out of the tab order`);
    assert.match(lines[index - 1], /<div ref="\{\{[a-zA-Z.]+\}\}"/, `scrim on line ${index + 1} sits in a focus-owning container`);
    assert.match(lines[index + 1], /role="dialog"[^>]* aria-label="[^"]+"/, `panel on line ${index + 2} is a named dialog`);
  });
  // Notes sharing uses the common native dialog (share-panel.test.mjs), not a scrim popup.
  assert.ok(scrims >= 12, `the template still marks its remaining scrim popups (${scrims})`);
  const access = read('apps/app/src/prototype/subview-accessibility.ts');
  for (const ref of [...template.matchAll(/<div ref="\{\{([a-z]+)\.([a-zA-Z]+)\}\}" data-alpha-popup/g)])
    assert.match(access, new RegExp(`${ref[1]}:\\[[^\\n]*\\['${ref[2]}'`), `${ref[1]}.${ref[2]} is provided by subview-accessibility.ts`);
  // Settings re-releases its top page on every render; it must not release one a sheet holds.
  assert.match(read('apps/app/src/prototype/model.js'), /if \(!root\.querySelector\("\[data-alpha-popup\]"\)\) \{\s*current\.inert = false;/);
  // Toasts are announced: the live region is always present and its text arrives inside it,
  // and an inline modal does not retire it.
  assert.match(template, /<div data-alpha-toast aria-live="polite" aria-atomic="true"[^>]*>\n<sc-if value="\{\{toastOn\}\}">/);
  assert.match(read('apps/app/src/runtime/inline-modal.ts'), /!sibling\.matches\('\[data-alpha-toast\]'\)/);
  // The find bar is bound to its open flag, not to the always-present binding object.
  assert.ok(template.includes('<sc-if value="{{browser.finding}}">'));
  assert.ok(!template.includes('<sc-if value="{{browser.find}}">'));
  assert.ok(template.includes('onChange="{{browser.find.onInput}}"'));
});
