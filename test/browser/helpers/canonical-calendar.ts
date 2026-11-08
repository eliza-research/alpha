import { expect, test, type Page } from "@playwright/test";
import {flagOffAndroid} from "../flag-off-android";
export interface CanonicalCalendarFixtureOptions {
  eventTitle?: string;
  location?: string;
  begin?: number;
  end?: number;
  theme?: string;
  launcher?: boolean;
}
/** Closed read-only CalendarService transport. Install before navigation when another
 * native fixture adds event handoffs. The current client, controller and UI run unchanged. */
export async function installCanonicalCalendarFixture(page: Page, options: CanonicalCalendarFixtureOptions = {}) {
  const foreign: string[] = [];
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,
    async (route) => {
      foreign.push(route.request().url());
      await route.abort();
    },
  );
  const native = test.info().project.name === 'production';
  if (!native) await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  const install = async ({native, options}:{native:boolean;options:CanonicalCalendarFixtureOptions}) => {
    const identity = {
      ownerId: native ? "9f1dc45a-4011-4e44-947a-30d999d24fa5" : "calendar-fixture-owner",
      agentId: native ? "6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11" : "calendar-fixture-agent",
      sessionId: "calendar-fixture-session",
      origin: location.origin,
    };
    const f: { requests: Array<{ path: string; method: string }> } = {
      requests: [],
    };
    (
      window as Window & { canonicalCalendarAccessibility: typeof f }
    ).canonicalCalendarAccessibility = f;
    const calendar = {
      provider: "eliza",
      side: "owner",
      grantId: "eliza-calendar",
      connectorAccountId: "fixture-account",
      accountEmail: null,
      calendarId: "primary",
      summary: "Fixture Calendar",
      description: null,
      primary: true,
      accessRole: "owner",
      backgroundColor: null,
      foregroundColor: null,
      timeZone: "UTC",
      selected: true,
      includeInFeed: true,
      selectionVersion: 0,
    };
    const begin=options.begin??new Date().setHours(12,0,0,0),end=options.end??begin+1800000;
    const event=options.eventTitle?{
      id:'fixture-event',externalId:'fixture-event',agentId:identity.agentId,
      provider:calendar.provider,side:calendar.side,grantId:calendar.grantId,
      connectorAccountId:calendar.connectorAccountId,calendarId:calendar.calendarId,
      title:options.eventTitle,description:'',location:options.location??'',status:'confirmed',
      startAt:new Date(begin).toISOString(),endAt:new Date(end).toISOString(),isAllDay:false,
      timezone:'UTC',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],
      metadata:{etag:'"fixture-event-v1"'},syncedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    }:null;
    const client = {
      sessionId: identity.sessionId,
      identity,
      current: () => true,
      request: async (
        path: string,
        method: string,
        _body: unknown,
        signal: AbortSignal,
      ) => {
        signal.throwIfAborted();
        f.requests.push({ path, method });
        if (method !== "GET")
          throw Error("Calendar accessibility fixture forbids record writes");
        const url = new URL(path, location.origin);
        if (url.pathname === "/api/notes/state")
          return { success: true, data: { notes: [], trash: [], revision: 0 } };
        if (url.pathname === "/api/lifeops/calendar/feed")
          return {
            calendarId: "primary",
            events: event?[event]:[],
            source: "cache",
            state: "complete",
            sources: [],
            timeMin: url.searchParams.get("timeMin"),
            timeMax: url.searchParams.get("timeMax"),
            syncedAt: new Date().toISOString(),
          };
        if (url.pathname === "/api/lifeops/calendar/calendars")
          return { calendars: [calendar] };
        if (url.pathname === "/api/lifeops/calendar/next-context")
          return {
            event: event&&end>Date.now()?event:null,
            readScope: {
              selection: "next_event",
              timeMin: new Date().toISOString(),
              timeMax: new Date(Date.now() + 86400000).toISOString(),
              exhaustive: false,
            },
            calendarFeedState: "complete",
            calendarSources: [],
            startsAt: event&&end>Date.now()?event.startAt:null,
            startsInMinutes: event&&end>Date.now()?(begin-Date.now())/60000:null,
            attendeeCount: 0,
            attendeeNames: [],
            location: null,
            conferenceLink: null,
            preparationChecklist: [],
            linkedMailState: "unavailable",
            linkedMailError: null,
            linkedMail: [],
          };
        throw Error("Unexpected closed Calendar accessibility route");
      },
    };
    if(native){
      const w=window as any,base=w.Capacitor.nativePromise;
      w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
        if(plugin==='ElizaSystem'&&method==='getBuildInfo'&&typeof options.launcher==='boolean')return {launcher:options.launcher,version:'calendar-layout-fixture'};
        if(plugin==='Agent'&&method==='request'&&(input.path.startsWith('/api/lifeops/calendar/')||input.path==='/api/notes/state')){
          const data=await client.request(input.path,input.method,input.body,new AbortController().signal);
          return {status:200,body:JSON.stringify(data)};
        }
        return base(plugin,method,input);
      };
    }else{
      const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
      c.getAppRecordClient=()=>client;
      await c.offline();
    }
  };
  if(native)await page.addInitScript(install,{native,options});
  return {native,foreign,install,options};
}
/** Open the current Calendar view over the closed service fixture, without choosing
 * retired Settings authorities or creating a record. */
export async function openCanonicalCalendar(page:Page,options:CanonicalCalendarFixtureOptions={}) {
  const native=test.info().project.name==='production';
  if(native)await flagOffAndroid(page);
  const fixture=await installCanonicalCalendarFixture(page,options);
  await page.goto(`/?theme=${options.theme??'light'}`);
  if(!native)await page.evaluate(fixture.install,{native,options});
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              canonicalCalendarAccessibility: {
                requests: Array<{ path: string; method: string }>;
              };
            }
          ).canonicalCalendarAccessibility.requests.filter((r) =>
            r.path.startsWith("/api/lifeops/calendar/"),
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(3);
  if(!options.eventTitle)await expect(page.getByText("No events in this Calendar window", { exact: true })).toBeVisible();
  expect(fixture.foreign).toEqual([]);
}
/** Accessibility form fixture: opening New event never writes a record. */
export async function openCanonicalCalendarForm(page:Page,theme='light') {
  await openCanonicalCalendar(page,{theme});
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await expect(
    page.locator('[data-alpha-subview="calendar-form"]:not([inert])'),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as Window & {
          canonicalCalendarAccessibility: {
            requests: Array<{ path: string; method: string }>;
          };
        }
      ).canonicalCalendarAccessibility.requests.every(
        (r) => r.method === "GET",
      ),
    ),
  ).toBe(true);
}
