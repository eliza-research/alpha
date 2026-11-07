import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const directory = dirname(fileURLToPath(import.meta.url));
export const app = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
export const sense = 'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/';

function executable(name) {
  for (const candidate of [process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', name),
    `/usr/lib/jvm/java-21-openjdk/bin/${name}`, name].filter(Boolean)) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['-version'], {encoding: 'utf8', timeout: 10000}).status === 0) return candidate;
  }
  throw new Error(`A JDK is required for native refinement (${name})`);
}

function jsonJar() {
  if (process.env.ALPHA_JSON_JAR) return process.env.ALPHA_JSON_JAR;
  const cache = join(homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
  for (const entry of existsSync(cache) ? readdirSync(cache) : []) {
    const path = join(cache, entry, 'json-20250517.jar');
    if (existsSync(path)) return path;
  }
  throw new Error('The pinned org.json 20250517 jar is required for native refinement');
}

export function javaTraces(harness, sources, args = [], mainClass) {
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-native-refinement-'));
  const jar = jsonJar();
  const run = (command, commandArgs) => {
    const result = spawnSync(command, commandArgs, {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error(`${command} failed\n${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  try {
    run(executable('javac'), ['-cp', jar, '-d', temporary, join(directory, 'Trace.java'), join(directory, harness), ...sources.map(path => resolve(root, path))]);
    return JSON.parse(run(executable('java'), ['-cp', `${temporary}:${jar}`, mainClass || `ai.elizaresearch.alphaphone.${harness.replace(/\.java$/, '')}`, ...args]));
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}
