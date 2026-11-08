package ai.elizaresearch.alphaphone;
import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;
import org.junit.*;
import static org.junit.Assert.*;
/** Explicit two-process test using the test-only runner, real Inbox and encrypted storage. */
public final class InboxDraftInstrumentedTest {
 private boolean fixtureArmed;
 @Before public void installClosedFixture()throws Exception {
  android.os.Bundle args=InstrumentationRegistry.getArguments();String phase=args.getString("inboxPhase"),runId=args.getString("inboxRunId");
  Assume.assumeTrue("Explicit Inbox process fixture arguments required",phase!=null);
  assertTrue("Known fixture phase",java.util.Set.of("prepare","restore","cleanup").contains(phase));
  assertNotNull("Run UUID required",runId);assertEquals("Canonical UUID",java.util.UUID.fromString(runId).toString(),runId);
  InboxFixtureScope.phase=phase;InboxFixtureScope.runId=runId;
  assertTrue(InstrumentationRegistry.getInstrumentation() instanceof androidx.test.runner.MonitoringInstrumentation);
  androidx.test.runner.MonitoringInstrumentation runner=(androidx.test.runner.MonitoringInstrumentation)InstrumentationRegistry.getInstrumentation();
  runner.interceptActivityUsing(new androidx.test.runner.intercepting.InterceptingActivityFactory(){
   @Override public boolean shouldIntercept(ClassLoader loader,String name,Intent intent){return name.equals(MainActivity.class.getName());}
   @Override public Activity create(ClassLoader loader,String name,Intent intent){return new InboxFixtureActivity();}
  });fixtureArmed=true;
 }
 @After public void removeClosedFixture()throws Exception {
  if(!fixtureArmed)return;
  try{InboxFixtureActivity a=activity();if(a!=null)BoundedActivityScenario.main(a::finish);}
  finally{((androidx.test.runner.MonitoringInstrumentation)InstrumentationRegistry.getInstrumentation()).useDefaultInterceptingActivityFactory();fixtureArmed=false;}
 }
 private static final String SELECTION="alpha.connection.selection.v1",SERVICE="alpha.connection.cloud-service.v1";
 private InboxFixtureActivity activity()throws Exception{
  AtomicReference<InboxFixtureActivity> out=new AtomicReference<>();
  BoundedActivityScenario.main(()->{for(Stage stage:new Stage[]{Stage.RESUMED,Stage.STARTED})for(Activity a:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(a.getClass()==InboxFixtureActivity.class&&!a.isFinishing())out.set((InboxFixtureActivity)a);});
  return out.get();
 }
 private String js(String code)throws Exception{
  InboxFixtureActivity a=activity();assertNotNull("Fixture Activity is live",a);CountDownLatch done=new CountDownLatch(1);AtomicReference<String> out=new AtomicReference<>();
  BoundedActivityScenario.main(()->a.getBridge().getWebView().evaluateJavascript(code,value->{out.set(value);done.countDown();}));
  assertTrue("Fixture WebView responds",done.await(8,TimeUnit.SECONDS));return out.get();
 }
 private void until(String code)throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(80);}throw new AssertionError("Inbox UI condition timed out: "+code);
 }
 private JSONObject call(String expression)throws Exception{
  js("window.__inboxNative=null;Promise.resolve("+expression+").then(v=>window.__inboxNative={ok:true,value:v??null},()=>window.__inboxNative={ok:false})");until("window.__inboxNative!==null");JSONObject result=new JSONObject(js("window.__inboxNative"));assertTrue("Native fixture operation succeeded",result.getBoolean("ok"));return result;
 }
 private String button(String name){return "[...document.querySelectorAll('button')].find(e=>e.getClientRects().length&&!e.disabled&&(e.getAttribute('aria-label')==="+JSONObject.quote(name)+"||e.textContent.trim()==="+JSONObject.quote(name)+"))";}
 private void click(String name)throws Exception{until(button(name));js("("+button(name)+").click()");}
 private void input(String name,String text)throws Exception{
  String selector="document.querySelector('[aria-label=\""+name+"\"]')";until(selector);js("(()=>{const e="+selector+";Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(text)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");until(selector+".value==="+JSONObject.quote(text));
 }
 private void nav(String name)throws Exception{js(AppNavigation.request(name));until("window.__alphaTestNavigation?.status==='complete'&&"+AppNavigation.selected(name));}
 private String slot(){return "inbox-drafts:v1:"+new JSONArray().put("production").put(InboxFixtureScope.runId).put("").put("a");}
 private JSONObject read(String key)throws Exception{return call("Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(key)+"})").getJSONObject("value");}
 private void reload()throws Exception{String before=js("performance.timeOrigin");js("location.replace(location.origin+location.pathname)");until("performance.timeOrigin!=="+before+"&&document.documentElement.dataset.activeView");}
 @Test public void processPhase()throws Exception{
  assertTrue(BuildConfig.DEBUG);String phase=InboxFixtureScope.phase;
  android.os.Bundle evidence=new android.os.Bundle();evidence.putInt("inboxFixturePid",android.os.Process.myPid());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File backup=new File(context.getNoBackupFilesDir(),"inbox-fixture-"+InboxFixtureScope.runId+".json");
  BoundedActivityScenario.main(()->context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK)));
  long deadline=SystemClock.elapsedRealtime()+20000;while(activity()==null&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(50);assertNotNull(activity());
  until("window.Capacitor?.Plugins?.AlphaConnection&&document.documentElement.dataset.activeView");
  if(phase.equals("cleanup")){
   if(!backup.exists())return;
   JSONObject prior=new JSONObject(new String(Files.readAllBytes(backup.toPath()),java.nio.charset.StandardCharsets.UTF_8));
   JSONObject credential=read("cloud:production");
   if(!credential.isNull("value")){
    JSONObject value=new JSONObject(credential.getString("value"));assertTrue("Only fixture credential can be removed",InboxFixtureConnection.token().equals(value.optString("token")));
    call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:'cloud:production'})");
   }
   call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot())+"})");
   for(String key:new String[]{SELECTION,SERVICE})js(prior.isNull(key)?"localStorage.removeItem("+JSONObject.quote(key)+")":"localStorage.setItem("+JSONObject.quote(key)+","+JSONObject.quote(prior.getString(key))+")");
   Files.delete(backup.toPath());return;
  }
  if(phase.equals("prepare")){
   assertFalse("Refuse unresolved earlier fixture",backup.exists());
   assertTrue("Refuse preexisting production-profile credentials",read("cloud:production").isNull("value"));
   assertTrue("Unique draft slot starts empty",read(slot()).isNull("value"));
   JSONObject prior=new JSONObject().put("pid",android.os.Process.myPid());
   for(String key:new String[]{SELECTION,SERVICE})prior.put(key,new JSONTokener(js("localStorage.getItem("+JSONObject.quote(key)+")")).nextValue());
   Files.write(backup.toPath(),prior.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
   js("localStorage.setItem("+JSONObject.quote(SELECTION)+",JSON.stringify({kind:'none'}));localStorage.removeItem("+JSONObject.quote(SERVICE)+")");reload();
   // Exercise the production sign-in control with a closed test-APK transport;
   // a developer-only environment selector is not part of this UI contract.
   nav("Settings");click("Agent connection");click("Sign in with Eliza Cloud");
   until("document.querySelector('.alpha-cloud-sign-in input[name=email]')");js(InboxFixtureSignIn.DRIVE_EMAIL);
   until("document.querySelector('.alpha-cloud-sign-in input[name=one-time-code]')");js(InboxFixtureSignIn.DRIVE_CODE);// The Android account panel names the signed-in state and offers Sign out only once /api/v1/user verified the session.
   until("document.querySelector('#connection-title')?.textContent==='Your agent'&&"+button("Sign out"));click("Close connection settings");
   // Inbox loads the signed-in mailbox by itself (the old explicit Load Inbox control is gone).
   nav("Inbox");until(button("Fixture a"));until(button("Refresh"));click("Compose");input("To","literal@example.invalid");click("literal@example.invalid");input("Subject","Synthetic saved draft");input("Message","Exact native draft\nSecond line");click("Save draft locally");until("[...document.querySelectorAll('[role=status]')].some(e=>e.textContent==='Saved locally on this device')");
   JSONObject draft=new JSONObject(read(slot()).getString("value"));assertEquals("Exact native draft\nSecond line",draft.getString("body"));
   StringBuilder hash=new StringBuilder();for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(slot().getBytes(StandardCharsets.UTF_8)))hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
   byte[] bytes=Files.readAllBytes(new File(context.getNoBackupFilesDir(),"connection-credentials/"+hash).toPath());assertFalse(new String(bytes,StandardCharsets.ISO_8859_1).contains("Exact native draft"));
  }else{
   JSONObject prior=new JSONObject(new String(Files.readAllBytes(backup.toPath()),java.nio.charset.StandardCharsets.UTF_8));assertNotEquals("Actual new Android process required",prior.getInt("pid"),android.os.Process.myPid());
   // Decision P-43: there is no local-apps choice to keep. The resident starts at every app start and
   // the saved sign-in binds inference and Cloud services, so after the restart Settings shows the
   // signed-in account without a retry and Inbox offers the saved draft.
   nav("Settings");click("Agent connection");
   until("document.querySelector('#connection-title')?.textContent==='Your agent'&&"+button("Sign out"));click("Close connection settings");
   nav("Inbox");click("Restore local draft");until("document.querySelector('textarea[aria-label=Message]')?.value==='Exact native draft\\nSecond line'");assertEquals("\"Synthetic saved draft\"",js("document.querySelector('input[aria-label=Subject]').value"));
   click("Discard local draft");click("Keep draft");assertFalse(read(slot()).isNull("value"));click("Discard local draft");click("Discard permanently");until(button("Refresh"));assertTrue(read(slot()).isNull("value"));
   click("Refresh");click("Synthetic sender, Fixture reply");click("Reply");input("Message","Native reply draft");click("Save draft locally");until("[...document.querySelectorAll('[role=status]')].some(e=>e.textContent==='Saved locally on this device')");
   JSONObject reply=new JSONObject(read(slot()).getString("value")).getJSONObject("reply");assertEquals("fixture-message",reply.getString("messageId"));assertEquals("fixture-thread",reply.getString("threadId"));
   click("Back from draft");click("Back to inbox");click("Fixture b");click("Compose");until("document.querySelector('textarea[aria-label=Message]')?.value===''");assertFalse(read(slot()).isNull("value"));
  }
  assertEquals("No provider mutation was attempted",0,InboxFixtureConnection.rejectedWrites);
  assertTrue("Identity actually verified through Cloud protocol",InboxFixtureConnection.routes.contains("GET /api/v1/user"));
  assertTrue("Accounts actually fetched",InboxFixtureConnection.routes.contains("GET /api/v1/eliza/google/accounts"));
 }
}
