package com.android.systemui.privacy;

import ai.elizaresearch.alphaphone.Trace;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.ProviderInfo;
import android.os.Bundle;
import android.os.Handler;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/** The real serial lease producer runs with queued main/executor and provider ports. */
public final class ProducerTraces {
 public static void main(String[] args) throws Exception {
  JSONArray traces = new JSONArray();
  for (String mode : new String[]{"accepted", "refused", "no-provider", "delayed", "acquire-failed"}) {
   Context context = new Context(); Handler main = new Handler(); ArrayList<Runnable> background = new ArrayList<>();
   ProviderInfo info = new ProviderInfo(); info.packageName = "ai.elizaresearch.alphaphone";
   info.applicationInfo = new ApplicationInfo(); info.applicationInfo.uid = 10042; context.packages.provider = info;
   boolean[] recording = {false}; Bundle[] sent = {null};
   context.resolver.handler = (uri, method, arg, extras) -> {
    if (method.equals(SenseListeningPolicy.LEASE_ACQUIRE)) {
     if (mode.equals("acquire-failed")) return null;
     Bundle answer = new Bundle(); answer.putLong(SenseListeningPolicy.KEY_GENERATION, 1); return answer;
    }
    if (method.equals(SenseListeningPolicy.LEASE_RENEW)) { sent[0] = extras; Bundle answer = new Bundle(); answer.putBoolean(SenseListeningPolicy.KEY_ACCEPTED, !mode.equals("refused")); return answer; }
    return new Bundle();
   };
   SenseListeningLease client = new SenseListeningLease(context, main, background::add,
     () -> new SenseListeningLease.Acknowledgement(10042, true, true, recording[0], "on", "none"), "ai.elizaresearch.alphaphone");
   Trace trace = new Trace("producer-" + mode, Trace.fields("generation", Trace.read(client, "generation"), "sent", false));
   client.start(); trace.step("start", Trace.fields("running", Trace.read(client, "running")));
   main.advanceTo(0); trace.step("tick", Trace.fields("generation", Trace.read(client, "generation")));
   if (background.size() != 1) throw new AssertionError("nonserial producer");
   if (mode.equals("delayed")) { recording[0] = true; trace.step("audioRecording", Trace.fields("view.recording", true), true); }
   if (mode.equals("no-provider")) { context.packages.provider = null; trace.step("provider", Trace.fields("generation", Trace.read(client, "generation")), false); }
   background.remove(0).run();
   JSONObject observed = Trace.fields("generation", Trace.read(client, "generation"), "sent", sent[0] != null);
   if (sent[0] != null) {
    observed.put("s.lastSent.recording", sent[0].getBoolean(SenseListeningPolicy.KEY_RECORDING, true));
    observed.put("s.lastSent.chip", sent[0].getBoolean(SenseListeningPolicy.KEY_CHIP, true));
   }
   ArrayList<JSONObject> actions = new ArrayList<>(); actions.add(Trace.action("beginDelivery"));
   if (!mode.equals("no-provider")) {
    actions.add(Trace.action("acquire", !mode.equals("acquire-failed")));
    if (!mode.equals("acquire-failed")) actions.add(Trace.action("renew", !mode.equals("refused")));
   }
   trace.macro("serial delivery", observed, actions.toArray(new JSONObject[0]));
   traces.put(trace.value);
  }
  System.out.println(new JSONObject().put("ListenerLeaseProducer", traces));
 }
}
