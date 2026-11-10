package ai.alphacompute.alphaphone;

import android.app.Activity;
import android.Manifest;
import com.getcapacitor.annotation.Permission;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.DocumentsContract;
// MVP-DEFERRED: import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import ai.eliza.plugins.media.SelectedDocumentCalls;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Product handoffs only. Opening another app never proves that a write completed. */
@CapacitorPlugin(name = "DailyApps", permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}), @Permission(alias = "camera", strings = {Manifest.permission.CAMERA})})
public class DailyAppsPlugin extends ai.eliza.plugins.reminders.ReminderPlugin {
 private static final String[] ACTIONS = {"camera", "photos", "files", "maps", "calendar", "calendar-create", "reminder", "email", "inbox", "browser", "notifications", "settings", "autofill", "voice"}; // MVP-DEFERRED: "phone", "messages", "contacts".
 private boolean selectionPending;
 /** Selected-document calls reach the document provider (a cloud file can stall for its whole download) and
  *  the shared SelectedDocuments monitor, so they run here in call order, never on Capacitor's plugin thread. */
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 public DailyAppsPlugin() { super(AlphaReminders.CONFIGURATION, AlphaReminders.STORAGE); }

 /** Cancellation uses AlphaDeletions' native review and durable ten-second window. */
 @Override @PluginMethod public void operateReminder(PluginCall call){JSObject operation=call.getObject("operation");if(operation!=null&&"reminder_cancel".equals(operation.optString("type"))){call.reject("Use the reviewed deletion window");return;}super.operateReminder(call);}
 @Override @PluginMethod public void cancelReminder(PluginCall call){call.reject("Use the reviewed deletion window");}
 @Override public void load() {
  SelectedDocumentAccess.initialize(getContext());
  super.load();
  openAssistant();
 }
 @Override protected void handleOnDestroy(){worker.shutdownNow();super.handleOnDestroy();}
 @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); openAssistant(); }
 private void openAssistant() {
  if (!(getActivity() instanceof AlphaAssistActivity)) return;
  JSObject value = new JSObject(); value.put("source", "android-assist"); value.put("surface", "assistant");
  notifyListeners("assistantInvoked", value, true);
 }
 /** Capacitor's own permission request launches through the activity; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 /** The shared reminder plugin asks for the notification permission inside this method; see {@link LateLaunch}. */
 @Override @PluginMethod public void scheduleReminder(PluginCall call){LateLaunch.ask(call,()->super.scheduleReminder(call));}
 @PluginMethod public void surfaceInfo(PluginCall call) {
  JSObject value = new JSObject(); value.put("assistant", getActivity() instanceof AlphaAssistActivity); value.put("developmentBuild", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  addReminderCapabilities(value);
  // Repeat days reach Clock (clock.handoff.v2): clockHandoff accepts days.
  value.put("clockRepeatDaysVersion", 1);
  value.put("topInset", getActivity() instanceof MainActivity ? ((MainActivity)getActivity()).getTopInsetDp() : 0);
  value.put("bottomInset", getActivity() instanceof MainActivity ? ((MainActivity)getActivity()).getBottomInsetDp() : 0); call.resolve(value);
 }
 @PluginMethod public void closeAssistant(PluginCall call) {
  boolean assistant = getActivity() instanceof AlphaAssistActivity;
  JSObject value = new JSObject(); value.put("closed", assistant); call.resolve(value);
  if (assistant) getActivity().runOnUiThread(() -> getActivity().finish());
 }
 /** Selected-document capabilities: the shared bridge contract over Alpha's installed registry (SelectedDocumentAccess). */
 @PluginMethod public void restoreSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.restore(call,()->SelectedDocumentAccess.documents(getContext())));}
 @PluginMethod public void renameSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.rename(call,()->SelectedDocumentAccess.documents(getContext())));}
 @PluginMethod public void pdfSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.pdf(call,()->SelectedDocumentAccess.documents(getContext())));}
 @PluginMethod public void describeSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.describe(call,()->SelectedDocumentAccess.documents(getContext())));}
 @PluginMethod public void readSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.read(call,()->SelectedDocumentAccess.documents(getContext())));}
 @PluginMethod public void openSelected(PluginCall call){Activity activity=getActivity();documents(call,()->SelectedDocumentCalls.open(call,()->SelectedDocumentAccess.documents(getContext()),activity));}
 @PluginMethod public void shareSelected(PluginCall call){Activity activity=getActivity();documents(call,()->SelectedDocumentCalls.share(call,()->SelectedDocumentAccess.documents(getContext()),activity));}
 @PluginMethod public void forgetSelected(PluginCall call){documents(call,()->SelectedDocumentCalls.forget(call,()->SelectedDocumentAccess.documents(getContext())));}
 private void documents(PluginCall call,Runnable task){PluginWorkers.submit(worker,task,()->call.reject("Saved document access is unavailable"));}
 private Integer clockInteger(JSObject data,String key) {
  Object value=data.opt(key);if(value==null||value==org.json.JSONObject.NULL)return null;
  if(!(value instanceof Number))throw new IllegalArgumentException("Invalid Clock number");
  double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number!=Math.rint(number)||number<Integer.MIN_VALUE||number>Integer.MAX_VALUE)throw new IllegalArgumentException("Invalid Clock number");
  return (int)number;
 }
 @PluginMethod public void clockHandoff(PluginCall call) {
  try {
   JSObject data=call.getData();java.util.Iterator<String> keys=data.keys();
   while(keys.hasNext()){String key=keys.next();if(!java.util.Arrays.asList("action","hour","minute","label","snoozeMinutes","reviewed","timeZone","days").contains(key))throw new IllegalArgumentException("Unexpected Clock option");}
   if(data.has("timeZone")&&(!(data.opt("timeZone") instanceof String)||((String)data.opt("timeZone")).length()>100))throw new IllegalArgumentException("Invalid Clock time zone");
   Object label=data.opt("label");if(label!=null&&label!=org.json.JSONObject.NULL&&!(label instanceof String))throw new IllegalArgumentException("Invalid Clock label");
   // Shared reviewed handoff (plugin-native-system clock.ClockHandoff): a launched Clock activity is
   // never a receipt; the strongest status is "opened", naming the package that received it.
   call.resolve(clockResult(ai.eliza.plugins.system.clock.ClockHandoff.launch(getActivity(),"Alpha",call.getString("action"),clockInteger(data,"hour"),clockInteger(data,"minute"),label instanceof String?(String)label:null,clockInteger(data,"snoozeMinutes"),Boolean.TRUE.equals(data.opt("reviewed")),call.getString("timeZone"),ai.eliza.plugins.system.clock.ClockDays.strict(data.opt("days")))));
  }catch(IllegalArgumentException invalid){call.resolve(clockResult(ai.eliza.plugins.system.clock.ClockHandoff.result(call.getString("action"),ai.eliza.plugins.system.clock.ClockHandoff.Status.FAILED,invalid.getMessage())));}
 }
 static JSObject clockResult(ai.eliza.plugins.system.clock.ClockHandoff.Result result){
  JSObject out=new JSObject();out.put("action",result.action);out.put("status",result.status.wire);out.put("message",result.message);
  if(result.receiver!=null)out.put("package",result.receiver);return out;
 }
 @PluginMethod public void capabilities(PluginCall call) {
  JSArray actions = new JSArray();
  for (String action : ACTIONS) {
   JSObject item = new JSObject(); item.put("action", action);
   try { item.put("available", intent(action, null).resolveActivity(getContext().getPackageManager()) != null); }
   catch (IllegalArgumentException error) { item.put("available", false); }
   item.put("mode", isSelection(action) ? "selection" : "handoff"); actions.put(item);
  }
  JSObject result = new JSObject(); result.put("platform", "android"); result.put("actions", actions); call.resolve(result);
 }
 private boolean isSelection(String action) { return "photos".equals(action) || "files".equals(action) || "voice".equals(action); }
 private Double number(PluginCall call, String key) {
  // Capacitor getDouble does not accept org.json's Long representation of epoch ms.
  Object value = call.getData().opt(key);
  return value instanceof Number ? ((Number)value).doubleValue() : null;
 }
 /** Category pickers narrow the system picker only; the provider still decides.
  * A missing list means all documents. Invalid entries refuse the request. */
 static String[] mimeTypes(PluginCall call) {
  if (call == null || !call.getData().has("mime")) return new String[0];
  JSArray raw = call.getArray("mime");
  if (raw == null || raw.length() < 1 || raw.length() > 12) throw new IllegalArgumentException("Choose up to 12 document types");
  String[] types = new String[raw.length()];
  for (int i = 0; i < raw.length(); i++) {
   String value = raw.optString(i, "");
   if (!value.matches("[a-z]+/([a-z0-9][a-z0-9.+-]{0,126}|\\*)") && !"*/*".equals(value)) throw new IllegalArgumentException("Unsupported document type");
   types[i] = value;
  }
  return types;
 }
 private String string(PluginCall call, String key, String fallback) { return call == null ? fallback : call.getString(key, fallback); }
 private Intent intent(String action, PluginCall call) {
  switch (action) {
   // MVP-DEFERRED: case "phone": return new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(string(call, "query", ""))));
   // MVP-DEFERRED: case "messages": return new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(string(call, "query", "")))).putExtra("sms_body", string(call, "body", ""));
   // MVP-DEFERRED: case "contacts": return new Intent(Intent.ACTION_VIEW).setDataAndType(ContactsContract.Contacts.CONTENT_URI, ContactsContract.Contacts.CONTENT_TYPE);
   case "camera": return new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
   case "photos": return new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
   case "files": {
    Intent result = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    String[] types = mimeTypes(call);
    if (types.length == 1) result.setType(types[0]); else if (types.length > 1) result.putExtra(Intent.EXTRA_MIME_TYPES, types);
    if ("downloads".equals(string(call, "initialLocation", ""))) {
     result.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
       DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download"));
    }
    return result;
   }
   case "maps": return new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(string(call, "query", ""))));
   case "calendar": return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR);
   case "calendar-create": case "reminder": {
    Intent result = new Intent(Intent.ACTION_INSERT).setDataAndType(CalendarContract.Events.CONTENT_URI, "vnd.android.cursor.dir/event");
    result.putExtra(CalendarContract.Events.TITLE, string(call, "title", ""));
    result.putExtra(CalendarContract.Events.DESCRIPTION, string(call, "body", ""));
    if (call != null) {
     Double start = number(call, "startTime"), end = number(call, "endTime");
     if (start != null && (!Double.isFinite(start) || start < 0)) throw new IllegalArgumentException("Choose a valid start time");
     if (end != null && (!Double.isFinite(end) || end < 0 || (start != null && end <= start))) throw new IllegalArgumentException("End time must follow start time");
     if (start != null) result.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.longValue());
     if (end != null) result.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue());
    }
    return result;
   }
   case "email": {
    String recipient = string(call, "query", "").trim();
    if (!recipient.isEmpty() && !android.util.Patterns.EMAIL_ADDRESS.matcher(recipient).matches()) throw new IllegalArgumentException("Enter one valid email address");
    Intent result = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", recipient, null)).putExtra(Intent.EXTRA_SUBJECT, string(call, "title", "")).putExtra(Intent.EXTRA_TEXT, string(call, "body", ""));
    if (!recipient.isEmpty()) result.putExtra(Intent.EXTRA_EMAIL, new String[]{recipient});
    return result;
   }
   case "inbox": return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_EMAIL);
   case "browser": {
    Uri uri = Uri.parse(string(call, "url", "https://example.com"));
    if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getHost().isEmpty() || uri.getUserInfo() != null) throw new IllegalArgumentException("Enter an http or https address without embedded credentials");
    return new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
   }
   case "notifications": return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
   case "settings": return new Intent(Settings.ACTION_SETTINGS);
   // Android has no public generic autofill-picker intent. Provider enablement
   // intents require an installed provider package, which Alpha Phone is not.
   case "autofill": return new Intent(Settings.ACTION_SETTINGS);
   case "voice": return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PROMPT, "Dictate your note. Review the transcript before saving.").putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
   default: throw new IllegalArgumentException("Unsupported daily app action");
  }
 }
 @PluginMethod public void perform(PluginCall call) {
  String action = call.getString("action", "");
  try {
   Intent target = intent(action, call);
   if (target.resolveActivity(getContext().getPackageManager()) == null) { finish(call, "unavailable", "No installed app handles this action"); return; }
   if (isSelection(action)) {
    if (selectionPending) { finish(call, "failed", "Finish the current selection first"); return; }
    selectionPending = true;
    if (!LateLaunch.ask(call, () -> startActivityForResult(call, target, "selectionResult"))) selectionPending = false;
   } else { getActivity().startActivity(target); finish(call, "opened", "autofill".equals(action) ? "Opened Android settings. Search for passwords or autofill to choose your installed provider." : "Opened the system app. Review and complete the action there."); }
  } catch (ActivityNotFoundException error) { selectionPending = false; finish(call, "unavailable", "The app is no longer available"); }
  catch (SecurityException error) { selectionPending = false; finish(call, "failed", "Android did not allow this action"); }
  catch (IllegalArgumentException error) { finish(call, "failed", error.getMessage()); }
 }
 @ActivityCallback private void selectionResult(PluginCall call, ActivityResult result) {
  selectionPending = false;
  if (call == null) return;
  if (result.getResultCode() != Activity.RESULT_OK) { finish(call, "cancelled", "Nothing was selected or saved"); return; }
  Intent data = result.getData();
  if ("voice".equals(call.getString("action"))) {
   ArrayList<String> words = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
   if (words == null || words.isEmpty() || words.get(0).trim().isEmpty()) { finish(call, "failed", "No speech was recognized"); return; }
   JSObject value = base(call, "selected"); value.put("transcript", words.get(0)); resolveResult(call, value); return;
  }
  Uri uri = data == null ? null : data.getData();
  if (uri == null || !"content".equals(uri.getScheme())) { finish(call, "failed", "The provider did not return an accessible document"); return; }
  String selectedId=null;
  try {
   int retainedFlags=0;
   if ((data.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0 && (data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
    final int offered=(data.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION)!=0 ? Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION : Intent.FLAG_GRANT_READ_URI_PERMISSION;
    getContext().getContentResolver().takePersistableUriPermission(uri, offered);retainedFlags=offered;
   }
   selectedId=SelectedDocumentAccess.authorize(getContext(),uri,retainedFlags);
   JSObject value = base(call, "selected"); value.put("uri", uri.toString()); value.put("mimeType", getContext().getContentResolver().getType(uri));
   try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
    if (cursor != null && cursor.moveToFirst()) value.put("name", cursor.getString(0));
   }
   value.put("selectionId", selectedId);
   resolveResult(call, value);
  } catch (RuntimeException error) { if(selectedId!=null)try{SelectedDocumentAccess.forget(selectedId);}catch(RuntimeException ignored){} finish(call, "failed", "The document provider could not grant access or read this selection"); }
 }
 private void resolveResult(PluginCall call, JSObject value) {
  if (PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())) notifyListeners("restoredResult", value, true);
  call.resolve(value);
 }
 private JSObject base(PluginCall call, String status) { JSObject value = new JSObject(); value.put("action", call.getString("action", "")); value.put("status", status); return value; }
 private void finish(PluginCall call, String status, String message) { JSObject value = base(call, status); value.put("message", message); resolveResult(call, value); }
}
