import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runJvm} from './fixtures/jvm-tools.mjs';

test('voice feed fences runtime replacement even when lifecycle epoch and owner remain unchanged', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-admission-'));
 try {
  fs.copyFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/VoiceEventAdmission.java',path.join(dir,'VoiceEventAdmission.java'));
  fs.writeFileSync(path.join(dir,'VoiceAdmissionTest.java'),`package ai.alphacompute.alphaphone;
public class VoiceAdmissionTest {
 public static void main(String[] args) {
  if(!VoiceEventAdmission.current("old","old","old","owner","owner",20,10))throw new AssertionError("valid feed rejected");
  if(VoiceEventAdmission.current("old","old","new","owner","owner",20,10))throw new AssertionError("rotated runtime leaked before reenrollment");
  if(VoiceEventAdmission.current("old","new","new","owner","owner",20,10))throw new AssertionError("reenrollment revived old feed");
  if(VoiceEventAdmission.current("old","old","old","owner","other",20,10))throw new AssertionError("owner changed");
  if(VoiceEventAdmission.current("old","old","old","owner","owner",10,10))throw new AssertionError("expired");
  if(VoiceEventAdmission.current(null,null,null,"owner","owner",20,10))throw new AssertionError("unenrolled");
 }
}`);
  runJvm([path.join(dir,'VoiceEventAdmission.java'),path.join(dir,'VoiceAdmissionTest.java')],'ai.alphacompute.alphaphone.VoiceAdmissionTest');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
