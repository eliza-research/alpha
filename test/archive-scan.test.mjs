import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
for (const mode of ['signed', 'unsigned', 'signed-test-class']) test(`archive scan admits release names and rejects test code: ${mode}`, t => {
  fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
  const dir = fs.mkdtempSync(path.join(root, 'test-results/archive-scan-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const fixtureHome = path.join(dir, 'fixture-home');
  fs.mkdirSync(path.join(fixtureHome, '.config/alphaphone'), {recursive:true});
  fs.writeFileSync(path.join(fixtureHome, '.config/alphaphone/cerebras-key'), 'synthetic-archive-scan-only', {mode:0o600});
  const input = 'android/app/src/androidTest/java/ai/alphacompute/alphaphone/FixtureTest.java';
  fs.writeFileSync(path.join(dir, 'inputs-before.json'), JSON.stringify({files:{[input]:'fixture'}}));
  const manifest = {};
  for (const flavor of ['standalone', 'launcher']) for (const build of ['debug', mode === 'unsigned' ? 'release-unsigned' : 'release']) {
    const name = `${flavor}-${build}.apk`;
    fs.writeFileSync(path.join(dir, 'classes.dex'), mode === 'signed-test-class' && build === 'release' ? 'Lai/alphacompute/alphaphone/FixtureTest;' : 'fixture-dex');
    execFileSync('zip', ['-q', name, 'classes.dex'], {cwd:dir});
    manifest[name] = createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');
  }
  fs.writeFileSync(path.join(dir, 'apk-manifest.json'), JSON.stringify(manifest));
  // Isolated Python fixture: the scanner can only read our synthetic key, never the user's key.
  const runner = 'import runpy,sys; from pathlib import Path; fixture_home=Path(sys.argv[1]); archive=sys.argv[2]; script=sys.argv[3]; Path.home=classmethod(lambda cls: fixture_home); sys.argv=[script,archive]; runpy.run_path(script,run_name="__main__")';
  const result = spawnSync('python3', ['-c', runner, fixtureHome, dir, path.join(root,'scripts/scan-archived-apks.py')], {encoding:'utf8'});
  assert.equal(result.status, mode === 'signed-test-class' ? 1 : 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir,'static-secret-scan.json'),'utf8'));
  assert.equal(report.results.length, 4);
  const releases = report.results.filter(row => row.apk.includes('-release'));
  assert.equal(releases.length, 2);
  assert.ok(releases.every(row => row.androidTestClassesAbsent === (mode !== 'signed-test-class')));
});

test('archive scan without a local provider key stops with a plain reason', t => {
  fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
  const dir = fs.mkdtempSync(path.join(root, 'test-results/archive-scan-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const fixtureHome = path.join(dir, 'fixture-home');
  fs.mkdirSync(fixtureHome);
  fs.writeFileSync(path.join(dir, 'inputs-before.json'), JSON.stringify({files:{}}));
  fs.writeFileSync(path.join(dir, 'apk-manifest.json'), '{}');
  const runner = 'import runpy,sys; from pathlib import Path; fixture_home=Path(sys.argv[1]); archive=sys.argv[2]; script=sys.argv[3]; Path.home=classmethod(lambda cls: fixture_home); sys.argv=[script,archive]; runpy.run_path(script,run_name="__main__")';
  const result = spawnSync('python3', ['-c', runner, fixtureHome, dir, path.join(root,'scripts/scan-archived-apks.py')], {encoding:'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^No provider key at ~\/\.config\/alphaphone\/cerebras-key; this scan checks archives for that key and needs it locally$/m);
  assert.doesNotMatch(result.stderr, /Traceback/);
  assert.equal(fs.existsSync(path.join(dir, 'static-secret-scan.json')), false);
});
