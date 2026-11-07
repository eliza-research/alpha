package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Visible state for a confirmed reset that could not finish (issue #409). Runs in its own process,
 * which installs none of Alpha's content providers (so no WorkManager or startup initializers) and
 * never starts the agent, renderer, listener or notification code. It never reports the reset as
 * complete: on success Android stops every Alpha process and the next launch is first run.
 */
public final class ResetRecoveryActivity extends Activity {
 static final String PROCESS_SUFFIX=":reset_recovery";
 private final Handler main=new Handler(Looper.getMainLooper());
 private TextView status; private Button retry; private boolean destroyed, controllable;

 @Override protected void onCreate(Bundle state){
  super.onCreate(state);
  int pad=(int)(20*getResources().getDisplayMetrics().density);
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(pad,pad,pad,pad);
  root.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(pad,pad+insets.getSystemWindowInsetTop(),pad,pad+insets.getSystemWindowInsetBottom());return insets;});
  TextView title=new TextView(this);title.setText("Reset could not finish");title.setTextSize(24);title.setPadding(0,0,0,pad/2);root.addView(title);
  boolean installed=listenerInstalled();controllable=AlphaListenerPlugin.available(this);
  TextView body=new TextView(this);body.setTextSize(16);body.setText(
   "You confirmed Reset Alpha data, but the reset has not finished. Alpha's local data has not been deleted yet. (Alpha may already have asked Cloud to revoke this phone's sign-in.)\n\n"+
   (!installed?"Android has not accepted Alpha's request to delete its data. "
    :controllable?"Alpha deletes its data only after the phone's always-on listener confirms that its consent has been withdrawn, and that confirmation has not arrived. "
    :"Alpha deletes its data only after the phone's always-on listener confirms that its consent has been withdrawn. Alpha cannot reach the listener's controls on this phone, so it cannot get that confirmation, and trying again will not finish the reset until the listener is repaired. ")+
   "Until the reset finishes, Alpha stays closed: its agent, notifications and scheduled work do not run.\n\n"+
   (controllable?"Try again, or open the listener's settings to turn it off first. ":"")+"Phone and Android Settings remain available.");
  root.addView(body);
  status=new TextView(this);status.setTextSize(16);status.setPadding(0,pad/2,0,pad/2);status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
  retry=button(root,"Try reset again",v->retry());
  if(controllable)button(root,"Open listener settings",v->open(new Intent().setComponent(new ComponentName(AlphaListenerPlugin.LISTENER_PACKAGE,AlphaListenerPlugin.LISTENER_PACKAGE+".ConsentActivity"))));
  button(root,"Phone",v->open(new Intent(Intent.ACTION_DIAL)));
  button(root,"Android Settings",v->open(new Intent(android.provider.Settings.ACTION_SETTINGS)));
  ScrollView scroll=new ScrollView(this);scroll.addView(root);setContentView(scroll);
 }

 @Override protected void onResume(){
  super.onResume();
  // Already finished (or never requested): this surface has nothing to recover.
  if(!AlphaDataReset.pending(this)){open(getPackageManager().getLaunchIntentForPackage(getPackageName()));finish();}
 }

 private boolean listenerInstalled(){
  try{getPackageManager().getPackageInfo(AlphaListenerPlugin.LISTENER_PACKAGE,0);return true;}
  catch(android.content.pm.PackageManager.NameNotFoundException absent){return false;}
 }

 private Button button(LinearLayout root,String label,android.view.View.OnClickListener action){
  Button button=new Button(this);button.setText(label);button.setAllCaps(false);button.setOnClickListener(action);root.addView(button);return button;
 }

 private void open(Intent intent){
  if(intent==null)return;
  try{startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(RuntimeException unavailable){status.setText("That screen is not available on this phone.");}
 }

 private void retry(){
  retry.setEnabled(false);status.setText("Trying the reset again…");
  final android.content.Context context=getApplicationContext();
  Thread attempt=new Thread(()->{
   AlphaDataReset.Outcome outcome=AlphaDataReset.retry(context,System.currentTimeMillis());
   main.post(()->{
    if(destroyed)return;
    if(outcome==AlphaDataReset.Outcome.DISPATCHED){status.setText("Android is deleting Alpha's data. Alpha will close.");return;}
    retry.setEnabled(true);
    status.setText(outcome==AlphaDataReset.Outcome.DEFERRED
     ?"Reset preparation is unavailable. Alpha stays closed. Try again after the current attempt finishes or storage is available."
     :outcome!=AlphaDataReset.Outcome.LISTENER_UNACKNOWLEDGED
     ?"Android did not accept the reset. Alpha's local data was not deleted. Try again."
     :AlphaListenerPlugin.available(this)
     ?"The listener still has not confirmed. Alpha's local data was not deleted. Open its settings to turn it off, then try again."
     :"The listener could not be reached. Alpha's local data was not deleted.");
   });
  },"alpha-reset-recovery");
  attempt.setDaemon(true);attempt.start();
 }

 @Override protected void onDestroy(){destroyed=true;super.onDestroy();}
}
