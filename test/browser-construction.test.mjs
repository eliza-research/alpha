// Compile the actual tab-construction settings sequence. The Android/provider ports
// are finite fixtures: entering the compat converter fails instead of hanging the JVM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';

// The tab host is shared (plugin-native-browser-surface at the pin); Alpha supplies its identity.
const shared=name=>path.join('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface',name);

test('fresh browser tab settings avoid the WebAuthn compat converter and retain isolation/autofill',()=>{
 const source=fs.readFileSync(shared('BrowserTabHostPlugin.java'),'utf8');
 const start=source.indexOf(' private Tab build(String id, boolean priv, String profileName)');
 const end=source.indexOf('   t.readingWorld=',start);
 assert.ok(start>=0&&end>start,'Actual construction settings sequence must exist');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'browser-construction-'));
 try {
  const file=path.join(temporary,'BrowserConstructionTest.java');
  fs.writeFileSync(file,`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserAutofillExtras;
import ai.eliza.plugins.browsersurface.BrowserTabHostConfig;
import java.util.*;
public class BrowserConstructionTest {
 // Alpha's installed profile names (AlphaBrowserStores) under the real shared identity rules.
 static final BrowserTabHostConfig IDENTITY=BrowserTabHostConfig.builder("alpha_browser_v1","alpha_private_","alpha-browser").legacyEphemeralPrefix("alpha_public_").autofillExtras(new BrowserAutofillExtras("field","top")).build();
 BrowserTabHostConfig config(){return IDENTITY;}
 static class View {static final int IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS=8;}
 static class WebSettings {
  static final int MIXED_CONTENT_NEVER_ALLOW=2;final Map<String,Object> values=new HashMap<>();int webAuthn=0;
  void setJavaScriptEnabled(boolean v){values.put("javascript",v);}void setDomStorageEnabled(boolean v){values.put("storage",v);}
  void setAllowFileAccess(boolean v){values.put("file",v);}void setAllowContentAccess(boolean v){values.put("content",v);}
  void setAllowFileAccessFromFileURLs(boolean v){values.put("fileUrls",v);}void setAllowUniversalAccessFromFileURLs(boolean v){values.put("universalFileUrls",v);}
  void setMixedContentMode(int v){values.put("mixed",v);}void setJavaScriptCanOpenWindowsAutomatically(boolean v){values.put("automaticWindows",v);}
  void setSupportMultipleWindows(boolean v){values.put("multipleWindows",v);}void setSaveFormData(boolean v){values.put("formData",v);}void setSafeBrowsingEnabled(boolean v){values.put("safeBrowsing",v);}
 }
 static class CookieManager {boolean thirdParty;void setAcceptThirdPartyCookies(CredentialWebView web,boolean value){thirdParty=value;}boolean acceptThirdPartyCookies(CredentialWebView web){return thirdParty;}}
 static class Profile {final CookieManager cookies=new CookieManager();CookieManager getCookieManager(){return cookies;}}
 static class CredentialWebView {final WebSettings settings=new WebSettings();final Profile profile=new Profile();String profileName;int autofill;CredentialWebView(Tab tab){}WebSettings getSettings(){return settings;}void setImportantForAutofill(int value){autofill=value;}}
 static class WebViewCompat {static void setProfile(CredentialWebView web,String name){web.profileName=name;}static boolean isMultiProcessEnabled(){return true;}static Profile getProfile(CredentialWebView web){return web.profile;}}
 static class WebViewFeature {static final String MULTI_PROCESS="multi",WEB_AUTHENTICATION="auth";static boolean authSupported;static boolean isFeatureSupported(String feature){return !WEB_AUTHENTICATION.equals(feature)||authSupported;}}
 static class WebSettingsCompat {static final int WEB_AUTHENTICATION_SUPPORT_NONE=0;static void setWebAuthenticationSupport(WebSettings settings,int mode){throw new AssertionError("Entered WebkitToCompatConverter on tab construction");}static int getWebAuthenticationSupport(WebSettings settings){throw new AssertionError("Entered WebkitToCompatConverter on tab construction");}}
 static class Tab {String id,profile;boolean priv,passkeys;CredentialWebView web;}
 ${source.slice(start,end)}
   return t;
  }catch(Exception error){throw error;}
 }
 static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 public static void main(String[] args)throws Exception {
  BrowserConstructionTest plugin=new BrowserConstructionTest();
  for(boolean supported:new boolean[]{false,true})for(boolean priv:new boolean[]{false,true}){
   WebViewFeature.authSupported=supported;String profile=priv?"alpha_private_owned":"alpha_browser_v1";Tab tab=plugin.build("owned",priv,profile);
   check(!tab.passkeys&&tab.web.settings.webAuthn==0,"Unqualified passkeys enabled");check(profile.equals(tab.web.profileName),"Isolated profile not assigned");check(tab.web.profile.cookies.thirdParty==!priv,"Private cookie policy changed");
   check(tab.web.autofill==View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS,"Password autofill excluded");
   Map<String,Object> settings=tab.web.settings.values;
   for(String key:new String[]{"file","content","fileUrls","universalFileUrls","automaticWindows","formData"})check(Boolean.FALSE.equals(settings.get(key)),"Unsafe setting: "+key);
   for(String key:new String[]{"javascript","storage","multipleWindows","safeBrowsing"})check(Boolean.TRUE.equals(settings.get(key)),"Expected setting missing: "+key);
   check(Integer.valueOf(WebSettings.MIXED_CONTENT_NEVER_ALLOW).equals(settings.get("mixed")),"Mixed content allowed");
  }
  try{plugin.build("bad",false,"Default");throw new AssertionError("Default profile admitted");}catch(IllegalStateException expected){}
  try{plugin.build("bad",true,"alpha_browser_v1");throw new AssertionError("Private profile mismatch admitted");}catch(IllegalStateException expected){}
  try{plugin.build("bad",false,"alpha_public_old");throw new AssertionError("Legacy ephemeral profile admitted for a normal tab");}catch(IllegalStateException expected){}
  System.out.println("PASS actual browser construction: no WebAuthn converter; isolated profiles, cookies, passwords and security settings retained");
 }
}`);
  const rules=['BrowserTabHostConfig','BrowserSessionPolicy','BrowserWebOrigin','BrowserProfilePolicy','BrowserAutofillExtras'].map(name=>shared(name+'.java'));
  execFileSync(javaBinary('javac'),['--release','11','-d',temporary,file,...rules],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.BrowserConstructionTest'],{encoding:'utf8',timeout:10000}),/^PASS actual browser construction/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
