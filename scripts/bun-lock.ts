/**
 * Reads bun.lock (Bun's text lockfile) as the flat, installed-path view the licence and SBOM
 * inventories consume: one entry per installed package directory, with its registry integrity
 * and whether only development or optional edges reach it from the root manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';

export const LOCKFILE = 'bun.lock';

export interface LockedPackage {
  name?: string;
  version: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  link?: boolean;
}
export interface PackageLock {
  packages?: Record<string, LockedPackage>;
}
interface BunManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalPeers?: string[];
}
interface BunLock {
  lockfileVersion: number;
  workspaces: Record<string, BunManifest>;
  packages: Record<string, [string, string?, BunManifest?, string?]>;
}

/** "a/@s/b" names package @s/b nested under a: node_modules/a/node_modules/@s/b. */
function segments(key: string) {
  const parts = key.split('/');
  const out: string[] = [];
  for (let index = 0; index < parts.length; index++) out.push(parts[index].startsWith('@') ? `${parts[index]}/${parts[++index]}` : parts[index]);
  return out;
}
const installedPath = (key: string) => segments(key).map(name => `node_modules/${name}`).join('/');

export function parseBunLock(text: string): PackageLock {
  const lock = JSON5.parse(text) as BunLock;
  if (!lock || typeof lock !== 'object' || !lock.packages || !lock.workspaces?.['']) throw new Error(`${LOCKFILE} is not a Bun text lockfile`);
  const keys = new Set(Object.keys(lock.packages));
  // Node resolution: the nearest enclosing node_modules that holds the name.
  const resolve = (from: string, name: string) => {
    const chain = from ? segments(from) : [];
    for (let depth = chain.length; depth >= 0; depth--) {
      const candidate = [...chain.slice(0, depth), name].join('/');
      if (keys.has(candidate)) return candidate;
    }
    return undefined;
  };
  const reach = (roots: string[], optionalEdges: boolean) => {
    const seen = new Set<string>();
    const queue = roots.map(name => resolve('', name)).filter((key): key is string => !!key);
    while (queue.length) {
      const key = queue.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const manifest = lock.packages[key][2] ?? {};
      const optionalPeers = new Set(manifest.optionalPeers ?? []);
      const names = [...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}).filter(name => optionalEdges || !optionalPeers.has(name)),
        ...(optionalEdges ? Object.keys(manifest.optionalDependencies ?? {}) : [])];
      for (const name of names) { const next = resolve(key, name); if (next) queue.push(next); }
    }
    return seen;
  };
  const root = lock.workspaces[''];
  const required = reach(Object.keys(root.dependencies ?? {}), false);
  const withOptional = reach([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.optionalDependencies ?? {})], true);
  const packages: Record<string, LockedPackage> = {};
  for (const [key, [identity, registry, , integrity]] of Object.entries(lock.packages)) {
    const at = identity.lastIndexOf('@');
    const name = identity.slice(0, at), version = identity.slice(at + 1);
    const link = /^(?:workspace|link|file):/.test(version);
    packages[installedPath(key)] = {
      name, version, integrity: integrity || undefined, link: link || undefined,
      resolved: link ? undefined : `${registry || 'https://registry.npmjs.org/'}${name}/-/${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`,
      dev: !withOptional.has(key) || undefined,
      optional: (withOptional.has(key) && !required.has(key)) || undefined,
    };
  }
  return {packages};
}

/** The lock, with each installed package's declared licence when node_modules is present. */
export function readBunLock(root: string): PackageLock {
  const lock = parseBunLock(fs.readFileSync(path.join(root, LOCKFILE), 'utf8'));
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    try {
      const license = JSON.parse(fs.readFileSync(path.join(root, key, 'package.json'), 'utf8')).license;
      if (typeof license === 'string') meta.license = license;
    } catch { /* not installed: the caller reports a missing manifest where it needs one */ }
  }
  return lock;
}
