import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {git as fixtureGit} from './fixtures/git-fixture.mjs';
import { createHash } from "node:crypto";
import { verifySecureCameraSource, verifySecureCameraImage, writeSecureCameraOverlay, secureCameraComponent } from "../scripts/aosp-secure-camera-contract.ts";

test("source admission rejects missing path, unreviewed revisions, dirty sources and mismatched bytes", t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"alpha-camera-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,"Camera2");fs.mkdirSync(dir);const git=(...args)=>fixtureGit(dir,...args);
 git("init");fs.writeFileSync(path.join(dir,"Android.bp"),'android_app { name: "Camera2" }\n');git("add",".");git("commit","-m","fixture");
 const contract={modules:[{path:"Camera2",commit:git("rev-parse","HEAD"),files:{"Android.bp":createHash("sha256").update(fs.readFileSync(path.join(dir,"Android.bp"))).digest("hex")}}]};
 assert.throws(()=>verifySecureCameraSource(null),/explicit --aosp-source/);assert.equal(verifySecureCameraSource(root,contract).sourceVerified,true);
 const wrong=structuredClone(contract);wrong.modules[0].commit="0".repeat(40);assert.throws(()=>verifySecureCameraSource(root,wrong),/Unreviewed/);
 wrong.modules[0].commit=contract.modules[0].commit;wrong.modules[0].files["Android.bp"]="0".repeat(64);assert.throws(()=>verifySecureCameraSource(root,wrong),/bytes differ/);
 for(const flag of ["assume-unchanged","skip-worktree"]){git("update-index",`--${flag}`,"Android.bp");assert.throws(()=>verifySecureCameraSource(root,contract),/index hides changes/);git("update-index",`--no-${flag}`,"Android.bp");}
 fs.appendFileSync(path.join(dir,".git/info/exclude"),"\nIgnored.java\n");fs.writeFileSync(path.join(dir,"Ignored.java"),"ignored input");assert.throws(()=>verifySecureCameraSource(root,contract),/Ignored source inputs/);fs.unlinkSync(path.join(dir,"Ignored.java"));
 fs.writeFileSync(path.join(dir,"Injected.java"),"untracked");assert.throws(()=>verifySecureCameraSource(root,contract),/not clean/);fs.unlinkSync(path.join(dir,"Injected.java"));
 fs.writeFileSync(path.join(dir,"tool.txt"),"reviewed tooling");
 const override={path:"Camera2/tool.txt",sizeBytes:Buffer.byteLength("reviewed tooling"),sha256:createHash("sha256").update("reviewed tooling").digest("hex")};
 assert.equal(verifySecureCameraSource(root,contract,[override]).sourceVerified,true);
 fs.appendFileSync(path.join(dir,"tool.txt"),"changed");assert.throws(()=>verifySecureCameraSource(root,contract,[override]),/override differs/);
 fs.unlinkSync(path.join(dir,"tool.txt"));assert.throws(()=>verifySecureCameraSource(root,contract,[override]),/not clean/);
 fs.appendFileSync(path.join(dir,"Android.bp"),"dirty");assert.throws(()=>verifySecureCameraSource(root,contract),/not clean/);
});
function device(overrides={}){
 const calls=[];const run=(...args)=>{calls.push(args);const c=args.join(" ");
  if(c.includes("getprop"))return overrides.fingerprint??"fixture/image";
  if(c.includes("list packages"))return overrides.packages??"package:com.android.camera2\n";
  if(c.includes("query-activities"))return (!args.includes("-p")?overrides.globalHandler:undefined)??overrides.handler??secureCameraComponent;
  if(c.includes("bool/config"))return overrides.gesture??"true";
  if(c.includes("string/config"))return overrides.target??"com.android.camera2";
  if(c.includes("settings"))return overrides.disabled??"null";
  if(c.includes("list features"))return overrides.features??"feature:android.hardware.camera.any\n";
  throw Error(`Unexpected command ${c}`);
 };return {run,calls};
}
test("image checks bind explicit user/fingerprint and only read system routing",()=>{
 const {run,calls}=device();const result=verifySecureCameraImage(run,"10","fixture/image");assert.equal(result.imageContractVerified,true);assert.equal(result.lockedCaptureVerified,false);assert.equal(result.unlockPrivacyVerified,false);
 assert.ok(calls.some(c=>c.includes("-s")&&c.includes("-e")));assert.equal(calls.filter(c=>c.includes("query-activities")).length,4);
 for(const c of calls)assert.ok(!c.some(v=>["start","grant","put","delete","install","uninstall"].includes(v)));
 assert.throws(()=>verifySecureCameraImage(run,"","fixture/image"),/user required/);assert.throws(()=>verifySecureCameraImage(run,"10",null),/fingerprint required/);
});
for(const [name,override,error] of [
 ["wrong image",{fingerprint:"other"},/fingerprint differs/],["missing or disabled system camera",{packages:"package:com.other.camera"},/not enabled/],
 ["Alpha secure handler",{globalHandler:"ai.alphacompute.alphaphone/.Camera"},/Alpha must not handle/],
 ["wrong secure handler",{handler:"com.android.camera2/com.android.camera.CameraActivity"},/handler missing/],
 ["disabled power gesture",{gesture:"false"},/not enabled/],["wrong system target",{target:"ai.alphacompute.alphaphone"},/does not target/],
 ["user opt out",{disabled:"1"},/user disabled/],["no camera",{features:""},/no camera feature/]
])test(`image rejects ${name}`,()=>assert.throws(()=>verifySecureCameraImage(device(override).run,"10","fixture/image"),error));
test("staged overlay selects AOSP Camera2 and standard gesture while preserving unverified evidence",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"alpha-camera-stage-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,"product.mk"),"# existing\n");
 writeSecureCameraOverlay(dir,{sourceVerified:false,imageVerified:false});assert.match(fs.readFileSync(path.join(dir,"product.mk"),"utf8"),/PRODUCT_PACKAGES \+= Camera2/);
 assert.match(fs.readFileSync(path.join(dir,"secure-camera/overlay/frameworks/base/core/res/res/values/config.xml"),"utf8"),/config_cameraDoubleTapPowerGestureEnabled">true/);
 assert.match(fs.readFileSync(path.join(dir,"secure-camera/overlay/frameworks/base/packages/SystemUI/res/values/config.xml"),"utf8"),/config_cameraGesturePackage" translatable="false">com.android.camera2/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"secure-camera/source-evidence.json"))).sourceVerified,false);
});
