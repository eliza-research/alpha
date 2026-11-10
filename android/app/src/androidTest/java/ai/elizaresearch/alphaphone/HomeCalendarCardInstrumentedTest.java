package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** The Home calendar card (data-alpha-home-calendar) over the real CalendarProvider: the next event
 * of a named local calendar shows its title, the calendar's name and when this app read it; with
 * calendar access revoked the card shows the access-off state and no event or read time.
 * Run by scripts/test-calendar-regression.mjs in a disposable secondary user:
 *   --case=HomeCalendarCardInstrumentedTest#nextProviderEventShowsTitleCalendarNameAndReadTime (granted)
 *   --case=HomeCalendarCardInstrumentedTest#revokedAccessShowsTheAccessOffState (both permissions revoked
 *   before the process starts: revoking a runtime permission kills the app process, so the test
 *   never revokes its own). Synthetic local calendar only; emulator evidence, no synced account. */
@RunWith(AndroidJUnit4.class)
public class HomeCalendarCardInstrumentedTest {
 private static final String CARD = "document.querySelector('[data-screen] [data-alpha-home-calendar]')";
 private static String gate() { return InstrumentationRegistry.getArguments().getString("homeCalendar"); }
 private static String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private static void until(String condition, String message) throws Exception {
  for (int i = 0; i < 200; i++) { if ("true".equals(eval("!!(" + condition + ")"))) return; SystemClock.sleep(100); }
  fail(message + ": " + eval("JSON.stringify((()=>{const c=" + CARD + ";return c&&{label:c.getAttribute('aria-label'),text:c.innerText}})())"));
 }
 private static JSONObject card() throws Exception {
  return new JSONObject(eval("(()=>{const c=" + CARD + ";const t=s=>c.querySelector(s)?.textContent?.trim()||'';return {label:c.getAttribute('aria-label')||'',title:t('.home-calendar-title'),origin:t('[data-alpha-home-calendar-origin]'),source:t('[data-alpha-home-calendar-source]'),event:c.getAttribute('data-alpha-home-calendar-event')}})()"));
 }
 private static void home() throws Exception {
  AppNavigation.liveMode();
  eval(AppNavigation.request("Home"));
  until(AppNavigation.selected("Home") + "&&" + CARD, "Home shows its calendar card");
 }

 @Test public void nextProviderEventShowsTitleCalendarNameAndReadTime() throws Exception {
  Assume.assumeTrue("Run by scripts/test-calendar-regression.mjs with calendar access granted", "1".equals(InstrumentationRegistry.getArguments().getString("homeCalendar")));
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals("The runner granted READ_CALENDAR", PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.READ_CALENDAR));
  assertEquals("The runner granted WRITE_CALENDAR", PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR));
  ContentResolver resolver = context.getContentResolver();
  String suffix = UUID.randomUUID().toString().substring(0, 8), account = "Alpha home card fixture " + suffix, name = "Home card calendar " + suffix, title = "Home card event " + suffix;
  Uri calendars = CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
   .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build();
  ContentValues c = new ContentValues();
  c.put(CalendarContract.Calendars.ACCOUNT_NAME, account); c.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
  c.put(CalendarContract.Calendars.NAME, name); c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, name); c.put(CalendarContract.Calendars.OWNER_ACCOUNT, account);
  c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER); c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, java.util.TimeZone.getDefault().getID());
  c.put(CalendarContract.Calendars.VISIBLE, 1); c.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
  Uri calendar = resolver.insert(calendars, c);
  assertNotNull("Fixture calendar inserted", calendar);
  try {
   // Twenty minutes from now: the next item on a fresh user's calendar, today, not yet started.
   long begin = (System.currentTimeMillis() / 60_000L + 20) * 60_000L, end = begin + 30 * 60_000L;
   ContentValues e = new ContentValues();
   e.put(CalendarContract.Events.CALENDAR_ID, ContentUris.parseId(calendar)); e.put(CalendarContract.Events.TITLE, title);
   e.put(CalendarContract.Events.DTSTART, begin); e.put(CalendarContract.Events.DTEND, end); e.put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().getID());
   assertNotNull("Fixture event inserted", resolver.insert(CalendarContract.Events.CONTENT_URI, e));
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    home();
    until(CARD + ".querySelector('.home-calendar-title')?.textContent.trim()===" + JSONObject.quote(title), "The card shows the provider event's title");
    JSONObject shown = card();
    assertEquals("The card has an event", "true", shown.getString("event"));
    assertTrue("Accessible name opens that event: " + shown, shown.getString("label").startsWith("Open calendar event: " + title + ","));
    assertEquals("The card names the calendar the event was read from", name, shown.getString("origin"));
    assertTrue("The card says when this app read it: " + shown, shown.getString("source").startsWith("Read "));
    // A read today is shown as a time of day (home-cards.ts presentHomeCalendarSource), not a date.
    assertTrue("The read time is today's: " + shown, shown.getString("source").matches("Read \\d{1,2}:\\d{2}.*"));
   }
  } finally {
   resolver.delete(calendar.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
    .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build(), null, null);
  }
 }

 @Test public void revokedAccessShowsTheAccessOffState() throws Exception {
  Assume.assumeTrue("Run by scripts/test-calendar-regression.mjs after both calendar permissions are revoked", "revoked".equals(gate()));
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertNotEquals("The runner revoked READ_CALENDAR before this process started", PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.READ_CALENDAR));
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   home();
   until(CARD + "&&!/^(Loading events|Reading your calendar)/.test(" + CARD + ".querySelector('.home-calendar-title')?.textContent.trim()||'')", "The card settles");
   JSONObject shown = card();
   // Never asked in this process: "Connect your calendar"; refused in Android's dialog: "Calendar access is off".
   assertTrue("Access-off state, not an event: " + shown, java.util.Set.of("Calendar access is off", "Connect your calendar").contains(shown.getString("title")));
   assertEquals("No event without calendar access", "false", shown.getString("event"));
   assertEquals("The card opens Calendar, not an event", "Open your calendar", shown.getString("label"));
   assertFalse("No read time is claimed without access: " + shown, shown.getString("source").startsWith("Read "));
  }
 }
}
