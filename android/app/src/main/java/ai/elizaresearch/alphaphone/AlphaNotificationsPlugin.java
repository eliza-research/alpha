package ai.elizaresearch.alphaphone;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.eliza.plugins.notifications.HostNoticePoster;
import ai.eliza.plugins.notifications.NoticeDelivery;
import ai.eliza.plugins.notifications.NoticeRoutes;
import ai.eliza.plugins.notifications.NotificationMirror;
import ai.eliza.plugins.notifications.NotificationsHostPlugin;

/**
 * Alpha's registration of the shared notifications bridge (ai.eliza.plugins.notifications.NotificationsHostPlugin):
 * own rows, channel settings, cross-app access, workflow taps and workflow notices are upstream code behind
 * its ForegroundNoticeGate. Alpha supplies only installed identities (label, scope, credential slots,
 * alpha-workflow-* channels and routes, the alpha-notification-access mirror), its own notice kinds and
 * the canonical Eliza notification tap, which is Alpha's resident-agent integration.
 */
@CapacitorPlugin(name="AlphaNotifications")
public class AlphaNotificationsPlugin extends NotificationsHostPlugin {
 private static java.lang.ref.WeakReference<AlphaNotificationsPlugin> canonicalLive=new java.lang.ref.WeakReference<>(null);
 static void canonicalTapReady(){AlphaNotificationsPlugin plugin=canonicalLive.get();if(plugin!=null)plugin.notifyListeners("canonicalNotificationTap",new JSObject(),true);}
 @PluginMethod public void canonicalPending(PluginCall call){
  noticeWork(call,"Notification owner is unavailable.",()->{
   AlphaCanonicalNotifications.ensure(getContext());org.json.JSONObject pending=AlphaCanonicalNotifications.pending();
   requireNoticeForeground();call.resolve(JSObject.fromJSONObject(pending));
  });
 }
 @PluginMethod public void acknowledgeCanonical(PluginCall call){
  String token=call.getString("token","");
  noticeWork(call,"Notification read status is unconfirmed; it will not be retried.",()->{
   AlphaCanonicalNotifications.acknowledge(token,this::requireNoticeForeground);
   requireNoticeForeground();call.resolve(new JSObject().put("ok",true));
  });
 }
 @Override public void load(){super.load();canonicalLive=new java.lang.ref.WeakReference<>(this);}
 @Override protected void handleOnDestroy(){if(canonicalLive.get()==this)canonicalLive.clear();super.handleOnDestroy();}

 @Override protected String appLabel(){return "Alpha Phone";}
 @Override protected String scope(){return "alpha-phone";}
 /** Deployed credential slots; the record formats are unchanged. */
 @Override protected NoticeDelivery.Storage noticeStorage(){AlphaCredentialStore store=new AlphaCredentialStore(getContext());return new NoticeDelivery.Storage(){public String read(String key)throws Exception{return store.readCredentialSlot(key);}public void write(String key,String value)throws Exception{store.writeCredentialSlot(key,value);}};}
 @Override protected NoticeDelivery.Config deliveryConfig(){return WorkflowNoticeDelivery.CONFIG;}
 @Override protected NoticeRoutes.Config routesConfig(){return WorkflowNoticeTaps.CONFIG;}
 @Override protected NoticeRoutes routes(){return WorkflowNoticeTapsFactory.create(getContext());}
 @Override protected HostNoticePoster.Config posterConfig(){return WorkflowNoticePoster.CONFIG;}
 @Override protected NotificationMirror mirror(){return NotificationAccess.MIRROR;}
 @Override protected String noticeKind(String channel){return kind(channel);}
 /**
  * The kind of one of Alpha's own notices, from its channel. Hosted results and scheduled digests
  * (alpha-hosted-results) and workflow notices can carry mail-derived text, so the renderer offers
  * a question only for reminder and navigation rows (context-selection.ts noticeReviewable). An
  * unrecognized channel is "other" and is not offered either.
  */
 static String kind(String channel){
  if(channel==null)return "other";
  if(AlphaHostedResultsPlugin.CHANNEL.equals(channel))return "hosted-result";
  if(WorkflowNoticePoster.CHANNEL.equals(channel)||WorkflowNoticePoster.APPROVAL_CHANNEL.equals(channel))return "workflow";
  if(AlphaReminders.CONFIGURATION.channelId.equals(channel)||AlphaReminders.CONFIGURATION.dueChannelId().equals(channel))return "reminder";
  if(AlphaNavigationService.CHANNEL.equals(channel))return "navigation";
  return "other";
 }
}
