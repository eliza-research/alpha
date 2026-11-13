import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fixture, jvmSkip, nativeSource, runJvm} from './fixtures/jvm-tools.mjs';

const skip = jvmSkip('javac');
// Compile the production storageShare, path validation and typed refusal body.
// Android intent construction and URI publication are observable closed ports.
function runShareFixture(caseName) {
  const source = readFileSync(nativeSource('AlphaFilesPlugin.java'), 'utf8');
  const strings = source.slice(source.indexOf(' private static List<String> strings('), source.indexOf(' private static List<String> reviewedTokens('));
  const limit = source.indexOf(' private static final int MAX_SHARE_FILES');
  const share = source.slice(limit < 0 ? source.indexOf(' /** One share sheet') : limit, source.indexOf(' /** Opens a file in this app'));
  assert.match(strings, /array\.length\(\)>max/);
  assert.match(share, /public void storageShare\(PluginCall call\)/);
  const temp = mkdtempSync(join(tmpdir(), 'alpha-files-share-'));
  try {
    const path = join(temp, 'AlphaFilesShareTest.java');
    const testSource = readFileSync(fixture('AlphaFilesShareTest.java.txt'), 'utf8');
    assert.equal(testSource.split('/* production strings */').length, 2);
    assert.equal(testSource.split('/* production share */').length, 2);
    writeFileSync(path, testSource.replace('/* production strings */', strings).replace('/* production share */', share.replace('@PluginMethod ', '')));
    return runJvm([path], 'AlphaFilesShareTest', {args:[caseName]}).trim();
  } finally {
    rmSync(temp, {recursive:true, force:true});
  }
}

for (const [name, expected] of [
  ['101 files', 'unsupported|Select up to 100 files to share.|0|0|0'],
  ['mixed directory', 'unsupported|Select files without folders to share.|0|0|0'],
  ['missing file', 'missing|This item is no longer there.|0|0|0'],
  ['100 files', 'opened||100|1|100'],
  ['single file', 'opened||1|1|1'],
  ['duplicate file', 'invalid|Invalid name or path.|0|0|0'],
]) {
  test(`native Files share ${name}`, {skip}, () => assert.equal(runShareFixture(name), expected));
}
