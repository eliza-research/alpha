#!/usr/bin/env node
// spec/app/image/licences.md, "Story: Ship what Alpha is built from, with its licences"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { packPrepared } from "@repo/eliza-harness"
import { licenceFlags as flagsOf, releaseBlockedByLicences, type Family, type Flag, type FontCheck } from "../gen/app__image__licences.ts"

export const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const root = resolve(app, "../..")
const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i
const BUILD_TOOLS = new Set(["esbuild", "lightningcss", "rolldown", "vite"])
const BUILD_HOSTS = new Set(["darwin", "linux", "win32"])
const PERMISSIVE = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "IJG", "ISC", "libpng-2.0", "libtiff", "MIT", "OFL-1.1", "SunPro", "Zlib"])
const NEWLY_PERMISSIVE = new Set(["Artistic-2.0", "BlueOak-1.0.0", "BSD-3-Clause-Clear", "BSL-1.0", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "MIT-0", "PSF-2.0", "Python-2.0",
  "Unicode-3.0", "Unicode-DFS-2016", "Unlicense", "WTFPL", "X11"])
const FLAG_NAMES: Readonly<Record<Flag, string>> = {
  CopyleftStrongFlag: "copyleft-strong", NetworkCopyleftFlag: "network-copyleft", CopyleftWeakFlag: "copyleft-weak", ShareAlikeDataFlag: "share-alike-data",
  UnknownLicenceFlag: "unknown-licence", PermissiveNotPreviouslyListedFlag: "permissive-not-previously-listed",
}
/** Android runtime libraries by Maven group: what the launcher APK's classpath ships besides the web page. */
const MAVEN_FAMILIES = [
  { prefix: "androidx.", name: "AndroidX (Android Jetpack) libraries, including CameraX", license: "Apache-2.0", source: "https://android.googlesource.com/platform/frameworks/support/" },
  { prefix: "org.jetbrains.kotlinx", name: "Kotlin coroutines", license: "Apache-2.0", source: "https://github.com/Kotlin/kotlinx.coroutines" },
  { prefix: "org.jetbrains.kotlin", name: "Kotlin standard library", license: "Apache-2.0", source: "https://github.com/JetBrains/kotlin" },
  { prefix: "org.jetbrains", exact: true, name: "JetBrains Java annotations", license: "Apache-2.0", source: "https://github.com/JetBrains/java-annotations" },
  { prefix: "com.squareup.okhttp3", exact: true, name: "OkHttp HTTP and WebSocket client", license: "Apache-2.0", source: "https://square.github.io/okhttp/" },
  { prefix: "com.squareup.okio", exact: true, name: "Okio I/O library", license: "Apache-2.0", source: "https://square.github.io/okio/" },
  { prefix: "com.google.guava", name: "Guava and ListenableFuture", license: "Apache-2.0", source: "https://github.com/google/guava" },
  { prefix: "com.google.auto.value", name: "AutoValue annotations", license: "Apache-2.0", source: "https://github.com/google/auto" },
  { prefix: "org.jspecify", name: "JSpecify annotations", license: "Apache-2.0", source: "https://github.com/jspecify/jspecify" },
  { prefix: "org.apache.cordova", name: "Apache Cordova Android framework (Capacitor compatibility layer)", license: "Apache-2.0", source: "https://github.com/apache/cordova-android" },
  { prefix: "com.google.code.findbugs", exact: true, name: "JSR-305 annotations", license: "Apache-2.0", source: "https://repo.maven.apache.org/maven2/com/google/code/findbugs/jsr305/" },
  { prefix: "com.google.errorprone", exact: true, name: "Error Prone annotations", license: "Apache-2.0", source: "https://github.com/google/error-prone" },
  { prefix: "com.google.j2objc", exact: true, name: "J2ObjC annotations", license: "Apache-2.0", source: "https://github.com/google/j2objc" },
  { prefix: "org.checkerframework", exact: true, name: "Checker Framework qualifiers", license: "MIT", licenseFile: "checker-qual-3.43.0-LICENSE.txt", source: "https://github.com/typetools/checker-framework" },
]

export interface Notice {
  readonly name: string
  readonly version: string
  readonly license: string
  readonly source: string
  readonly text: string
  readonly textSource?: string
  readonly flags: readonly string[]
  readonly obligations?: readonly { readonly flag: string; readonly note: string }[]
}

interface Draft { name: string; version: string; license: string; source: string; text: string; textSource?: string; flags: string[] }

interface LicenseObject { readonly type?: string }
interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly license?: string | LicenseObject
  readonly licenses?: readonly (string | LicenseObject)[]
  readonly repository?: string | { readonly url?: string }
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly os?: string | readonly string[]
}
interface ElizaLock { readonly commit: string; readonly remote: string; readonly branch: string }
interface ClasspathRecord { readonly coordinates: readonly string[] }
interface FontRecord {
  readonly name: string
  readonly sha256: readonly string[]
  readonly license: string
  readonly evidence?: string
  readonly source?: string
  readonly holder?: string
  readonly licensee?: string
  readonly basis?: string
  readonly scope?: string
}
interface FontLicensesFile { readonly entries: readonly FontRecord[] }

const read = (file: string) => readFileSync(file, "utf8")
const json = <T>(file: string): T => JSON.parse(read(file)) as T
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const canonical = (id: string) => {
  const file = join(app, "licenses", `${id.replace(/\+$/, "").replace(/-(only|or-later)$/, "").split(/ WITH /i)[0]?.trim()}.txt`)
  return existsSync(file) ? read(file).trim() : ""
}

/** The family of one SPDX identifier, by its name without `-only`, `-or-later`, `+` or an exception. */
export function familyOf(id: string): Family {
  const name = (id.split(/ WITH /i)[0] ?? "").trim().replace(/\+$/, "").replace(/-(only|or-later)$/, "")
  if (PERMISSIVE.has(name)) return "Permissive"
  if (NEWLY_PERMISSIVE.has(name)) return "NewlyPermissive"
  if (/^AGPL-/.test(name)) return "NetworkCopyleft"
  if (/^(GPL|EUPL|OSL)-/.test(name)) return "StrongCopyleft"
  if (/^(LGPL|MPL|EPL|CDDL|CPL)-/.test(name)) return "WeakCopyleft"
  if (/^(ODbL|CC-BY-SA|CDLA-Sharing)-/.test(name)) return "ShareAlike"
  return "UnknownFamily"
}

/** An SPDX expression as its alternatives (OR) of identifiers (AND); none when it is not SPDX. */
export function alternatives(expression: string): string[][] {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let at = 0
  const cross = (a: string[][], b: string[][]) => a.flatMap((x) => b.map((y) => [...x, ...y]))
  const atom = (): string[][] => {
    const token = tokens[at++]
    if (token === "(") { const inner = or(); if (tokens[at++] !== ")") throw new Error("unbalanced"); return inner }
    if (!token || /^(AND|OR|WITH|\))$/i.test(token) || !/^[A-Za-z0-9.+-]+$/.test(token)) throw new Error("identifier expected")
    if (/^WITH$/i.test(tokens[at] ?? "")) { at++; const exception = tokens[at++]; if (!exception) throw new Error("exception expected"); return [[`${token} WITH ${exception}`]] }
    return [[token]]
  }
  const and = (): string[][] => { let left = atom(); while (/^AND$/i.test(tokens[at] ?? "")) { at++; left = cross(left, atom()) } return left }
  const or = (): string[][] => { let left = and(); while (/^OR$/i.test(tokens[at] ?? "")) { at++; left = [...left, ...and()] } return left }
  try { const parsed = or(); return at === tokens.length ? parsed : [] } catch { return [] }
}

function flagged(license: string): string[] {
  return flagsOf(alternatives(license).map((ids) => ids.map(familyOf))).map((flag) => FLAG_NAMES[flag])
}

function manifestLicence(manifest: PackageManifest): string {
  if (typeof manifest.license === "string") return manifest.license.trim()
  if (typeof manifest.license?.type === "string") return manifest.license.type
  if (manifest.licenses !== undefined) return manifest.licenses.map((item) => (typeof item === "string" ? item : item.type)).filter((item): item is string => Boolean(item)).join(" OR ")
  return ""
}

function licenceText(dir: string): string {
  return readdirSync(dir).filter((file) => LICENCE_FILE.test(file) && statSync(join(dir, file)).isFile()).sort().map((file) => read(join(dir, file)).trim()).join("\n\n")
}

function canonicalExpression(license: string): string {
  if (license === "UNKNOWN") return ""
  const ids = alternatives(license)[0] ?? []
  if (ids.length === 0) return ""
  const texts = ids.map((id) => canonical(id))
  if (texts.some((item) => item === "")) return ""
  return texts.join("\n\n---\n\n")
}

function packageDraft(dir: string, manifest: PackageManifest): Draft {
  const stated = manifestLicence(manifest)
  const license = stated === "" || /^(SEE LICEN[CS]E IN\b|UNLICENSED$)/i.test(stated) ? "UNKNOWN" : stated
  const flags = flagged(license)
  const source = typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? `https://www.npmjs.com/package/${manifest.name}`)
  const own = licenceText(dir)
  if (own !== "") return { name: manifest.name, version: manifest.version, license, source, text: own, flags }
  const text = canonicalExpression(license)
  return {
    name: manifest.name, version: manifest.version, license, source, flags: [...flags, "licence-text-missing-from-package"],
    textSource: text === "" ? undefined : "spdx-canonical",
    text: text === "" ? `The npm package ships no licence file, and no canonical text of ${license} is held in apps/app/licenses.` : `The npm package ships no licence file. Its package.json declares ${license}. The standard terms follow.\n\n${text}`,
  }
}

/** The installed directory of a dependency, as Node resolves it from the package that names it, looking no higher than this workspace: an enclosing checkout's node_modules never enters the inventory. */
function installed(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
    if (dir === root || dirname(dir) === dir) return undefined
  }
}

/** Every npm package the app ships: the production dependencies of the app, its workspace packages, `@elizaos/*` packages and `apps/agent`, each once, with eliza's packages as one entry. */
function npmDrafts(): Draft[] {
  const drafts = new Map<string, Draft>()
  const visited = new Set<string>()
  const walk = (dir: string) => {
    const canonicalDir = realpathSync(dir)
    if (visited.has(canonicalDir)) return
    visited.add(canonicalDir)
    const manifest = json<PackageManifest>(join(canonicalDir, "package.json"))
    const inWorkspace = !canonicalDir.split(sep).includes("node_modules") && canonicalDir !== root
    const isEliza = manifest.name.startsWith("@elizaos/")
    const isRepo = manifest.name.startsWith("@repo/")
    if (!inWorkspace && !isEliza && !isRepo) drafts.set(`${manifest.name}@${manifest.version}`, packageDraft(canonicalDir, manifest))
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]
    for (const name of names) {
      const optional = Object.hasOwn(manifest.optionalDependencies ?? {}, name)
      const found = installed(canonicalDir, name) ?? installed(app, name)
      if (found === undefined) {
        if (optional) continue
        if (isEliza) continue
        throw new Error(`${name}, a dependency of ${manifest.name}, is not installed: run pnpm install`)
      }
      if (optional && BUILD_TOOLS.has(manifest.name)) {
        const { os } = json<PackageManifest>(join(found, "package.json"))
        const platforms = typeof os === "string" ? [os] : os ?? []
        if (platforms.length > 0 && platforms.every((platform) => BUILD_HOSTS.has(platform))) continue
      }
      walk(found)
    }
  }
  walk(app)
  const agentDir = join(root, "apps/agent")
  if (existsSync(join(agentDir, "package.json"))) walk(agentDir)
  return [...drafts.values()]
}

function elizaDraft(): Draft {
  const pin = json<ElizaLock>(join(root, "eliza.lock.json"))
  const text = read(join(root, ".eliza/LICENSE")).trim()
  return { name: "elizaOS (@elizaos/agent, @elizaos/os, @elizaos/cloud)", version: pin.commit, license: "MIT", source: `${pin.remote} (${pin.branch})`, text, flags: flagged("MIT") }
}

interface OcrSources {
  package: string;
  version: string;
  cores: Record<string, string>;
  source: string;
  components: Array<{ name: string; version: string; license: string; source: string; preface?: string; files: Array<{ path: string; sha256: string }> }>;
}

/** The libraries linked into OCR's shipped WebAssembly and the bundled OCR language data. */
function ocrDrafts(): Draft[] {
  const directory = join(app, "licenses/tesseract-core")
  const sources = json<OcrSources>(join(directory, "sources.json"))
  const engine = installed(app, sources.package)
  if (engine === undefined || json<{ version?: string }>(join(engine, "package.json")).version !== sources.version) throw new Error("The OCR engine does not match the recorded licences")
  for (const [file, digest] of Object.entries(sources.cores)) {
    if (sha256(join(engine, file)) !== digest) throw new Error(`The OCR core ${file} differs from its recorded binary`)
  }
  const drafts: Draft[] = sources.components.map((component) => {
    const texts = component.files.map(({ path, sha256: digest }) => {
      const file = join(directory, path)
      if (sha256(file) !== digest) throw new Error(`The OCR licence ${path} differs from its recorded source`)
      return read(file).trim()
    })
    return {
      name: `${component.name} (linked into tesseract.js-core WebAssembly)`,
      version: component.version, license: component.license, source: component.source,
      text: [component.preface, ...texts].filter(Boolean).join("\n\n"), flags: flagged(component.license),
    }
  })
  const language = "@tesseract.js-data/eng"
  const english = installed(app, language)
  if (english === undefined) throw new Error("The OCR language data is unavailable")
  drafts.push({
    name: "Tesseract English trained data (tessdata 4.0.0_best_int)",
    version: json<{ version?: string }>(join(english, "package.json")).version ?? "",
    license: "Apache-2.0", source: "https://github.com/tesseract-ocr/tessdata_best", flags: flagged("Apache-2.0"),
    text: read(join(app, "public/ocr/tessdata-LICENSE.txt")).trim(),
  })
  const sdk = installed(app, "@elizaos/plugin-files-client")
  const pdf = sdk === undefined ? undefined : installed(sdk, "pdf-lib")
  if (pdf === undefined) throw new Error("The SDK's searchable PDF engine is unavailable")
  drafts.push(packageDraft(pdf, json(join(pdf, "package.json"))))
  return drafts
}

function androidDrafts(): Draft[] {
  const record = json<ClasspathRecord>(join(app, "licenses/android-runtime-classpath.json"))
  const groups = new Map<string, { family: (typeof MAVEN_FAMILIES)[number] | undefined; coordinates: string[] }>()
  for (const coordinate of record.coordinates) {
    const [group = "", artifact = ""] = coordinate.split(":")
    const family = MAVEN_FAMILIES.find((f) => (f.exact ? group === f.prefix : group.startsWith(f.prefix)))
    const key = family?.name ?? `${group}:${artifact}`
    groups.set(key, { family, coordinates: [...(groups.get(key)?.coordinates ?? []), coordinate] })
  }
  return [...groups].map(([name, { family, coordinates }]) => {
    const license = family?.license ?? "UNKNOWN"
    const text = family?.licenseFile ? read(join(app, "licenses", family.licenseFile)).trim() : canonical(license)
    return { name, version: coordinates.join("\n"), license, source: family?.source ?? "not recorded", text: text || "No licence could be established for this Android library.",
      flags: flagged(license), ...(family?.licenseFile ? {} : { textSource: "spdx-canonical" }) }
  })
}

export const NODE_ENTRY = "Node.js runtime (libeliza_node.so)"

/** Alpha's own code staged into the agent pack's entry (the entry package and Alpha's product plugin), found by its package.json digest. */
function alphaOwn(name: string, digest: string): boolean {
  const alpha = join(packPrepared([]).root, ".alpha")
  if (!existsSync(alpha)) return false
  return readdirSync(alpha).filter((entry) => entry.startsWith("pack-entry-")).some((entry) =>
    [join(alpha, entry, "package.json"), join(alpha, entry, "node_modules", name, "package.json")].some((file) => existsSync(file) && sha256(file) === digest))
}

/** The packages a built agent bundle names (its manifest.json), found by name, version and package.json digest in the pinned eliza checkout. */
function bundledPackages(bundle: string): Draft[] {
  const manifest = json<{ readonly packages: readonly { readonly name: string; readonly version: string; readonly sha256: string }[] }>(join(bundle, "manifest.json"))
  const store = join(root, ".eliza/node_modules/.pnpm")
  const candidates = (name: string, version: string) => [
    ...readdirSync(store).filter((entry) => entry.startsWith(`${name.replace("/", "+")}@${version}`)).map((entry) => join(store, entry, "node_modules", name)),
    ...[join(root, ".eliza/packages/agent"), join(root, ".eliza")].flatMap((from) => installed(from, name) ?? []),
  ]
  const drafts: Draft[] = []
  for (const row of manifest.packages) {
    if (row.name.startsWith("@elizaos/") || alphaOwn(row.name, row.sha256)) continue
    const dir = candidates(row.name, row.version).find((candidate) => existsSync(join(candidate, "package.json")) && sha256(join(candidate, "package.json")) === row.sha256)
    if (dir === undefined) throw new Error(`${row.name}@${row.version}, bundled into the agent, is not in the pinned eliza checkout: run pnpm eliza`)
    drafts.push(packageDraft(dir, json<PackageManifest>(join(dir, "package.json"))))
  }
  return drafts
}

/** The packaged agent runtime: the Android Node runtime eliza's lock pins, and every npm package bundled into agent.mjs. */
export function runtimeDrafts(bundle: string): Draft[] {
  const lock = json<{ readonly version: string; readonly ndk: string; readonly buildCommit: string }>(join(root, ".eliza/packages/os/aosp/runtime/node.lock.json"))
  if (process.versions.node !== lock.version) throw new Error(`The Node licence is read from this Node ${process.versions.node}; the packaged runtime is ${lock.version}`)
  const text = read(join(dirname(process.execPath), "../LICENSE")).trim()
  const node: Draft = {
    name: NODE_ENTRY, version: `${lock.version} (Android NDK ${lock.ndk}, eliza build ${lock.buildCommit})`, license: "MIT", flags: flagged("MIT"),
    source: `https://github.com/nodejs/node/tree/v${lock.version}`, text,
  }
  return [node, ...bundledPackages(bundle)]
}

/** The fonts the design system ships, each with its recorded licence, and whether every one has a record. */
export function fontDrafts(): { drafts: Draft[]; check: "FontResolved" | "FontUnresolved" | "FontCheckNotRun" } {
  const directory = join(root, "packages/design-system/fonts")
  if (!existsSync(directory)) return { drafts: [], check: "FontCheckNotRun" }
  const records = json<FontLicensesFile>(join(app, "licenses/font-licenses.json")).entries
  const drafts = new Map<string, Draft>()
  let unresolved = false
  for (const file of readdirSync(directory).filter((name) => /\.(woff2?|ttf|otf)$/i.test(name)).sort()) {
    const digest = sha256(join(directory, file))
    const record = records.find((entry) => entry.sha256.includes(digest))
    if (record === undefined) {
      unresolved = true
      drafts.set(file, { name: file, version: digest, license: "proprietary, no licence recorded", source: relative(root, join(directory, file)), flags: ["proprietary-no-licence-recorded"],
        text: "A bundled font with no licence recorded in apps/app/licenses/font-licenses.json." })
      continue
    }
    const proprietary = record.license === "LicenseRef-Commercial-Font"
    const held = record.evidence === "held-outside-repository"
    drafts.set(record.name, {
      name: record.name, version: record.sha256.join("\n"), license: record.license, source: record.source ?? record.holder ?? "",
      flags: proprietary ? (held ? ["proprietary-licence-held-outside-repo"] : []) : flagged(record.license),
      text: proprietary ? `${record.name} is licensed to ${record.licensee ?? record.holder ?? ""}. ${record.basis ?? record.scope ?? ""}`.trim() : canonical(record.license),
      ...(proprietary ? {} : { textSource: "spdx-canonical" }),
    })
  }
  return { drafts: [...drafts.values()], check: unresolved ? "FontUnresolved" : "FontResolved" }
}

function obligation(flag: string, entry: Draft): string {
  const where = `Corresponding source: ${entry.source.split("\n")[0] ?? ""}.`
  switch (flag) {
    case "copyleft-strong": return `${entry.license} is a strong copyleft licence. Its licence text and the copyright notices ship with the app in this entry. Anyone who receives the app must be able to get the complete corresponding source of this component at this exact version. ${where} The licence also sets conditions on distributing a larger work that contains the component; that has not been assessed here.`
    case "network-copyleft": return `${entry.license}: the source offer extends to network use. People who use this component over a network must be offered its corresponding source, not only people who receive a copy. ${where}`
    case "copyleft-weak": return `${entry.license}: the licence text and copyright notices ship with the app in this entry, and the source of the covered library or files, with any changes, must be available under the same licence. ${where}`
    case "share-alike-data": return `${entry.license} is a share-alike licence for data or content. Attribution must be shown, and a work derived from it that is shared publicly must be offered under the same licence. ${where}`
    case "unknown-licence": return entry.license === "UNKNOWN"
      ? `No open-source licence could be identified from the package manifest or its licence files. Nothing recorded here shows that use or redistribution is permitted. ${where}`
      : `The declared licence "${entry.license}" is not an identifier this inventory recognises, so nothing recorded here establishes what it permits or obliges. ${where}`
    case "licence-text-missing-from-package": return entry.textSource === "spdx-canonical"
      ? "The package ships no licence file. The canonical text of its declared licence is included instead."
      : "The package ships no licence file, and no canonical text for its licence is held in apps/app/licenses. The licence text itself is therefore not in this entry."
    case "permissive-not-previously-listed": return `${entry.license} is a permissive licence recognised from the SPDX list that was not on this project's earlier accepted list. It asks that its licence text and copyright notices stay with copies, which this entry does.`
    case "proprietary-licence-held-outside-repo": return "This is a proprietary item, not open-source software. The owner states its licence is held; the licence document is not in this repository and has not been seen here."
    case "proprietary-no-licence-recorded": return "This is a proprietary item, not open-source software, and no licence to embed or redistribute it is recorded (apps/app/licenses/font-licenses.json is where one is recorded)."
    default: return ""
  }
}

function finish(draft: Draft): Notice {
  const flags = [...new Set(draft.flags)]
  return flags.length ? { ...draft, flags, obligations: flags.map((flag) => ({ flag, note: obligation(flag, draft) })) } : { ...draft, flags }
}

export interface Inventory { readonly notices: readonly Notice[]; readonly fontCheck: "FontResolved" | "FontUnresolved" | "FontCheckNotRun"; readonly openSourceFlags: readonly Flag[] }

function isProprietaryDraft(draft: Draft): boolean {
  return draft.license.startsWith("LicenseRef-") || draft.flags.some((flag) => flag.startsWith("proprietary-"))
}

/** What Alpha ships, each with its licence: npm packages, eliza, the Android runtime classpath and the fonts. @throws {Error} */
export function inventory(bundle?: string): Inventory {
  const fonts = fontDrafts()
  const found = new Map([...npmDrafts(), elizaDraft(), ...androidDrafts(), ...ocrDrafts(), ...fonts.drafts, ...(bundle === undefined ? [] : runtimeDrafts(bundle))].map((draft) => [`${draft.name}@${draft.version}`, draft]))
  const drafts = [...found.values()]
  const notices = drafts.map(finish).sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"))
  const openSourceFlags = [...new Set(drafts.filter((draft) => !isProprietaryDraft(draft)).flatMap((draft) => flagsOf(alternatives(draft.license).map((ids) => ids.map(familyOf)))))]
  return { notices, fontCheck: fonts.check, openSourceFlags }
}

export function renderJson(notices: readonly Notice[]): string {
  return `${JSON.stringify(notices, null, 2)}\n`
}

export function renderText(notices: readonly Notice[]): string {
  const flagged = notices.filter((entry) => entry.flags.length)
  const header = ["Alpha third-party notices", "", "Alpha includes the third-party software, fonts and data listed below, generated by `pnpm licences`.",
    `Entries: ${notices.length}. Flagged entries: ${flagged.length}.`, "",
    "A flag records what was found about an entry: a copyleft licence, a licence that is unknown, a package that ships no licence file, or a proprietary item. It is not legal review and not a clearance.",
    ...flagged.map((entry) => `  - ${entry.name}@${entry.version.split("\n")[0]}: ${entry.flags.join(", ")}`)].join("\n")
  const blocks = notices.map((entry) => ["=".repeat(78), entry.name, `Version: ${entry.version.replace(/\n/g, "\n         ")}`, `License: ${entry.license}`, `Source: ${entry.source}`,
    ...(entry.flags.length ? [`Flags: ${entry.flags.join(", ")}`, ...(entry.obligations ?? []).map((item) => `Obligation (${item.flag}): ${item.note}`)] : []), "", entry.text.replaceAll("\r\n", "\n")].join("\n"))
  return `${header}\n\n${blocks.join("\n\n")}\n`
}

const MAVEN_COORDINATE = /^([^:\s]+):([^:\s]+):([^:\s]+)$/

function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest()
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** A CycloneDX 1.5 software bill of materials of the same inventory. */
export function renderSbom(notices: readonly Notice[], serial?: string): string {
  const version = json<PackageManifest>(join(app, "package.json")).version
  const components = notices.flatMap((entry) => {
    const parsed = alternatives(entry.license)
    const licenses = parsed.length === 1 && parsed[0]?.length === 1 ? [{ license: { id: entry.license } }] : [{ expression: entry.license }]
    const externalReferences = entry.source.startsWith("http") ? { externalReferences: [{ type: "distribution", url: entry.source }] } : {}
    const properties = entry.flags.map((flag) => ({ name: "alpha:licence-flag", value: flag }))
    const lines = entry.version.split("\n").map((line) => line.trim()).filter(Boolean)
    if (lines.length > 1 && lines.every((line) => MAVEN_COORDINATE.test(line))) {
      const subcomponents = lines.map((line) => {
        const match = MAVEN_COORDINATE.exec(line)
        const group = match?.[1] ?? ""
        const artifact = match?.[2] ?? ""
        const coordVersion = match?.[3] ?? line
        return {
          type: "library",
          name: `${group}:${artifact}`,
          version: coordVersion,
          purl: `pkg:maven/${group}/${artifact}@${coordVersion}`,
          licenses,
        }
      })
      return [{
        type: "library",
        name: entry.name,
        version: lines[0] ?? "",
        licenses,
        ...externalReferences,
        properties,
        components: subcomponents,
      }]
    }
    return [{
      type: "library",
      name: entry.name,
      version: lines[0] ?? "",
      licenses,
      ...externalReferences,
      properties,
    }]
  })
  const serialId = serial ?? deterministicUuid(`${version}\n${renderJson(notices)}`)
  return `${JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: `urn:uuid:${serialId}`, version: 1,
    metadata: { component: { type: "application", name: "Alpha", version } }, components }, null, 2)}\n`
}

export const outputs = { json: join(app, "public/licenses/third-party-notices.json"), text: join(app, "public/licenses/THIRD_PARTY_NOTICES.txt") }

export function currentText(file: string): string | undefined {
  try { return read(file) } catch { return undefined }
}

const font = (check: Inventory["fontCheck"]): FontCheck => check

/** Write the notices, or with `--check` say whether the committed ones are current; with `--packaged-runtime BUNDLE` list the agent runtime too, with `--into DIR` write them under DIR/licenses, with `--sbom FILE` write the bill of materials too. @throws {Error} */
export function licences(argv: readonly string[]) {
  const check = argv.includes("--check")
  const sbomAt = argv.indexOf("--sbom")
  const out = sbomAt >= 0 ? argv[sbomAt + 1] : undefined
  if (sbomAt >= 0 && (out === undefined || out.startsWith("--"))) throw new Error("--sbom needs a file")
  const option = (name: string) => {
    const at = argv.indexOf(name)
    if (at < 0) return undefined
    const value = argv[at + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a directory`)
    return value
  }
  const bundle = option("--packaged-runtime")
  const into = option("--into")
  if (check && (bundle !== undefined || into !== undefined)) throw new Error("--check compares the committed notices, which list no packaged runtime")
  const found = inventory(bundle)
  const flagLines = found.notices.flatMap((entry) => entry.flags.map((flag) => `LICENCE FLAG ${flag}: ${entry.name}@${entry.version.split("\n")[0]} (${entry.license})`))
  if (releaseBlockedByLicences([...found.openSourceFlags], font(found.fontCheck))) {
    const osBlocked = releaseBlockedByLicences([...found.openSourceFlags], "FontResolved")
    const fontBlocked = releaseBlockedByLicences([], font(found.fontCheck))
    const reasons: string[] = []
    if (osBlocked) reasons.push(`open-source licence flags block release: ${found.openSourceFlags.join(", ")}`)
    if (fontBlocked) reasons.push(`the font licence check is ${found.fontCheck}: a release cannot ship until every bundled font's check runs`)
    throw new Error(reasons.join("; ") || "Release blocked by licence policy")
  }
  const target = into === undefined ? outputs : { json: join(into, "licenses/third-party-notices.json"), text: join(into, "licenses/THIRD_PARTY_NOTICES.txt") }
  const written: readonly (readonly [string, string])[] = [[target.json, renderJson(found.notices)], [target.text, renderText(found.notices)]]
  if (check) {
    const stale = written.filter(([file, content]) => currentText(file) !== content).map(([file]) => relative(app, file))
    if (stale.length) throw new Error(`The third-party notices are stale: ${stale.join(", ")}. Run pnpm licences`)
    if (out !== undefined) writeFileSync(out, renderSbom(found.notices), { flag: "wx" })
    return { current: true, entries: found.notices.length, fontCheck: found.fontCheck, flagLines }
  }
  for (const [file, content] of written) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  if (out !== undefined) writeFileSync(out, renderSbom(found.notices), { flag: "wx" })
  return { entries: found.notices.length, flagged: found.notices.filter((entry) => entry.flags.length).length, fontCheck: found.fontCheck, flagLines }
}

if (import.meta.main) {
  try {
    const { flagLines, ...result } = licences(process.argv.slice(2))
    for (const line of flagLines) process.stderr.write(`${line}\n`)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
