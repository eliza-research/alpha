import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectJavaFiles} from '../scripts/quint-java-state-audit.mjs';
import {inspectStateCandidates, writeStateAudit, checkStateAudit} from '../scripts/quint-state-audit.mjs';
test('state audit retains mutable readonly containers and asynchronous closure writes', () => {
  const report = inspectStateCandidates('fixture.ts', `
    let generation = 0;
    const fixed = 7;
    class Owner {
      readonly pending = new Set<number>();
      readonly constant = 3;
      active = false;
      constructor() { this.implicit = 1; }
      start() {
        this.pending.add(1);
        setTimeout(() => { generation++; this.active = true; }, 1);
      }
    }
    const [state, setState] = useState(false);
  `);
  assert.deepEqual(report.parseErrors, []);
  assert.ok(report.candidates.some(item => item.name === 'pending' && item.readonly && item.writes.some(write => write.operation === '.add()')));
  assert.ok(report.candidates.some(item => item.name === 'active' && item.writes.some(write => write.operation === '=')));
  assert.ok(report.candidates.some(item => item.name === 'generation' && item.writes.some(write => write.operation === '++')));
  assert.ok(report.candidates.some(item => item.name === 'implicit' && item.kind === 'inferred-class-field'));
  assert.ok(report.candidates.some(item => item.name === 'state' && item.reason === 'state-hook'));
  assert.ok(!report.candidates.some(item => item.name === 'fixed' || item.name === 'constant'));
  assert.ok(report.asynchronous.some(item => item.operation === 'setTimeout'));
  const unknown = inspectStateCandidates('unknown.ts', 'getOwner().active = true;');
  assert.equal(unknown.writeSites, 1);
  assert.equal(unknown.unassignedWrites.length, 1);
});

test('state audit binds its detailed report and refuses changed source bytes', t => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-state-audit-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'specs/quint'), {recursive: true});
  const source = 'export let active = false; active = true;';
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'owner.ts'), source);
  writeFileSync(join(root, 'Owner.java'), 'class Owner {}');
  writeFileSync(join(root, 'specs/quint/coverage.json'), JSON.stringify({upstream: {commit: 'fixture'}, files: [
    {path: 'owner.ts', sha256: sha256(source), models: ['Application'], reviewStatus: 'state-audit-required'},
    {path: 'Owner.java', sha256: sha256('class Owner {}'), models: ['Application'], reviewStatus: 'state-audit-required'},
  ]}));
  const counts = writeStateAudit(root);
  assert.equal(counts.files, 2);
  assert.equal(counts.parsedFiles, 2);
  assert.equal(counts.languageReview, 0);
  const summary = JSON.parse(readFileSync(join(root, 'specs/quint/state-audit.json')));
  const detail = readFileSync(join(root, summary.detail.path));
  assert.equal(sha256(detail), summary.detail.sha256);
  assert.equal(summary.files[0].owners[0].bindings, 1);
  assert.deepEqual(checkStateAudit(root), []);
  assert.equal(JSON.parse(detail).files[0].candidates[0].name, 'active');
  writeFileSync(join(root, 'owner.ts'), source + ' active = false;');
  assert.ok(checkStateAudit(root).some(problem => problem.includes('owner.ts')));
  assert.throws(() => writeStateAudit(root), /current source bytes/);
});
test('committed state candidate audit matches its source inputs', () => {
  assert.deepEqual(checkStateAudit(process.cwd()), []);
});

test('Java audit observes final containers and monitor-protected field writes', t => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-java-audit-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'Owner.java'), `
    import java.util.*;
    class Owner {
      final Map<String, String> pending = new HashMap<>();
      int generation;
      void start() { synchronized (pending) { pending.put("key", "value"); generation++; } }
      void change(int value) { value++; }
      void change(long value) { value--; }
    }
  `);
  const parsed = inspectJavaFiles(root, ['Owner.java'])['Owner.java'];
  assert.deepEqual(parsed.parseErrors, []);
  assert.ok(parsed.candidates.some(item => item.name === 'pending' && item.readonly && item.writes.some(write => write.operation === '.put()')));
  const generation = parsed.candidates.find(item => item.name === 'generation');
  assert.ok(generation.writes.some(write => write.guards.some(guard => guard.includes('synchronized'))));
  const overloaded = parsed.candidates.filter(item => item.name === 'value');
  assert.equal(overloaded.length, 2);
  assert.notEqual(overloaded[0].owner, overloaded[1].owner);
  assert.deepEqual(overloaded.map(item => item.writes.length), [1, 1]);
  assert.match(parsed.consumedSha256, /^[a-f0-9]{64}$/);
});
