import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {androidEnv} from './toolchain.ts';

const [appApk, testApk, fixtureDirectory, output, mode, ...extra] = process.argv.slice(2);
const serial = process.env.ANDROID_SERIAL;
if (!appApk || !testApk || !fixtureDirectory || !output || !serial || !/^emulator-\d+$/.test(serial)
    || (mode !== undefined && mode !== '--restart') || extra.length) {
  throw Error('Expected an explicit emulator and APP.apk TEST.apk FIXTURE_DIR NEW_OUTPUT [--restart]');
}
if (fs.existsSync(output)) throw Error('Refuse to overwrite existing evidence');

const restart = mode === '--restart';
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, 'platform-tools/adb');
const app: string = JSON.parse(fs.readFileSync('app.config.json', 'utf8')).appId;
const runner = `${app}.test/androidx.test.runner.AndroidJUnitRunner`;
const restartClass = `${app}.CrossAppNotificationsRestartInstrumentedTest#processPhase`;
const run = (...args: string[]) => execFileSync(adb, ['-s', serial, ...args], {
  env, encoding: 'utf8', timeout: args.includes('instrument') ? 360000 : 120000, maxBuffer: 8 * 1024 * 1024,
});
const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const appSha256 = hash(appApk);
const testSha256 = hash(testApk);
const manifest: Record<string, string> = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(appApk)), 'apk-manifest.json'), 'utf8'));
if (path.dirname(path.resolve(appApk)) !== path.dirname(path.resolve(testApk))
    || manifest[path.basename(appApk)] !== appSha256 || manifest[path.basename(testApk)] !== testSha256) {
  throw Error('Matching immutable archived APKs required');
}
const variant = path.basename(appApk).match(/^(standalone|launcher)-debug\.apk$/)?.[1];
if (!variant || path.basename(testApk) !== `${variant}-androidTest.apk`) throw Error('Matching distribution pair required');

const fixture: {apks: Record<string, {packageName: string; sha256: string; signer: string}>} =
  JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'manifest.json'), 'utf8'));
const signerTool = path.join(env.ANDROID_HOME, 'build-tools/36.0.0/apksigner');
const signer = (apk: string) => execFileSync(signerTool, ['verify', '--print-certs', apk], {env, encoding: 'utf8'})
  .match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];
const alphaSigner = signer(appApk);
if (!alphaSigner) throw Error('Alpha signer unavailable');
const installedPackage = (pkg: string) => run('shell', 'pm', 'list', 'packages', pkg)
  .split('\n').some(line => line.trim() === `package:${pkg}`);
const companion = ['selected', 'excluded'].map(name => {
  const row = fixture.apks[name];
  const apk = path.join(fixtureDirectory, `${name}.apk`);
  const pkg = `ai.alphacompute.notificationfixture.${name}`;
  if (row.packageName !== pkg || row.sha256 !== hash(apk) || signer(apk) !== row.signer || row.signer === alphaSigner) {
    throw Error('Unqualified companion identity/hash/signer');
  }
  if (installedPackage(pkg)) throw Error('Refuse preexisting synthetic companion installation');
  return {apk, pkg, sha256: row.sha256, signer: row.signer};
});
const listenerGranted = () => run('shell', 'settings', 'get', 'secure', 'enabled_notification_listeners').includes(app + '/');
if (listenerGranted()) throw Error('Refuse preexisting Alpha notification-listener grant');

interface MethodResult {
  completed: number;
  assumptions: number;
  passed: boolean;
}
function methodResult(log: string): MethodResult {
  const completed = (log.match(/^INSTRUMENTATION_STATUS_CODE: 0\s*$/gm) ?? []).length;
  const assumptions = (log.match(/^INSTRUMENTATION_STATUS_CODE: -(?:3|4)\s*$/gm) ?? []).length;
  const passed = /OK \(1 test\)/.test(log) && completed === 1 && assumptions === 0
    && !/FAILURES|INSTRUMENTATION_FAILED|Process crashed|AssumptionViolated|INSTRUMENTATION_STATUS_CODE: -(?:1|2)/.test(log);
  return {completed, assumptions, passed};
}

type Phase = MethodResult & {name: string; pid: number};
interface Evidence {
  variant: string;
  serial: string;
  appSha256: string;
  testSha256: string;
  companion: typeof companion;
  passed: boolean;
  companionCleanup: boolean;
  processRestartTested: boolean;
  physicalDeviceTested: boolean;
  runId?: string;
  phases?: Phase[];
  secureLockTested?: boolean;
  completedMethods?: number;
  assumptions?: number;
  error?: string;
  cleanupError?: string;
  companionCleanupError?: string;
  recoveryRequired?: true;
}

const runId = restart ? crypto.randomUUID() : undefined;
const phases: Phase[] = [];
const evidence: Evidence = {
  variant, serial, appSha256, testSha256, companion, passed: false, companionCleanup: false,
  processRestartTested: false, physicalDeviceTested: false,
  ...(restart ? {runId, phases, secureLockTested: false} : {}),
};
const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function phase(name: string) {
  if (!runId) throw Error('Restart evidence needs a run ID');
  const file = path.join(output, `${name}.txt`);
  let log: string;
  try {
    log = run('shell', 'am', 'instrument', '-w', '-r', '-e', 'class', restartClass,
      '-e', 'crossNotificationsRestart', '1', '-e', 'notificationPhase', name,
      '-e', 'notificationRunId', runId, runner);
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? error.stdout : '';
    const stderr = error instanceof Error && 'stderr' in error ? error.stderr : '';
    fs.writeFileSync(file, String(stdout || '') + String(stderr || ''));
    throw error;
  }
  fs.writeFileSync(file, log);
  const result = methodResult(log);
  const pid = Number(log.match(/notificationRestartPid=(\d+)/)?.[1]);
  const passed = result.passed && Number.isSafeInteger(pid) && pid > 0;
  phases.push({name, ...result, pid, passed});
  if (!passed) throw Error(`Notification restart ${name} failed; inspect ${name}.txt`);
  if (phases.slice(0, -1).some(prior => prior.pid === pid)) throw Error(`Distinct process not proven for ${name}`);
}

const installed: string[] = [];
function removeCompanions() {
  for (const pkg of installed) {
    run('uninstall', pkg);
    if (installedPackage(pkg)) throw Error('Owned companion removal not verified');
  }
  evidence.companionCleanup = true;
}

fs.mkdirSync(output, {recursive: true});
let failure: unknown;
let beganRestart = false;
try {
  run('install', '-r', appApk);
  run('install', '-r', testApk);
  for (const row of companion) {
    run('install', row.apk);
    installed.push(row.pkg);
  }
  writeJson('recovery.json', {
    serial, ownedCompanions: installed, alphaListener: `${app}/${app}.AlphaNotificationListener`,
    ...(restart ? {runId, checkpoint: 'no_backup/notification-restart-checkpoint.json', cleanupClass: restartClass} : {}),
  });
  if (restart) {
    beganRestart = true;
    for (const name of ['prepare', 'restore', 'pause', 'restorePaused', 'resumeAndRevoke', 'verifyRevoked']) {
      run('shell', 'am', 'force-stop', app);
      phase(name);
    }
    evidence.processRestartTested = true;
  } else {
    const log = run('shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
      `${app}.CrossAppNotificationsInstrumentedTest`, '-e', 'crossNotifications', '1', runner);
    fs.writeFileSync(path.join(output, 'instrumentation.txt'), log);
    const result = methodResult(log);
    evidence.completedMethods = result.completed;
    evidence.assumptions = result.assumptions;
    if (!result.passed) throw Error('Cross-app notification flow failed; inspect bounded fixture evidence');
  }
  evidence.passed = true;
} catch (error) {
  failure = error;
  evidence.error = errorMessage(error);
} finally {
  let cleanupComplete = false;
  try {
    if (!restart) removeCompanions();
    if (beganRestart) {
      run('shell', 'am', 'force-stop', app);
      phase('cleanup');
    }
    if (listenerGranted()) throw Error('Alpha notification listener grant remains; exact recovery required');
    cleanupComplete = true;
  } catch (error) {
    failure ??= error;
    evidence.passed = false;
    evidence.cleanupError = errorMessage(error);
  }
  if (restart) {
    if (cleanupComplete || !beganRestart) {
      try {
        removeCompanions();
      } catch (error) {
        failure ??= error;
        evidence.passed = false;
        evidence.companionCleanupError = errorMessage(error);
      }
    } else {
      evidence.recoveryRequired = true;
    }
  }
  writeJson('result.json', evidence);
}
if (failure) throw failure;
console.log(restart
  ? 'PASS distinct-PID notification history, explicit resume, Android revoke, and owned cleanup. Secure lock untested.'
  : 'PASS synthetic separate-UID notification consent, selection, exact actions, redacted history and mock pause.');
