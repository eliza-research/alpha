// Bun imports TypeScript natively. This loads a module as a fresh instance per call, which is what
// callers relied on from tsx's tsImport(specifier, parent).
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';

let sequence = 0;
export async function tsImport(specifier, parent) {
  const parentUrl = typeof parent === 'string' ? parent : parent?.parentURL;
  if (!parentUrl) throw new TypeError('tsImport needs the importing module URL');
  const bare = !/^(?:\.{1,2}\/|\/|file:)/.test(specifier) && !isAbsolute(specifier);
  if (bare) return import(specifier);
  const url = isAbsolute(specifier) ? pathToFileURL(specifier) : new URL(specifier, parentUrl);
  // A path specifier, not url.href: Bun returns the cached module for a file: URL that differs
  // only in its query, and a fresh instance for a path with a query.
  return import(`${fileURLToPath(url)}?ts-import=${++sequence}`);
}
