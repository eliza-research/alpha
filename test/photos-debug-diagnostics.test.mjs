import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
function declaration(source,signature){const start=source.indexOf(signature);assert.notEqual(start,-1);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
test('Photos QA emits only fixed debug enum markers; exception payloads and release builds stay silent',()=>{
 // The marker enum and its failure categories are the shared PhotosPlugin's; Alpha logs them in debug builds only.
 const source=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java','utf8');
 const shared=readFileSync('vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/PhotosPlugin.java','utf8');
 assert.match(source,/@Override protected void diagnostic\(PhotosPlugin\.Diagnostic marker\)\{qaMarker\(marker\);\}/);
 assert.match(shared,/protected void diagnostic\(Diagnostic marker\) \{\}/,'hosts that do not log record nothing');
 assert.match(shared,/diagnostic\(Diagnostic\.readFailure\(failure\)\);\n {8}call\.reject\("This saved media is no longer available"\);/,'a failed read reports its category only');
 const dir=mkdtempSync(join(tmpdir(),'photos-diagnostic-'));
 try{
  mkdirSync(join(dir,'android/util'),{recursive:true});
  writeFileSync(join(dir,'android/util/Log.java'),'package android.util;public class Log {public static final java.util.List<String> entries=new java.util.ArrayList<>();public static int i(String tag,String message){entries.add(tag+":"+message);return 0;}}');
  writeFileSync(join(dir,'PhotosDiagnosticHarness.java'),`class BuildConfig {static boolean DEBUG;}
 public class PhotosDiagnosticHarness {
 static class PhotosPlugin {
 ${declaration(shared,'public enum Diagnostic ')}
 }
 ${declaration(source,'static void qaMarker(PhotosPlugin.Diagnostic marker)')}
 static void diagnostic(PhotosPlugin.Diagnostic marker){qaMarker(marker);}
 static void diagnosticReadFailure(Exception failure){qaMarker(PhotosPlugin.Diagnostic.readFailure(failure));}
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
 Exception[] failures={new SecurityException("private-uri"),new IllegalArgumentException("private-id"),new java.io.IOException("private-pixels"),new RuntimeException("private-token")};
 for(boolean debug:new boolean[]{false,true}){
 BuildConfig.DEBUG=debug;android.util.Log.entries.clear();for(PhotosPlugin.Diagnostic marker:PhotosPlugin.Diagnostic.values())diagnostic(marker);for(Exception failure:failures)diagnosticReadFailure(failure);
 if(!debug){check(android.util.Log.entries.isEmpty());continue;}
 check(android.util.Log.entries.size()==PhotosPlugin.Diagnostic.values().length+4);
 for(String entry:android.util.Log.entries){check(entry.startsWith("AlphaPhotosQA:"));PhotosPlugin.Diagnostic.valueOf(entry.substring("AlphaPhotosQA:".length()));check(!entry.contains("private"));}
 int offset=PhotosPlugin.Diagnostic.values().length;check(android.util.Log.entries.get(offset).endsWith("READ_FAILED_SECURITY"));check(android.util.Log.entries.get(offset+1).endsWith("READ_FAILED_ARGUMENT"));check(android.util.Log.entries.get(offset+2).endsWith("READ_FAILED_IO"));check(android.util.Log.entries.get(offset+3).endsWith("READ_FAILED_OTHER"));
 }
 System.out.println("PASS fixed debug markers, failure categories, no exception payload, release silence");
 }}
 `);
  const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(bin('javac'),['--release','11','-d',dir,join(dir,'android/util/Log.java'),join(dir,'PhotosDiagnosticHarness.java')]);
  assert.match(execFileSync(bin('java'),['-cp',dir,'PhotosDiagnosticHarness'],{encoding:'utf8'}),/PASS fixed debug markers/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
