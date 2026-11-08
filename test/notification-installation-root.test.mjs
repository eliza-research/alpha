import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,runJvm} from './fixtures/jvm-tools.mjs';
test('actual installation reader accepts app-root aliases but rejects escaped state and file links',()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');const start=source.indexOf(' static String notificationInstallation('),end=source.indexOf(' static void rememberNotificationOwner',start);assert(start>=0&&end>start);
 const dir=mkdtempSync(join(tmpdir(),'alpha-installation-root-')),files=[];const put=(name,text)=>{const p=join(dir,name);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,text);files.push(p);};
 try{
 put('android/content/Context.java','package android.content;public class Context {private final java.io.File files;public Context(java.io.File p){files=p;}public java.io.File getFilesDir(){return files;}}');
 put('InstallationTest.java',`package ai.elizaresearch.alphaphone;import android.content.Context;import java.nio.file.*;
class HostedInbox {static String id(String value){if(value==null||!value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw new IllegalArgumentException();return value;}}
class AlphaLocalAgentPlugin {${source.slice(start,end)}}
public class InstallationTest {
 interface Attempt{void run()throws Exception;}
 static void refuses(Attempt action)throws Exception{try{action.run();throw new AssertionError("Unsafe installation accepted");}catch(SecurityException|java.io.IOException expected){}}
 public static void main(String[]args)throws Exception{
  Path base=Files.createTempDirectory("installation-reader").toRealPath(),app=Files.createDirectory(base.resolve("app")),state=Files.createDirectory(app.resolve(".eliza"));
  String id="10000000-0000-4000-8000-000000000001";Path file=state.resolve("runtime-installation-id");Files.writeString(file,id+"\\n");
  Context direct=new Context(app.toFile());if(!id.equals(AlphaLocalAgentPlugin.notificationInstallation(direct)))throw new AssertionError("Real root refused");
  Path alias=base.resolve("android-data-alias");Files.createSymbolicLink(alias,app);if(!id.equals(AlphaLocalAgentPlugin.notificationInstallation(new Context(alias.toFile()))))throw new AssertionError("App alias changed identity");
  Path other=Files.createDirectory(base.resolve("other")),outside=Files.createDirectory(other.resolve(".eliza"));Files.writeString(outside.resolve("runtime-installation-id"),id+"\\n");
  Files.delete(file);Files.delete(state);Files.createSymbolicLink(state,outside);refuses(()->AlphaLocalAgentPlugin.notificationInstallation(direct));Files.delete(state);Files.createDirectory(state);
  Files.createSymbolicLink(file,outside.resolve("runtime-installation-id"));refuses(()->AlphaLocalAgentPlugin.notificationInstallation(direct));Files.delete(file);
  Files.createDirectory(file);refuses(()->AlphaLocalAgentPlugin.notificationInstallation(direct));Files.delete(file);
  refuses(()->AlphaLocalAgentPlugin.notificationInstallation(new Context(other.resolve("missing-root").toFile())));
  Files.writeString(file,"invalid identity/escape");try{AlphaLocalAgentPlugin.notificationInstallation(direct);throw new AssertionError("Invalid ID accepted");}catch(IllegalArgumentException expected){}
  System.out.println("PASS app alias identity retained; escaped state, linked ID, directory ID and missing root refused");
 }
}`);
 assert.match(runJvm(files,'ai.elizaresearch.alphaphone.InstallationTest'),/^PASS app alias identity retained/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
