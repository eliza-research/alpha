import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {protectGzipAssets,packagedGzipProblems,isGzip} from '../scripts/android-gzip-assets.ts';
import {mergeGzipAssets} from './fixtures/android-gzip-assets.mjs';

const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'alpha-gzip-assets-'));


test('a gzip web asset survives the Android asset merger under its published name',()=>{
 const web=temporary(),android=temporary();
 try{
  const model=zlib.gzipSync(Buffer.from('synthetic traineddata '.repeat(100)));
  for(const root of [web,android]){fs.mkdirSync(path.join(root,'ocr'));fs.writeFileSync(path.join(root,'ocr/eng.traineddata.gz'),model);fs.writeFileSync(path.join(root,'ocr/worker.min.js'),'worker');}
  // Without protection the merger publishes eng.traineddata, and the engine's request for .gz finds nothing.
  const unprotected=temporary();
  try{fs.cpSync(android,unprotected,{recursive:true});mergeGzipAssets(unprotected);assert.equal(fs.existsSync(path.join(unprotected,'ocr/eng.traineddata.gz')),false);assert.match(packagedGzipProblems(unprotected,web).join('\n'),/ocr\/eng\.traineddata\.gz is missing from the APK web payload/);}
  finally{fs.rmSync(unprotected,{recursive:true,force:true});}
  assert.deepEqual(protectGzipAssets(android),['ocr/eng.traineddata.gz']);
  assert.deepEqual(fs.readdirSync(path.join(android,'ocr')).sort(),['eng.traineddata.gz.gz','worker.min.js']);
  const wrapped=fs.readFileSync(path.join(android,'ocr/eng.traineddata.gz.gz'));
  assert.deepEqual(protectGzipAssets(android),[],'an already wrapped payload is left alone');
  assert.ok(wrapped.equals(fs.readFileSync(path.join(android,'ocr/eng.traineddata.gz.gz'))));
  mergeGzipAssets(android);
  const packaged=fs.readFileSync(path.join(android,'ocr/eng.traineddata.gz'));
  assert.ok(packaged.equals(model)&&isGzip(packaged),'the APK carries the original gzip bytes');
  assert.deepEqual(packagedGzipProblems(android,web),[]);
  fs.writeFileSync(path.join(android,'ocr/eng.traineddata.gz'),zlib.gzipSync(Buffer.from('other')));
  assert.match(packagedGzipProblems(android,web).join('\n'),/differs from the web build/);
 }finally{for(const root of [web,android])fs.rmSync(root,{recursive:true,force:true});}
});

test('wrapping is deterministic and refuses a mislabelled or linked asset',()=>{
 const one=temporary(),two=temporary();
 try{
  const model=zlib.gzipSync(Buffer.from('bytes'));
  for(const root of [one,two]){fs.writeFileSync(path.join(root,'a.gz'),model);protectGzipAssets(root);}
  assert.ok(fs.readFileSync(path.join(one,'a.gz.gz')).equals(fs.readFileSync(path.join(two,'a.gz.gz'))));
  fs.writeFileSync(path.join(one,'plain.gz'),'not gzip');assert.throws(()=>protectGzipAssets(one),/is not gzip data/);fs.rmSync(path.join(one,'plain.gz'));
  fs.symlinkSync(path.join(two,'a.gz.gz'),path.join(one,'link.gz'));assert.throws(()=>protectGzipAssets(one),/Refusing to follow/);
 }finally{for(const root of [one,two])fs.rmSync(root,{recursive:true,force:true});}
});

test('the Android sync step and APK verification use the protection',()=>{
 const scripts=JSON.parse(fs.readFileSync('package.json','utf8')).scripts;
 assert.match(scripts['android:sync'],/cap sync android .*&& node scripts\/android-gzip-assets\.ts protect$/);
 assert.match(fs.readFileSync('scripts/verify-apks.ts','utf8'),/problems\.push\(\.\.\.packagedGzipProblems\(payload\.public\)\)/);
 // The pinned engine asks for the gzip name; if upstream changes that, this protection needs review.
 assert.match(fs.readFileSync('vendor/eliza/plugins/plugin-files/src/documents/local-ocr.ts','utf8'),/gzip: true/);
});
