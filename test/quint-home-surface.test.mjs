import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// HomeSurface traces from the simulator, replayed on Home's remembered agenda choice and its
// storage probe. One model tick is one local day, so the all-day candidate ends with its day and
// the timed one at an instant, as the candidates built from calendar rows do.
const {createHomeAgenda, createStorageAccessCheck} = await import('../apps/app/src/prototype/home-cards.ts');
const day = n => new Date(2026, 0, 10 + n).getTime();
const utcDay = n => Date.UTC(2026, 0, 10 + n);
const TIMED = {id: 1, title: 'Timed', nativeEvent: {begin: day(2), end: day(3)}};
const ALL_DAY = {id: 2, title: 'All day', nativeEvent: {allDay: true, begin: utcDay(1), end: utcDay(5)}};
const OVERDUE = {id: 3, title: 'Overdue', at: day(0), off: 0};
const capped = count => Math.min(count, 9);

test('simulated HomeSurface traces agree with the agenda memo and storage probe after every step', {timeout: 120000}, async () => {
  const traces = modelTraces({module: 'HomeSurface', traces: 80, steps: 30});
  const result = await replay(traces, {
    start() {
      let now = 0, storageWorks = true, probes = 0, selections = 0, available = true;
      let events = [], overdue = [], shown = {agenda: undefined, following: undefined}, last;
      const agenda = createHomeAgenda(), lists = new Map([['', events]]);
      const check = createStorageAccessCheck(() => { probes++; if (!storageWorks) throw Error('blocked'); }, 2, () => now);
      return {
        apply({action, picks}) {
          if (action === 'tick') now++;
          else if (action === 'clockBack') now--;
          else if (action === 'setInput') {
            // The memo knows an event list by identity: one array stands for each model list.
            const key = [TIMED, ALL_DAY].filter(event => picks.ids.includes(event.id)).map(event => event.id).join();
            if (!lists.has(key)) lists.set(key, [TIMED, ALL_DAY].filter(event => picks.ids.includes(event.id)));
            events = lists.get(key);
            overdue = picks.ids.includes(3) ? [{...OVERDUE}] : [];
          } else if (action === 'render') {
            const chosen = agenda({events, overdue, calendarShown: true, now: day(now)});
            // Every selection returns a new choice; a reused one is the same object.
            if (chosen !== last) selections++;
            last = shown = chosen;
          } else if (action === 'storageChanges') storageWorks = !storageWorks;
          else if (action === 'checkStorage') available = check();
          else assert.fail(`unmapped action ${action}`);
        },
        observe: () => ({agenda: shown.agenda?.event.id ?? 0, following: shown.following?.event.id ?? 0,
          selections: capped(selections), available, probes: capped(probes)}),
      };
    },
    project: s => ({agenda: s.agenda, following: s.following, selections: s.selections, available: s.available, probes: s.probes}),
  });
  assert.deepEqual([...result.exercised].sort(), ['checkStorage', 'clockBack', 'render', 'setInput', 'storageChanges', 'tick']);
});
