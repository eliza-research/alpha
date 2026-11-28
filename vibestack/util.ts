import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { isExcludedSpecPath, loadConfig, type ResolvedVibestackConfig } from "./config.ts";
import { formatStamp, writeWhole } from "./run.ts";
import { evaluatorIdentity } from "./installed.ts";
import { heading, type Spec } from "./parse.ts";
import type { Result } from "./pipeline.ts";
import { profile, type TestProfile } from "./testing/profile.ts";

export { writeWhole };

let tsModule: typeof TS | undefined;
/** Load TypeScript lazily so commands that never touch it skip its startup cost. */
export const tsApi = (): typeof TS => (tsModule ??= createRequire(import.meta.url)("typescript") as typeof TS);

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
/** A hash of several texts, in which no two lists of texts give the same input. */
export const sha = (...parts: string[]) => digest(JSON.stringify(parts));
export const short = (text: string) => digest(text).slice(0, 12);
export const indent = (s: string, by = 6) => s.split("\n").map((l) => " ".repeat(by) + l).join("\n");
/** What each promise gives, once every one has finished: a failure is thrown only then, so that nothing is left running. */
export function allDone<const T extends readonly unknown[]>(promises: T): Promise<{ -readonly [I in keyof T]: Awaited<T[I]> }>;
export async function allDone(promises: readonly unknown[]): Promise<unknown[]> {
  const settled = await Promise.allSettled(promises);
  return settled.map((r) => {
    if (r.status === "rejected") throw r.reason;
    return r.value;
  });
}

/** Files and symbolic links below a project directory, excluding directory entries. */
export const filesUnder = (root: string, dir: string) => !fs.existsSync(path.join(root, dir)) ? []
  : fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() || e.isSymbolicLink())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/")).sort();

const sidecarSource = /^(.*?)(?:\.vibex?\.[^./]+\.d\.ts|\.d\.vibex?\.tsx?|\.d\.ts)$/;

const FILE_DIGEST_CACHE_LIMIT = 16_384;
const fileDigestCache = new Map<string, { stamp: string; sha: string; genImport?: boolean }>();

function statEntry(file: string): { stamp: string; sha: string; genImport?: boolean } | undefined {
  const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  if (!stat) return undefined;
  const at = formatStamp(stat);
  const cached = fileDigestCache.get(file);
  if (cached && cached.stamp === at) return cached;
  const bytes = fs.readFileSync(file);
  const entry = { stamp: at, sha: createHash("sha256").update(bytes).digest("hex") };
  if (!fileDigestCache.has(file) && fileDigestCache.size >= FILE_DIGEST_CACHE_LIMIT) {
    fileDigestCache.clear();
  }
  fileDigestCache.set(file, entry);
  return entry;
}

/** SHA-256 hex digest of a file, cached in memory while its stat stamp (dev, ino, size, mtimeNs, ctimeNs) is unchanged. */
export function fileDigest(file: string): string {
  const entry = statEntry(file);
  if (!entry) throw new Error(`ENOENT: no such file or directory, open '${file}'`);
  return entry.sha;
}

/** SHA-256 hex digest of a file if it exists, or "" if absent. */
export function fileDigestIfExists(file: string): string {
  return statEntry(file)?.sha ?? "";
}

export function pruneSidecars(dir: string) {
  const configFile = path.join(dir, "tsconfig.json");
  let config: Record<string, any> | undefined;
  let parsedJson = false;
  try {
    config = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, any>;
    parsedJson = true;
  } catch {
    config = tsApi().readConfigFile(configFile, tsApi().sys.readFile).config;
  }
  const sidecarDir = config?.vibe?.sidecarDir;
  if (typeof sidecarDir !== "string") return;
  const sidecars = path.resolve(dir, sidecarDir);
  if (!fs.existsSync(sidecars)) return;
  const existing = filesUnder(sidecars, "");
  if (!existing.length) return;
  const rawRootDirs: unknown = config?.compilerOptions?.rootDirs;
  let rootDirs: string[];
  if (Array.isArray(rawRootDirs) && rawRootDirs.every((entry): entry is string => typeof entry === "string" && !entry.includes("${configDir}"))) {
    rootDirs = rawRootDirs.map((entry) => path.resolve(dir, entry));
  } else if (parsedJson && !config?.extends) {
    return;
  } else {
    const ts = tsApi();
    const host: TS.ParseConfigHost = { ...ts.sys, readDirectory: () => [] };
    rootDirs = ts.parseJsonConfigFileContent(config, host, dir).options.rootDirs ?? [];
  }
  for (const mirror of rootDirs) {
    const within = path.relative(sidecars, mirror);
    if (within.startsWith("..") || path.isAbsolute(within)) continue;
    const base = path.resolve(dir, ...within.split(path.sep).filter(Boolean).map(() => ".."));
    for (const file of existing) {
      const stem = sidecarSource.exec(file)?.[1];
      if (stem && ![".vibe", ".vibex"].some((ext) => fs.existsSync(path.join(base, stem + ext)))) fs.rmSync(path.join(sidecars, file), { force: true });
    }
  }
}

export interface WatchedPath {
  path: string;
  shallow: boolean;
}

export interface ConfiguredSnapshot {
  files: string[];
  safeSkip: boolean;
  watched: WatchedPath[];
}

export function watchStamp(target: string, shallow = false): string {
  const stat = fs.lstatSync(target, { bigint: true, throwIfNoEntry: false });
  if (!stat) return "";
  if (!stat.isDirectory()) return `${stat.isSymbolicLink() ? "l" : "f"}:${formatStamp(stat)}`;
  const entries: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      if (!shallow) entries.push(`${entry.name}:d`);
    } else if (entry.isSymbolicLink()) {
      const linked = fs.statSync(path.join(target, entry.name), { throwIfNoEntry: false });
      entries.push(`${entry.name}:${linked?.isDirectory() ? "ld" : linked?.isFile() ? "lf" : "lo"}`);
    } else {
      entries.push(`${entry.name}:f`);
    }
  }
  entries.sort();
  return `d:${digest(entries.join("\0"))}`;
}

/** What a package's tsconfig.json names: itself, the configurations it extends and the files it includes, VibeLang's among them, plus the paths whose stat stamps guard skipping `tsconfig` parsing on warm checks. */
export function configuredSnapshot(dir: string): ConfiguredSnapshot {
  const ts = tsApi();
  const at = fs.realpathSync(path.resolve(dir));
  const config = path.join(at, "tsconfig.json");
  const source = ts.readJsonConfigFile(config, ts.sys.readFile);
  const readDirCalls: { rootDir: string; includes?: readonly string[] }[] = [];
  const absentProbes = new Set<string>();
  const host: TS.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readFile: (file) => ts.sys.readFile(file),
    fileExists(file) {
      const exists = ts.sys.fileExists(file);
      if (!exists) absentProbes.add(path.resolve(file));
      return exists;
    },
    readDirectory(rootDir, extensions, excludes, includes, depth) {
      readDirCalls.push({ rootDir: path.resolve(rootDir), includes });
      return ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth);
    },
  };
  const { fileNames } = ts.parseJsonSourceFileConfigFileContent(source, host, path.dirname(config), undefined, config, undefined,
    [".vibe", ".vibex"].map((extension) => ({ extension, isMixedContent: false, scriptKind: ts.ScriptKind.Deferred })));
  const files = [config, ...source.extendedSourceFiles ?? [], ...fileNames];
  const watched = new Map<string, boolean>();
  for (const probe of absentProbes) watched.set(probe, false);
  const watchPath = (target: string, shallow: boolean) => {
    const existing = watched.get(target);
    if (existing === undefined || (existing && !shallow)) watched.set(target, shallow);
  };
  const MAX_WATCHED = 256;
  const addTree = (target: string, recursive: boolean): boolean => {
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat) {
      watchPath(target, false);
      return watched.size <= MAX_WATCHED;
    }
    if (stat.isSymbolicLink() || fs.realpathSync(target) !== target) return false;
    if (stat.isFile()) {
      watchPath(target, false);
      return watched.size <= MAX_WATCHED;
    }
    if (!stat.isDirectory()) return false;
    if (!recursive) {
      watchPath(target, true);
      return watched.size <= MAX_WATCHED;
    }
    const queue = [target];
    watchPath(target, false);
    while (queue.length) {
      if (watched.size > MAX_WATCHED) return false;
      const cur = queue.pop()!;
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(cur, entry.name);
        if (entry.isSymbolicLink()) {
          const targetStat = fs.statSync(full, { throwIfNoEntry: false });
          if (!targetStat || targetStat.isDirectory()) return false;
        } else if (entry.isDirectory()) {
          if (watched.get(full) !== false) {
            watchPath(full, false);
            queue.push(full);
          }
        }
      }
    }
    return watched.size <= MAX_WATCHED;
  };
  let safeSkip = true;
  for (const call of readDirCalls) {
    if (!call.includes || !call.includes.length) {
      safeSkip = false;
      break;
    }
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(call.rootDir);
    } catch {
      safeSkip = false;
      break;
    }
    for (const raw of call.includes) {
      if (path.isAbsolute(raw)) {
        safeSkip = false;
        break;
      }
      const segs = raw.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
      if (!segs.length) {
        safeSkip = false;
        break;
      }
      const wildIdx = segs.findIndex((s) => s.includes("*") || s.includes("?"));
      const prefix = wildIdx === -1 ? segs : segs.slice(0, wildIdx);
      let sawNonParent = false;
      let hasNestedParent = false;
      for (const seg of prefix) {
        if (seg === "..") {
          if (sawNonParent) { hasNestedParent = true; break; }
        } else sawNonParent = true;
      }
      if (hasNestedParent) {
        safeSkip = false;
        break;
      }
      if (wildIdx === -1) {
        const target = path.resolve(realRoot, ...prefix);
        if (target === at || at.startsWith(target + path.sep) || !addTree(target, true)) {
          safeSkip = false;
          break;
        }
      } else {
        const rest = segs.slice(wildIdx);
        const recursive = rest.length > 1 || rest[0].includes("**");
        const base = prefix.length ? path.resolve(realRoot, ...prefix) : realRoot;
        if ((recursive && (base === at || at.startsWith(base + path.sep))) || !addTree(base, recursive)) {
          safeSkip = false;
          break;
        }
      }
    }
    if (!safeSkip) break;
  }
  const watchedList = safeSkip
    ? [...watched.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([watchedPath, shallow]) => ({ path: watchedPath, shallow }))
    : [];
  return { files, safeSkip, watched: watchedList };
}

/** Resolve a project folder before a command reads or writes its files. */
export function projectRoot(directory: string, base = process.cwd()): string {
  const root = path.resolve(base, directory);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory())
    throw new Error(`${directory}: not an existing project directory`);
  return fs.realpathSync(root);
}

/** The declarations the VibeLang compiler writes for a `.vibe` module: its output, not the package's code. */
const SIDECAR = /\.d\.vibex?\.ts$/;

function specOwnerPathsFrom(declared: Readonly<Record<string, string>>, name: string): string[] {
  const conventional = [`apps/${name}`, `packages/${name}`];
  const entries = Object.entries(declared);
  if (!entries.length) return conventional;
  const claimed = new Set<string>();
  let match: string | undefined;
  for (const [area, dir] of entries) {
    claimed.add(dir);
    if (area === name) match = dir;
  }
  return match ? [match] : conventional.filter((dir) => !claimed.has(dir));
}

/** The directories a spec area may map to: an entry in `vibestack.json` `spec.owners` or `package.json` `specOwners`, or conventional `apps/<name>` and `packages/<name>`. */
export function specOwnerPaths(root: string, name: string): string[] {
  return specOwnerPathsFrom(loadConfig(root).spec.owners, name);
}

function ownerFrom(root: string, spec: string, specConfig: ResolvedVibestackConfig["spec"], observe?: (file: string) => void): string | undefined {
  const prefix = `${specConfig.dir}/`;
  if (!spec.startsWith(prefix)) return undefined;
  const rest = spec.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;
  const name = rest.slice(0, slash);
  if (isExcludedSpecPath(`${specConfig.dir}/${name}`, specConfig)) return undefined;
  observe?.(path.join(root, "package.json"));
  observe?.(path.join(root, "vibestack.json"));
  const exists = observe ? (file: string) => { observe(file); return fs.existsSync(file); } : fs.existsSync;
  return specOwnerPathsFrom(specConfig.owners, name).find((dir) => exists(path.join(root, dir, "package.json")) && !exists(path.join(root, dir, specConfig.dir)));
}

/**
 * The workspace package a spec belongs to by name, as a path from the root: `<specDir>/<name>/…` is `apps/<name>` or
 * `packages/<name>`, if that is a package with no `<specDir>/` of its own. The root's check generates into its `gen/` and
 * checks its code (SPEC.md, "One spec tree").
 */
export function owner(root: string, spec: string, observe?: (file: string) => void): string | undefined {
  return ownerFrom(root, spec, loadConfig(root).spec, observe);
}
/**
 * The directories whose code a check reads, each as the prefix of a path from the root: "" for the root's own
 * `src/` and `test/`, then `apps/app/` for each package that owns a directory of the spec tree.
 */
export const codeDirs = (root: string): string[] => {
  const { spec: specConfig } = loadConfig(root);
  const specRoot = path.join(root, specConfig.dir);
  return ["", ...!fs.existsSync(specRoot) ? []
    : [...new Set(fs.readdirSync(specRoot)
      .filter((name) => !isExcludedSpecPath(`${specConfig.dir}/${name}`, specConfig))
      .flatMap((name) => ownerFrom(root, `${specConfig.dir}/${name}/`, specConfig) ?? []))].sort().map((dir) => `${dir}/`)];
};
/** Which of `codeDirs` a path from the root is in: the root holds no `apps/` or `packages/` code of its own. */
export const codeDirOf = (file: string): string => file.match(/^(?:(?:apps|packages)\/[^/]+\/)?/)![0];

/** A file with `//@` under a `src/` the check reads; `file` is its path from the root (`src/x.ts`, `apps/app/src/x.ts`). */
export interface SrcFile { file: string; code: string; ts: boolean }
/** Every such file, read once: a check proves and reviews the same text, even if a file changes while it runs. */
export function readSrc(root: string): SrcFile[] {
  const files = codeDirs(root).flatMap((dir) => filesUnder(root, `${dir}src`)).filter((f) => /\.(?:[mc]?ts|tsx|[mc]?jsx?|vibex?)$/.test(f) && !SIDECAR.test(f));
  return files.map((f) => ({ file: f, code: fs.readFileSync(path.join(root, f), "utf8"), ts: /\.ts$/.test(f) })).filter((u) => u.code.includes("//@"));
}

/** One result as `report` in spec.ts takes it. */
export type Reported<S extends Result["stage"] = Result["stage"]> = [ok: boolean, stage: S, summary: string, detail?: string, where?: string];

/** A directory's package.json, or nothing; one that is not JSON is refused with its path. */
/** A package's package.json, or nothing where it has none. */
export function manifest(dir: string) {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
}
/** A package's scripts. */
export const packageScripts = (root: string): Record<string, string> => manifest(root).scripts ?? {};

/** The script that runs the package's app, for Studio's preview and the explore stage: `start`, or `dev` when that is not the studio. */
export function appScript(root: string): "start" | "dev" | undefined {
  const scripts = packageScripts(root);
  return scripts.start ? "start" : scripts.dev && !/\bspec(\.ts)? studio\b/.test(scripts.dev) ? "dev" : undefined;
}

/** A terminal colour code, which development servers print around their address. */
export const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
/** The address a development server says it serves at, in a line it printed. @throws {never} */
export const servedAt = (line: string) => line.replace(COLOUR, "").match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+[^\s]*/)?.[0];

/** `run()`, or what it returned the last time for the same fingerprint, if `keep` kept it then (cache.ts). */
export type Remember = <T>(fingerprint: string, run: () => Promise<T>, keep: (result: T) => boolean) => Promise<T>;

/**
 * What a fingerprint covers: what a package's tests read, or what its typecheck may read, its scripts and JSON but the
 * traces and counterexamples. What its page reads is explore.ts's `pageInputs`.
 */
export type Inputs = "tests" | "types";

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const prosePatterns = new Map<string, RegExp>();
/** What no test reads: a spec's prose and its Quint copy, and the prose `spec init` and these tools keep for people and agents at a package's top. */
const prosePattern = (specDir: string) => {
  let pattern = prosePatterns.get(specDir);
  if (!pattern) {
    pattern = new RegExp(`^${escapeRegex(specDir)}/.*\\.md$|^gen/[^/]*\\.qnt$|^(?:README|AGENTS|CLAUDE|CONTRIBUTING|SPEC)\\.md$`);
    prosePatterns.set(specDir, pattern);
  }
  return pattern;
};

/** A package and the workspace packages it depends on, and theirs, each once: by its real directory and the name it is depended on by. */
export function workspacePackages(root: string): { directory: string; name: string }[] {
  const found = new Map<string, string>();
  const pending = [{ directory: root, name: "." }];
  for (const { directory, name } of pending) {
    const from = fs.realpathSync(directory);
    if (found.has(from)) continue;
    found.set(from, name);
    const pkg = manifest(from);
    for (const [dependency, version] of Object.entries({ ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies, ...pkg.optionalDependencies }).sort(([a], [b]) => a.localeCompare(b))) {
      const at = path.join(from, "node_modules", dependency);
      if (String(version).startsWith("workspace:") && fs.existsSync(at)) pending.push({ directory: at, name: dependency });
    }
  }
  return [...found].map(([directory, name]) => ({ directory, name }));
}

/**
 * A fingerprint of what a package's tests or its typecheck read: its files but `PROSE` and the simulations' traces, and
 * the top of its gen/ (an owner's is mirrored from the root's), the fixtures nested under its test/, the workspace packages it depends on, the lock file
 * and the fuzzing budget. Of a workspace package depended on, only what a dependent can load: not its spec/, Markdown
 * outside fixtures/, tests, drivers, traces or counterexamples, nor the packages nested in it, nor its gen/ unless its
 * scripts or its manifest reach into it.
 */
export function testInputs(root: string, mode: TestProfile = "normal", read: Inputs = "tests"): string | undefined {
  const evaluator = read === "tests" ? evaluatorIdentity(root) : undefined;
  if (read === "tests" && !evaluator) return undefined;
  const hash = createHash("sha256").update(JSON.stringify(["tests-v7", read, process.versions.node, process.platform, process.arch, profile(mode), ...evaluator ? [evaluator] : []]));
  const served = (file: string) => !isTestFile(file) && ![DRIVERS, TRACES, COUNTEREXAMPLES].some((dir) => file.startsWith(`${dir}/`));
  const update = (from: string, file: string, checkGenImport: boolean): boolean => {
    const full = path.join(from, file);
    const entry = statEntry(full);
    if (!entry) throw new Error(`ENOENT: no such file or directory, open '${full}'`);
    hash.update(`${file}\0${entry.sha}\0`);
    if (!checkGenImport) return false;
    if (entry.genImport === undefined) {
      const text = fs.readFileSync(full, "utf8");
      entry.genImport = tsApi().preProcessFile(text, true, true).importedFiles
        .some(({ fileName }) => /^\.\.?\//.test(fileName) && path.posix.join(path.posix.dirname(file), fileName).startsWith("gen/"));
    }
    return entry.genImport;
  };
  for (const { directory: from, name } of workspacePackages(root)) {
    hash.update(JSON.stringify(name));
    const own = name === ".";
    const specDir = loadConfig(from).spec.dir;
    const prose = prosePattern(specDir);
    const lockPath = `${specDir}/lock.json`;
    const reads: Record<Inputs, (file: string) => boolean> = {
      tests: (file) => !prose.test(file) && !file.startsWith(`${SIMULATIONS}/`),
      types: (file) => /\.(?:[cm]?[jt]sx?|json|vibex?)$/.test(file) && file !== lockPath && ![TRACES, COUNTEREXAMPLES, SIMULATIONS].some((dir) => file.startsWith(`${dir}/`)),
    };
    const keep = (file: string) => reads[read](file) && (own || (served(file) && !file.startsWith(`${specDir}/`) && !file.startsWith("gen/") && (!file.endsWith(".md") || /(?:^|\/)fixtures\//.test(file))));
    const pkg = manifest(from);
    if ([pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies].some((deps) =>
      Object.values(deps ?? {}).some((version) => typeof version === "string" && version.startsWith("link:")))) return undefined;
    let gen = own || /(?:^|["/.])gen\//.test(JSON.stringify([pkg.exports, pkg.main, pkg.module, pkg.types]));
    for (const file of packageFiles(from, keep, "", own)) {
      const checkGen = !gen && /\.(?:[cm]?[jt]sx?|vibex?)$/.test(file);
      if (update(from, file, checkGen)) gen = true;
    }
    const top = gen && fs.existsSync(path.join(from, "gen")) ? fs.readdirSync(path.join(from, "gen"), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `gen/${e.name}`).sort() : [];
    for (const file of top.filter(reads[read])) update(from, file, false);
  }
  const { lock } = packageManager(root);
  if (lock) hash.update(fileDigest(lock));
  return hash.digest("hex");
}

/** A successful complete Node test run, also restored by the Turbo test task. */
export const testReceipt = (root: string, mode: TestProfile = "normal") => path.join(root, ".cache", `test-result-${mode}.json`);

const specDirContext = new AsyncLocalStorage<string>();
export const withSpecDir = <T>(specDir: string, run: () => T): T => specDirContext.run(specDir, run);

const citationMatchers = new Map<string, { global: RegExp; test: RegExp }>();
function citationMatcher(specDir: string) {
  let entry = citationMatchers.get(specDir);
  if (!entry) {
    const source = `(?<![\\w/.-])(${escapeRegex(specDir)}\\/(?:[A-Za-z0-9]+\\/)*[A-Za-z0-9]+\\.md), "((?:[^"\\\\]|\\\\["\\\\])+)"`;
    entry = { global: new RegExp(source, "g"), test: new RegExp(source) };
    citationMatchers.set(specDir, entry);
  }
  return entry;
}

class ActiveCitationRegExp extends RegExp {
  constructor() {
    super(citationMatcher("spec").test.source);
  }
  override test(input: string): boolean {
    return citationMatcher(specDirContext.getStore() ?? "spec").test.test(input);
  }
}

/** Where code cites a story or rule (AGENTS.md, "Tests"). */
export const HAS_CITATION: RegExp = new ActiveCitationRegExp();
/** A citation of `heading` in `spec`; `at` is `file:line`, a path from the checking root. */
export interface Citation { at: string; spec: string; heading: string }
export function fileCitations(file: string, text: string, specDir = specDirContext.getStore() ?? "spec"): Citation[] {
  const prefix = `${specDir}/`;
  if (!text.includes(prefix)) return [];
  const pattern = citationMatcher(specDir).global;
  const out: Citation[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(prefix)) continue;
    pattern.lastIndex = 0;
    for (const [, spec, heading] of lines[i].matchAll(pattern)) out.push({ at: `${file}:${i + 1}`, spec, heading: heading.replace(/\\(["\\])/g, "$1") });
  }
  return out;
}
/** Every citation in the code of `dirs`, which are `codeDirs` (all of them unless given): an owner cites as the root does. */
export const citations = (root: string, dirs = codeDirs(root)): Citation[] => {
  const specDir = loadConfig(root).spec.dir;
  return dirs.flatMap((dir) => packageCode(path.join(root, dir))
    .flatMap((f) => fileCitations(dir + f, fs.readFileSync(path.join(root, dir, f), "utf8"), specDir)));
};

export function missingCitations(specs: Spec[], found: Citation[]): string[] {
  const valid = new Set<string>();
  for (const s of specs) {
    for (const t of s.stories) valid.add(`${s.file}\0${t.title}`);
    for (const r of s.rules) valid.add(`${s.file}\0${heading(r)}`);
  }
  return found.filter((c) => !valid.has(`${c.spec}\0${c.heading}`)).map((c) => `${c.at}  ${c.spec}, "${c.heading}"`);
}
/** Every citation in a package's code whose heading is no story or rule of that spec, as `file:line  citation`. */
export const danglingCitations = (root: string, specs: Spec[], dir = ""): string[] => missingCitations(specs, citations(root, [dir]));

/** A directory no stage reads in a package: build output, dependencies, saved explorations and hidden directories. */
export const UNREAD = /^(node_modules|dist|build|out|coverage|storybook-static|__traces__|__screenshots__|\..*)$/;

/**
 * A package's files that `keep` accepts, as paths from it: not gen/, build output, dependencies, hidden directories
 * (such as `.cache/`) or `.DS_Store`, nor the packages nested in it, which are checked on their own, except, with
 * `fixtures`, those under a test/ directory, which its tests read.
 */
export function packageFiles(root: string, keep: (file: string) => boolean, dir = "", fixtures = false): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.name === ".git" || e.name === ".DS_Store") return [];
    if (e.isFile()) return keep(rel) ? [rel] : [];
    if (!e.isDirectory() || UNREAD.test(e.name)) return [];
    const nested = fs.existsSync(path.join(root, rel, "package.json"));
    const skip = nested && (e.name === "gen" || !fixtures || !/(?:^|\/)test\//.test(rel));
    return skip ? [] : packageFiles(root, keep, rel, fixtures);
  }).sort();
}
export const packageCode = (root: string) => packageFiles(root, (file) => /\.(?:[cm]?[jt]sx?|vibex?)$/.test(file) && !SIDECAR.test(file));

/** A test of a package: test/**\/*.test.*, but not a driver, which the traces stage runs. */
export const isTestFile = (file: string) => /^test\/(?!drivers\/).*\.test\.[^/.]+$/.test(file);

/** Where a package keeps its drivers, the traces they replay and the counterexamples the simulator found (SPEC.md, "Conformance"). */
export const TRACES = "test/traces", DRIVERS = "test/drivers", COUNTEREXAMPLES = "test/counterexamples";
/** Where Quint writes the traces of the simulations a check ran. */
export const SIMULATIONS = "gen/traces";

/** A token of a script, and how many brackets it sits in. */
interface Token { text: string; pos: number; start: number; depth: number; fresh: boolean }
const JSX_FILE = /\.[cm]?[jt]sx$|\.vibex$/i;

function hasLineBreak(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) return true;
  }
  return false;
}

function tokenizeJsx(text: string): Token[] | undefined {
  const ts = tsApi();
  const K = ts.SyntaxKind;
  const source = ts.createSourceFile("file.tsx", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const out: Token[] = [];
  const open: boolean[] = [];
  let balanced = true;
  const walk = (node: TS.Node) => {
    if (!balanced) return;
    const children = node.getChildren(source);
    if (children.length) {
      for (const child of children) walk(child);
      return;
    }
    const kind = node.kind;
    if (kind === K.EndOfFileToken || kind === K.JsxTextAllWhiteSpaces) return;
    const pos = node.getFullStart();
    const start = node.getStart(source);
    const tokenText = text.slice(start, node.end);
    if (!tokenText) return;
    if (kind === K.CloseParenToken || kind === K.CloseBracketToken || kind === K.CloseBraceToken || kind === K.TemplateTail) {
      if (!open.length) { balanced = false; return; }
      open.pop();
    }
    out.push({ text: tokenText, pos, start, depth: open.length, fresh: hasLineBreak(text, pos, start) });
    if (kind === K.OpenParenToken || kind === K.OpenBracketToken || kind === K.OpenBraceToken || kind === K.TemplateHead) open.push(kind === K.TemplateHead);
  };
  walk(source);
  return balanced && !open.length ? out : undefined;
}

/** A script's tokens, or nothing if its brackets do not balance; TypeScript's scanner reads VibeLang's too, and TSX/JSX uses TypeScript's parser. */
export function tokenize(text: string, file?: string | boolean): Token[] | undefined {
  const isJsx = typeof file === "boolean" ? file : file !== undefined && JSX_FILE.test(file);
  if (isJsx) return tokenizeJsx(text);
  const K = tsApi().SyntaxKind;
  const scanner = tsApi().createScanner(tsApi().ScriptTarget.Latest, true, tsApi().LanguageVariant.Standard, text);
  const out: Token[] = [];
  const open: boolean[] = []; // each bracket that is open: true for a template's `${`
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    // A slash after a value divides; anywhere else it starts a regular expression.
    const last = out.at(-1)?.text ?? "";
    if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !(/[\w$)\]}'"`]$/.test(last) && !/^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(last)))
      kind = scanner.reScanSlashToken();
    if (kind === K.CloseBraceToken && open.at(-1)) kind = scanner.reScanTemplateToken(false);
    if (kind === K.CloseParenToken || kind === K.CloseBracketToken || kind === K.CloseBraceToken || kind === K.TemplateTail) {
      if (!open.length) return undefined;
      open.pop();
    }
    out.push({ text: scanner.getTokenText(), pos: scanner.getTokenFullStart(), start: scanner.getTokenStart(), depth: open.length, fresh: scanner.hasPrecedingLineBreak() });
    if (kind === K.OpenParenToken || kind === K.OpenBracketToken || kind === K.OpenBraceToken || kind === K.TemplateHead) open.push(kind === K.TemplateHead);
  }
  return open.length ? undefined : out;
}

/** The package manager a package declares, or whose lock file sits in it or a directory above it, up to the repository or workspace root. */
export function packageManager(root: string): { name: string; lock?: string } {
  const locks: Record<string, string> = { "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" };
  let declared: string | undefined;
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const pkg = manifest(dir);
    declared ??= pkg.packageManager?.split("@")[0];
    const lock = Object.keys(locks).find((f) => fs.existsSync(path.join(dir, f)));
    if (lock) return { name: declared ?? locks[lock], lock: path.join(dir, lock) };
    if (pkg.workspaces || fs.existsSync(path.join(dir, ".git")) || path.dirname(dir) === dir) return { name: declared ?? "npm" };
  }
}

/** The nearest pnpm lockfile, up to and including the repository or workspace root. */
export function pnpmLockfile(root: string): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const lock = path.join(dir, "pnpm-lock.yaml");
    if (fs.existsSync(lock)) return lock;
    if (path.dirname(dir) === dir || fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) || manifest(dir).workspaces) return undefined;
  }
}
