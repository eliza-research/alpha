// Node 26 type stripping removes types only; it refuses TypeScript that needs a transform
// (parameter properties, enums, namespaces). Those sources are transformed by esbuild instead,
// the same compiler tsx uses. Everything else keeps Node's own position-preserving strip.
import {stripTypeScriptTypes as strip} from 'node:module';
import {transformSync} from 'esbuild';
export function stripTypeScriptTypes(source, options = {}) {
  try { return strip(source, {...options, mode: 'strip'}); }
  catch (error) {
    if (error?.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') throw error;
    return transformSync(source, {loader: 'ts', target: 'esnext', tsconfigRaw: {compilerOptions: {verbatimModuleSyntax: true}}}).code;
  }
}
