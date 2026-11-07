package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * MVP-13 notification question on Android: Alpha's own posted reminder offers "Ask Alpha" in
 * Android's shade (Alpha draws no shade, #416). The question action opens the exact reminder and,
 * with an agent selected, a review whose excerpt is that notice's title and text; the reviewed text
 * is what reaches the draft, and a reminder cancelled during review adds nothing. Without a selected
 * agent nothing is reviewed or composed and the notification is retained. The action's own
 * PendingIntent is sent (the unlock requirement is Android's and needs an unlocked emulator).
 * Disposable reminder fixtures only. Emulator evidence only.
 */
@RunWith(AndroidJUnit4.class)
public class ReminderNoticeQuestionInstrumentedTest {
 private static final String REVIEW="document.querySelector('dialog[aria-label=\"Ask about selected content\"]')";
 private static final String EXCERPT=REVIEW+"?.querySelector('textarea[aria-label=\"Content excerpt\"]')";
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private NotificationManager manager(){return context().getSystemService(NotificationManager.class);}
 private StatusBarNotification notification(String id){for(StatusBarNotification n:manager().getActiveNotifications())if(id.equals(n.getTag()))return n;return null;}
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Notice question condition: "+js+"; UI="+eval("JSON.stringify({view:document.documentElement.dataset.activeView,dialog:"+REVIEW+"?.textContent?.slice(0,400),text:document.body.innerText.slice(-600)})"));}
 private void clickText(String text)throws Exception{String q="[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==="+JSONObject.quote(text)+"&&!b.disabled)";until(q);eval("("+q+").click()");}
 private void editExcerpt(String value)throws Exception{eval("(()=>{const e="+EXCERPT+";Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");}
 /** Schedules a due disposable reminder and posts its notice; returns the posted notice. */
 private StatusBarNotification post(String id,String title,String body)throws Exception{
  Context c=context();
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  ReminderTestAccess.channel(c);Assume.assumeTrue("Notifications must be enabled for the app",ReminderTestAccess.allowed(c));
  long at=System.currentTimeMillis()+1500;ReminderTestAccess.schedule(c,id,title,body,at);
  while(System.currentTimeMillis()<at+250)SystemClock.sleep(100);
  ReminderTestAccess.deliver(c,id,ReminderTestAccess.read(c,id).getString("occurrenceId"));
  StatusBarNotification posted=null;for(int i=0;i<100&&(posted=notification(id))==null;i++)SystemClock.sleep(100);
  assertNotNull("The reminder notice is posted",posted);
  assertEquals(AlphaReminders.CONFIGURATION.questionActionLabel,posted.getNotification().actions[2].title.toString());
  return posted;
 }
 private void ask(StatusBarNotification posted)throws Exception{posted.getNotification().actions[2].actionIntent.send();}
 private void ready()throws Exception{
  AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Home"));
  until("document.querySelector('[data-screen]')&&!document.querySelector('.alpha-connection-scrim')");AppNavigation.declineStartupAccess();
 }
 private void clean(String id)throws Exception{ReminderTestAccess.cancel(context(),id);manager().cancel(id,0);}

 /** No selected agent: the question opens the exact reminder, reviews nothing and keeps the notice. */
 @Test public void questionWithoutASelectedAgentReviewsNothingAndRetainsTheNotice()throws Exception{
  Assume.assumeTrue("Home is reachable without an account only in a test-mocks app build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Assume.assumeFalse("The selected-agent campaign runs the review method instead","1".equals(InstrumentationRegistry.getArguments().getString("noticeQuestion")));
  String id="question_"+UUID.randomUUID(),title="Question fixture "+id;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();StatusBarNotification posted=post(id,title,"Disposable body");ask(posted);
   until(AppNavigation.selected("Calendar"));
   until("document.body.innerText.includes('Select an agent before asking about this reminder. The notification is retained.')");
   assertEquals("No review opens without an agent","false",eval("Boolean("+REVIEW+")"));
   assertEquals("Nothing reaches a draft","false",eval("[...document.querySelectorAll('textarea[data-alpha-composer]')].some(e=>e.value.includes("+JSONObject.quote(title)+"))"));
   assertNotNull("The notice is retained",notification(id));
  }finally{clean(id);}
 }

 /**
  * With an agent selected (the #676 notice-question campaign provides one and passes
  * {@code -e noticeQuestion 1}): the exact notice text is reviewed and composed; a reminder cancelled
  * while its review is open adds nothing.
  */
 @Test public void questionReviewsTheExactNoticeAndRefusesACancelledOne()throws Exception{
  Assume.assumeTrue("Selected-agent notice question campaign: -e noticeQuestion 1","1".equals(InstrumentationRegistry.getArguments().getString("noticeQuestion")));
  String id="question_"+UUID.randomUUID(),title="Question fixture "+id,body="Ask about Tuesday "+id;
  String other="question_"+UUID.randomUUID(),otherTitle="Cancelled fixture "+other;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();StatusBarNotification posted=post(id,title,body);ask(posted);
   until(AppNavigation.selected("Calendar"));until(EXCERPT+"?.value.length>0");
   assertEquals("\"Alpha Phone notification\"",eval(REVIEW+".querySelector('[aria-label=\"Selected source\"]').textContent.trim()"));
   assertEquals(JSONObject.quote(title+"\n"+body),eval(EXCERPT+".value"));
   // A verification code is never placed in a draft.
   editExcerpt("Your verification code is 481516");clickText("Use in conversation");
   until(REVIEW+"?.querySelector('[role=status]')?.textContent.includes('credentials or verification codes')");
   editExcerpt(title);clickText("Use in conversation");
   until(AppNavigation.composer()+"?.value==="+JSONObject.quote("Help me with this notification.\n\nSource: Alpha Phone notification\n\n"+title));
   until("!"+REVIEW);

   // A reminder cancelled while its review is open adds nothing to the conversation.
   StatusBarNotification second=post(other,otherTitle,"Disposable body");ask(second);
   until(EXCERPT+"?.value.includes("+JSONObject.quote(otherTitle)+")");
   assertTrue("Cancelled during review",ReminderTestAccess.cancel(context(),other));
   clickText("Use in conversation");
   until("document.body.innerText.includes('Nothing was added to your conversation.')");until("!"+REVIEW);
   assertEquals("The cancelled notice never reached a draft","false",eval("[...document.querySelectorAll('textarea[data-alpha-composer]')].some(e=>e.value.includes("+JSONObject.quote(otherTitle)+"))"));
  }finally{clean(id);clean(other);}
 }
}
