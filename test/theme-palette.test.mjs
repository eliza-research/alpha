import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every colour of the prototype renderer comes from the product record (config/alpha-product.json):
// the theme tokens and aliases, and its palette of fixed product colours, all emitted as CSS custom
// properties by the shared shell's mobileShellThemeVariables. A new colour is added to the record's
// palette and referenced as var(--alpha-...); a hex literal in these files fails here.
const FILES = ['template.html', 'model.js', 'phone.css', 'scan-dialog.css'].map(name => `apps/app/src/prototype/${name}`);
const record = JSON.parse(readFileSync('config/alpha-product.json', 'utf8'));
const palette = record.theme.palette ?? {};
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

/** Comments may name issues (#416); only code and markup are checked. */
function code(file, source) {
  const blank = text => text.replace(/[^\n]/g, ' ');
  if (file.endsWith('.html')) return source.replace(/<!--[\s\S]*?-->/g, blank);
  let out = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (file.endsWith('.js')) out = out.replace(/(?<![:"'\\])\/\/[^\n]*/g, blank);
  return out;
}

test('the prototype files hold no hex colour literal', () => {
  const found = [];
  for (const file of FILES) {
    const source = code(file, readFileSync(file, 'utf8'));
    for (const match of source.matchAll(HEX)) found.push(`${file}:${source.slice(0, match.index).split('\n').length} ${match[0]}`);
  }
  assert.deepEqual(found, [], `Add the colour to theme.palette in config/alpha-product.json and use var(--alpha-...):\n${found.join('\n')}`);
});

test('every palette property the prototype uses is in the record, and every palette entry is used', () => {
  const used = new Set();
  for (const file of FILES) for (const match of readFileSync(file, 'utf8').matchAll(/var\((--alpha-[a-z0-9-]+)\)/g)) used.add(match[1]);
  // Non-CSS reads (a comparison with stored data) name the property through alphaPaletteColor.
  for (const match of readFileSync('apps/app/src/prototype/model.js', 'utf8').matchAll(/alphaPaletteColor\("(--alpha-[a-z0-9-]+)"\)/g)) used.add(match[1]);
  // Layout properties the renderer sets itself (--alpha-dock-width: ...) are not colours.
  const defined = new Set();
  for (const file of [...FILES, 'apps/app/src/runtime/dock-clearance.ts', 'apps/app/src/main.tsx'])
    for (const match of readFileSync(file, 'utf8').matchAll(/(--alpha-[a-z0-9-]+)['"]?\s*[:,]/g)) defined.add(match[1]);
  const missing = [...used].filter(name => !Object.hasOwn(palette, name) && !defined.has(name));
  assert.deepEqual(missing, [], 'used but not in theme.palette');
  const unused = Object.keys(palette).filter(name => !used.has(name));
  assert.deepEqual(unused, [], 'in theme.palette but used nowhere');
});

test('palette entries are colours under Alpha product property names', () => {
  for (const [name, value] of Object.entries(palette)) {
    assert.match(name, /^--alpha-[a-z0-9]+(?:-[a-z0-9]+)*$/, name);
    const values = typeof value === 'string' ? [value] : [value.light, value.dark];
    for (const color of values) assert.match(color, /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/, `${name}: ${color}`);
  }
});
