import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {runJvm,nativeSource} from './fixtures/jvm-tools.mjs';
const base=process.env.ALPHA_RECOVERY_SOURCE_ROOT||path.resolve('.');
const read=n=>fs.readFileSync(path.join(base,'android/app/src/main/java/ai/alphacompute/alphaphone',n),'utf8');
function run(name,source,files=[]){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-home-contract-'));try{const file=path.join(temp,name+'.java');fs.writeFileSync(file,source);return runJvm([file,...files],`ai.alphacompute.alphaphone.${name}`);}finally{fs.rmSync(temp,{recursive:true,force:true});}}
test('the exact HOME visibility predicate uses current role for icon-started and role-retired tasks',()=>{
 const source=read('MainActivity.java'),method=/private boolean showsHome\(\) \{[^}]+\}/.exec(source)?.[0];assert.ok(method);
 assert.match(run('HomeRoleContract',`package ai.alphacompute.alphaphone;
public class HomeRoleContract{static class BuildConfig{static boolean IS_LAUNCHER=true;}boolean startedAsHome,held,assistant;boolean isAssistantSurface(){return assistant;}boolean isCurrentHome(){return held;}${method}
public static void main(String[]a){HomeRoleContract h=new HomeRoleContract();h.startedAsHome=false;h.held=true;if(!h.showsHome())throw new AssertionError("role acquired after icon launch ignored");h.startedAsHome=true;h.held=false;if(h.showsHome())throw new AssertionError("retired HOME role still traps Back");h.held=true;h.assistant=true;if(h.showsHome())throw new AssertionError("assistant treated as Home");System.out.println("PASS current HOME role");}}`),/PASS current HOME role/);
});
test('background renderer reclaim defers recreation without consuming crash budget',()=>{
 const file=path.join(base,'android/app/src/main/java/ai/alphacompute/alphaphone/RendererRecoveryBudget.java');
 assert.match(run('BackgroundReclaimContract',`package ai.alphacompute.alphaphone;import java.lang.reflect.*;
public class BackgroundReclaimContract{public static void main(String[]a)throws Exception{RendererRecoveryBudget b=new RendererRecoveryBudget();Method loss;try{loss=RendererRecoveryBudget.class.getDeclaredMethod("onLoss",long.class,boolean.class,boolean.class,boolean.class);}catch(NoSuchMethodException old){loss=RendererRecoveryBudget.class.getDeclaredMethod("onLoss",long.class,boolean.class);}loss.setAccessible(true);for(int i=0;i<10;i++){Object value=loss.getParameterCount()==4?loss.invoke(b,(long)i,true,false,false):loss.invoke(b,(long)i,true);if(!value.toString().equals("REBUILD_ON_START"))throw new AssertionError("background reclaim recreated renderer: "+value);}System.out.println("PASS background reclaim waits");}}`,[file]),/PASS background reclaim waits/);
});
test('HOME without a working WebView has a native Settings escape',()=>{
 const source=read('MainActivity.java');assert.match(source,/if \(getBridge\(\) == null\) \{[^}]*if \(showsHome\(\)\) showRendererEscape\(\);\s*return;\s*\}/);
});
