import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Source-level guards for two round-8 changes whose behaviour is otherwise shown in a browser
// (test/browser/notifications-handle.spec.ts) or only on an emulator (the instrumented classes).
// These do not replace either; they stop the source drifting back while no emulator run exists.
const read = file => readFileSync(file, 'utf8');
const ANDROID_TESTS = 'android/app/src/androidTest/java/ai/alphacompute/alphaphone';

test('Android\'s shade is the only shade: the swipe handler asks Android, never opens an Alpha panel (#416, #417)', () => {
  const model = read('apps/app/src/prototype/model.js');
  const swipe = model.slice(model.indexOf('  swipe(g, dx, dy) {'), model.indexOf('  sw(fn, opts) {'));
  assert.ok(swipe.length > 200 && swipe.length < 6000, 'swipe() located');
  // The zones are the shared shell's (resolveMobileShellSwipe, tested upstream); its one opener asks
  // for Android's shade: a pull on launcher Home's button or one the shared empty-Home pull accepts.
  assert.match(swipe, /resolveMobileShellSwipe\(\{ screen: S\.screen, shade: !!S\.shade, view: S\.view, chat: S\.chat, launcher: this\.props\.systemShell !== false \}, \{ x: g\.x, y: g\.y, onShadeControl: false \}, dx, dy,/);
  assert.match(swipe, /pullOpensShade: function \(px, py, threshold\) \{ return emptyHomeShadePull\(self\.pullContext\(\), g\.pull, g\.y, px, py, threshold\); \}/);
  assert.match(swipe, /if \(action === "open-system-shade"\) return this\.openSystemShade\(\);/);
  assert.doesNotMatch(swipe, /shade: true/, 'no swipe sets a panel open directly');
  assert.doesNotMatch(swipe, /this\.openShade\(\)/, 'no swipe opens the development stand-in directly');
  assert.doesNotMatch(swipe, /g\.y < 90/, 'the top-edge band is not a gesture zone of Alpha');
  assert.doesNotMatch(swipe, /raise-assistant[^;]*chat: "sheet"/, 'only the dock opens the chat: a swipe up on Home content opens nothing');
  assert.match(model, /pull: pullStart\(e\.target\)/);
  // The development stand-in opens only in a build that has it.
  assert.match(model, /openShade\(\) \{\s*var S = this\.S\(\);\s*if \(!this\.simulatedShade\(\) \|\| S\.screen !== "home" \|\| S\.shade\) return;/);
  const template = read('apps/app/src/prototype/template.html');
  assert.doesNotMatch(template, /data-alpha-shade-handle|Open notifications/, 'Home has no notifications control');
  assert.match(template, /<sc-if value="\{\{simulatedShade\}\}">\s*<sc-if value="\{\{isOn\}\}">\s*<div data-alpha-layer="shade" id="alpha-notifications"/);
});

test('no instrumented test opens the panel with the removed swipe', () => {
  for (const name of readdirSync(ANDROID_TESTS).filter(file => file.endsWith('.java'))) {
    const source = read(path.join(ANDROID_TESTS, name));
    // The synthetic top-edge swipe the product no longer answers (a pointer pair from y=50 to y=200).
    assert.doesNotMatch(source, /\['pointerdown',\s*50\]/, `${name} synthesizes the removed top-edge swipe`);
  }
});

test('the launcher keeps one MainActivity and its kind belongs to the task', () => {
  const activity = read('android/app/src/main/java/ai/alphacompute/alphaphone/MainActivity.java');
  // A second instance never loads a page.
  assert.match(activity, /@Override protected void load\(\) \{ if \(!handedOff\) super\.load\(\); \}/);
  assert.match(activity, /MainActivity live = BuildConfig\.IS_LAUNCHER && !isAssistantSurface\(\) \? liveInstance\(\) : null;/);
  // The kind is read from the start intent once per task. A relaunch is handed the last intent given
  // to setIntent (AlphaConnectionPlugin keeps the sign-in return there), so it must not be read again.
  assert.match(activity, /java\.util\.Map<Integer,TaskKind> taskKinds = new java\.util\.HashMap<>\(\)/);
  assert.match(activity, /if \(task == -1\) startedAsHome = isHomeTypeStart\(getIntent\(\)\);/);
  assert.match(activity, /TaskKind kind = taskKinds\.get\(task\);\s*if \(kind == null\) \{ kind = new TaskKind\(isHomeTypeStart\(getIntent\(\)\),this\); taskKinds\.put\(task,kind\); \}/);
  assert.match(activity, /kind\.owner = new java\.lang\.ref\.WeakReference<>\(this\);\s*startedAsHome = kind\.home;/);
  // A replaced or merely stopped activity cannot erase a surviving task's classification.
  assert.match(activity, /if \(isFinishing\(\) && kind != null && kind\.owner\.get\(\) == this\) taskKinds\.remove\(getTaskId\(\)\);/);
  assert.match(read('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaConnectionPlugin.java'), /getActivity\(\)\.setIntent\(intent\);delegationCallback=uri;/, 'the sign-in return is still kept with setIntent, which is why the kind is per task');
  // An exported activity reads its own marker extra without trusting the sender's parcel.
  // Only this process's own token counts: another app setting the key is an ordinary start.
  assert.match(activity, /try \{ return FRONT_START_TOKEN\.equals\(intent\.getStringExtra\(EXTRA_FRONT_START\)\); \}\s*catch \(RuntimeException foreign\) \{ return false; \}/);
  assert.doesNotMatch(activity, /isOwnFrontStart|frontStartAt/, 'the marker alone identifies a front start; no time window');
  // The live instance's own task is never removed by the instance that hands off.
  assert.match(activity, /if \(home \|\| sameTask\) finish\(\); else finishAndRemoveTask\(\);/);
  // The bring-to-front start cannot loop: an instance it creates finishes without starting anything,
  // whenever it arrives, and from then on starts are not handed off (Android would otherwise start
  // HOME again into the emptied home task and the hand-off would repeat).
  const handOff = activity.slice(activity.indexOf('private void handOff(MainActivity live)'), activity.indexOf('@Override public void onCreate(Bundle state)'));
  assert.equal(handOff.split('startActivity(').length - 1, 1, 'one start in the hand-off');
  assert.match(handOff, /if \(hasFrontMarker\(getIntent\(\)\)\) \{[\s\S]*?handOffUnreliable = true;[\s\S]*?\} else \{[\s\S]*startActivity\(front\)/);
  // So does a start that throws or that the live instance never receives three times in a row.
  assert.match(handOff, /if \(!started \|\| \+\+unackedFrontStarts >= MAX_UNACKED_FRONT_STARTS\) \{\s*handOffUnreliable = true;/);
  assert.match(activity, /if \(hasFrontMarker\(intent\)\) \{[\s\S]{0,400}?else unackedFrontStarts = 0;\s*return;/, 'the live instance acknowledges the front start and passes nothing of it to the page');
  assert.match(activity, /if \(live != null && live != this && \(!handOffUnreliable \|\| hasFrontMarker\(getIntent\(\)\)\)\) \{/);
  // A standard live task is moved to the front by its id. An intent cannot do it: measured on API 36
  // (round 8), the explicit-component start made by the instance in the home task was matched to
  // that home task and came back to the instance that asked. The intent stays for a home-type live
  // instance, whose task Android does not list among the app's own.
  assert.match(handOff, /boolean started = !live\.startedAsHome && moveLiveTaskToFront\(live\.getTaskId\(\)\);\s*if \(!started\) \{[\s\S]*?startActivity\(front\)/);
  assert.match(activity, /for \(android\.app\.ActivityManager\.AppTask task : manager\.getAppTasks\(\)\) \{\s*if \(task\.getTaskInfo\(\)\.taskId != taskId\) continue;\s*task\.moveToFront\(\);\s*return true;/);
  // The task move has no intent to acknowledge: the page owner resuming is the acknowledgement.
  assert.match(activity, /public void onResume\(\)\{super\.onResume\(\);[\s\S]{0,200}?if\(liveInstance\.get\(\)==this\)unackedFrontStarts=0;/);
});
