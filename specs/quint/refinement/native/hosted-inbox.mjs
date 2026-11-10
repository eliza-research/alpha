import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model = 'NativeHostedInbox';
const owner = 'plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java';
const harness = 'HostedInboxTraces.java';
const campaign = ['two-pages-and-exact-ack', 'ack-reply-loss-and-equivalent-replay',
  'replacement-during-fetch', 'accepted-receipt-before-generation-retire', 'background-pause-and-owner-stop',
  'row-and-index-partial-writes', 'notice-failure-retries-without-provider-replay', 'notice-effect-before-index-clear-refusal',
  'packed-cache-removal-journal',
  'packed-replay-acknowledges-journaled-last-row', 'resident-credential-expiry', 'invalid-unordered-and-unavailable-pages'];

const support = `package ai.alphacompute.alphaphone;
import android.content.Context;
import org.json.JSONObject;

// Only wall time is controlled. Timeout arithmetic uses the host monotonic clock.
final class System {
 static long currentTimeMillis(){return HostedInboxTraces.now;}
 static long nanoTime(){return java.lang.System.nanoTime();}
}
final class BuildConfig { static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false; }
final class AlphaCredentialStore {
 AlphaCredentialStore(Context context){}
 String readCredentialSlot(String key){return HostedInboxTraces.slots.get(key);}
 void writeCredentialSlot(String key,String value)throws Exception{HostedInboxTraces.write(key,value);}
 void removeCredentialSlot(String key)throws Exception{HostedInboxTraces.remove(key);}
}
final class HostedNoticePoster implements HostedResultNotices.Poster {
 HostedNoticePoster(Context context){}
 public boolean allowed(){return true;}
 public boolean active(String key){return HostedInboxTraces.posts.containsKey(key);}
 public void post(String key){HostedInboxTraces.post(key);}
 public void cancel(String key){throw new AssertionError("Unique synthetic loops should never cancel a notice");}
}
final class HostedDeliveryWorker {
 static void schedule(Context context,String generation,boolean resident){if(!resident)throw new AssertionError("Resident fixture only");}
 static void cancel(Context context){}
}
final class AlphaLocalAgentPlugin {
 static JSONObject captureResultSession(String owner)throws Exception {
  int number=owner.equals(HostedInboxTraces.owner(1))?1:owner.equals(HostedInboxTraces.owner(2))?2:0;
  if(number==0)throw new SecurityException("Unknown synthetic owner");
  return ResidentResultSession.snapshot(owner,HostedInboxTraces.session(number),HostedInboxTraces.now+HostedInboxTraces.TTL,HostedInboxTraces.RUNTIME);
 }
}
final class ElizaAgentService {
 static String localAgentToken(Context context){return HostedInboxTraces.RUNTIME;}
 static String requestLocalAgent(String raw)throws Exception{return HostedInboxTraces.exchange(new JSONObject(raw)).toString();}
}
`;

export async function checkNativeHostedInbox(extraSources = []) {
  const compiled = ['HostedInbox', 'HostedDelivery', 'HostedDeliveryCancelled', 'HostedStorageFault', 'HostedResultNotices',
    'ResidentResultSession', 'ResidentResultTransport', 'HostedTransport', 'NativeDigestSources', 'NativeDeviceEnrollmentKey',
    'CloudDeployment'].map(name => app+name+'.java').concat('vendor/eliza/'+owner);
  const sources = [...compiled, fileURLToPath(import.meta.url), join(directory,harness), join(directory,'Trace.java'),
    join(directory,'java.mjs'), 'scripts/upstream-native-source.ts', 'upstream.lock.json',
    'test/fixtures/jvm-tools.mjs', ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(sources);
  assert.equal(driverHashes[join(root,'vendor/eliza',owner)],upstreamNativeSource(root).read(owner).get(owner).sha256);
  const temporary = mkdtempSync(join(tmpdir(),'quint-native-hosted-inbox-'));
  let traces;
  try {
    const context = join(temporary,'Context.java'), ports = join(temporary,'Support.java');
    writeFileSync(context,'package android.content; public final class Context {public Context getApplicationContext(){return this;}}');
    writeFileSync(ports,support);
    traces = javaTraceCampaign(harness,[...compiled,context,ports],campaign.map(mode => [mode]));
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
  for (const trace of traces) for (const {expect} of [trace,...trace.steps]) {
    expect['s.buckets'] = qmap(expect['s.buckets'].map(([number,bucket]) => [number,{
      ...bucket, rows:qmap(bucket.rows), removal:qset(bucket.removal),
      pendingNotices:qset(bucket.pendingNotices), posted:qset(bucket.posted),
    }]));
  }
  const receipt = await checkTraces({model,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'The actual HostedDelivery, HostedInbox, HostedResultNotices, ResidentResultSession and ResidentResultTransport run in JVMs. Android scheduling, credential storage and resident IPC are synthetic, with controlled wall time.',
    'Real async poll threads block at the exact synthetic GET and ACK ingress. The driver observes the actual operation lock, active scope, transport closure, durable slots and exact provider request body. An externally accepted receipt is recorded independently of response delivery.',
    'The source exercises both pages of one poll, resident expiry, invalid/reordered pages, equivalent or conflicting replay, partial row/index persistence, notice retry, deletion recovery and old-generation unwind.',
    'The model represents three tracked rows and the oldest known row of a packed cache. A synthetic 99-row historical suffix exercises the actual 100-result threshold and ordered journaled eviction.',
  ]});
  return {receipt,obligations:[
    {model,obligation:'Remote, Cloud and installed Android ports',
      reason:'Resident IPC, scheduling, provider receipt acceptance and encrypted storage are controlled. The remote transport, server cursor implementation, WorkManager scheduling and real Keystore behavior remain separate.'},
    {model,obligation:'Unbounded row and partial-write schedules',
      reason:'The campaign covers two scopes, small pages, one seeded full inbox, selected write failures and held IPC. Concurrent configure verification, additional anonymous evictions and failures after storage commits require separate campaigns.'},
  ]};
}
