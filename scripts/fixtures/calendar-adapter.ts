import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../test/support/strip-types.mjs';
import {formatHour} from '../../apps/app/src/prototype/locale-time.ts';

type CalendarRow = {id: string; alphaCalendarId: string};
export type CalendarFixtureState = {
  day: number;
  month: number | null;
  events: CalendarRow[];
  open?: string | null;
  reminderStale?: boolean;
  form?: {expected?: {revision: string; title: string}; title?: string; notes?: string; cal?: string} | null;
};
export type CalendarFixtureApi = {
  now: number;
  track: () => string;
  kx: () => number;
  toast: (message: string) => void;
  set: (patch: Partial<CalendarFixtureState>) => void;
  open?: (view: string, patch: unknown) => void;
  isActive?: () => boolean;
  get?: () => CalendarFixtureState;
};
type EventControls = {
  edit: () => Promise<void>;
  del: () => Promise<void>;
  checkUncertain: () => void;
  goWhere: () => void;
  busy: boolean;
  uncertain: boolean;
};
export type CalendarFixtureView = {
  render(state: CalendarFixtureState, api: CalendarFixtureApi): {
    events: unknown[];
    hours: unknown[];
    week: unknown[];
    mdays: unknown[];
    ev?: Partial<EventControls>;
    f?: {cals: unknown[]} | null;
    reminderRecovery?: boolean;
  };
  displaySources?: () => {
    native: boolean;
    ready: boolean;
    loading: boolean;
    error: boolean;
    status: string;
    sources: {id: string; name: string; account: string; change(action: string): Promise<void>}[];
  };
};

export class CalendarFixtureShell {
  declare nativeCalendarRows?: CalendarRow[];
  declare calendarWriteUncertain?: {eventId: string; kind: string; begin?: number};
  declare refreshAgentCalendar: () => Promise<void>;
  declare calendarSelection: () => {id: string} | undefined;
  componentDidMount() {}
  componentWillUnmount() {}
}

const source = (file: string) => readFileSync(new URL(`../../apps/app/src/prototype/${file}`, import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '');

export function installCalendarFixture(bindings: {
  Shell: typeof CalendarFixtureShell;
  views: {calendar: CalendarFixtureView};
  calendar: object;
} & Record<string, unknown>) {
  const calendarDays = 'const currentSurfaceLayout=()=>({split:false,calendarDays:1});\n' + source('calendar-days.ts');
  const intervals = source('calendar-interval-presentation.ts');
  const adapter = source('calendar-adapter.ts').replace("const calendar = registerPlugin<any>('AlphaCalendar');", '');
  const forbidRecovery = () => { throw Error('Browser recovery must not open in native fixture'); };
  vm.runInNewContext(
    stripTypeScriptTypes(calendarDays, {mode:'strip'})
      + '\n{' + stripTypeScriptTypes(intervals, {mode:'strip'})
      + '\nglobalThis.presentCalendarIntervals=presentCalendarIntervals;}\n'
      + stripTypeScriptTypes(adapter, {mode:'strip'})
      + '\ninstallCalendarAdapter(Shell,views);',
    {
      window: new EventTarget(), document: {hidden: false},
      openCalendarRecovery: forbidRecovery, openReminderRecovery: forbidRecovery,
      openReminderActionRecovery: forbidRecovery, openReminderCreationRecovery: forbidRecovery,
      Capacitor: {getPlatform: () => 'android', isNativePlatform: () => true},
      DailyApps: {addListener: async () => ({remove() {}})},
      Date, queueMicrotask, console, formatHour,
      mapsEventOriginFor: () => undefined, noteOriginSupported: () => false,
      rememberNoteOrigin: async () => false, forgetNoteOrigin: async () => {}, eventNoteOriginId: () => undefined,
      ...bindings,
    },
  );
}
