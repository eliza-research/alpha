package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.notifications.MailNoticePoster;
import android.content.*;
import android.app.KeyguardManager;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.*;

/** Capacitor bridge for the shared background new-mail check; behaviour lives in plugin-native-notifications. */
@CapacitorPlugin(name="AlphaGmail")
public final class AlphaGmailPlugin extends Plugin {
 private volatile long lifecycle;
 private final ExecutorService io=Executors.newSingleThreadExecutor();
 private MailBackgroundDelivery delivery(){return GmailBackground.get(getContext());}
 private interface Work {JSObject run()throws Exception;}
 private void submit(PluginCall call,Work work){try{io.execute(()->{try{call.resolve(work.run());}catch(Exception unavailable){call.reject("Gmail background state could not be verified. Open Inbox and check the account.");}});}catch(RejectedExecutionException closed){call.reject("Gmail bridge closed");}}
 private boolean foreground(){return getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus()&&!getContext().getSystemService(KeyguardManager.class).isDeviceLocked();}
 private void requireForeground(long epoch)throws Exception{
  if(epoch!=lifecycle)throw new SecurityException("Gmail view changed");
  CountDownLatch checked=new CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean allowed=new java.util.concurrent.atomic.AtomicBoolean();
  if(getActivity()==null)throw new SecurityException("Gmail view closed");
  getActivity().runOnUiThread(()->{try{allowed.set(epoch==lifecycle&&foreground());}finally{checked.countDown();}});
  if(!checked.await(5,TimeUnit.SECONDS)||!allowed.get()||epoch!=lifecycle)throw new SecurityException("Unlock Gmail to continue");
 }
 @PluginMethod public void configure(PluginCall call){if(!foreground()){call.reject("Select Gmail on the unlocked phone");return;}long attempt=delivery().begin();String credential=call.getString("credentialId"),grant=call.getString("grantId"),user=call.getString("userId"),organization=call.getString("organizationId");submit(call,()->new JSObject(delivery().configure(attempt,credential,grant,user,organization).toString()));}
 @PluginMethod public void withdraw(PluginCall call){submit(call,()->{delivery().withdraw(call.getString("grantId"));return new JSObject();});}
 @PluginMethod public void status(PluginCall call){submit(call,()->new JSObject(delivery().status().toString()));}
 @PluginMethod public void pending(PluginCall call){if(!foreground()){call.resolve(new JSObject());return;}long epoch=lifecycle;submit(call,()->new JSObject(delivery().pending(()->requireForeground(epoch)).toString()));}
 @PluginMethod public void consume(PluginCall call){if(!foreground()){call.reject("Unlock Gmail to continue");return;}long epoch=lifecycle;submit(call,()->{delivery().consume(call.getString("token"),()->requireForeground(epoch));return new JSObject();});}
 @PluginMethod public void releaseQuestion(PluginCall call){if(!foreground()){call.reject("Unlock Gmail to continue");return;}long epoch=lifecycle;submit(call,()->{delivery().releaseQuestion(call.getString("token"),()->requireForeground(epoch));return new JSObject();});}
 @PluginMethod public void notificationSettings(PluginCall call){if(!foreground()){call.reject("Open settings on the unlocked phone");return;}try{getActivity().startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,GmailBackground.NOTICES.channel));call.resolve();}catch(RuntimeException unavailable){call.reject("Android notification settings unavailable");}}
 private void capture(Intent intent){try{io.execute(()->{try{MailNoticePoster.Tap tap=GmailBackground.poster(getContext()).tap(intent);if(tap==null)return;delivery().capture(tap.key,tap.question);intent.setData(null);notifyListeners("pendingMail",new JSObject(),true);}catch(Exception ignored){/* Owner mismatch exposes no route. */}});}catch(RejectedExecutionException ignored){}}
 private void resumeDelivery(boolean notify){try{io.execute(()->{delivery().resume();if(notify)notifyListeners("pendingMail",new JSObject(),true);});}catch(RejectedExecutionException ignored){/* The bridge was destroyed. */}}
 @Override public void load(){capture(getActivity().getIntent());resumeDelivery(false);}
 @Override protected void handleOnNewIntent(Intent intent){capture(intent);}
 @Override protected void handleOnResume(){resumeDelivery(true);}
 @Override protected void handleOnPause(){lifecycle++;super.handleOnPause();}
 @Override protected void handleOnDestroy(){lifecycle++;io.shutdown();super.handleOnDestroy();}
}
