import assert from 'node:assert/strict';
import {currentNativeSource} from '../refinement/native/current-sources.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const work = mkdtempSync(join(tmpdir(), 'alpha-quint-native-'));
const quint = join(root, 'node_modules/.bin/quint');
const specification = join(directory, 'AlwaysOnListener.qnt');
const nativeDirectory = join(root, 'android/app/src/main/java/ai/elizaresearch/alphaphone');
const listenerDirectory = join(root, 'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense');

function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024});
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
  'paused-indicator': 'PAUSED_FULLSCREEN',
  'indicator-unavailable': 'INDICATOR_UNAVAILABLE',
  'paused-mic-unavailable': 'PAUSED_MIC_UNAVAILABLE',
  listening: 'LISTENING',
};
const fields = ['consent', 'enabled', 'permission', 'notification', 'foregroundUser',
  'unlocked', 'speechReady', 'crashLoop', 'paused', 'inCall', 'otherMic', 'silenced',
  'explainedPause', 'indicatorLost'];

try {
  run(quint, ['test', specification, '--backend=typescript', '--seed=1701', '--max-samples=1',
    '--out-itf', join(work, 'scenario_{test}_{seq}.json'), '--verbosity=0']);
  run(quint, ['run', specification, '--backend=typescript', '--seed=1701', '--max-samples=32',
    '--n-traces=32', '--max-steps=60', '--invariant=safety',
    '--out-itf', join(work, 'sample_{seq}.json'), '--verbosity=0']);
  const rows = [];
  const decisions = new Set();
  for (const name of readdirSync(work).filter(name => name.endsWith('.json')).sort()) {
    const trace = JSON.parse(readFileSync(join(work, name), 'utf8'));
    for (const [index, state] of trace.states.entries()) {
      const model = state.s;
      assert.equal(model.image, true, 'Listener trace unexpectedly uses a non-image deployment');
      assert.ok(enumNames[model.decision], `Unknown model decision ${model.decision}`);
      decisions.add(model.decision);
      rows.push([`${name}/${index}`, ...fields.map(field => model[field]), model.lease === 'fresh',
        enumNames[model.decision], model.microphone, model.analyzing].join(','));
    }
  }
  assert.ok(rows.length > 100, 'Too few Quint states were emitted');
  for (const required of ['off', 'listening', 'stopped-indicator-lost', 'paused-indicator', 'paused-mic-unavailable']) {
    assert.ok(decisions.has(required), `Missing required policy state ${required}`);
  }
  const inputs = join(work, 'listener.csv');
  writeFileSync(inputs, rows.join('\n') + '\n');
  const harness = join(work, 'NativeQuintConformance.java');
  writeFileSync(harness, `package ai.elizaresearch.alphaphone;
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
    int states = 0;
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
      input.indicatorPause = bool(row, 13) ? ListenerPolicy.IndicatorPause.FULLSCREEN : ListenerPolicy.IndicatorPause.NONE;
      input.indicatorLost = bool(row, 14);
      input.indicatorLeaseValid = bool(row, 15);
      ListenerPolicy.State actual = ListenerPolicy.decide(input, 0);
      check(actual.name().equals(row[16]), row[0] + " expected " + row[16] + " got " + actual);
      check(ListenerPolicy.holdsMicrophone(actual) == bool(row, 17), row[0] + " microphone projection");
      check(ListenerPolicy.processesAudio(actual) == bool(row, 18), row[0] + " processing projection");
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
    System.out.println("native conformance passed " + states + " Quint states and " + checks + " Java assertions");
  }
}
`);
  run('javac', ['-d', work, harness, join(listenerDirectory, 'ListenerPolicy.java'),
    currentNativeSource('ResetAuthorization.java'), currentNativeSource('SpeechAudioFocusPolicy.java'),
    join(listenerDirectory, 'IndicatorLease.java'), join(listenerDirectory, 'CrashLoopBreaker.java'),
    join(nativeDirectory, 'ResidentScheduleRearm.java')]);
  console.log(run('java', ['-cp', work, 'ai.elizaresearch.alphaphone.NativeQuintConformance', inputs]));
  console.log(`Listener decisions covered ${[...decisions].sort().join(', ')}`);
  const {usableNavigationFix} = await import(pathToFileURL(join(root, 'apps/app/src/maps/navigation-fix.ts')).href);
  const {atStep} = await import(pathToFileURL(join(root, 'apps/app/src/maps/guidance.ts')).href);
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
} finally {
  rmSync(work, {recursive: true, force: true});
}
