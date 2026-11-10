import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {runJvm} from './fixtures/jvm-tools.mjs';
const source=fs.readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/CalendarSyncBridge.java','utf8');
test('Calendar Cloud reads classify retryable refusal without authorizing a mutation',()=>{
 const method=/private static String cloudFailure\([^\n]+/.exec(source)?.[0];assert.ok(method);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-calendar-cloud-'));
 try{const file=path.join(dir,'CloudRefusal.java');fs.writeFileSync(file,`public class CloudRefusal {
 static class LocalAgentProviderAdmission {static class CloudReadFailure {int status;CloudReadFailure(int status){this.status=status;}}}
 ${method}
 public static void main(String[] a){for(int status:new int[]{408,429,500,503})if(!cloudFailure(new LocalAgentProviderAdmission.CloudReadFailure(status)).equals("unavailable"))throw new AssertionError(status);for(int status:new int[]{400,401,403,404,409})if(!cloudFailure(new LocalAgentProviderAdmission.CloudReadFailure(status)).equals("context-changed"))throw new AssertionError(status);System.out.println("PASS Calendar Cloud refusal classes");}
 }`);assert.match(runJvm([file],'CloudRefusal'),/PASS Calendar Cloud refusal classes/);
 assert.equal((source.match(/catch\(LocalAgentProviderAdmission\.CloudReadFailure failure\)\{call\.resolve\(status\(cloudFailure\(failure\)\)\);\}/g)||[]).length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
