import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';

export const recoveryBridge=app+'AlphaActionJournalPlugin.java';
const journal='plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/';
const notice='plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/';
export const reminderStore='plugins/plugin-native-reminders/android/src/main/java/ai/eliza/plugins/reminders/ReminderStore.java';
export const recoveryShared=[
  ...['ActionJournal','ActionJournalConfiguration','ActionJournalPlugin','deletion/DeletionReceiptRecovery'].map(name=>journal+name+'.java'),
  ...['NoticeRecovery','NoticeDelivery','NoticeCoordinator','NoticeRoutes','NoticeOwner'].map(name=>notice+name+'.java'),
];
export const recoveryProduct=['AlphaActionJournal','WorkflowNoticeDelivery','WorkflowNoticeTaps'].map(name=>app+name+'.java');

function slice(text,first,last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`Missing exact recovery source bounds ${first}`);
  return text.slice(start,end);
}

export function actionRecoveryPlatform() {
  const directory=mkdtempSync(join(tmpdir(),'quint-action-recovery-'));
  const close=()=>rmSync(directory,{recursive:true,force:true});
  try {
    const bridge=readFileSync(join(root,recoveryBridge),'utf8');
    const store=readFileSync(join(root,'vendor/eliza',reminderStore),'utf8');
    const files={
      'ai/alphacompute/alphaphone/AlphaActionJournalPlugin.java':
        bridge.slice(0,bridge.indexOf(' private final android.os.Handler clockMain'))+'\n}\n',
      'android/content/Context.java':`package android.content;
public final class Context {public Context getApplicationContext(){return this;}}`,
      'com/getcapacitor/Plugin.java':`package com.getcapacitor;
public abstract class Plugin {
 public android.content.Context getContext(){return new android.content.Context();}
 protected void handleOnDestroy(){}
}`,
      'com/getcapacitor/annotation/CapacitorPlugin.java':`package com.getcapacitor.annotation;
public @interface CapacitorPlugin {String name();}`,
      'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
      'com/getcapacitor/JSObject.java':'package com.getcapacitor;public class JSObject extends org.json.JSONObject {}',
      'com/getcapacitor/JSArray.java':'package com.getcapacitor;public class JSArray extends org.json.JSONArray {}',
      'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
import java.util.concurrent.*;
import org.json.JSONObject;
public final class PluginCall {
 private final JSONObject input;
 private final CountDownLatch answered=new CountDownLatch(1);
 public volatile JSObject result;
 public volatile String rejection;
 public PluginCall(JSONObject input){this.input=input;}
 public String getString(String name){return input.optString(name,null);}
 public JSONObject getObject(String name){return input.optJSONObject(name);}
 public synchronized void resolve(JSObject value){if(answered.getCount()==0)throw new AssertionError("Duplicate response");result=value;answered.countDown();}
 public synchronized void reject(String reason){if(answered.getCount()==0)throw new AssertionError("Duplicate response");rejection=reason;answered.countDown();}
 public void await()throws Exception{if(!answered.await(4,TimeUnit.SECONDS))throw new AssertionError("Recovery call unanswered");}
}`,
      'ai/alphacompute/alphaphone/RecoveryPorts.java':`package ai.alphacompute.alphaphone;
import org.json.JSONObject;
import android.content.Context;
final class AlphaCredentialStore {
 AlphaCredentialStore(Context context){}
 String readCredentialSlot(String key)throws Exception{return ActionRecoveryTraces.read(key);}
 void writeCredentialSlot(String key,String value)throws Exception{ActionRecoveryTraces.write(key,value);}
}
final class WorkflowNoticePoster implements WorkflowNoticeDelivery.Poster {
 WorkflowNoticePoster(Context context){}
 public boolean allowed(){throw new AssertionError("Recovery consulted post admission");}
 public void post(String id,String title,String body){throw new AssertionError("Recovery posted an alert");}
 public void cancel(String id){throw new AssertionError("Recovery cancelled an alert");}
 public boolean matches(String id,String title,String body){return ActionRecoveryTraces.matches(id,title,body);}
}
final class NativeDeletionCoordinator {
 static NativeDeletionCoordinator get(Context context){return new NativeDeletionCoordinator();}
 JSONObject receipt(String kind,String id)throws Exception{return ActionRecoveryTraces.deletionReceipt(kind,id);}
}
final class AlphaReminders {
 static ai.eliza.plugins.reminders.ReminderReceiptFixture engine(Context context){return new ai.eliza.plugins.reminders.ReminderReceiptFixture(context);}
}
final class CalendarAvailabilityJournalResult {
 static final String TYPE="calendar_availability";
 static void check(JSONObject retained,String id,String status,JSONObject result){throw new AssertionError("Unrelated receipt policy");}
}
final class SmsActionJournalResult {
 static void check(JSONObject entry,String status,JSONObject result){throw new AssertionError("Unrelated receipt policy");}
}
final class System {
 static long currentTimeMillis(){return 100;}
}`,
      'ai/eliza/plugins/reminders/ReminderReceiptFixture.java':`package ai.eliza.plugins.reminders;
import ai.alphacompute.alphaphone.ActionRecoveryTraces;
import android.content.Context;
import java.util.ArrayList;
import org.json.*;
public final class ReminderReceiptFixture {
 private final Context context;
 public ReminderReceiptFixture(Context context){this.context=context;}
 public JSONObject operationReceipt(String id,String binding,JSONObject operation)throws Exception {
  ActionRecoveryTraces.reminderLookup(id,binding,operation);
  return operationReceipt(context,id,binding,operation);
 }
 public static String argumentHash(String binding,JSONObject operation){
  return digest(binding+":"+new ReminderReceiptFixture(null).canonical(operation));
 }
${slice(store,' static String digest(String value)',' synchronized JSONObject selected(')}
${slice(store,' synchronized JSONObject operationReceipt(',' /** No automatic replay')}
}
final class ReminderEnvelope {
 final JSONObject value;
 ReminderEnvelope(Context context,ReminderReceiptFixture store){
  value=ActionRecoveryTraces.reminderEnvelope();
 }
}`,
    };
    assert.ok(files['ai/alphacompute/alphaphone/AlphaActionJournalPlugin.java'].includes('recoverReminder(PluginCall call)'));
    const paths=Object.entries(files).map(([name,contents])=>{
      const path=join(directory,name);
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,contents);
      return path;
    });
    return {paths,close};
  }catch(error){close();throw error;}
}
