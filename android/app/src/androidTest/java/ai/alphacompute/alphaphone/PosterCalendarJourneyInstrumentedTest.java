package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Journey J01 on Android, composed through the rendered controls in one process: a poster image
 * picked through the real DocumentsUI picker (the CameraScanInstrumentedTest pattern) -> Scan
 * review with the on-device OCR -> "Create event draft" with its suggested fields -> "Review in
 * Calendar" -> the Calendar form, its destination chosen in the rendered picker -> Save event. Then
 * CalendarContract.Events holds exactly one row with the reviewed title, location and start, and the
 * Home card "Open calendar event: <title>" opens that same event. The cancel variant leaves no row.
 *
 * The poster is a PNG this test draws (synthetic text, dated tomorrow so Home lists it). The OCR text
 * is replaced with the exact poster text, as an owner corrects a scan, so the suggested fields do not
 * depend on recognition quality; that the OCR ran at all is asserted. The only destination an emulator
 * without accounts offers is "On this phone" (Alpha's own local calendar). Calendar's confirm prompts
 * (replacing a draft) are accepted and recorded, as a person would. Every row this test
 * creates is deleted by its unique title. Emulator evidence only; not a printed poster, a camera
 * capture, a synced account or device acceptance.
 *
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --serial emulator-NNNN --classes PosterCalendarJourney
 */
@RunWith(AndroidJUnit4.class)
public class PosterCalendarJourneyInstrumentedTest {
 private static final String REVIEW = "document.querySelector('dialog[aria-label=\"Review scanned text\"]')";
 private static final String SCANNED = REVIEW + "?.querySelector('textarea[aria-label=\"Scanned text\"]')";
 private final SelectedDocumentInstrumentedTest documents = new SelectedDocumentInstrumentedTest();
 private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
 private String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private void until(String js, long millis) throws Exception {
  long end = SystemClock.elapsedRealtime() + millis;
  while (SystemClock.elapsedRealtime() < end) { if ("true".equals(eval("Boolean(" + js + ")"))) return; SystemClock.sleep(150); }
  fail("J01 condition: " + js + "; screen=" + eval("document.body.innerText.slice(-900)"));
 }
 private void until(String js) throws Exception { until(js, 25000); }
 private static String button(String label) {
  return "[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===" + JSONObject.quote(label) + "||b.textContent.trim()===" + JSONObject.quote(label) + ")&&b.getClientRects().length&&!b.disabled)";
 }
 private void click(String label) throws Exception { until(button(label)); eval("(" + button(label) + ").click()"); }
 private void set(String selector, String value) throws Exception {
  String node = "document.querySelector(" + JSONObject.quote(selector) + ")";
  until(node);
  eval("(()=>{const e=" + node + ",proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e," + JSONObject.quote(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
 }
 private String value(String selector) throws Exception {
  return (String) new JSONTokener(eval("document.querySelector(" + JSONObject.quote(selector) + ")?.value??''")).nextValue();
 }
 private static String field(String label) { return "dialog[aria-label=\"Review scanned text\"] input[aria-label=\"" + label + "\"]"; }
 private static String detail(String title) {
  return "(!!document.querySelector('[data-screen] button[aria-label=\"Edit event\"]')&&[...document.querySelectorAll('[data-screen] h1')].some(h=>h.textContent.trim()===" + JSONObject.quote(title) + "))";
 }
 private static byte[] poster(String... lines) throws Exception {
  Bitmap bitmap = Bitmap.createBitmap(1200, 900, Bitmap.Config.ARGB_8888);
  try {
   Canvas canvas = new Canvas(bitmap); canvas.drawColor(Color.WHITE);
   Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK); paint.setTextSize(72);
   for (int i = 0; i < lines.length; i++) canvas.drawText(lines[i], 60, 160 + i * 170, paint);
   ByteArrayOutputStream out = new ByteArrayOutputStream(); assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)); return out.toByteArray();
  } finally { bitmap.recycle(); }
 }
 private List<Long> rows(String title) {
  List<Long> ids = new ArrayList<>();
  try (Cursor c = context().getContentResolver().query(CalendarContract.Events.CONTENT_URI, new String[]{CalendarContract.Events._ID}, CalendarContract.Events.TITLE + "=? AND " + CalendarContract.Events.DELETED + "=0", new String[]{title}, null)) {
   if (c != null) while (c.moveToNext()) ids.add(c.getLong(0));
  }
  return ids;
 }
 private void gate() throws Exception {
  Assume.assumeTrue("Explicit J01 journey campaign", "1".equals(InstrumentationRegistry.getArguments().getString("posterJourney")));
  AppNavigation.assumeNoRequiredSignIn("J01 (poster to calendar)");
  // Scan mode lives in the Camera view, whose preview starts first: without CAMERA it asks Android
  // for it, and the system permission dialog stays in front of "Starting camera…" (an owner grants
  // it once; the picked poster still comes from DocumentsUI, never the camera).
  for (String permission : new String[]{Manifest.permission.CAMERA, Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR})
   InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(), permission);
 }
 /** Accepts Calendar's confirm prompts the way a person would, recording each message. */
 private void acceptConfirms() throws Exception {
  eval("(()=>{if(window.__j01Confirm)return;window.__j01Confirm={original:window.confirm,messages:[]};window.confirm=m=>{window.__j01Confirm.messages.push(String(m));return true;};})()");
 }
 private void restoreConfirms() throws Exception {
  eval("(()=>{const c=window.__j01Confirm;if(c){window.confirm=c.original;delete window.__j01Confirm;}})()");
 }

 private static final DateTimeFormatter PRINTED = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);
 /** Picks the poster, waits for the on-device OCR, corrects its text and opens the event draft. */
 private void scanPoster(String fixture, LocalDate day, String corrected) throws Exception {
  eval(AppNavigation.request("Camera")); until(AppNavigation.selected("Camera")); until("document.querySelector('[data-alpha-camera-screen]')");
  click("Scan mode"); until("document.querySelector('button[aria-label=\"Choose image\"]')");
  click("Choose image"); documents.selectDocument(fixture);
  until(SCANNED + "&&!" + SCANNED + ".disabled", 120000);
  String recognized = value("dialog[aria-label=\"Review scanned text\"] textarea[aria-label=\"Scanned text\"]");
  assertTrue("The on-device OCR read the picked poster: " + recognized, recognized.toLowerCase(Locale.ROOT).contains("studio"));
  set("dialog[aria-label=\"Review scanned text\"] textarea[aria-label=\"Scanned text\"]", corrected);
  until("[..." + REVIEW + ".querySelectorAll('summary')].some(s=>s.textContent.includes('Create event draft'))");
  eval("[..." + REVIEW + ".querySelectorAll('summary')].find(s=>s.textContent.includes('Create event draft')).click()");
  until("document.querySelector(" + JSONObject.quote(field("Event title")) + ")");
  // The suggestions, before anything is saved.
  assertEquals("Suggested title", "Open studio", value(field("Event title")));
  assertEquals("Suggested date", day.toString(), value(field("Event date")));
  assertEquals("Suggested start", "18:30", value(field("Event start time")));
  assertEquals("Suggested duration", "90", value(field("Event duration in minutes")));
  assertEquals("Suggested location", "Main hall", value(field("Event location")));
 }

 @Test public void posterBecomesExactlyOneReviewedProviderEventShownOnHome() throws Exception {
  gate();
  ContentResolver resolver = context().getContentResolver();
  String run = UUID.randomUUID().toString().substring(0, 8), title = "Poster journey " + run, name = "alpha-poster-" + run + ".png";
  LocalDate day = LocalDate.now(ZoneId.systemDefault()).plusDays(1);
  String corrected = "Open studio\n" + PRINTED.format(day) + "\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall";
  Uri fixture = null;
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   fixture = documents.fixtureBytes(resolver, name, "image/png", poster("Open studio", PRINTED.format(day), "Time: 6:30 PM - 8:00 PM", "Venue: Main hall"));
   AppNavigation.liveMode(); until("document.documentElement.dataset.activeView"); AppNavigation.declineStartupAccess(); acceptConfirms();
   scanPoster(name, day, corrected);
   set(field("Event title"), title);
   assertTrue("A suggestion saves nothing", rows(title).isEmpty());
   click("Review in Calendar");
   until("!" + REVIEW + "&&document.querySelector('input[aria-label=Title]')?.value===" + JSONObject.quote(title));
   assertEquals("Main hall", value("input[aria-label=Location]"));
   assertTrue("The Calendar form saves nothing by itself", rows(title).isEmpty());
   // The destination, chosen in the rendered picker.
   click("On this phone");
   click("Save event");
   until(detail(title));
   List<Long> saved = rows(title);
   assertEquals("Calendar Save wrote exactly one provider event", 1, saved.size());
   long begin = day.atTime(18, 30).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
   try (Cursor row = resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, saved.get(0)), new String[]{CalendarContract.Events.EVENT_LOCATION, CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND}, null, null, null)) {
    assertNotNull(row); assertTrue(row.moveToFirst());
    assertEquals("Reviewed location", "Main hall", row.getString(0));
    assertEquals("Reviewed start", begin, row.getLong(1));
    assertEquals("Reviewed duration", begin + 90 * 60_000L, row.getLong(2));
   }
   // Home's calendar card opens the same event.
   eval(AppNavigation.request("Home")); until(AppNavigation.selected("Home"));
   String card = "[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')?.startsWith(" + JSONObject.quote("Open calendar event: " + title + ",") + "))";
   until(card, 30000); eval("(" + card + ").click()");
   until(AppNavigation.selected("Calendar") + "&&" + detail(title));
   assertEquals("Opening it from Home created nothing", saved, rows(title));
  } finally {
   try { restoreConfirms(); } catch (Exception | AssertionError ignored) { /* The Activity may already be gone. */ }
   for (long id : rows(title)) resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null);
   if (fixture != null) resolver.delete(fixture, null, null);
  }
 }

 @Test public void cancellingTheScanOrTheCalendarReviewLeavesNoRow() throws Exception {
  gate();
  ContentResolver resolver = context().getContentResolver();
  String run = UUID.randomUUID().toString().substring(0, 8), title = "Poster cancelled " + run, name = "alpha-poster-cancel-" + run + ".png";
  LocalDate day = LocalDate.now(ZoneId.systemDefault()).plusDays(1);
  String corrected = "Open studio\n" + PRINTED.format(day) + "\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall";
  Uri fixture = null;
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   fixture = documents.fixtureBytes(resolver, name, "image/png", poster("Open studio", PRINTED.format(day), "Time: 6:30 PM - 8:00 PM", "Venue: Main hall"));
   AppNavigation.liveMode(); until("document.documentElement.dataset.activeView"); AppNavigation.declineStartupAccess(); acceptConfirms();
   // 1. Close the scan with a reviewed draft open.
   scanPoster(name, day, corrected); set(field("Event title"), title);
   click("Close scan"); until("!" + REVIEW);
   assertTrue("Closing the scan saves nothing", rows(title).isEmpty());
   // 2. Hand off to Calendar, then discard the form there without Save.
   scanPoster(name, day, corrected); set(field("Event title"), title);
   click("Review in Calendar"); until("document.querySelector('input[aria-label=Title]')?.value===" + JSONObject.quote(title));
   click("Discard calendar draft"); until("!document.querySelector('input[aria-label=Title]')");
   SystemClock.sleep(1500);
   assertTrue("Leaving the Calendar review saves nothing", rows(title).isEmpty());
   scenario.recreate(); AppNavigation.liveMode(); until("document.documentElement.dataset.activeView");
   assertTrue("Nothing appears after a recreation either", rows(title).isEmpty());
  } finally {
   try { restoreConfirms(); } catch (Exception | AssertionError ignored) { /* The Activity may already be gone. */ }
   for (long id : rows(title)) resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null);
   if (fixture != null) resolver.delete(fixture, null, null);
  }
 }
}
