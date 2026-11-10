import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const native = join(root, 'android/app/src/main/java/ai/alphacompute/alphaphone');
const speech = join(root, 'vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice');
const models = ['RendererRecovery', 'VadSegmentation'];

function run(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function jdkTool(name) {
  const candidates = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', name),
    `/usr/lib/jvm/java-21-openjdk/bin/${name}`,
    name,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-version'], {encoding: 'utf8', timeout: 10_000});
    if (probe.status === 0) return candidate;
  }
  throw new Error(`A JDK with ${name} is required for native policy conformance`);
}

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if ('#bigint' in value) return Number(value['#bigint']);
    if ('#set' in value) return value['#set'].map(decode);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decode(entry)]));
  }
  return value;
}

/** Replay model-generated traces through the actual pure Java implementations. */
export async function runRecoveryVadConformance() {
  const work = mkdtempSync(join(tmpdir(), 'alpha-recovery-vad-'));
  const quint = join(root, 'node_modules/.bin/quint');
  const statistics = {};
  const lines = [];
  try {
    for (const model of models) {
      const specification = join(directory, `${model}.qnt`);
      run(quint, ['test', specification, '--backend=typescript', '--seed=1701', '--max-samples=1',
        '--out-itf', join(work, `${model}-scenario_{test}_{seq}.json`), '--verbosity=0']);
      run(quint, ['run', specification, '--backend=typescript', '--seed=1701', '--max-samples=32',
        '--n-traces=32', '--max-steps=80', '--invariant=safety',
        '--out-itf', join(work, `${model}-sample_{seq}.json`), '--verbosity=0']);
      const files = readdirSync(work).filter(name => name.startsWith(`${model}-`) && name.endsWith('.json')).sort();
      let states = 0;
      let transitions = 0;
      for (const name of files) {
        const trace = JSON.parse(readFileSync(join(work, name), 'utf8'));
        let prior;
        lines.push(model === 'RendererRecovery' ? 'R,reset' : 'V,reset');
        for (const row of trace.states) {
          const state = decode(row.s);
          states++;
          if (prior && JSON.stringify(prior) === JSON.stringify(state)) continue;
          transitions++;
          if (model === 'RendererRecovery') {
            lines.push(['R', state.operation, state.lossTime, state.home, state.decision,
              state.delay, state.started, state.windowStart, state.losses].join(','));
          } else {
            lines.push(['V', state.operation, state.probability, state.edge, state.closeReturned,
              state.speaking, state.above, state.below].join(','));
          }
          prior = state;
        }
      }
      assert.ok(states > 1000, `${model} did not emit enough states`);
      statistics[model] = {traces: files.length, states, transitions};
    }
    const input = join(work, 'traces.csv');
    writeFileSync(input, lines.join('\n') + '\n');
    const harness = join(work, 'RecoveryVadConformance.java');
    writeFileSync(harness, `package ai.alphacompute.alphaphone;
import ai.eliza.voice.LiveVadGate;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
public final class RecoveryVadConformance {
  private static int checks;
  private static void check(boolean result, String message) { checks++; if (!result) throw new AssertionError(message); }
  private static int integer(Object object, String name) throws Exception { Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.getInt(object); }
  private static long longValue(Object object, String name) throws Exception { Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.getLong(object); }
  private static boolean bool(Object object, String name) throws Exception { Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.getBoolean(object); }
  public static void main(String[] args) throws Exception {
    RendererRecoveryBudget renderer = null;
    LiveVadGate vad = null;
    int rowNumber=0;
    for (String line : Files.readAllLines(Path.of(args[0]))) {
      rowNumber++; String[] row=line.split(","); String label="row "+rowNumber;
      if (row[0].equals("R")) {
        if (row[1].equals("reset")) { renderer=new RendererRecoveryBudget(); continue; }
        if (row[1].equals("loss")) {
          // This budget projection covers genuine renderer crashes while the Activity is visible.
          RendererRecoveryBudget.Action result=renderer.onLoss(Long.parseLong(row[2]),Boolean.parseBoolean(row[3]),true,true);
          check(result.name().equals(row[4]),label+" renderer decision "+result+" expected "+row[4]);
          check(RendererRecoveryBudget.delay(result)==Long.parseLong(row[5]),label+" renderer delay");
        }
        check(bool(renderer,"started")==Boolean.parseBoolean(row[6]),label+" budget initialized");
        check(longValue(renderer,"windowStart")==Long.parseLong(row[7]),label+" window start");
        check(Math.min(4,integer(renderer,"lossesInWindow"))==Integer.parseInt(row[8]),label+" loss count projection");
      } else {
        if (row[1].equals("reset")) { vad=new LiveVadGate(); continue; }
        if (row[1].equals("accept")) {
          int code=Integer.parseInt(row[2]);
          float probability=code==-1001?Float.NaN:code==-1000?Float.POSITIVE_INFINITY:code==-999?Float.NEGATIVE_INFINITY:code/1000f;
          LiveVadGate.Edge edge=vad.accept(probability);
          check(edge.name().equals(row[3]),label+" VAD edge "+edge+" expected "+row[3]);
        } else if (row[1].equals("close")) check(vad.close()==Boolean.parseBoolean(row[4]),label+" VAD close return");
        check(vad.speaking()==Boolean.parseBoolean(row[5]),label+" VAD speaking");
        check(integer(vad,"above")==Integer.parseInt(row[6]),label+" VAD above counter");
        check(integer(vad,"below")==Integer.parseInt(row[7]),label+" VAD below counter");
      }
    }
    check(RendererRecoveryBudget.homeChoiceAction(Set.of(RendererRecoveryBudget.ACTION_SETTINGS)::contains).equals(RendererRecoveryBudget.ACTION_SETTINGS),"Settings fallback");
    check(RendererRecoveryBudget.homeChoiceAction(action->false)==null,"Absent Settings handler");
    check(LiveVadGate.WINDOW==512&&LiveVadGate.START_WINDOWS==2&&LiveVadGate.END_WINDOWS==16&&LiveVadGate.PREROLL_WINDOWS==10,"VAD constants");
    System.out.println(checks);
  }
}
`);
    const javac = jdkTool('javac');
    const java = jdkTool('java');
    const sources = [join(native, 'RendererRecoveryBudget.java'), join(speech, 'LiveVadGate.java')];
    run(javac, ['-d', work, harness, ...sources]);
    const checks = Number(run(java, ['-cp', work, 'ai.alphacompute.alphaphone.RecoveryVadConformance', input]));
    assert.ok(Number.isSafeInteger(checks) && checks > 1000);
    return {models: statistics, javaAssertions: checks, java, javac,
      sources: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))};
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runRecoveryVadConformance(), null, 2));
}
