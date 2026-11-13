import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {androidPorts,compileJava,javaJson,materialize,root} from './os-host-support.mjs';

const folder='android/aosp/branding/provision/';
const driver=fileURLToPath(import.meta.url);
const probe=`package com.android.provision;
import android.app.*;import android.app.admin.*;import android.app.role.*;import android.os.*;import android.provider.*;import android.view.*;import android.view.inputmethod.*;import android.widget.*;
import org.json.*;import java.lang.reflect.*;import java.util.*;
public class Probe {
 static final JSONArray traces=new JSONArray();static JSONObject trace;static Activity activity;static RoleManager roles;static Object controller;
 static boolean complete,presets;static int completions;static JSONObject pending;
 static JSONObject action(String name,Object...args){return new JSONObject().put("name",name).put("args",new JSONArray(Arrays.asList(args)));}
 static boolean bool(String field){try{Field f=controller.getClass().getDeclaredField(field);f.setAccessible(true);return f.getBoolean(controller);}catch(Exception e){throw new RuntimeException(e);}}
 static int generation(){try{Field f=controller.getClass().getDeclaredField("generation");f.setAccessible(true);return f.getInt(controller);}catch(Exception e){throw new RuntimeException(e);}}
 static String keyboard(){String v=activity.resolver.get(Settings.Secure.DEFAULT_INPUT_METHOD);return v==null||v.isEmpty()?"none":v.contains("LatinIME")?"latin":"owner";}
 static JSONObject state(){return new JSONObject().put("s.eligible",AlphaFreshPresets.eligible(activity)).put("s.alive",!activity.isDestroyed()&&!activity.isFinishing())
 .put("s.phase",activity.isDestroyed()?"idle":complete?"done":presets?"presets":bool("waiting")?"waiting":"idle").put("s.generation",generation())
 .put("s.keyboard",keyboard()).put("s.complete",complete).put("s.completionAuthorized",complete&&AlphaFreshPresets.eligible(activity)&&roles.held&&!keyboard().equals("none"));}
 static void mark(String label,Object action,JSONObject observation){trace.getJSONArray("steps").put(new JSONObject().put("label",label).put("action",action==null?JSONObject.NULL:action).put("expect",observation));}
 static void mark(String label,Object action){mark(label,action,state());}
 static void enterPresets(){presets=true;mark("Actual eligible finishPresets entry",pending,state().put("s.held",roles.held));pending=null;}
 static void keyboardResult(AlphaFreshSetupPolicy.ImeResult result){boolean ok=result==AlphaFreshSetupPolicy.ImeResult.READY||result==AlphaFreshSetupPolicy.ImeResult.EXISTING_CHOICE;
  JSONObject observed=state();if(!ok)observed.remove("s.phase");mark("Actual secure-setting keyboard result",action("keyboardDefault",ok),observed);}
 static void fail(){presets=false;}
 static Activity fresh(){Activity a=new Activity();a.services.put(DevicePolicyManager.class,new DevicePolicyManager());a.services.put(UserManager.class,new UserManager());a.services.put(InputMethodManager.class,new InputMethodManager());roles=new RoleManager();a.services.put(RoleManager.class,roles);return a;}
 static void setup(String name)throws Exception {android.os.Process.user=new UserHandle();Handler.delayed.clear();activity=fresh();complete=false;presets=false;completions=0;pending=null;
  AlphaWelcome.show(activity,()->{complete=true;completions++;mark("Actual provision completion callback",action("finish"));});
  LinearLayout column=(LinearLayout)((ScrollView)activity.content).child;Button next=null;
  for(View v:column.children)if(v instanceof Button&&((Button)v).text.equals(R.string.alpha_continue))next=(Button)v;
  if(next==null)throw new AssertionError("Continue absent");Object listener=next.listener;
  for(Field f:listener.getClass().getDeclaredFields()){f.setAccessible(true);Object value=f.get(listener);if(value!=null&&value.getClass().getName().endsWith("$Completion"))controller=value;}
  if(controller==null)throw new AssertionError("Actual Completion controller absent");
  trace=new JSONObject().put("name",name).put("init",action("init")).put("expect",state().put("s.held",false).put("s.appearanceRequested",false).put("s.appearanceChanged",false)).put("steps",new JSONArray());traces.put(trace);
 }
 static void begin()throws Exception{Method m=controller.getClass().getDeclaredMethod("begin");m.setAccessible(true);m.invoke(controller);mark("Actual Continue requests HOME",action("begin"));}
 static void callback(int index,boolean accepted,boolean held){roles.held=held;pending=action("callback",index+1,accepted,held);roles.callbacks.get(index).accept(accepted);
  if(pending!=null){JSONObject observed=state();mark("Actual role result or retained callback",pending,observed);pending=null;}}
 static void timeout(int index){Handler.delayed.get(index).run();mark("Actual delayed timeout",action("timeout"));}
 static void ownerKeyboard(){activity.resolver.values.put(Settings.Secure.DEFAULT_INPUT_METHOD,"owner/.ChosenIME");mark("External owner choice",action("ownerKeyboard"));}
 static void check(boolean v,String message){if(!v)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  setup("accepted-home-installs-latin");begin();callback(0,true,true);check(complete&&completions==1&&keyboard().equals("latin"),"Fresh setup did not complete");
  int writes=activity.resolver.writes;roles.callbacks.get(0).accept(true);check(completions==1&&activity.resolver.writes==writes,"Repeated callback repeated effects");mark("Duplicate callback has no effects",action("callback",1,true,true));
  setup("owner-keyboard-preserved");ownerKeyboard();begin();callback(0,true,true);check(complete&&keyboard().equals("owner"),"Owner keyboard replaced");
  setup("expired-callback");begin();timeout(0);callback(0,true,true);check(!complete&&activity.resolver.writes==0,"Expired callback wrote settings");
  setup("previous-generation");begin();timeout(0);begin();callback(0,true,true);check(bool("waiting")&&!complete,"Old generation won");callback(1,true,true);check(complete,"Current generation failed");
  setup("destroyed-activity");begin();activity.destroyed=true;mark("Activity destruction",action("destroy"));callback(0,true,true);check(!complete&&activity.resolver.writes==0,"Destroyed activity wrote settings");
  setup("authority-loss");begin();((DevicePolicyManager)activity.services.get(DevicePolicyManager.class)).managed=true;mark("Device management became authoritative",action("authorityLost"));callback(0,true,true);check(!complete&&activity.resolver.writes==0,"Ineligible completion wrote settings");
  setup("rejected-home");begin();callback(0,false,false);check(!complete&&activity.resolver.writes==0,"Rejected HOME wrote settings");
  setup("accepted-but-not-home");begin();callback(0,true,false);check(!complete&&activity.resolver.writes==0,"Unheld HOME wrote settings");
  setup("missing-latin");((InputMethodManager)activity.services.get(InputMethodManager.class)).available=false;begin();callback(0,true,true);check(!complete&&keyboard().equals("none"),"Missing IME completed");
  setup("keyboard-setting-failure");activity.resolver.writeOk=false;begin();callback(0,true,true);check(!complete&&keyboard().equals("none"),"Rejected IME setting completed");
  for(boolean ok:new boolean[]{true,false}){
   setup("explicit-appearance-"+ok);AlphaAppearance appearance=new AlphaAppearance();appearance.onCreate(new Bundle());
   WallpaperManager.writes=0;WallpaperManager.writeOk=ok;check(appearance.resolver.writes==0&&!appearance.finishing,"Appearance changed on open");
   mark("Opening the real appearance Activity writes nothing",null,new JSONObject().put("s.appearanceRequested",false).put("s.appearanceChanged",false));
   Button apply=(Button)((LinearLayout)appearance.content).children.get(1);
   mark("Explicit user Apply action",action("requestAppearance"),new JSONObject().put("s.appearanceRequested",true));apply.performClick();
   mark("Actual wallpaper/palette completion",action("applyAppearance",ok),new JSONObject().put("s.appearanceChanged",appearance.finishing&&WallpaperManager.writes==1&&appearance.resolver.get(Settings.Secure.THEME_CUSTOMIZATION_OVERLAY_PACKAGES)!=null));
   check(appearance.finishing==ok&&WallpaperManager.writes==(ok?1:0),"Appearance failure semantics changed");
  }
  System.out.println(traces);
 }
}`;

export async function checkOSProvisioning(extraSources=[]){
 const sources=[driver,'app.config.json','specs/quint/refinement/application/os-host-support.mjs','test/fixtures/jvm-tools.mjs',
  'android/gradle/verification-metadata.xml',jsonJar,...['AlphaWelcome.java','AlphaAppearance.java','AlphaFreshPresets.java','AlphaFreshSetupPolicy.java'].map(name=>folder+name),...extraSources];
 sources.push('test/fixtures/jvm-tools.mjs','scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts','specs/quint/refinement/application/index.mjs','test/quint-application-refinement.test.mjs');
 const before=captureInputs(sources),temporary=mkdtempSync(join(tmpdir(),'alpha-os-provision-'));
 try{
  const identity=JSON.parse(readFileSync(resolve(root,'app.config.json'),'utf8')).appId;
  const welcome=readFileSync(resolve(root,folder+'AlphaWelcome.java'),'utf8');
  const entry='            AlphaFreshSetupPolicy.ImeResult keyboard = AlphaFreshPresets.ensureKeyboard(activity);';
  const result='            if (keyboard == AlphaFreshSetupPolicy.ImeResult.FAILED';
  const fail='        private void fail(int message) {';
  for(const anchor of [entry,result,fail])assert.equal(welcome.split(anchor).length,2,'Unique observer anchor');
  const observed=welcome.replace(entry,'            Probe.enterPresets();\n'+entry).replace(result,'            Probe.keyboardResult(keyboard);\n'+result).replace(fail,fail+'\n            Probe.fail();');
  const names=[...new Set([...welcome.matchAll(/R\.string\.([a-z_]+)/g),...readFileSync(resolve(root,folder+'AlphaAppearance.java'),'utf8').matchAll(/R\.string\.([a-z_]+)/g)].map(match=>match[1]))];
  const generated=materialize(temporary,{...androidPorts(identity),'com/android/provision/AlphaWelcome.java':observed,'com/android/provision/Probe.java':probe,
   'com/android/provision/R.java':`package com.android.provision;final class R {static class drawable {static final int alpha_mark=1,alpha_wallpaper=2;}static class string {${names.map((name,index)=>`static final int ${name}=${index+1};`).join('')}}}`});
  const driverHashes={...before,...captureInputs(generated)};
  compileJava([...generated,...['AlphaAppearance.java','AlphaFreshPresets.java','AlphaFreshSetupPolicy.java'].map(name=>resolve(root,folder+name))],temporary);
  const traces=javaJson(temporary,'com.android.provision.Probe');assert.equal(traces.length,12);
  return await checkTraces({model:'OSProvisioning',sources:[...sources,...generated],driverHashes,generatedSources:generated,traces,scope:'bounded-orchestration',assumptions:[
   'The unchanged provisioning policy, Android IME adapter and appearance Activity execute on the host JVM. Welcome has three bound read-only observer calls; the real private controller, generation checks, timeout runnable, role callback and completion callback execute.',
   'Android UI, RoleManager, settings, policy, IME and wallpaper services are explicit synthetic ports. The fixture exposes no fresh telephony feature and exercises HOME provisioning only. These serialized callbacks prove source decisions under controlled port responses, not Android permission enforcement, cross-process settings atomicity, device lifecycle delivery, wallpaper rendering or AOSP image boot.',
   'The finite model treats failed keyboard presets as an unfinished presets phase; only keyboard and completion are projected after that source recovery path. Retry from failed presets and partial wallpaper success followed by palette failure require separate models/platform checks. Automatic fresh-setup palette is distinct from the explicit post-update appearance action.',
  ]});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
