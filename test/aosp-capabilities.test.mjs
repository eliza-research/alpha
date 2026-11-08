import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ALPHA_IMAGE_PROVISIONING, assertAlphaProvisioningDefault, writeAospCapabilityOverlay} from '../scripts/aosp-capability-overlay.mjs';

test('compiled image admission uses the shared decision, requires every trusted fact and keeps adapter roles unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-image-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files={
 'android/content/BroadcastReceiver.java':'package android.content; public abstract class BroadcastReceiver {}',
 'android/content/pm/ApplicationInfo.java':'package android.content.pm; public class ApplicationInfo {public static final int FLAG_SYSTEM=1; public int flags;}',
 'android/content/pm/PackageManager.java':'package android.content.pm; public class PackageManager {public java.util.Set<String> features=new java.util.HashSet<>();public boolean hasSystemFeature(String name,int version){return version<=1&&features.contains(name);}}',
 'android/content/res/Resources.java':'package android.content.res; public class Resources {public boolean value; public boolean missing;public boolean getBoolean(int id){if(missing)throw new IllegalArgumentException();return value;}}',
 'android/content/Context.java':'package android.content; public class Context {public android.content.pm.ApplicationInfo info=new android.content.pm.ApplicationInfo();public android.content.res.Resources resources=new android.content.res.Resources();public android.content.pm.PackageManager packages=new android.content.pm.PackageManager();public android.content.pm.ApplicationInfo getApplicationInfo(){return info;}public android.content.res.Resources getResources(){return resources;}public Context getApplicationContext(){return null;}public android.content.pm.PackageManager getPackageManager(){return packages;}public String getPackageName(){return "ai.elizaresearch.alphaphone";}}',
 'ai/elizaresearch/alphaphone/BuildConfig.java':'package ai.elizaresearch.alphaphone; public class BuildConfig {public static boolean DEBUG=Boolean.getBoolean("t.debug"),ELIZA_DEV_ALLOW_TEST_MOCKS=Boolean.getBoolean("t.mocks"),IS_LAUNCHER=!Boolean.getBoolean("t.flavor");}',
 'ai/elizaresearch/alphaphone/R.java':'package ai.elizaresearch.alphaphone; public class R {public static class bool {public static int alpha_aosp_image_capability=1;}}',
 'ai/elizaresearch/alphaphone/CapabilityTest.java':`package ai.elizaresearch.alphaphone;
public class CapabilityTest {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args){
  android.content.Context c=new android.content.Context();
  if(args.length>0){c.resources.value=true;c.info.flags=1;c.packages.features.add("ai.elizaresearch.alphaphone.aosp_image");check(!AlphaImageCapabilities.aospImage(c));check(!AlphaImageCapability.verified(c));check(!AlphaImageCapabilities.defaultAppEnabled(c,"dial"));System.out.println("PASS refused "+args[0]);return;}
  check(!AlphaImageCapabilities.aospImage(c));c.resources.value=true;check(!AlphaImageCapabilities.aospImage(c));c.info.flags=1;check(AlphaImageCapabilities.aospImage(c));
  check(AlphaImageCapabilities.defaultAppEnabled(c,"dial"));check(!AlphaImageCapabilities.defaultAppEnabled(c,"sms"));check(!AlphaImageCapabilities.defaultAppEnabled(c,null));
  check(AlphaImageCapability.featureName("ai.elizaresearch.alphaphone").equals("ai.elizaresearch.alphaphone.aosp_image"));
  c.resources.missing=true;check(!AlphaImageCapabilities.aospImage(c));check(!AlphaImageCapabilities.defaultAppEnabled(c,"dial"));check(!AlphaImageCapability.verified(c));c.resources.missing=false;
  c.packages.features.add("ai.elizaresearch.alphaphone.aosp_image");check(AlphaImageCapability.verified(c));
  for(String role:new String[]{"dialer","sms","contacts","unknown",null})check(!AlphaImageCapabilities.roleEnabled(role));check(AlphaImageCapabilities.roleEnabled("home"));check(AlphaImageCapabilities.roleEnabled("assistant"));
  System.out.println("PASS image admission and unimplemented role denial");
 }
}`,
 };
 for(const [name,body] of Object.entries(files)){const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);}
 // Alpha's adapters compile against the shared decision (plugin-native-messages ImageCapability) at the pin.
 const alpha='android/app/src/main/java/ai/elizaresearch/alphaphone', shared='vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages';
 const sources=[`${alpha}/AlphaImageCapabilities.java`,`${alpha}/AlphaImageCapability.java`,`${shared}/ImageCapability.java`,`${shared}/SmsTelephonyConfiguration.java`];
 const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
 execFileSync(binary('javac'),['--release','11','-d',dir,...sources,...Object.keys(files).map(name=>path.join(dir,name))],{timeout:30000,stdio:'pipe'});
 const run=(...args)=>execFileSync(binary('java'),[...args,'-cp',dir,'ai.elizaresearch.alphaphone.CapabilityTest',...(args.length?[args[0]]:[])],{encoding:'utf8',timeout:30000});
 assert.match(run(),/PASS image admission/);
 // Debug, test-mocks and non-launcher builds are refused even with every image fact present.
 for(const flag of ['-Dt.debug=true','-Dt.mocks=true','-Dt.flavor=true'])assert.match(run(flag),/PASS refused/);
});
test('production RRO targets the prebuilt app overlayable and cannot be a development default',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-image-overlay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'product.mk'),'');
 const files=writeAospCapabilityOverlay(dir,'ai.elizaresearch.alphaphone');assert.match(files['image-capabilities/Android.bp'],/runtime_resource_overlay/);assert.match(files['image-capabilities/Android.bp'],/product_specific: true/);
 assert.match(files['image-capabilities/AndroidManifest.xml'],/targetName="AlphaImageProvisioning"/);assert.match(files['image-capabilities/res/values/capabilities.xml'],/>true</);
 assert.match(fs.readFileSync(path.join(dir,'product.mk'),'utf8'),/PRODUCT_PACKAGES \+= AlphaImageCapabilityOverlay\n/);
 const defaults=fs.readFileSync('android/app/src/main/res/values/aosp-capabilities.xml','utf8');assert.equal(assertAlphaProvisioningDefault(defaults),true);
 assert.throws(()=>assertAlphaProvisioningDefault(defaults.replace('>false<','>true<')),/default to false/);
 const stage=fs.readFileSync('scripts/stage-aosp.mjs','utf8');assert.ok(stage.indexOf('if (!physical) writeAospCapabilityOverlay(output')>stage.indexOf('if (production) {'));
 // The shared Pixel 10a composition writes the same overlay from Alpha's product, with Alpha's installed identifiers.
 const product=JSON.parse(fs.readFileSync('vendor/eliza/packages/os/android/products/pixel10a-alpha.json','utf8'));
 assert.deepEqual(product.launcher.imageProvisioning,{...ALPHA_IMAGE_PROVISIONING});
 assert.throws(()=>writeAospCapabilityOverlay(dir,'bad"target'),/Invalid/);
});
