import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary,nativeSource} from './fixtures/jvm-tools.mjs';
const strip=text=>text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
test('the listener owner is read once per credential state and never survives a provider or Cloud commit',()=>{
 const agent=strip(readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8')),store=strip(readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8'));
 assert.match(agent,/static String invocationOwner\(Context context\)\{return INVOCATION_OWNER\.get\(\(\)->readProviderOwner\(new AlphaCredentialStore\(context\)\),System\.currentTimeMillis\(\)\);\}/);
 assert.match(agent,/private static <T> T commitCredentials\(CredentialMutation<T> mutation\)throws Exception\{INVOCATION_OWNER\.invalidate\(\);try\{return mutation\.commit\(\);\}finally\{INVOCATION_OWNER\.invalidate\(\);\}\}/);
 // The cached owner carries the Cloud credential's expiresAt as its deadline.
 assert.match(agent,/if\(credential\.has\("expiresAt"\)\)validUntil=InvocationOwnerCache\.deadline\(credential\.opt\("expiresAt"\)\);/);
 // Every commit in mutateCredentials (the only path that writes the provider or Cloud slots) is wrapped.
 assert.equal(agent.match(/mutation\.commit\(\)/g).length,1);assert.equal(agent.match(/return commitCredentials\(mutation\);/g).length,2);
 // The store writes the provider and Cloud slots only inside a CredentialMutation commit.
 const fast=store.slice(store.indexOf('private boolean mutateSlotOnce('),store.indexOf('return AlphaLocalAgentPlugin.mutateCredentials('));
 assert.match(fast,/if\(!"cloud:production"\.equals\(name\)&&!"cloud:staging"\.equals\(name\)&&!LocalAgentProviderAdmission\.PROVIDER_SLOT\.equals\(name\)\)\{/);
 const temporary=mkdtempSync(join(tmpdir(),'invocation-owner-cache-'));
 try{
  writeFileSync(join(temporary,'Harness.java'),`package ai.elizaresearch.alphaphone;
public final class Harness {
 static String value="owner-a";static int reads;static long clock=1000;static Object expiresAt=null;
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 // Mirrors NativeProviderAdmission.currentGeneration: the generation is null once expiresAt <= now.
 static InvocationOwnerCache.Owner stored(){reads++;boolean expired=expiresAt!=null&&!(((Number)expiresAt).doubleValue()>clock);return new InvocationOwnerCache.Owner(expired?null:value,expiresAt==null?Long.MAX_VALUE:InvocationOwnerCache.deadline(expiresAt));}
 static String owner(InvocationOwnerCache cache){return cache.get(Harness::stored,clock);}
 public static void main(String[] args)throws Exception{
  InvocationOwnerCache cache=new InvocationOwnerCache();
  check("owner-a".equals(owner(cache))&&"owner-a".equals(owner(cache))&&reads==1,"read once while unchanged");
  value="owner-b";cache.invalidate();
  check("owner-b".equals(owner(cache))&&reads==2,"a commit invalidates the owner");
  // A read that started before a commit finished is returned to its caller but never cached.
  cache.invalidate();String inFlight=cache.get(()->{InvocationOwnerCache.Owner old=stored();value="owner-c";cache.invalidate();return old;},clock);
  check("owner-b".equals(inFlight),"in-flight read returns what it read");
  check("owner-c".equals(owner(cache)),"a read overlapping a commit is not cached");
  // A failed read is not cached as the owner.
  cache.invalidate();
  check(cache.get(()->{throw new Exception("locked");},clock)==null,"failure is null");
  int before=reads;check("owner-c".equals(owner(cache))&&reads==before+1,"failure is not cached");
  // A stored null (invalid admission) is cached until the next commit.
  value=null;cache.invalidate();before=reads;
  check(owner(cache)==null&&owner(cache)==null&&reads==before+1,"null owner cached");
  value="owner-d";cache.invalidate();check("owner-d".equals(owner(cache)),"null replaced after commit");
  // A Cloud credential expires with no commit: the cached owner is never returned at or after expiresAt.
  value="owner-e";expiresAt=5000L;clock=1000;cache.invalidate();before=reads;
  check("owner-e".equals(owner(cache))&&"owner-e".equals(owner(cache))&&reads==before+1,"cached before expiry");
  clock=4999;check("owner-e".equals(owner(cache))&&reads==before+1,"still cached one millisecond before expiry");
  clock=5000;check(owner(cache)==null,"expired at expiresAt with no commit");
  clock=9000;check(owner(cache)==null,"expired after expiresAt");
  // A fractional expiresAt never extends the cached owner past it.
  expiresAt=7000.5;clock=1000;cache.invalidate();check("owner-e".equals(owner(cache)),"fractional expiry cached");
  before=reads;clock=7000;check("owner-e".equals(owner(cache))&&reads==before+1,"fractional expiry is read again, not served from the cache, at its floor");
  clock=7001;check(owner(cache)==null,"fractional expiry refused after expiresAt");
  // An expiresAt that is not a finite number (refused by cloudProviderToken) is never cached.
  check(InvocationOwnerCache.deadline("5000")==Long.MIN_VALUE&&InvocationOwnerCache.deadline(Double.NaN)==Long.MIN_VALUE&&InvocationOwnerCache.deadline(Double.POSITIVE_INFINITY)==Long.MIN_VALUE&&InvocationOwnerCache.deadline(null)==Long.MIN_VALUE,"unreadable expiry is immediate");
  check(InvocationOwnerCache.deadline(7000.5)==7000L&&InvocationOwnerCache.deadline(5000L)==5000L,"deadline never after expiresAt");
  System.out.println("PASS invocation owner cache");
 }
}`);
  execFileSync(javaBinary('javac'),['-d',temporary,nativeSource('InvocationOwnerCache.java'),join(temporary,'Harness.java')]);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.Harness'],{encoding:'utf8'}),/PASS invocation owner cache/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
