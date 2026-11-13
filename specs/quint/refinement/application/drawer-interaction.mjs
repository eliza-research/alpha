import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {checkTraces, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, root, trace} from './support.mjs';

const fixture = 'specs/quint/refinement/application/drawer-interaction-fixture.tsx';
const driver = fileURLToPath(import.meta.url);
const drawer = '.eliza/client-features/packages/ui/src/mobile-shell/InstalledAppsGridDrawer.tsx';
const replaceOnce = (input, old, next) => {
  assert.equal(input.split(old).length, 2, 'Exact Drawer observer or timer port seam');
  return input.replace(old, next);
};

export async function compileDrawerInteraction(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [fixture], bundle: true, platform: 'browser',
    format: 'iife', write: false, metafile: true, define: {'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}'},
    plugins: [{name: 'drawer-ownership-observer', setup(builder) {
      builder.onLoad({filter: /\/InstalledAppsGridDrawer\.tsx$/}, ({path}) => {
        let source = readFileSync(path, 'utf8');
        const marker = '    opened = useRef<string | null>(null);';
        source = replaceOnce(source, marker, marker +
          '\n  globalThis.quintDrawerPort.inspect = () => ({press:press.current,swallow:swallow.current,opened:opened.current});');
        source = replaceOnce(source, 'clearTimeout(press.current.timer)', 'globalThis.quintDrawerPort.clearTimeout(press.current.timer)');
        source = replaceOnce(source, 'timer: setTimeout(() => {', 'timer: globalThis.quintDrawerPort.setTimeout(() => {');
        return {contents: source, loader: 'tsx'};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), drawer, driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function observed(source) {
  return {...source, 's.inventory': qset(source['s.inventory']), 's.favorites': qset(source['s.favorites']), visible: qset(source.visible)};
}

const open = ['openDrawer'], hold = ['hold'], context = ['context', 1], oldTimeout = ['oldTimeout'];
const down = ['down', 1, 1], clockOnly = ['replaceInventory', [1]], mailOnly = ['replaceInventory', [2]];
const restore = ['replaceInventory', [1, 2]], close = ['closeDrawer'];
const cases = [
  ['secondary-down-move-release-do-not-retire-hold', [], [open, down, ['down', 2, 2],
    ['movePointer', 1, 2, true], ['release', 2], ['release', 2, true], hold]],
  ['owner-move-crossing-threshold-retires', [], [open, down, ['movePointer', 1, 1, false],
    ['movePointer', 1, 1, true], oldTimeout]],
  ['owner-up-before-timeout-retires', [], [open, down, ['release', 1], oldTimeout]],
  ['owner-cancel-before-timeout-retires', [], [open, down, ['release', 1, true], oldTimeout]],
  ['replacement-press-rejects-old-same-pointer-callback', [], [open, down, ['down', 2, 1], oldTimeout, hold]],
  ['pointer-release-click-is-suppressed-once', [], [open, down, hold, ['tap', 1], ['closeMenu'], ['tap', 1]]],
  ['closing-drawer-cleans-armed-timeout', [], [open, down, close, oldTimeout, open]],
  ['query-removes-owner-before-timeout', [], [open, down, ['search', 'mail'], oldTimeout, ['search', '']]],
  ['query-keeping-the-same-entry-keeps-hold', [], [open, down, ['search', 'clock'], hold]],
  ['removed-armed-entry-cannot-reopen-on-reinstall', [], [open, down, mailOnly, restore, oldTimeout]],
  ['removed-menu-cannot-reopen-on-reinstall', [], [open, context, mailOnly, restore, ['tap', 1]]],
  ['inventory-change-keeping-owner-keeps-menu', [], [open, context, clockOnly, ['closeMenu']]],
  ['escape-restores-menu-tile-then-closes-drawer', [], [open, context, ['escape'], ['escape']]],
  ['menu-keyboard-wrap-and-endpoints', [], [open, context, ['menuKey', 'ArrowDown'], ['menuKey', 'ArrowDown'],
    ['menuKey', 'End'], ['menuKey', 'ArrowUp'], ['menuKey', 'Home'], ['closeMenu']]],
  ['closing-menu-respects-focus-outside', [], [open, context, ['focusOutside'], ['closeMenu']]],
  ['closing-menu-respects-search-focus', [], [open, context, ['focusSearch'], ['closeMenu']]],
  ['search-closes-menu-without-stealing-focus', [], [open, context, ['search', 'mail'], ['search', 'missing'], ['search', '']]],
  ['add-home-returns-to-home-and-persists-choice', [], [open, context, ['addHome'], open, context, ['closeMenu']]],
  ['app-info-uses-exact-work-profile-and-restores-tile', [2], [open, ['context', 2], ['menuKey', 'ArrowDown'],
    ['appInfo'], ['infoReply', true]]],
  ['late-info-failure-after-drawer-close-is-reported', [], [open, ['context', 2], ['appInfo'], close, ['infoReply', false], open]],
  ['late-info-failure-leaves-new-menu-owned', [], [open, ['context', 2], ['appInfo'], context, ['infoReply', false], ['closeMenu']]],
  ['pending-info-after-target-removal-keeps-exact-dispatch', [2], [open, ['context', 2], ['appInfo'], clockOnly, ['infoReply', true]]],
];

export async function checkDrawerInteraction(extraSources = []) {
  const compiled = await compileDrawerInteraction(extraSources), traces = [], errors = [];
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 412, height: 915}});
    await page.route('**/*', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<button id="outside">Outside</button><div id="mount"></div>');
    await page.addScriptTag({content: compiled.code});
    for (const [name, favorites, steps] of cases) {
      const initial = await page.evaluate(initial => globalThis.quintDrawerFixture.reset(initial), favorites);
      const t = trace(name, observed(initial), call('initWith', qset(favorites)));
      for (const [operation, ...args] of steps) {
        const source = await page.evaluate(({operation, args}) => globalThis.quintDrawerFixture.step(operation, args), {operation, args});
        const modelArgs = operation === 'replaceInventory' ? [qset(args[0])] : operation === 'release' ? args.slice(0, 1) : args;
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...modelArgs), observed(source));
      }
      traces.push(t);
    }
    await page.evaluate(() => globalThis.quintDrawerFixture.close());
    assert.deepEqual(errors, [], 'Mounted Drawer has no browser errors');
  } finally {await browser.close();}
  return checkTraces(boundInputs({model: 'DrawerInteraction', sources: compiled.sources, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual Alpha installHomeShell adapter, shared launcher and React InstalledAppsGridDrawer mount in Chromium with a real DOM, controlled timers, and synthetic native and storage ports.',
    'Two installed component identities, one work profile, two pointer IDs, four query classes, and one outstanding App Info request form the bounded scope. The real React refs, visible entries, focus and owner selection are observed after committed effects.',
    'App Info completion is a controlled port outcome. The model includes replies after close/removal while the same Home owner lives. Actual platform navigation, overlapping requests, owner replacement and physical touch remain external.',
  ]}));
}
