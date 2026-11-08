package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.agent.runtime.CredentialShutdownLease;

/** Test port for the resident's real lease with a controllable stop observation. */
final class AlphaLocalAgentPlugin {
 static final CredentialShutdownLease lease = new CredentialShutdownLease();
 static volatile boolean confirmed = true;
 static volatile int stops, releases;
 static volatile Runnable acquiring = () -> {};
 static volatile Runnable confirming = () -> {};

 static long pauseForUpdate(Context context) {
  acquiring.run();
  long request = lease.acquire();
  stops++;
  return request;
 }

 static boolean updateShutdownConfirmed(Context context, long request) {
  lease.acknowledge(request, confirmed);
  confirming.run();
  return lease.isConfirmed(request);
 }

 static void releaseUpdateShutdown(long request) {
  if (!lease.release(request)) throw new AssertionError("Shutdown release lost exact ownership");
  releases++;
 }
}
