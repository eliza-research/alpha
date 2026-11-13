import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {calendarFormInputPatch, calendarFormInputs} from '../../../../apps/app/src/prototype/calendar-form-inputs.ts';

const source = 'apps/app/src/prototype/model.js';
const inputsSource = 'apps/app/src/prototype/calendar-form-inputs.ts';
const buttonNames = {later: 'sPlus', earlier: 'sMinus', endLater: 'ePlus', endEarlier: 'eMinus'};
function clockTime(minutes) {
  return [Math.floor(minutes / 60), minutes % 60].map(value => String(value).padStart(2, '0')).join(':');
}
function between(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return text.slice(first, last);
}
function fixture() {
  const text = readFileSync(source, 'utf8');
  const days = new Function('api', 'f', 'fp', 'calDate', 'calDayName', 'weekdayName',
    between(text, '      var dayChips = [];', '      var chosen =') + ';return dayChips;');
  const buttons = Object.fromEntries(Object.entries(buttonNames).map(([action, name]) => {
    const pattern = new RegExp(name + ': (function \\(\\) \\{ fp\\(\\{ [^}]+ \\}\\); \\})');
    const handler = text.match(pattern)?.[1];
    assert.ok(handler, 'The retained form provides ' + name);
    return [action, new Function('f', 'fp', 'return (' + handler + ')')];
  }));
  const inputChange = new Function('api', 'f', 'fp', 'calendarFormInputPatch',
    between(text, '      var inputChange=', '      var dayChips = [];') + 'return inputChange;');
  const month = new Function('st', 'selDate', 'today', 'on', 'set', 'DAYS', 'MONS', 'sel',
    between(text, '    // month panel', '    var calRows =') + ';return mdays;');
  let form = {off: 0, t: 12, d: 1}, date = new Date(2027, 5, 1);
  const patch = value => {form = {...form, ...value};};
  const now = new Date(2027, 0, 1);
  const api = {
    now: now.getTime(),
    get(name) {
      assert.equal(name, 'calendar');
      return {form};
    },
    toast(message) { assert.equal(message, 'Choose an end after the start.'); },
  };
  const change = (kind, value) => inputChange(api, form, patch, calendarFormInputPatch)(kind)({target: {value}});
  const dateAt = off => calendarFormInputs({...form, off}, now).date;
  const chips = () => days({}, form, patch, (_api, off) => new Date(2027, 0, off + 1), (_api, off) => String(off), () => 'day');
  return {
    observe() {
      const leading = (date.getDay() + 6) % 7, count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const rows = month({month: 0}, date, new Date(2027, 0, 1), () => [], () => {}, Array(7).fill('day'), Array(12).fill('month'), 0);
      return {'s.off': form.off, 's.start': Math.round(form.t * 60), 's.duration': Math.round(form.d * 60), 's.days': count, 's.leading': leading,
        rows: rows.length, windowDays: qset(chips().map(chip => Number(chip.label)))};
    },
    run(action, args) {
      if (action === 'chooseDay') {
        const chip = chips().find(chip => Number(chip.label) === args[0]);
        assert.ok(chip, 'The chosen day exists in the actual form window'); chip.pick();
      } else if (Object.hasOwn(buttons, action)) buttons[action](form, patch)();
      else if (action === 'setDate') change('date', dateAt(args[0]));
      else if (action === 'setStart') change('startTime', clockTime(args[0]));
      else if (action === 'setEndDate') change('endDate', dateAt(form.off + args[0]));
      else if (action === 'setEndTime') change('endTime', clockTime(args[0]));
      else if (action === 'retiredStart') {
        const oldCallback = inputChange(api, form, patch, calendarFormInputPatch)('startTime');
        form = {...form};
        oldCallback({target: {value: '05:00'}});
      } else if (action === 'month') {
        const candidates = [new Date(2027, 5, 1), new Date(2027, 4, 1), new Date(2027, 1, 1)];
        date = candidates.find(candidate => new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate() === args[0] && (candidate.getDay() + 6) % 7 === args[1]);
        assert.ok(date, 'A real calendar month supplies the controlled month facts');
      } else throw Error('Unexpected Calendar control action');
    },
  };
}
export async function checkCalendarFormControls(extraSources = []) {
  const sources = [source, inputsSource, 'apps/app/src/prototype/template.html', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const traces = [
    ['month ahead and Today', [['chooseDay', 20], ['chooseDay', 37], ['chooseDay', 0]]],
    ['quarter-hour controls preserve midnight bounds', [
      ['setStart', 1410], ['later'], ['later'], ['later'], ['setStart', 1439], ['later'], ['earlier'], ['setStart', 0], ['earlier'],
    ]],
    ['direct time and date edits preserve multi-day duration and reject retired input', [
      ['setDate', 40], ['setEndTime', 720], ['setEndTime', 721], ['endEarlier'], ['setEndDate', 2], ['endLater'], ['endEarlier'], ['retiredStart'],
    ]],
    ['real five-row, six-row and February months', [['month', 31, 5], ['month', 30, 1], ['month', 28, 0]]],
  ].map(([name, actions]) => {
    const actual = fixture(), trace = {name, expect: actual.observe(), steps: []};
    for (const [action, ...args] of actions) {actual.run(action, args); trace.steps.push({label: action, action: {name: action, args}, expect: actual.observe()});}
    return trace;
  });
  return checkTraces({model: 'CalendarFormControls', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual day chips, four time buttons, direct input callbacks and month-panel construction execute. Observations read the returned chips, selected offset, civil minute values and actual month cells.',
    'A fixed local 2027 anchor and real calendar months provide controlled dates. The retained form callbacks and civil input parser are under test. Provider save admission and time zone conversion at Save are separate.',
    'Browser checks separately exercise the retained browser Calendar route, current markup and keyboard-accessible selected states. Canonical agent Calendar and installed Google behavior remain separate proof.',
  ]});
}
