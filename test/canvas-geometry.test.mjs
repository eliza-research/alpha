import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #411: the canvas arrangement follows measured window geometry, not screen orientation,
// and the software keyboard is never mistaken for a rotation.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const { canvasGeometry, keyboardFreeHeight, surfaceLayout, WIDE_CANVAS } = await import('../apps/app/src/runtime/canvas-geometry.ts');

const input = (width, height, extra = {}) => ({ width, layoutHeight: height, available: height, desktop: false, fluid: true, launcher: false, screenShort: Math.min(width, height), editing: false, ...extra });
const fit = (width, height, extra) => canvasGeometry(input(width, height, extra), height);

test('standalone touch windows keep their own density in every orientation', () => {
  assert.deepEqual([fit(412, 915).scale, fit(412, 915).landscape, fit(412, 915).wide], [1, false, false]);
  // A small phone on its side is not shrunk below 44px targets.
  assert.deepEqual([fit(640, 360).scale, fit(640, 360).landscape], [1, true]);
  // A tablet is never a magnified phone.
  assert.deepEqual([fit(1280, 800).scale, fit(1280, 800).wide], [1, true]);
  assert.deepEqual([fit(800, 1280).scale, fit(800, 1280).landscape, fit(800, 1280).wide, fit(800, 1280).width], [1, false, true, '800px']);
  // A narrow portrait phone still fits the reference canvas, as before.
  assert.equal(fit(360, 740).scale, 360 / 412);
  assert.equal(fit(WIDE_CANVAS - 1, 1000).wide, false);
});

test('the launcher and desktop preview keep their fitted 412px canvas', () => {
  const launcher = canvasGeometry(input(915, 412, { launcher: true, screenShort: 412 }), 412);
  assert.deepEqual([launcher.scale, launcher.landscape], [1, true]);
  assert.equal(canvasGeometry(input(412, 915, { launcher: true }), 915).width, '412px');
  const desktop = canvasGeometry(input(1440, 900, { desktop: true, fluid: false, available: 852 }), 900);
  assert.deepEqual([desktop.scale, desktop.landscape, desktop.wide, desktop.width], [852 / 915, false, false, '412px']);
});

test('the keyboard shortens a portrait window without flipping it to landscape', () => {
  const free = keyboardFreeHeight();
  assert.equal(free(412, 915, false), 915);
  // Typing: the window is now wider than tall, but the width did not change.
  assert.equal(free(412, 380, true), 915);
  assert.equal(canvasGeometry(input(412, 380, { editing: true }), free(412, 380, true)).landscape, false);
  // The keyboard closes or the field loses focus: the real height is measured again.
  assert.equal(free(412, 380, false), 380);
  // Rotation changes the width, so it is honoured even while a field has focus.
  const turned = keyboardFreeHeight();
  turned(412, 915, true);
  assert.equal(canvasGeometry(input(915, 300, { editing: true }), turned(915, 300, true)).landscape, true);
  // Turning back while the keyboard stays up: a small phone's portrait window is already shorter
  // than it is wide, but the sides were swapped, so it is portrait again.
  assert.equal(canvasGeometry(input(412, 380, { editing: true }), turned(412, 380, true)).landscape, false);
  // The same on a 360x640 phone, starting in landscape with the keyboard closed.
  const small = keyboardFreeHeight();
  small(640, 360, false);
  assert.equal(canvasGeometry(input(640, 150, { editing: true }), small(640, 150, true)).landscape, true);
  assert.equal(canvasGeometry(input(360, 330, { editing: true }), small(360, 330, true)).landscape, false);
  assert.equal(canvasGeometry(input(640, 150, { editing: true }), small(640, 150, true)).landscape, true);
  // Once the keyboard closes the measured height is used again.
  assert.equal(small(360, 600, false), 600);
  // A width change that is not a swap (a resized window) takes the measured height as it is.
  const resized = keyboardFreeHeight();
  resized(500, 900, false);
  assert.equal(resized(700, 400, true), 400);
});

test('list-detail split and Calendar day columns follow measured width, with an agenda at large text', () => {
  const at = (split, calendarDays) => ({ split, calendarDays, agenda: false });
  assert.deepEqual(surfaceLayout(412, 1), at(false, 1));
  assert.deepEqual(surfaceLayout(640, 1), at(false, 2));
  assert.deepEqual(surfaceLayout(800, 1), at(false, 3));
  assert.deepEqual(surfaceLayout(915, 1), at(false, 3));
  assert.deepEqual(surfaceLayout(1024, 1), at(true, 3));
  assert.deepEqual(surfaceLayout(1280, 1), at(true, 5));
  assert.equal(surfaceLayout(4000, 1).calendarDays, 7);
  // Enlarged text below the large-text threshold gets fewer, wider day columns.
  assert.deepEqual(surfaceLayout(1280, 1.3), at(true, 3));
  assert.deepEqual(surfaceLayout(640, 1.3), at(false, 1));
  // Large text (150% and above): one pane, and Calendar lists the selected day as an agenda.
  assert.deepEqual(surfaceLayout(1280, 1.5), { split: false, calendarDays: 1, agenda: true });
  assert.deepEqual(surfaceLayout(1280, 2), { split: false, calendarDays: 1, agenda: true });
  assert.deepEqual(surfaceLayout(1280, 1, true), at(false, 1));
});

test('wide Calendar leads with the previous day from three columns and keeps those days when an event closes', () => {
  const source = readFileSync(new URL('../apps/app/src/prototype/calendar-days.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
  const days = vm.runInNewContext(stripTypeScriptTypes('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n' + source, { mode: 'transform' }) + '\n({visibleCalendarDays,calendarReturnDay,markVisibleWeek,calendarAgendaRows})');
  assert.deepEqual([...days.visibleCalendarDays(4, 1)], [4]);
  assert.deepEqual([...days.visibleCalendarDays(4, 2)], [4, 5]);
  assert.deepEqual([...days.visibleCalendarDays(4, 5)], [3, 4, 5, 6, 7]);
  // An event opened from any visible column, including the previous day, returns to the same days.
  assert.equal(days.calendarReturnDay(4, 3, 5), 4);
  assert.equal(days.calendarReturnDay(4, 7, 5), 4);
  assert.equal(days.calendarReturnDay(4, 8, 5), 8);
  assert.equal(days.calendarReturnDay(4, 3, 2), 3);
  const week = days.markVisibleWeek(Array.from({ length: 7 }, () => ({ cs: '' })), 1, 4, 5);
  assert.deepEqual([...week.map(item => item.cs.includes('var(--s2)'))], [false, false, true, false, true, true, true]);
  const open = () => {};
  assert.deepEqual(JSON.parse(JSON.stringify(days.calendarAgendaRows([{ title: 'Trip', open }], [{ title: 'Late', top: 300, time: '3:00', agendaTime: '3:00 PM', open }, { title: 'Early', top: 100, time: '9:00', agendaTime: '9:00 AM', open }]))),
    [{ title: 'Trip', time: 'All day' }, { title: 'Early', time: '9:00 AM' }, { title: 'Late', time: '3:00 PM' }]);
});
