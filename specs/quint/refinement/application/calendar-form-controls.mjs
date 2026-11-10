import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';

const source = 'apps/app/src/prototype/model.js';
function between(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return text.slice(first, last);
}
function fixture() {
  const text = readFileSync(source, 'utf8');
  const days = new Function('api', 'f', 'fp', 'calDate', 'calDayName', 'weekdayName',
    between(text, '      var dayChips = [];', '      var chosen =') + ';return dayChips;');
  const after = text.slice(text.indexOf('sPlus: ') + 7).split('\n')[0].replace(/,\s*$/, '');
  const later = new Function('f', 'fp', 'return (' + after + ')');
  const month = new Function('st', 'selDate', 'today', 'on', 'set', 'DAYS', 'MONS', 'sel',
    between(text, '    // month panel', '    var calRows =') + ';return mdays;');
  let form = {off: 0, t: 12, d: 1}, date = new Date(2027, 5, 1);
  const patch = value => {form = {...form, ...value};};
  const chips = () => days({}, form, patch, (_api, off) => new Date(2027, 0, off + 1), (_api, off) => String(off), () => 'day');
  return {
    observe() {
      const leading = (date.getDay() + 6) % 7, count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const rows = month({month: 0}, date, new Date(2027, 0, 1), () => [], () => {}, Array(7).fill('day'), Array(12).fill('month'), 0);
      return {'s.off': form.off, 's.start': form.t * 4, 's.duration': form.d * 4, 's.days': count, 's.leading': leading,
        rows: rows.length, windowDays: qset(chips().map(chip => Number(chip.label)))};
    },
    run(action, args) {
      if (action === 'chooseDay') {
        const chip = chips().find(chip => Number(chip.label) === args[0]);
        assert.ok(chip, 'The chosen day exists in the actual form window'); chip.pick();
      } else if (action === 'setTime') form = {...form, t: args[0] / 4, d: args[1] / 4};
      else if (action === 'later') later(form, patch)();
      else if (action === 'month') {
        const candidates = [new Date(2027, 5, 1), new Date(2027, 4, 1), new Date(2027, 1, 1)];
        date = candidates.find(candidate => new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate() === args[0] && (candidate.getDay() + 6) % 7 === args[1]);
        assert.ok(date, 'A real calendar month supplies the controlled month facts');
      } else throw Error('Unexpected Calendar control action');
    },
  };
}
export async function checkCalendarFormControls(extraSources = []) {
  const sources = [source, 'apps/app/src/prototype/template.html', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const traces = [
    ['month ahead and Today', [['chooseDay', 20], ['chooseDay', 37], ['chooseDay', 0]]],
    ['later never moves an invalid midnight start earlier', [['setTime', 94, 4], ['later'], ['setTime', 88, 4], ['later'], ['setTime', 91, 5], ['later']]],
    ['real five-row, six-row and February months', [['month', 31, 5], ['month', 30, 1], ['month', 28, 0]]],
  ].map(([name, actions]) => {
    const actual = fixture(), trace = {name, expect: actual.observe(), steps: []};
    for (const [action, ...args] of actions) {actual.run(action, args); trace.steps.push({label: action, action: {name: action, args}, expect: actual.observe()});}
    return trace;
  });
  return checkTraces({model: 'CalendarFormControls', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual form day-chip construction, Start later callback and month-panel construction execute. Observations read their returned chips, selected offset, start time and actual month cells.',
    'Dates and formatting ports are controlled input, using real 2027 months. Time configuration represents an existing draft, including a midnight-invalid input; provider save admission and mutations are outside this campaign.',
    'Browser checks separately exercise the retained browser Calendar route, current markup and keyboard-accessible selected states. Canonical agent Calendar and installed Google behavior remain separate proof.',
  ]});
}
