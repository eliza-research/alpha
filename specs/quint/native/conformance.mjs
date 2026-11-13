import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {captureReplayInputs, observedReplay, recordComparedObservation} from '../refinement/observed-replay.mjs';
import {scaledTimeout} from '../refinement/timeouts.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const quint = join(root, 'node_modules/.bin/quint');
const specification = join(directory, 'AlwaysOnListenerIndicatorReadback.qnt');
const nativeDirectory = join(root, 'android/app/src/main/java/ai/alphacompute/alphaphone');
const listenerDirectory = join(root, 'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense');
const speechDirectory = join(root, 'vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice');
const resetDirectory = join(root, 'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/reset');

function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout: scaledTimeout(120_000), maxBuffer: 8 * 1024 * 1024});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

// The expected projection is evaluated by Quint and recorded in every state. This
// adapter maps vocabulary only; it does not recompute the policy in JavaScript.
const enumNames = {
  off: 'OFF',
  'permission-required': 'PERMISSION_REQUIRED',
  'notifications-required': 'NOTIFICATIONS_REQUIRED',
  'stopped-errors': 'STOPPED_AFTER_ERRORS',
  'stopped-indicator-lost': 'STOPPED_INDICATOR_LOST',
  'other-user': 'PAUSED_OTHER_USER',
  'waiting-unlock': 'WAITING_FOR_UNLOCK',
  'speech-unavailable': 'SPEECH_UNAVAILABLE',
  'paused-user': 'PAUSED_USER',
  'paused-call': 'PAUSED_CALL',
  'paused-mic-in-use': 'PAUSED_MIC_IN_USE',
  'paused-display-off': 'PAUSED_DISPLAY_OFF',
  'paused-fullscreen': 'PAUSED_FULLSCREEN',
  'paused-shade': 'PAUSED_SHADE',
  'paused-transition': 'PAUSED_TRANSITION',
  'indicator-unavailable': 'INDICATOR_UNAVAILABLE',
  'paused-mic-unavailable': 'PAUSED_MIC_UNAVAILABLE',
  listening: 'LISTENING',
};
const fields = ['consent', 'enabled', 'permission', 'notification', 'foregroundUser',
  'unlocked', 'speechReady', 'crashLoop', 'paused', 'inCall', 'otherMic', 'silenced'];
// Each lease verdict the model applied, replayed through the listener's pure latch and pause rules.
const observation = ['operation', 'obsHeld', 'obsBefore', 'obsLoss', 'obsInteractive', 'obsValid', 'obsLatched'];

async function runIndicatorReadback() {
 const work = mkdtempSync(join(tmpdir(), 'alpha-quint-native-'));
 try {
  run(quint, ['test', specification, '--backend=typescript', '--seed=1701', '--max-samples=1',
    '--out-itf', join(work, 'scenario_{test}_{seq}.json'), '--verbosity=0']);
  run(quint, ['run', specification, '--backend=typescript', '--seed=1701', '--max-samples=32',
    '--n-traces=32', '--max-steps=60', '--invariant=safety',
    '--out-itf', join(work, 'sample_{seq}.json'), '--verbosity=0']);
  const rows = [], modelStates = [];
  const decisions = new Set();
  const verdicts = new Set();
  for (const name of readdirSync(work).filter(name => name.endsWith('.json')).sort()) {
    const trace = JSON.parse(readFileSync(join(work, name), 'utf8'));
    for (const [index, state] of trace.states.entries()) {
      const model = state.s;
      assert.ok(enumNames[model.decision], `Unknown model decision ${model.decision}`);
      decisions.add(model.decision);
      if (model.operation === 'observe') verdicts.add(`${model.obsBefore}/${model.obsLoss}/${model.obsHeld}/${model.obsLatched}`);
      modelStates.push({trace: name, step: index, model});
      rows.push([`${name}/${index}`, ...fields.map(field => model[field]), model.indicatorPause, model.indicatorLost,
        model.lease === 'fresh', enumNames[model.decision], model.microphone, model.analyzing,
        ...observation.map(field => model[field])].join(','));
    }
  }
  assert.ok(rows.length > 100, 'Too few Quint states were emitted');
  for (const required of ['off', 'listening', 'stopped-indicator-lost', 'paused-display-off', 'paused-fullscreen',
    'paused-shade', 'paused-transition', 'indicator-unavailable', 'paused-mic-unavailable']) {
    assert.ok(decisions.has(required), `Missing required policy state ${required}`);
  }
  // A latch while capturing, a latch during an explained pause, and a display-off lapse that does not latch.
  for (const required of ['NONE/EXPIRED/true/true', 'FULLSCREEN/REVOKED/false/true', 'DISPLAY_OFF/EXPIRED/false/false']) {
    assert.ok(verdicts.has(required), `Missing required lease verdict ${required}`);
  }
  const inputs = join(work, 'listener.csv');
  writeFileSync(inputs, rows.join('\n') + '\n');
  const harness = join(work, 'NativeQuintConformance.java');
  writeFileSync(harness, `package ai.alphacompute.alphaphone;
import ai.eliza.sense.ListenerPolicy;
import ai.eliza.sense.IndicatorLease;
import ai.eliza.sense.CrashLoopBreaker;
import ai.eliza.voice.SpeechAudioFocusPolicy;
import ai.eliza.plugins.system.reset.ResetAuthorization;
import java.nio.file.Files;
import java.nio.file.Path;

public final class NativeQuintConformance {
  private static int checks;
  private static void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }
  private static boolean bool(String[] row, int index) { return Boolean.parseBoolean(row[index]); }
  public static void main(String[] args) throws Exception {
    int states = 0, observations = 0;
    for (String line : Files.readAllLines(Path.of(args[0]))) {
      String[] row = line.split(",");
      ListenerPolicy.Inputs input = new ListenerPolicy.Inputs();
      input.consentVersion = bool(row, 1) ? ListenerPolicy.CONSENT_VERSION : 0;
      input.enabled = bool(row, 2);
      input.recordAudioGranted = bool(row, 3);
      input.notificationsVisible = bool(row, 4);
      input.userForeground = bool(row, 5);
      input.userUnlocked = bool(row, 6);
      input.speechUnavailable = !bool(row, 7);
      input.crashLoopTripped = bool(row, 8);
      input.pausedUntilMs = bool(row, 9) ? Long.MAX_VALUE : 0;
      input.inCall = bool(row, 10);
      input.otherAppRecording = bool(row, 11);
      input.micSilenced = bool(row, 12);
      input.indicatorPause = ListenerPolicy.IndicatorPause.valueOf(row[13]);
      input.indicatorLost = bool(row, 14);
      input.indicatorLeaseValid = bool(row, 15);
      ListenerPolicy.State actual = ListenerPolicy.decide(input, 0);
      check(actual.name().equals(row[16]), row[0] + " expected " + row[16] + " got " + actual);
      check(ListenerPolicy.holdsMicrophone(actual) == bool(row, 17), row[0] + " microphone projection");
      check(ListenerPolicy.processesAudio(actual) == bool(row, 18), row[0] + " processing projection");
      String observedValid = "-", observedLatch = "-", observedPause = "-";
      if (row[19].equals("observe")) {
        // The listener's step on one lease verdict: the same pure rules in the order Listener applies them.
        boolean held = bool(row, 20);
        ListenerPolicy.IndicatorPause before = ListenerPolicy.IndicatorPause.valueOf(row[21]);
        IndicatorLease.Loss loss = IndicatorLease.Loss.valueOf(row[22]);
        boolean valid = loss == IndicatorLease.Loss.NONE;
        boolean asleep = IndicatorLease.sleepLapse(held, before, loss);
        boolean latches = !asleep && ListenerPolicy.latchesIndicatorLoss(held || before != ListenerPolicy.IndicatorPause.NONE, valid, loss.pause());
        ListenerPolicy.IndicatorPause pause = asleep && !bool(row, 23) ? ListenerPolicy.IndicatorPause.DISPLAY_OFF : IndicatorLease.pauseFor(loss);
        check(valid == bool(row, 24), row[0] + " lease validity");
        check(latches == bool(row, 25), row[0] + " indicator latch");
        check(pause.name().equals(row[13]), row[0] + " explained pause " + pause + " expected " + row[13]);
        check(valid == bool(row, 15), row[0] + " lease projection");
        observedValid = Boolean.toString(valid); observedLatch = Boolean.toString(latches); observedPause = pause.name();
        observations++;
      }
      System.out.println("OBS\t" + row[0] + "\t" + actual.name() + "\t" + ListenerPolicy.holdsMicrophone(actual) + "\t" + ListenerPolicy.processesAudio(actual) + "\t" + observedValid + "\t" + observedLatch + "\t" + observedPause);
      states++;
    }

    // These exercise real stateful methods independently of sampled listener projection.
    ResetAuthorization authorization = new ResetAuthorization();
    long old = authorization.begin();
    check(!authorization.confirm(old + 1), "stale review cannot confirm");
    check(!authorization.authenticate(old, true), "authentication without disclosure");
    long current = authorization.begin();
    check(authorization.confirm(current), "current review confirms");
    authorization.retire();
    check(!authorization.authenticate(current, true), "retired activity cannot reset");
    current = authorization.begin();
    check(authorization.confirm(current), "fresh review confirms");
    check(authorization.authenticate(current, true), "fresh credential approves once");
    check(!authorization.authenticate(current, true), "credential approval is single use");

    SpeechAudioFocusPolicy focus = new SpeechAudioFocusPolicy();
    check(focus.granted(true), "focus granted");
    check(focus.changed(SpeechAudioFocusPolicy.Event.LOSS_TRANSIENT_CAN_DUCK) == SpeechAudioFocusPolicy.Action.DUCK, "duck");
    check(focus.changed(SpeechAudioFocusPolicy.Event.LOSS_TRANSIENT_CAN_DUCK) == SpeechAudioFocusPolicy.Action.NONE, "duplicate duck");
    check(focus.changed(SpeechAudioFocusPolicy.Event.GAIN) == SpeechAudioFocusPolicy.Action.RESTORE, "restore");
    check(focus.changed(SpeechAudioFocusPolicy.Event.LOSS) == SpeechAudioFocusPolicy.Action.STOP, "loss stops");
    check(!focus.held(), "loss releases focus");
    check(focus.released(), "a granted request is abandoned after a loss ended the utterance");
    check(!focus.released(), "nothing is abandoned twice");
    check(!focus.granted(false) && !focus.released(), "a denied request is never abandoned");
    check(IndicatorLease.sleepLapse(false, ListenerPolicy.IndicatorPause.DISPLAY_OFF, IndicatorLease.Loss.PENDING), "display-off lapse");
    check(!IndicatorLease.sleepLapse(true, ListenerPolicy.IndicatorPause.DISPLAY_OFF, IndicatorLease.Loss.EXPIRED), "a held microphone is never a lapse");
    check(SpeechAudioFocusPolicy.stopsCapture(SpeechAudioFocusPolicy.Action.STOP, SpeechAudioFocusPolicy.Mode.IN_CALL), "call stops capture");
    check(SpeechAudioFocusPolicy.admission(SpeechAudioFocusPolicy.Mode.IN_CALL).equals(SpeechAudioFocusPolicy.CALL_ACTIVE), "call admission");
    IndicatorLease lease = new IndicatorLease();
    long token = lease.acquire(0);
    check(lease.verdict(0, 0, false) == IndicatorLease.Loss.PENDING, "lease waits for visible acknowledgement");
    check(lease.renew(token, 0, 0, true, false, false), "first visible lease");
    check(lease.verdict(2499, 0, false) == IndicatorLease.Loss.NONE, "lease inside deadline");
    check(lease.verdict(2499, 0, true) == IndicatorLease.Loss.UNATTRIBUTED, "attribution requires chip and recording");
    check(lease.verdict(3000, 0, false) == IndicatorLease.Loss.EXPIRED, "exact expiry boundary");
    check(!lease.renew(token, 3000, 0, true, true, true), "expired token cannot renew");
    long replacement = lease.acquire(0);
    check(!lease.renew(token, 3000, 0, true, true, true), "replaced token cannot renew");
    check(lease.renew(replacement, 3000, 0, false, false, false, "off", "none"), "explained hidden lease renews");
    check(lease.verdict(3000, 0, false) == IndicatorLease.Loss.DISPLAY_OFF, "display-off pauses");
    check(lease.renew(replacement, 3000, 0, true, true, true), "fresh visible return");
    check(lease.verdict(3000, 1, false) == IndicatorLease.Loss.OTHER_BOOT, "another boot retires lease");
    check(!CrashLoopBreaker.uncleanExit(true, 0, 1, 1, 1), "reboot is not crash");
    check(!CrashLoopBreaker.uncleanExit(true, 0, 0, 1, 2), "package update is not crash");
    check(CrashLoopBreaker.uncleanExit(true, -1, 0, 1, 1), "unknown boot counted conservatively");
    long[] exits = CrashLoopBreaker.onProcessStart(new long[]{0, 0}, true, 0);
    check(CrashLoopBreaker.tripped(exits, 0), "third unclean start trips");
    check(CrashLoopBreaker.prune(exits, 600000).length == 0, "exact crash window boundary");
    Object lifecycleLock = new Object();
    final boolean[] started = {false};
    check(ResidentScheduleRearm.admitAndStart(lifecycleLock, ResidentScheduleRearm.TIME_SET, true, true, true,
      () -> { check(Thread.holdsLock(lifecycleLock), "admission holds lifecycle lock"); return true; },
      () -> { check(Thread.holdsLock(lifecycleLock), "start holds same lifecycle lock"); started[0] = true; }) == ResidentScheduleRearm.Decision.START,
      "admitted rearm");
    check(started[0], "rearm invokes start");
    check(ResidentScheduleRearm.decide(ResidentScheduleRearm.TIME_SET, true, true, true, false) == ResidentScheduleRearm.Decision.LIFECYCLE_BUSY, "busy lifecycle refuses rearm");
    check(ResidentScheduleRearm.decide(ResidentScheduleRearm.BOOT_COMPLETED, false, true, true, true) == ResidentScheduleRearm.Decision.LOCKED, "boot waits for unlock");
    check(observations > 20, "too few lease verdicts were replayed");
    System.out.println("native conformance passed " + states + " Quint states, " + observations + " lease verdicts and " + checks + " Java assertions");
  }
}
`);
  const javaSources = [harness, join(listenerDirectory, 'ListenerPolicy.java'),
    join(resetDirectory, 'ResetAuthorization.java'), join(speechDirectory, 'SpeechAudioFocusPolicy.java'),
    join(listenerDirectory, 'IndicatorLease.java'), join(listenerDirectory, 'CrashLoopBreaker.java'),
    join(nativeDirectory, 'ResidentScheduleRearm.java')];
  captureReplayInputs([specification, inputs, ...javaSources]);
  run('javac', ['-d', work, ...javaSources]);
  const output = run('java', ['-cp', work, 'ai.alphacompute.alphaphone.NativeQuintConformance', inputs]);
  const observedRows = output.split('\n').filter(line => line.startsWith('OBS\t'));
  assert.equal(observedRows.length, modelStates.length, 'One actual Java observation per Quint state');
  for (const [at, line] of observedRows.entries()) {
    const [_, label, decision, microphone, analyzing, valid, latches, pause] = line.split('\t');
    const {trace, step, model} = modelStates[at];
    assert.equal(label, trace + '/' + step);
    const actual = {decision, microphone: microphone === 'true', analyzing: analyzing === 'true'};
    const expected = {decision: enumNames[model.decision], microphone: model.microphone, analyzing: model.analyzing};
    if (model.operation === 'observe') {
      Object.assign(actual, {valid: valid === 'true', latches: latches === 'true', pause});
      Object.assign(expected, {valid: model.obsValid, latches: model.obsLatched, pause: model.indicatorPause});
    }
    assert.deepEqual(actual, expected, label + ' actual policy/readback projection');
    recordComparedObservation({trace, step, actual, expected});
  }
  console.log(output.split('\n').filter(line => !line.startsWith('OBS\t')).join('\n'));
  console.log(`Listener decisions covered ${[...decisions].sort().join(', ')}`);
  const {usableNavigationFix} = await import(pathToFileURL(join(root, '.eliza/client-features/plugins/plugin-maps/src/client/navigation-fix.ts')).href);
  const {atStep} = await import(pathToFileURL(join(root, '.eliza/client-features/plugins/plugin-maps/src/client/guidance.ts')).href);
  const fixCases = [
    [30, 30000, 'precise', true], [51, 0, 'precise', false],
    [30, 30001, 'precise', false], [30, -5000, 'precise', true],
    [30, -5001, 'precise', false], [30, 0, 'approximate', false],
    [-1, 0, 'precise', false],
  ];
  for (const [accuracyMeters, age, precision, accepted] of fixCases) {
    assert.equal(usableNavigationFix({coordinate: {latitude: 0, longitude: 0},
      accuracyMeters, timestamp: 100000 - age, precision}, 100000), accepted);
  }
  const steps = [{instruction: 'first'}, {instruction: 'second'}, {instruction: 'last'}];
  const projection = {alongMeters: 80, maneuverAlongMeters: [0, 100, 200],
    remainingMeters: 120, remainingSeconds: 12, next: {index: 2, step: steps[2], distanceMeters: 120}};
  assert.equal(atStep(projection, steps, 0).next.index, 0, 'Sparse projection cannot skip the cursor');
  assert.equal(atStep(projection, steps, 0).next.distanceMeters, 0, 'Passed projection distance clamps to zero');
  assert.equal(atStep(projection, steps, 2).then, undefined, 'Last maneuver has no later instruction');
  console.log('Navigation conformance passed 10 TypeScript boundary assertions');
  return {traces: new Set(modelStates.map(row => row.trace)).size, checkpoints: observedRows.length};
} finally {
  rmSync(work, {recursive: true, force: true});
}

}

export async function checkAlwaysOnListenerIndicatorReadback(extraSources = []) {
  const receipt = await observedReplay({model: 'AlwaysOnListenerIndicatorReadback', run: runIndicatorReadback,
    prefix: 'indicatorReadbackProjection',
    projection: 'Actual ListenerPolicy decision/microphone/audio projection and IndicatorLease pause/latch readback at every emitted model state. This does not observe the complete Listener store, recognition epochs or service lifecycle.',
    assumptions: ['The original eight model scenarios, 32 sampled walks, required policy decisions, required lease verdicts and all additional Java/navigation assertions remain enforced.',
      'Pure shared Java rules execute with controlled policy inputs. Installed attribution, listener service scheduling and physical microphone acceptance remain separate.'],
    extraSources: [fileURLToPath(import.meta.url), ...extraSources]});
  return {receipt, obligations: [{model: receipt.model, obligation: 'Full listener/service refinement and installed attribution',
    reason: receipt.projection}]};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runIndicatorReadback();
