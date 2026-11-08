import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, directory, javaTraces, root} from './java.mjs';

const fixturePath = 'test/reset-startup.test.mjs';
const productSources = ['AlphaDataReset.java', 'AlphaApplication.java', 'ResetAuthorization.java'].map(name => app + name);

/** Read literal Android ports from the existing fixture without executing its tests. */
function existingPorts() {
  const source = readFileSync(join(root, fixturePath), 'utf8');
  const ports = new Map();
  for (const match of source.matchAll(/\bput\('([^']+)',`([^`]*?)`\);/g)) {
    const [, name, literal] = match;
    assert.ok(!literal.includes('${'), 'Fixture ports must remain static template literals');
    if (!name.endsWith('/ResetStartupTest.java')) {
      // The validated expression contains one literal and no interpolation. This preserves
      // JavaScript template escape decoding without running the test or its providers.
      const content = runInNewContext('`' + literal + '`', Object.create(null), {timeout: 1000});
      ports.set(name, content);
    }
  }
  assert.equal(ports.size, 13);
  return ports;
}

function portsWithObservers() {
  const ports = existingPorts();
  const change = (path, before, after) => {
    const value = ports.get(path);
    assert.ok(value?.includes(before), `Fixture contract changed in ${path}`);
    ports.set(path, value.replace(before, after));
  };
  change('ai/elizaresearch/alphaphone/Dependencies.java', 'calls++;return resetSaved;',
    'calls++;ResetTraceHooks.listenerResult(resetSaved);return resetSaved;');
  change('android/content/Context.java', 'recoveries++;', 'recoveries++;ai.elizaresearch.alphaphone.ResetTraceHooks.visibleRecovery();');
  change('android/os/Process.java', 'throw new Exit();', 'ai.elizaresearch.alphaphone.ResetTraceHooks.event("process-exit","");throw new Exit();');
  change('android/app/ActivityManager.java', 'public boolean clearApplicationUserData(){calls++;if(mode==2)throw new SecurityException("fixture refusal");return mode==0;}',
    'public boolean clearApplicationUserData(){calls++;ai.elizaresearch.alphaphone.ResetTraceHooks.event("android-call","");if(mode==2)throw new SecurityException("fixture refusal");boolean accepted=mode==0;ai.elizaresearch.alphaphone.ResetTraceHooks.androidResult(accepted);return accepted;}');
  change('android/system/Os.java', 'public static java.io.FileDescriptor open(String path,int flags,int mode){return new java.io.FileDescriptor();}',
    'public static java.io.FileDescriptor open(String path,int flags,int mode)throws java.io.IOException{if(ai.elizaresearch.alphaphone.ResetTraceHooks.lastCommittedName!=null&&ai.elizaresearch.alphaphone.ResetTraceHooks.lastCommittedName.equals(ai.elizaresearch.alphaphone.ResetTraceHooks.failDirectoryAfter)){ai.elizaresearch.alphaphone.ResetTraceHooks.failDirectoryAfter=null;ai.elizaresearch.alphaphone.ResetTraceHooks.event("directory-sync-failure",path);throw new java.io.IOException("directory sync failure after commit");}return new java.io.FileDescriptor();}');
  // Atomicity belongs to the external storage port. This port commits by atomic rename,
  // can refuse before writing, and emits an observation after the durable commit.
  ports.set('android/util/AtomicFile.java', `package android.util;
import java.io.*;import java.nio.file.*;import ai.elizaresearch.alphaphone.ResetTraceHooks;
public class AtomicFile {
 private final File file;private final File next;
 public AtomicFile(File file){this.file=file;this.next=new File(file.getPath()+".new");}
 public File getBaseFile(){return file;}
 public FileOutputStream startWrite()throws Exception{
  ResetTraceHooks.event("write-start",file.getName());
  if(file.getName().equals(ResetTraceHooks.failWrite))throw new IOException("fixture storage failure");
  return new FileOutputStream(next);
 }
 public void finishWrite(FileOutputStream stream)throws Exception{
  stream.getFD().sync();stream.close();
  if(file.getName().equals(ResetTraceHooks.skipCommitFor)){next.delete();ResetTraceHooks.skipCommitFor=null;ResetTraceHooks.event("replacement-not-committed",file.getName());return;}
  Files.move(next.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
  ResetTraceHooks.lastCommittedName=file.getName();
  ResetTraceHooks.event("durable-write",file.getName());
  if(file.getName().equals(ResetTraceHooks.crashAfterCommit))throw new ResetTraceHooks.Interruption();
 }
 public void failWrite(FileOutputStream stream){try{stream.close();}catch(Exception ignored){}next.delete();}
 public byte[] readFully()throws IOException{return Files.readAllBytes(file.toPath());}
 public void delete(){file.delete();next.delete();}
}`);
  return ports;
}

export async function generateResetOrchestrationTraces(extraSources = []) {
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-reset-refinement-'));
  const inputs = [...productSources, fixturePath, fileURLToPath(import.meta.url),
    join(directory, 'ResetOrchestrationTraces.java'), join(directory, 'ResetTraceHooks.java'),
    join(directory, 'ResetAdmissionRegression.java'),
    join(directory, 'Trace.java'), join(directory, 'java.mjs'), ...extraSources];
  try {
    const ports = portsWithObservers();
    const files = [];
    for (const [name, content] of ports) {
      const path = join(temporary, name);
      mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, content); files.push(path);
    }
    const portHash = createHash('sha256').update(JSON.stringify([...ports])).digest('hex');
    const driverHashes = captureInputs(inputs);
    const traces = javaTraces('ResetOrchestrationTraces.java',
      [...productSources, ...files, join(directory, 'ResetTraceHooks.java')], [join(temporary, 'data')]);
    const regressions = javaTraces('ResetAdmissionRegression.java',
      [...productSources, ...files, join(directory, 'ResetTraceHooks.java')], [join(temporary, 'regressions')]);
    for (const trace of traces) trace.fixturePortSha256 = portHash;
    return {traces, sources: inputs, driverHashes, fixturePortSha256: portHash, regressions};
  } finally { rmSync(temporary, {recursive: true, force: true}); }
}

export async function checkResetOrchestration(extraSources = []) {
  const generated = await generateResetOrchestrationTraces(extraSources);
  const output = join(root, 'test-results/quint-refinement/reset-orchestration-source-traces.json');
  mkdirSync(dirname(output), {recursive: true});
  writeFileSync(output, JSON.stringify(generated, null, 2) + '\n');
  const results = [], receipts = [];
  for (const trace of generated.traces) {
    const id = `ResetRecovery-${trace.name.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    try {
      const receipt = await checkTraces({model: 'ResetRecovery', id, traces: [trace], sources: generated.sources,
        driverHashes: generated.driverHashes, scope: 'bounded-orchestration', assumptions: [
          'Actual unmodified AlphaDataReset, AlphaApplication and ResetAuthorization execute with observed external Android/storage ports.',
          'Every port callback and durable write records all selected source fields. Raw failure count is retained; the model projection saturates it at three.',
          'Fixture AtomicFile commits through atomic rename. Physical power-loss durability, real device credentials and actual package erasure are not established.',
          'Authentication, budget, marker, reservation, callback, recovery and process-exit boundaries are checked separately.',
        ]});
      receipts.push(receipt);
      results.push({name: trace.name, status: receipt.status, receiptPath: receipt.receiptPath});
    } catch (error) {
      const receiptFile = join(root, 'test-results/quint-refinement', `${id}.json`);
      const failed = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : null;
      const kind = failed?.results.find(result => result.kind !== 'passed')?.kind;
      results.push({name: trace.name, status: kind === 'observation-mismatch' ? 'mismatch' : 'failed',
        receiptPath: `test-results/quint-refinement/${id}.json`, error: String(error).split('\n')[0]});
    }
  }
  const summary = {fixturePortSha256: generated.fixturePortSha256, sourceTraces: relative(root, output), regressions: generated.regressions, results};
  writeFileSync(join(root, 'test-results/quint-refinement/reset-orchestration-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return {...summary, receipts};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await checkResetOrchestration();
  const {receipts, ...report} = summary;
  console.log(JSON.stringify(report, null, 2));
  if (summary.results.some(result => result.status !== 'passed')) process.exitCode = 1;
}
