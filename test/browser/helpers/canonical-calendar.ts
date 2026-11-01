import { expect, test, type Page } from "@playwright/test";
import {flagOffAndroid} from "../flag-off-android";
/** Closed read-only canonical Calendar transport for accessibility form states.
 * The real Calendar client/controller/form run unchanged; no event store or write is simulated. */
export async function openCanonicalCalendarForm(page: Page, theme = "light") {
  const foreign: string[] = [];
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,
    async (route) => {
      foreign.push(route.request().url());
      await route.abort();
    },
  );
  const native = test.info().project.name === 'production';
  if (native) await flagOffAndroid(page);
  else await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  const install = async (native:boolean) => {
    const identity = {
      ownerId: "calendar-fixture-owner",
      agentId: "calendar-fixture-agent",
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
            events: [],
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
            event: null,
            readScope: {
              selection: "next_event",
              timeMin: new Date().toISOString(),
              timeMax: new Date(Date.now() + 86400000).toISOString(),
              exhaustive: false,
            },
            calendarFeedState: "complete",
            calendarSources: [],
            startsAt: null,
            startsInMinutes: null,
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
  if(native)await page.addInitScript(install,true);
  await page.goto(`/?theme=${theme}`);
  if(!native)await page.evaluate(install,false);
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
  await expect(
    page.getByText("No events in this Calendar window", { exact: true }),
  ).toBeVisible();
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
  expect(foreign).toEqual([]);
}
