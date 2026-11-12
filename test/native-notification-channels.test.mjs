import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,runJvm,jvmSkip} from './fixtures/jvm-tools.mjs';

// Run the actual presentation helper against a recording platform boundary. This verifies the
// calls Alpha makes, not Android's persistence of user choices or real Settings presentation.
test('channel descriptions update only existing identities and recover after platform refusal',{skip:jvmSkip('javac')},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-channel-descriptions-')),files=[nativeSource('AlphaNotificationChannels.java')];
 const put=(name,source)=>{const file=join(dir,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,source);files.push(file);};
 try{
  put('android/app/NotificationChannel.java',`package android.app;
public final class NotificationChannel {
 private final String id;private final CharSequence name;private final int importance;private String description;
 public NotificationChannel(String id,CharSequence name,int importance){this.id=id;this.name=name;this.importance=importance;}
 public String getId(){return id;}public CharSequence getName(){return name;}public int getImportance(){return importance;}
 public String getDescription(){return description;}public void setDescription(String value){description=value;}
}`);
  put('android/app/NotificationManager.java',`package android.app;
public final class NotificationManager {
 public final java.util.Map<String,NotificationChannel> installed=new java.util.LinkedHashMap<>();
 public final java.util.List<NotificationChannel> writes=new java.util.ArrayList<>();
 public boolean refuseRead,refuseWrite;public int attempts;
 public NotificationChannel getNotificationChannel(String id){if(refuseRead)throw new SecurityException("read refused");return installed.get(id);}
 public void createNotificationChannel(NotificationChannel value){attempts++;if(refuseWrite)throw new SecurityException("write refused");if(!installed.containsKey(value.getId()))throw new AssertionError("Created an absent channel");writes.add(value);installed.put(value.getId(),value);}
}`);
  put('android/content/Context.java',`package android.content;
public final class Context {
 public android.app.NotificationManager manager;public boolean refuse;
 public Context(android.app.NotificationManager manager){this.manager=manager;}
 public <T>T getSystemService(Class<T> type){if(refuse)throw new SecurityException("service refused");return type.cast(manager);}
}`);
  put('AlphaReminders.java',`package ai.alphacompute.alphaphone;
final class AlphaReminders {static final Configuration CONFIGURATION=new Configuration();static final class Configuration {final String channelId="alpha_reminders";String dueChannelId(){return channelId+"-due";}}}`);
  put('ChannelDescriptionsTest.java',`package ai.alphacompute.alphaphone;
import android.app.*;import android.content.Context;
public final class ChannelDescriptionsTest {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static NotificationChannel seed(NotificationManager manager,String id,String name,int importance){NotificationChannel row=new NotificationChannel(id,name,importance);manager.installed.put(id,row);return row;}
 public static void main(String[] args){
  NotificationManager manager=new NotificationManager();Context context=new Context(manager);
  AlphaNotificationChannels.describe(context);check(manager.attempts==0,"Absent channels must stay absent");
  seed(manager,"eliza_alerts","Installed alerts",0);seed(manager,"eliza_quiet","Installed quiet",2);
  seed(manager,"alpha_reminders","Earlier reminders",1);seed(manager,"alpha_reminders-due","Earlier reminders (due)",4);
  NotificationChannel unrelated=seed(manager,"unrelated","Unrelated",3);
  AlphaNotificationChannels.describe(context);check(manager.writes.size()==4,"Only the four existing known channels are described");
  check(manager.installed.size()==5&&manager.installed.get("unrelated")==unrelated,"No new identities or unrelated changes");
  check(manager.installed.get("eliza_alerts").getImportance()==0,"A blocked channel stays blocked in the submitted update");
  check(manager.installed.get("eliza_alerts").getName().toString().equals("Installed alerts"),"Existing ordinary names are retained");
  check(manager.installed.get("eliza_quiet").getImportance()==2,"Existing importance is retained");
  check(manager.installed.get("eliza_quiet").getDescription().equals("Low-priority notices from Alpha. Shown without sound."),"Quiet description");
  check(manager.installed.get("alpha_reminders").getName().toString().equals("Reminders (not used)"),"Legacy reminder presentation");
  check(manager.installed.get("alpha_reminders").getImportance()==1,"Legacy reminder importance");
  check(manager.installed.get("alpha_reminders-due").getName().toString().equals("Reminders"),"Active reminder presentation");
  check(manager.installed.get("alpha_reminders-due").getImportance()==4,"Active reminder importance");
  check(manager.installed.get("alpha_reminders-due").getDescription().equals("Reminders you set on this phone. Android may delay them."),"Active reminder description");
  AlphaNotificationChannels.describe(context);check(manager.attempts==4,"Matching descriptions are not written again");
  AlphaNotificationChannels.describe(new Context(null));context.refuse=true;AlphaNotificationChannels.describe(context);context.refuse=false;
  NotificationManager retry=new NotificationManager();Context retryContext=new Context(retry);
  NotificationChannel original=seed(retry,"eliza_alerts","Retry alerts",0);
  retry.refuseRead=true;AlphaNotificationChannels.describe(retryContext);check(retry.attempts==0,"Read refusal does not invent a channel");
  retry.refuseRead=false;retry.refuseWrite=true;AlphaNotificationChannels.describe(retryContext);
  check(retry.attempts==1&&retry.installed.get("eliza_alerts")==original,"Write refusal leaves the installed record alone");
  retry.refuseWrite=false;AlphaNotificationChannels.describe(retryContext);
  check(retry.writes.size()==1&&retry.installed.get("eliza_alerts").getDescription()!=null,"A later refresh retries the refused update");
  System.out.println("PASS existing channel identities, presentation, idempotence and refusal recovery");
 }
}`);
  assert.match(runJvm(files,'ai.alphacompute.alphaphone.ChannelDescriptionsTest'),/^PASS existing channel identities/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
