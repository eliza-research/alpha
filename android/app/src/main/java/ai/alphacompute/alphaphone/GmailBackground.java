package ai.alphacompute.alphaphone;

import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.notifications.MailNoticePoster;
import android.content.Context;
import org.json.JSONObject;

/** Alpha's installed binding for the shared background new-mail check (plugin-native-notifications):
 * the encrypted 'gmail-background:v1' slot, the production Cloud key, reset fence and notice identifiers. */
final class GmailBackground {
 static final String SLOT="gmail-background:v1";
 static final MailNoticePoster.Config NOTICES=new MailNoticePoster.Config("alpha-gmail","New Gmail messages","Tells you when new unread mail arrives. Never shows the sender or subject. Android may delay checks.",
  "ai.alphacompute.alphaphone.OPEN_GMAIL_NOTICE","alpha-gmail:","alpha-gmail-ask:","alpha-gmail-",R.drawable.notification_icon,"New mail in Gmail","Tap to open Inbox.","Alpha Phone","Tap to open.","Ask Alpha",MainActivity.class);
 private static MailBackgroundDelivery delivery;private static MailNoticePoster poster;
 static synchronized MailNoticePoster poster(Context context){if(poster==null)poster=new MailNoticePoster(context.getApplicationContext(),NOTICES);return poster;}
 static synchronized MailBackgroundDelivery get(Context context){
  if(delivery!=null)return delivery;
  Context app=context.getApplicationContext();AlphaCredentialStore store=new AlphaCredentialStore(app);
  delivery=new MailBackgroundDelivery(new MailBackgroundDelivery.Host(){
   // Lifecycle precedes the vault lock, matching credential writers.
   public Object lock(){return AlphaLocalAgentPlugin.credentialLifecycleLock();}
   public String readState()throws Exception{return store.readCredentialSlot(SLOT);}
   public void writeState(String value)throws Exception{store.writeCredentialSlot(SLOT,value);}
   public void removeState()throws Exception{store.removeCredentialSlot(SLOT);}
   public String readCredential()throws Exception{return store.readCredentialSlot("cloud:production");}
   public boolean resetPending(){return AlphaDataReset.RESET.pending(app);}
   public JSONObject verifiedIdentity(JSONObject data)throws Exception{return LocalAgentProviderAdmission.verifiedCloudIdentity(data);}
  },new MailBackgroundDelivery.Scheduler(){public void schedule(String generation){GmailDeliveryWorker.schedule(app,generation);}public void cancel(){GmailDeliveryWorker.cancel(app);}},
  poster(app),new MailBackgroundDelivery.Config(CloudDeployment.PRODUCTION_API,"production","google.gmail.triage",4));
  MailBackgroundDelivery created=delivery;
  // A replaced or removed Cloud key retires the selection, its schedule and its notices.
  AlphaCredentialStore.observeCloudChanges(()->created.withdraw(null));
  return delivery;
 }
}
