import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraces, root} from './java.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model = 'NativeHostedResultNotices';
const ledger = app+'HostedResultNotices.java';
const plugin = app+'AlphaHostedResultsPlugin.java';
const owner = 'plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java';
const harness = 'HostedResultNoticeTraces.java';

function bridgeSource(source) {
  function between(first, last) {
    const start = source.indexOf(first), end = source.indexOf(last, start+first.length);
    assert.ok(start >= 0 && end > start, `Hosted results source anchors ${first}, ${last}`);
    return source.slice(start, end).replaceAll('@PluginMethod ', '');
  }
  return `package ai.elizaresearch.alphaphone;
import java.util.concurrent.*;
import org.json.JSONObject;
import ai.eliza.plugins.notifications.NoticeOwner;
final class AlphaHostedResultsPlugin extends HostedBridgeHost {
 ${between(' static final String CHANNEL=', ' private void channel()')}
 ${between(' private void sourceForeground()', ' @PluginMethod public void nativeSourceIdentity')}
 ${between(' @PluginMethod public void withdrawOtherOwnerApprovalNotices', ' @PluginMethod public void resumeWorkflowApprovalNotice')}
 ${between(' private void retryCaptures()', ' @Override public void load()')}
 ${between(' @Override protected void handleOnNewIntent', ' @PluginMethod public void status')}
 ${between(' @Override protected void handleOnDestroy()', '\n}')}
}
`;
}

const platform = {
  'android/os/Handler.java': `package android.os;
public final class Handler {
 public Handler(Looper looper){}
 public boolean post(Runnable work){work.run();return true;}
 public void removeCallbacks(Runnable work){}
}`,
  'android/os/Looper.java': `package android.os;
public final class Looper { public static Looper getMainLooper(){return new Looper();} }`,
  'android/app/KeyguardManager.java': `package android.app;
public final class KeyguardManager {
 public boolean locked;
 public boolean isDeviceLocked(){return locked;}
}`,
  'ai/elizaresearch/alphaphone/HostedBridgeHost.java': `package ai.elizaresearch.alphaphone;
import android.app.KeyguardManager;
import org.json.JSONObject;

class HostedBridgeHost {
 final KeyguardManager keyguard=new KeyguardManager();
 final Activity activity=new Activity();
 int wakeups;
 final class Activity {
  boolean finishing, destroyed, focused=true;
  boolean isFinishing(){return finishing;}
  boolean isDestroyed(){return destroyed;}
  boolean hasWindowFocus(){return focused;}
 }
 Activity getActivity(){return activity;}
 HostedBridgeHost getContext(){return this;}
 <T> T getSystemService(Class<T> type){return type.cast(keyguard);}
 void captureRenewal(Intent unused){} // Independent source-renewal port.
 void captureRenewalNow(Intent unused){} // Exercised by the separate source-renewal campaign.
 protected void handleOnNewIntent(Intent intent){}
 protected void handleOnResume(){}
 protected void handleOnPause(){}
 protected void handleOnDestroy(){}
 void notifyListeners(String name,JSObject body,boolean retained){
  if(!name.equals("pendingResult")||!body.isEmpty()||!retained)throw new AssertionError("Expected an empty retained wakeup");
  wakeups++;
 }
}
final class HostedDelivery {
 static final HostedDelivery INSTANCE=new HostedDelivery();
 HostedResultNotices notices;
 static HostedDelivery get(HostedBridgeHost context){return INSTANCE;}
}
final class WorkflowNoticeTapsFactory {
 static boolean refuse;
 static WorkflowNoticeTapsFactory delivery(HostedBridgeHost context){return new WorkflowNoticeTapsFactory();}
 static WorkflowNoticeTapsFactory create(HostedBridgeHost context){return new WorkflowNoticeTapsFactory();}
 int withdrawOtherOwners(WorkflowNoticeTapsFactory taps,JSONObject owner,long now){
  if(refuse)throw new IllegalStateException("Synthetic workflow lane failure");
  return 0;
 }
 JSONObject suspendedApprovals(JSONObject owner,long now){return new JSONObject();}
}
final class SourceRenewalHost {
 static SourceRenewalHost get(HostedBridgeHost context){return new SourceRenewalHost();}
 void withdrawOtherOwners(JSONObject owner){}
}
final class Intent {
 private final String action;
 private String data;
 Intent(String action,String data){this.action=action;this.data=data;}
 String getAction(){return action;}
 String getData(){return data;}
 void setData(String data){this.data=data;}
}
final class JSObject extends JSONObject {
 JSObject(){}
 JSObject(String text){super(text);}
}
final class JSArray extends org.json.JSONArray {
 JSArray(org.json.JSONArray value){super(value.toString());}
 @SuppressWarnings("unchecked") public <E> java.util.List<E> toList(){return (java.util.List<E>)(java.util.List<?>)super.toList();}
}
final class PluginCall {
 final JSObject data;
 boolean answered, rejected;
 JSObject result;
 PluginCall(JSONObject value){data=new JSObject(value.toString());}
 JSObject getData(){return data;}
 JSONObject getObject(String field){return data.optJSONObject(field);}
 String getString(String field,String fallback){return data.optString(field,fallback);}
 String getString(String field){return data.optString(field,null);}
 JSArray getArray(String field){org.json.JSONArray value=data.optJSONArray(field);return value==null?null:new JSArray(value);}
 void reject(String reason){answer();rejected=true;}
 void resolve(){resolve(new JSObject());}
 void resolve(JSObject value){answer();result=value;}
 private void answer(){if(answered)throw new AssertionError("Duplicate bridge answer");answered=true;}
}
`,
};

export async function checkNativeHostedResultNotices(extraSources = []) {
  const compiled = [ledger, app+'PluginWorkers.java', 'vendor/eliza/'+owner];
  const sources = [...compiled, plugin, app+'HostedInbox.java', app+'HostedDelivery.java',
    app+'HostedNoticePoster.java', fileURLToPath(import.meta.url), join(directory,harness),
    join(directory,'Trace.java'), join(directory,'java.mjs'), 'scripts/upstream-native-source.mjs',
    'upstream.lock.json', 'test/fixtures/jvm-tools.mjs', ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(sources);
  const pinned = upstreamNativeSource(root).read(owner).get(owner);
  assert.equal(driverHashes[join(root,'vendor/eliza',owner)],pinned.sha256);
  const temporary = mkdtempSync(join(tmpdir(),'quint-hosted-result-notices-'));
  let result;
  try {
    const files = {...platform,
      'ai/elizaresearch/alphaphone/AlphaHostedResultsPlugin.java': bridgeSource(readFileSync(join(root,plugin),'utf8'))};
    const generated = Object.entries(files).map(([path,contents]) => {
      const file = join(temporary,path);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,contents);
      return file;
    });
    result = javaTraces(harness,[...compiled,...generated]);
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }

  const {traces, capacity} = result;
  assert.deepEqual(capacity,{rows:200,pendingKept:true,oldestUnclaimedRemoved:true});
  for (const trace of traces) for (const {expect} of [trace,...trace.steps]) {
    for (const field of ['retained','phases','digests','postCount']) expect['s.'+field]=qmap(expect['s.'+field]);
    expect['s.posted']=qset(expect['s.posted']);
  }
  const receipt = await checkTraces({model,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'Complete HostedResultNotices.java and the pinned NoticeOwner.java execute on the JVM. Extracted production bridge handlers execute exact foreground checks, a real serial worker and synthetic Android Intent/call ports.',
    'Synthetic storage, retained-inbox and poster ports control write/cancel refusals, dispatch interruption, and OS removal. Durable and readback JSON keys are independently checked for exact route and redaction.',
    'The driver also verifies the exact 200-row cap and pending-tap eviction exemption as a separate real-source assertion. The model covers four fixed routes, the exact owner tuple partition and four token generations.',
    'Withdrawal and consume can fail after durable writes. After the owner fence changes, readback stays empty and the prior token cannot settle through a current unlocked bridge. The withdrawal retry still clears the surviving pending slot and notification.',
  ]});
  return {receipt,obligations:[
    {model,obligation:'Installed notification lifecycle and credential storage',
      reason:'Synthetic ports exercise source behavior. Installed PendingIntent delivery, Android notification timeout, Keystore, and arbitrary storage failure/scheduler behavior remain outside the JVM campaign.'},
    {model,obligation:'Same-tuple reentry after interrupted withdrawal',
      reason:'The settlement fence uses exact current origin, owner and agent. There is no durable owner generation to distinguish later reentry of the same tuple.'},
  ]};
}
