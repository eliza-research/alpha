// patches/eliza/owned-captures-legacy-path.patch on the patched source: a host that moved its capture
// folder (Alpha: Pictures/ to DCIM/Camera/) still finds a keep reserved under the earlier folder, so
// retrying it resolves that row instead of reporting it unconfirmed forever. The pure-Java config runs
// on the JVM; the MediaStore lookup is device-checked by KeptCaptureLegacyPathInstrumentedTest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const ready=fs.existsSync(path.join(root,'vendor/eliza/plugins/plugin-native-media'));
const javac=(()=>{try{execFileSync('javac',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
test('a keep reserved under the earlier capture folder is still looked up there',{skip:(!ready&&'vendor/eliza not checked out')||(!javac&&'no JDK')},t=>{
 return import('../scripts/prepare-patched-native.mjs').then(({preparePatchedNative})=>{
  const media=path.join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');
  const captures=fs.readFileSync(path.join(media,'OwnedCaptures.java'),'utf8');
  const lookup=captures.slice(captures.indexOf('private Cursor lookup('),captures.indexOf('private Result recover('));
  assert.match(lookup,/paths\.addAll\(config\.legacyCaptureRelativePaths\)/);assert.match(lookup,/relative_path IN \(/);
  assert.equal((captures.match(/RELATIVE_PATH, config\.captureRelativePath/g)||[]).length,1,'New keeps are published only in the current folder');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-legacy-captures-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
  fs.writeFileSync(path.join(work,'LegacyCapturesCheck.java'),`import ai.eliza.plugins.media.OwnedMediaConfig;
public class LegacyCapturesCheck{static void check(boolean ok,String what){if(!ok)throw new AssertionError(what);}
 public static void main(String[] a){
  OwnedMediaConfig alpha=OwnedMediaConfig.builder("alpha").edits("Pictures/Alpha Phone/Edits/","Alpha-edit-").captures("DCIM/Camera/","SCAN_").legacyCaptures("Pictures/").legacyCaptures("Pictures/").build();
  check(alpha.captureRelativePath.equals("DCIM/Camera/"),"current folder");
  check(alpha.legacyCaptureRelativePaths.equals(java.util.List.of("Pictures/")),"one legacy folder "+alpha.legacyCaptureRelativePaths);
  OwnedMediaConfig same=OwnedMediaConfig.builder("alpha").edits("Pictures/E/","e-").captures("DCIM/Camera/","SCAN_").legacyCaptures("DCIM/Camera/").build();
  check(same.legacyCaptureRelativePaths.isEmpty(),"the current folder is not also legacy");
  check(OwnedMediaConfig.builder("alpha").edits("Pictures/E/","e-").captures("Pictures/","SCAN_").build().legacyCaptureRelativePaths.isEmpty(),"none by default");
  try{OwnedMediaConfig.builder("alpha").legacyCaptures("Music/");check(false,"rejects folders outside Pictures/ and DCIM/");}catch(IllegalArgumentException expected){}
  try{alpha.legacyCaptureRelativePaths.add("DCIM/");check(false,"immutable");}catch(UnsupportedOperationException expected){}
  System.out.println("ok");
 }}`);
  execFileSync('javac',['-d',work,path.join(media,'OwnedMediaConfig.java'),path.join(work,'LegacyCapturesCheck.java')],{timeout:60000});
  assert.equal(execFileSync('java',['-cp',work,'LegacyCapturesCheck'],{encoding:'utf8',timeout:60000}).trim(),'ok');
  const host=fs.readFileSync(path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaMediaConfig.java'),'utf8');
  assert.match(host,/\.captures\("DCIM\/Camera\/","SCAN_"\)\.legacyCaptures\("Pictures\/"\)/);
 });
});
