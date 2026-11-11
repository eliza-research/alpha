// Bun runs TypeScript itself but has no API that returns stripped source text. Amaro is the
// position-preserving stripper Node ships as module.stripTypeScriptTypes; like Node's, it refuses
// TypeScript that needs a transform (parameter properties, enums, namespaces). Those sources are
// transformed by esbuild instead.
import {transformSync as strip} from 'amaro';
import {transformSync} from 'esbuild';

/** Strict erasable-syntax strip: throws on TypeScript that needs a transform. */
export function stripErasableTypes(source) {
  return strip(source, {mode: 'strip-only'}).code;
}

export function stripTypeScriptTypes(source, options = {}) {
  let code;
  try { code = stripErasableTypes(source); }
  catch (error) {
    if (error?.code !== 'UnsupportedSyntax') throw error;
    code = transformSync(source, {loader: 'ts', target: 'esnext', tsconfigRaw: {compilerOptions: {verbatimModuleSyntax: true}}}).code;
  }
  return options.sourceUrl ? `${code}\n\n//# sourceURL=${options.sourceUrl}` : code;
}
