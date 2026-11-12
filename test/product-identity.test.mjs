// Source-level product identity and storage namespace (AP-01). This reads committed source only;
// built-APK identity is checked by scripts/apk.ts and is separate evidence.
import {ALPHA_PRODUCT_REGISTRATION as record} from '../apps/app/src/product/alpha-product-registration.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {tsImport} from './support/ts-import.mjs';
import ts from 'typescript-ast';

const identity = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(file, out);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)) out.push(file);
  }
  return out;
}

const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem']);
const PREFIXES = ['alpha.', 'alphaphone:'];
const FOREIGN = /milady|eliza:|senior/i;

/** Literal localStorage keys under a source tree: direct string arguments and the string constants passed by name. */
function literalStorageKeys(root) {
  const files = sources(root);
  const program = ts.createProgram(files, {allowJs: true, jsx: ts.JsxEmit.Preserve, noLib: true, noResolve: true, types: []});
  const checker = program.getTypeChecker();
  const keys = [];
  function prefix(expression, visited = new Set()) {
    if (!expression || visited.has(expression)) return;
    visited.add(expression);
    if (ts.isStringLiteralLike(expression) || ts.isTemplateExpression(expression)) {
      const key = ts.isStringLiteralLike(expression) ? expression.text : expression.head.text;
      return {file: expression.getSourceFile().fileName, key};
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return prefix(expression.left, visited);
    if (ts.isIdentifier(expression)) {
      let symbol = checker.getSymbolAtLocation(expression);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration)) return prefix(declaration.initializer, visited);
    }
  }
  for (const file of files) {
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && STORAGE_METHODS.has(node.expression.name.text)) {
        const key = prefix(node.arguments[0]);
        if (key) keys.push(key);
      }
      ts.forEachChild(node, visit);
    }
    visit(program.getSourceFile(file));
  }
  return keys;
}

test('app.config.json carries the Alpha Compute package identity', () => {
  assert.equal(identity.appId, 'ai.alphacompute.alphaphone');
  assert.equal(identity.appName, 'Alpha Phone');
});

test('every literal localStorage key under apps/app/src uses an Alpha prefix', () => {
  const keys = literalStorageKeys('apps/app/src');
  assert.ok(keys.length >= 20, `found only ${keys.length} keys; the scan no longer sees the storage calls`);
  for (const {file, key} of keys) {
    // Preserve the original durable Alpha onboarding key; renaming would lose completed installs.
    const historicalSetup = file === 'apps/app/src/startup-permission-progress.ts' && key === 'alpha:startup-permission-walkthrough:v1'
      || file === 'apps/app/src/startup-permissions.tsx' && ['alpha:startup-permission-progress:v1','alpha:startup-permissions-dismissed:v1'].includes(key);
    assert.ok(historicalSetup || PREFIXES.some(prefix => key.startsWith(prefix)), `${file}: ${JSON.stringify(key)} lacks an alpha. or alphaphone: prefix`);
    assert.doesNotMatch(key, FOREIGN, `${file}: ${JSON.stringify(key)} uses another product's prefix`);
  }
});

test('the key scan would catch an unprefixed or foreign key', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-identity-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'a.ts'), "const k='milady.theme';localStorage.getItem(k);localStorage.setItem('eliza:x','1');localStorage.getItem(`alpha.dev.${n}`);");
  assert.deepEqual(literalStorageKeys(dir).map(row => row.key).sort(), ['alpha.dev.', 'eliza:x', 'milady.theme']);
});

// Alpha is one registered product of the shared mobile shell (apps/app/src/product/alpha-product-registration.ts). The
// record is the product's identity, theme and installed-data compatibility input; the checks below
// keep it equal to what the build and the renderer actually use.
test('the product record validates and carries the same identity as app.config.json', async () => {
  const {validateMobileProductRegistration} = await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/product-registration.ts', import.meta.url);
  assert.deepEqual(validateMobileProductRegistration(record), []);
  assert.equal(record.identity.appId, identity.appId);
  assert.equal(record.identity.appName, identity.appName);
  // Installed-data compatibility: the favorites record, its product-view prefix and the
  // default-favorites policy every existing install wrote.
  assert.equal(record.storage.launcherFavorites, 'alpha.launcher.favorites.v1');
  assert.equal(record.storage.launcherBuiltinPrefix, 'alpha:');
  assert.equal(record.storage.launcherDefaultPolicy, 'alpha-apps');
  assert.doesNotMatch(JSON.stringify(record.storage), FOREIGN);
});
