import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sdk=process.env.ALPHA_TEST_SDK_SOURCE||path.join(root,'vendor/eliza');
const expected=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
assert.equal(execFileSync('git',['-C',sdk,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),expected,'test the descriptor-pinned SDK');
const {stageResidentHostSources,RESIDENT_HOST_CLASSES}=await import(pathToFileURL(path.join(sdk,'packages/app/scripts/mobile/android/resident-host-sources.mjs')).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual resident staging includes the shared browser host and its helper classes',t=>{
 const descriptor=JSON.parse(fs.readFileSync(path.join(root,'android/consumer-host.json'),'utf8'));
 const app=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8'));
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-browser-host-sources-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 const {files}=stageResidentHostSources({sourceRoot:sdk,output,identity:{packageName:app.appId,...descriptor.residentHost},classes:[...RESIDENT_HOST_CLASSES,...descriptor.residentHost.classes],helpers:descriptor.residentHost.helpers});
 const prefix='plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/';
 for(const name of ['BrowserTabHostConfig','BrowserTabHostPlugin','BrowserProfilePolicy','BrowserReviewedReading']){
  const relative=prefix+name+'.java';const row=files.find(file=>file.path===relative);assert.ok(row,`${name} is staged for the app classpath`);
  const bytes=fs.readFileSync(path.join(sdk,relative));assert.equal(row.sourceSha256,sha(bytes));assert.equal(row.generatedSha256,sha(bytes));assert.deepEqual(fs.readFileSync(row.generatedFile),bytes);
 }
});
