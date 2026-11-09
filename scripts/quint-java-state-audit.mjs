import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const javaAuditSource = fileURLToPath(new URL('./QuintJavaStateAudit.java', import.meta.url));
export function javaAuditInputs() {
  return {
    'scripts/QuintJavaStateAudit.java': hash(readFileSync(javaAuditSource)),
    'scripts/quint-java-state-audit.mjs': hash(readFileSync(fileURLToPath(import.meta.url))),
  };
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const executable = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;

function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || `${command} failed with ${result.signal}`);
  return result.stdout;
}

/** The Java parser reads immutable copies and reports the digest of each consumed source. */
export function inspectJavaFiles(root, paths) {
  if (!paths.length) return {};
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-java-state-audit-'));
  const parserBytes = readFileSync(javaAuditSource);
  const inputs = new Map(paths.map(path => [path, hash(readFileSync(resolve(root, path)))]));
  try {
    const parser = join(temporary, 'QuintJavaStateAudit.java');
    writeFileSync(parser, parserBytes);
    run(executable('javac'), ['--release', '21', '-d', temporary, parser]);
    const results = {};
    for (let start = 0; start < paths.length; start += 64) {
      const batch = paths.slice(start, start + 64);
      assert.ok(batch.every(path => !/[\r\n]/.test(path)), 'Java paths must be one input per line');
      const list = join(temporary, 'sources.txt');
      writeFileSync(list, batch.map(path => resolve(root, path)).join('\n') + '\n');
      const records = JSON.parse(run(executable('java'), ['-Xmx512m', '-cp', temporary, 'QuintJavaStateAudit', list, resolve(root)]));
      for (const path of batch) {
        assert.ok(records[path], `Java parser omitted ${path}`);
        assert.equal(records[path].consumedSha256, inputs.get(path), `Java parser consumed changed bytes ${path}`);
      }
      Object.assign(results, records);
    }
    assert.equal(hash(readFileSync(javaAuditSource)), hash(parserBytes), 'Java state parser changed during execution');
    for (const [path, digest] of inputs) assert.equal(hash(readFileSync(resolve(root, path))), digest, `Java source changed during audit ${path}`);
    return results;
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}
