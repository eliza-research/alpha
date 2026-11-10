import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from '../../test/support/strip-types.mjs';

/** Evaluate a product prototype module with explicit VM bindings and exports. */
export async function prototypeScript(file: string, exported: string | readonly string[]): Promise<string> {
  const source = await readFile(new URL(`../../apps/app/src/prototype/${file}`, import.meta.url), 'utf8');
  const inline = source.replace(/^import .*;\n/gm, '')
    .replace(/^export (?=(?:async )?function |const |let |interface |type )/gm, '');
  const names = typeof exported === 'string' ? [exported] : exported;
  const bindings = names.map(name => `globalThis.${name}=${name};`).join('');
  return '{' + stripTypeScriptTypes(inline + '\n' + bindings, {mode: 'strip'}) + '}';
}
