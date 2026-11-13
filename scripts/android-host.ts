/**
 * Generate Alpha's Android build files with the upstream consumer-host generator.
 *
 *   bun scripts/android-host.ts        write the generated host into android/
 *
 * android/consumer-host.json is the only authored Gradle setup: identity comes from
 * app.config.json; modules, dependencies, variants, signing and version environment
 * names, admission and installed-data compatibility names come
 * from the descriptor. The generator at the pinned upstream commit owns the Gradle
 * scripts, toolchain, wrapper and variant policy; the generated files are build
 * outputs (git-ignored), regenerated before every Android build. android/app/product.gradle
 * keeps Alpha's Gradle-time product admission. A host whose inputs changed refuses
 * to configure until it is regenerated.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateAndroidConsumerHost} from '../vendor/eliza/packages/app/scripts/mobile/android/consumer-host.mjs';
import {preparePatchedNative} from './prepare-patched-native.ts';
import {serializeOwnerRouteTable} from '../apps/app/src/product/owner-route-table.ts';

export const HOST_DESCRIPTOR = 'android/consumer-host.json';
export const PATCHED_NATIVE_ROOT = 'patchedNative';
const OWNER_ROUTE_ASSET = '.eliza/generated-android/owner-routes.json';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export interface HostReference {root: string; path: string}
type ReferenceMapper = (reference: HostReference) => HostReference;
type HostDescriptor = typeof import('../android/consumer-host.json');
type AppConfig = typeof import('../app.config.json');

/** The committed descriptor; only Alpha-owned data, no Gradle. */
export function readHostDescriptor(root = ROOT) {
 const descriptor: HostDescriptor = JSON.parse(fs.readFileSync(path.join(root, HOST_DESCRIPTOR), 'utf8'));
 if (descriptor?.schema !== 1 || descriptor.profile?.schema !== 1 || !descriptor.residentHost)
  throw new Error(`${HOST_DESCRIPTOR}: unsupported host descriptor`);
 return descriptor;
}

/** Product identity for the generator: package, label and version from app.config.json. */
export function hostIdentity(root = ROOT) {
 const {appId, appName, version, versionCode}: AppConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
 return {appId, appName, version, versionCode};
}

const isReference = (value: unknown): value is HostReference =>
 !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
 'root' in value && typeof value.root === 'string' && 'path' in value && typeof value.path === 'string';
/** Replace patched-native references; every other value is copied unchanged. */
export function mapReferences(value: unknown, map: ReferenceMapper): unknown {
 if (Array.isArray(value)) return value.map(item => mapReferences(item, map));
 if (isReference(value)) return value.root === PATCHED_NATIVE_ROOT ? map(value) : {...value};
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapReferences(item, map)]));
 return value;
}

/**
 * The upstream profile with patched-native modules resolved. With `canonical`, staged
 * modules name the pinned upstream directories from which staging copies them.
 */
export function hostProfile(root = ROOT, {patchedNativeRoot, canonical = false}: {patchedNativeRoot?: string; canonical?: boolean} = {}) {
 const {profile} = readHostDescriptor(root);
 const app: AppConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
 let map: ReferenceMapper;
 if (canonical) map = reference => ({root: 'upstream', path: reference.path});
 else {
  if (!patchedNativeRoot) throw new Error('Patched native staging path is required');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(patchedNativeRoot)).split(path.sep).join('/');
  if (!relative || relative.startsWith('..')) throw new Error('Patched native staging must be inside this checkout');
  map = reference => ({root: 'consumer', path: reference.path === '.' ? relative : `${relative}/${reference.path}`});
 }
 // Reference replacement preserves the descriptor's fields and reference shape.
 return {...mapReferences(profile, map) as HostDescriptor['profile'], manifestPlaceholders: {appOrientation: app.orientation}};
}

/** Write the generated table outside the authored tree, ready for the host's asset staging task. */
export function stageOwnerRouteAsset(root: string) {
 const file = path.join(root, OWNER_ROUTE_ASSET);
 fs.mkdirSync(path.dirname(file), {recursive: true});
 const temporary = fs.mkdtempSync(path.join(path.dirname(file), '.owner-routes-'));
 try {
  const staged = path.join(temporary, 'owner-routes.json');
  fs.writeFileSync(staged, serializeOwnerRouteTable());
  fs.renameSync(staged, file);
 } finally {
  fs.rmSync(temporary, {recursive: true, force: true});
 }
 return file;
}

/** Every option the upstream generator receives for this checkout. Stages patched native source and generated assets. */
export function hostOptions(root = ROOT) {
 const patched = preparePatchedNative({root});
 stageOwnerRouteAsset(root);
 return {
  consumerRoot: root,
  upstreamRoot: path.join(root, 'vendor/eliza'),
  dependencyRoot: path.join(root, 'node_modules'),
  output: path.join(root, 'android'),
  inPlace: true,
  identity: hostIdentity(root),
  profile: hostProfile(root, {patchedNativeRoot: patched.root}),
 };
}

/** Write the generated host into android/. preparePatchedNative authenticates the pinned vendor checkout. */
export function generateAlphaAndroidHost(root = ROOT) {
 return generateAndroidConsumerHost({...hostOptions(root), runtimeDirectory: undefined});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 if (process.argv.length > 2) {
  console.error('Usage: bun scripts/android-host.ts');
  process.exit(2);
 }
 const result = generateAlphaAndroidHost();
 console.log(`Generated the ${result.appId} Android host (${result.files.length} files, Gradle ${result.toolchain}) in ${path.relative(process.cwd(), result.directory) || '.'}`);
}
