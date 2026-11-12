/** Host-only Kotlin compiler, using the Android build's reviewed dependency pins. */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {javaBinary} from './jvm-tools.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modules = [
  ['org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.2.20'],
  ['org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.20'],
  ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.2.20'],
  ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'],
  ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.2.20'],
  ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'],
  ['org.jetbrains', 'annotations', '13.0'],
];

export function kotlinJars({prepare = false} = {}) {
  const metadata = readFileSync(join(root, 'android/gradle/verification-metadata.xml'), 'utf8');
  const output = process.env.ALPHA_KOTLIN_HOME || join(process.env.RUNNER_TEMP || tmpdir(), 'alpha-host-kotlin');
  return modules.map(([group, name, version]) => {
    const file = `${name}-${version}.jar`;
    const component = metadata.split(`<component group="${group}" name="${name}" version="${version}">`)[1]?.split('</component>')[0];
    const expected = component?.split(`<artifact name="${file}">`)[1]?.split('</artifact>')[0].match(/<sha256 value="([a-f0-9]{64})"/)?.[1];
    if (!expected) throw Error(`Kotlin compiler dependency has no reviewed pin: ${file}`);
    const cached = join(homedir(), '.gradle/caches/modules-2/files-2.1', group, name, version);
    const candidates = [join(output, file), ...(existsSync(cached) ? readdirSync(cached).map(dir => join(cached, dir, file)) : [])];
    const valid = path => existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === expected;
    let found = candidates.find(valid);
    if (!found && prepare) {
      mkdirSync(output, {recursive: true});
      const temporary = join(output, `${file}.${process.pid}.part`);
      try {
        execFileSync('curl', ['--fail', '--location', '--retry', '3', '--max-time', '90', '--output', temporary,
          `https://repo.maven.apache.org/maven2/${group.replaceAll('.', '/')}/${name}/${version}/${file}`], {stdio: 'inherit', timeout: 300000});
        if (!valid(temporary)) throw Error(`Kotlin compiler dependency checksum differs: ${file}`);
        found = join(output, file);
        renameSync(temporary, found);
      } finally {rmSync(temporary, {force: true});}
    }
    if (!found) throw Error(`Prepare the pinned host Kotlin compiler: bun test/fixtures/kotlin-tools.mjs --prepare (${file})`);
    return found;
  });
}

export function compileKotlin(sources, output) {
  const jars = kotlinJars();
  const runtime = [jars[1], jars[6]].join(delimiter);
  execFileSync(javaBinary('java'), ['-cp', jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-jvm-target', '11', '-classpath', runtime, '-d', output, ...sources],
  {timeout: 120000, stdio: 'pipe'});
  return [output, runtime].join(delimiter);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  kotlinJars({prepare: process.argv.includes('--prepare')});
  console.log('Reviewed host Kotlin compiler ready');
}
