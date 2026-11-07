// P-14 background Gmail check: behaviour is the shared plugin-native-notifications MailBackgroundDelivery
// (JVM-tested upstream) and @elizaos/plugin-inbox/mailbox createMailBackground. Alpha keeps only its
// installed identifiers. These are migration-sensitive: installed phones hold the encrypted slot, posted
// notices carry the tag/route prefixes, and the channel holds the owner's Android notification choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';

const root=resolve(import.meta.dirname,'..');
const java=name=>readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name),'utf8');

test('the Alpha binding keeps the installed slot, notice identifiers and bridge name',()=>{
 const binding=java('GmailBackground.java'),plugin=java('AlphaGmailPlugin.java');
 assert.match(binding,/SLOT="gmail-background:v1"/);
 assert.match(binding,/new MailNoticePoster\.Config\("alpha-gmail","New Gmail messages",/);
 assert.match(binding,/"ai\.elizaresearch\.alphaphone\.OPEN_GMAIL_NOTICE","alpha-gmail:","alpha-gmail-ask:","alpha-gmail-"/);
 assert.match(binding,/MainActivity\.class\)/);
 assert.match(binding,/readCredentialSlot\("cloud:production"\)/);
 assert.match(binding,/new MailBackgroundDelivery\.Config\(CloudDeployment\.PRODUCTION_API,"production","google\.gmail\.triage",4\)/);
 assert.match(binding,/observeCloudChanges\(\(\)->created\.withdraw\(null\)\)/,'a replaced Cloud key retires background state');
 assert.match(plugin,/@CapacitorPlugin\(name="AlphaGmail"\)/);
 for(const removed of ['GmailDelivery.java','GmailNoticePoster.java','GmailReconciliation.java'])
  assert.equal(existsSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',removed)),false,removed+' is shared upstream');
 const renderer=readFileSync(join(root,'apps/app/src/runtime/gmail-background.ts'),'utf8');
 assert.match(renderer,/registerPlugin<MailBackgroundNative>\('AlphaGmail'\)/);
 assert.match(renderer,/GMAIL_BACKGROUND_CHANGED='alpha:gmail-background-changed'/);
});

test('background admission no longer depends on the agent inference provider',()=>{
 const store=java('AlphaCredentialStore.java');
 assert.doesNotMatch(store,/PROVIDER_SLOT\.equals\(name\)\|\|"cloud:production"\.equals\(name\)&&!LocalAgentProviderAdmission\.sameCloudCredential\(before,value\)\)cloudChange/);
 assert.match(store,/if\("cloud:production"\.equals\(name\)&&!LocalAgentProviderAdmission\.sameCloudCredential\(before,value\)\)cloudChange\.changed\(\);/);
 const adapter=readFileSync(join(root,'apps/app/src/prototype/inbox-cloud-adapter.ts'),'utf8');
 const watch=adapter.match(/const watchSelectedMail=\(\)=>\{.*\};/)?.[0]??'';
 assert.match(watch,/if\(!selected\)\{void configureGmailBackground\(null\)/,'only an unselected account withdraws');
 assert.match(watch,/if\(owner\?\.organizationId&&owner\.credentialId===binding\.credentialId\)void configureGmailBackground\(\{credentialId:binding\.credentialId,grantId:selected,userId:owner\.userId,organizationId:owner\.organizationId\}\)/);
 assert.equal((watch.match(/configureGmailBackground\(/g)||[]).length,2,'an unnamed owner never withdraws the saved selection');
});

test('mail delivery enters the credential lifecycle lock before the vault and resumes off the UI thread',()=>{
 const binding=java('GmailBackground.java'),agent=java('AlphaLocalAgentPlugin.java'),plugin=java('AlphaGmailPlugin.java');
 assert.match(binding,/public Object lock\(\)\{return AlphaLocalAgentPlugin\.credentialLifecycleLock\(\);\}/);
 assert.match(agent,/static Object credentialLifecycleLock\(\)\{return lifecycleLock;\}/);
 assert.match(agent,/withCredentialSlotMutation\([^\n]+\n\s+requireLockOrder\(\);\n\s+synchronized\(lifecycleLock\)\{synchronized\(ai\.eliza\.plugins\.securestore\.nativeonly\.JsonCredentialSlots\.LOCK\)/);
 assert.match(plugin,/void resumeDelivery\(boolean notify\)\{try\{io\.execute\(\(\)->\{delivery\(\)\.resume\(\);/);
 assert.match(plugin,/void load\(\)\{[^\n]*resumeDelivery\(false\);\}/);
 assert.match(plugin,/void handleOnResume\(\)\{Intent again=retained;retained=null;if\(again!=null\)capture\(again\);resumeDelivery\(true\);\}/);
});

// The shared engine and delivery are exercised at the pin, against the real projected sources.
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('the pinned shared reconciliation and delivery pass their JVM checks',()=>{
 assert.ok(jsonJar,'Pinned JVM JSON dependency required');
 const plugin=join(root,'vendor/eliza/plugins/plugin-native-notifications'),sources=join(plugin,'android/src/main/java/ai/eliza/plugins/notifications'),tests=join(plugin,'test/native-host');
 const temporary=mkdtempSync(join(tmpdir(),'gmail-background-'));
 const home=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>home?join(home,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','17','-cp',jsonJar,'-d',temporary,join(sources,'MailHistoryReconciliation.java'),join(sources,'MailBackgroundDelivery.java'),join(tests,'MailHistoryReconciliationTest.java'),join(tests,'MailBackgroundDeliveryTest.java')],{timeout:60000});
  const run=main=>execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,main],{encoding:'utf8',timeout:60000});
  assert.match(run('MailHistoryReconciliationTest'),/^PASS mail durable/);
  assert.match(run('MailBackgroundDeliveryTest'),/^\d+ assertions passed/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
