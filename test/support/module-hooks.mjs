// node:module registerHooks({resolve, load}) for Bun, which has no such API. The hooks are
// adapted onto a Bun runtime plugin; deregister() makes the plugin pass everything through.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const loaders = {'.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.json': 'json', '.mjs': 'js', '.cjs': 'js', '.js': 'js'};
const toUrl = value => /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : pathToFileURL(value).href;
const splitQuery = value => { const at = value.search(/[?#]/); return at < 0 ? [value, ''] : [value.slice(0, at), value.slice(at)]; };

export function registerHooks(hooks) {
  let active = true;
  // Bun.resolveSync runs the plugin again; the inner pass must reach Bun's own resolver.
  let resolving = false;
  const namespace = `module-hooks-${Math.random().toString(36).slice(2)}`;
  const sources = new Map();
  // Bun 1.4.2 calls a runtime onResolve only for specifiers that carry a file extension: a bare
  // package ('@scope/name') or an extensionless path ('./module') never reaches it. Those are
  // resolved here instead, when the importing file is loaded, by rewriting the specifier in its source.
  const redirected = new Set();
  const delegate = (specifier, parentURL) => {
    const fallback = (name = specifier, context = {parentURL}) => {
      if (/^(?:node|bun|data):/.test(name)) return {url: name};
      const [bare, query] = splitQuery(name);
      const from = context?.parentURL?.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
      resolving = true;
      try { return {url: pathToFileURL(Bun.resolveSync(bare.startsWith('file:') ? fileURLToPath(bare) : bare, from)).href + query}; }
      finally { resolving = false; }
    };
    let passed;
    const result = hooks.resolve(specifier, {parentURL, conditions: ['import', 'node'], importAttributes: {}}, (...rest) => passed = fallback(...rest));
    return !result?.url || result === passed ? undefined : result.url;
  };
  // Bun does not evaluate a percent-encoded data: module from a rewritten specifier, so its text is
  // written once to a private temporary file and that file is imported instead.
  const materialized = new Map();
  const materialize = url => {
    if (!materialized.has(url)) {
      const comma = url.indexOf(',');
      const meta = url.slice(5, comma), body = url.slice(comma + 1);
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'module-hooks-')), 'module.mjs');
      fs.writeFileSync(file, /;base64$/.test(meta) ? Buffer.from(body, 'base64') : decodeURIComponent(body), {mode: 0o600});
      process.once('exit', () => fs.rmSync(path.dirname(file), {recursive: true, force: true}));
      materialized.set(url, file);
    }
    return materialized.get(url);
  };
  const scriptLoaders = new Set(['js', 'jsx', 'ts', 'tsx']);
  const rewriteImports = (contents, loader, file) => {
    if (!active || !hooks.resolve || !scriptLoaders.has(loader)) return contents;
    let imports;
    // scanImports rejects a leading '#!' line, which a launcher script carries.
    try { imports = new Bun.Transpiler({loader}).scanImports(contents.replace(/^#!/, '//')); } catch { return contents; }
    const parentURL = pathToFileURL(file).href;
    for (const specifier of new Set(imports.map(entry => entry.path))) {
      // A relative or absolute path with an extension reaches onResolve itself.
      if (/^data:/.test(specifier) || (/^(?:\.{1,2}\/|\/|file:)/.test(specifier) && path.extname(splitQuery(specifier)[0]))) continue;
      let url;
      try { url = delegate(specifier, parentURL); } catch { continue; }
      if (!url) continue;
      const target = url.startsWith('file:') ? fileURLToPath(url) + splitQuery(url)[1] : url.startsWith('data:') ? materialize(url) : url;
      redirected.add(target);
      const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      contents = contents.replace(new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)(['"])${quoted}\\2`, 'g'), (_, lead) => lead + JSON.stringify(target));
    }
    return contents;
  };
  const disk = file => { const loader = loaders[path.extname(file)] ?? 'js'; return {contents: rewriteImports(fs.readFileSync(file, 'utf8'), loader, file), loader}; };
  Bun.plugin({
    name: namespace,
    setup(build) {
      if (hooks.resolve) build.onResolve({filter: /.*/}, args => {
        if (!active || resolving || args.namespace === namespace || redirected.has(args.path)) return undefined;
        const parentURL = args.importer ? toUrl(args.importer) : undefined;
        const fallback = (specifier = args.path, context = {parentURL}) => {
          if (/^(?:node|bun):/.test(specifier)) return {url: specifier};
          const [bare, query] = splitQuery(specifier);
          const from = context?.parentURL?.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
          const target = bare.startsWith('file:') ? fileURLToPath(bare) : bare;
          resolving = true;
          try { return {url: pathToFileURL(Bun.resolveSync(target, from)).href + query}; }
          finally { resolving = false; }
        };
        // A hook that only delegates gets Bun's own resolution, untouched.
        let passed;
        const result = hooks.resolve(args.path, {parentURL, conditions: ['import', 'node'], importAttributes: {}}, (...rest) => passed = fallback(...rest));
        if (!result?.url || result === passed) return undefined;
        if (/^(?:node|bun):/.test(result.url)) return {path: result.url.replace(/^(?:node|bun):/, ''), namespace: result.url.split(':')[0]};
        if (result.url.startsWith('data:')) { sources.set(result.url, result.url); return {path: result.url, namespace}; }
        return {path: result.url.startsWith('file:') ? fileURLToPath(result.url) + splitQuery(result.url)[1] : result.url};
      });
      // Installed packages keep Bun's own loading (CommonJS named exports); specifiers inside them are not rewritten.
      if (hooks.resolve && !hooks.load) build.onLoad({filter: /^(?!.*[\\/]node_modules[\\/]).*\.(?:[cm]?[jt]s|[jt]sx)(?:[?#].*)?$/, namespace: 'file'}, args => disk(splitQuery(args.path)[0]));
      if (hooks.load) build.onLoad({filter: /.*/, namespace: 'file'}, args => {
        const [file] = splitQuery(args.path);
        if (!active) return {contents: fs.readFileSync(file, 'utf8'), loader: loaders[path.extname(file)] ?? 'js'};
        const url = pathToFileURL(file).href;
        let passed;
        const result = hooks.load(url, {format: undefined, conditions: ['import', 'node'], importAttributes: {}}, () => passed = {format: 'module', source: fs.readFileSync(file)});
        // Bun requires an object from onLoad: an untouched file is returned as it is on disk.
        if (!result || result === passed || result.source === undefined) return disk(file);
        const loader = result.format === 'json' ? 'json' : result.format === 'commonjs' || result.format === 'module' ? 'js' : loaders[path.extname(file)] ?? 'js';
        return {contents: rewriteImports(typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8'), loader, file), loader};
      });
      build.onLoad({filter: /.*/, namespace}, args => {
        const comma = args.path.indexOf(',');
        const meta = args.path.slice(5, comma), body = args.path.slice(comma + 1);
        return {contents: /;base64$/.test(meta) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body), loader: 'js'};
      });
    },
  });
  return {deregister() { active = false; }};
}
