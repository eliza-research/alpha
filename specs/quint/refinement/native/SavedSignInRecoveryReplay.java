package ai.alphacompute.alphaphone;

import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Replays SavedSignInRecovery model steps on the real AlphaCloudSignInPlugin. The harness holds
 * the restore at the two places the credential store leaves its locks (before the snapshot and
 * across the Cloud identity read) and releases it when the model takes that step. The epoch,
 * single-flight flag, guard and answer are the plugin's.
 */
public final class SavedSignInRecoveryReplay {
  static final AlphaCloudSignInPlugin plugin = new AlphaCloudSignInPlugin();
  static PluginCall restore;
  static long owner, restoreIntent = -1;
  static int refusals, commits, steps;
  static String legacyAtRequest, answer = "none";

  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static Object read(String name) throws Exception {
    Field field = AlphaCloudSignInPlugin.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(plugin);
  }
  static void arrived() throws Exception {
    check(AlphaCredentialStore.arrived.tryAcquire(5, TimeUnit.SECONDS), "The restore did not reach its next boundary");
  }
  /** The restore either settled its call or stopped at the Cloud read. */
  static void settledOrReading() throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (System.nanoTime() < end) {
      if (restore.settled.getCount() == 0) {
        answer = restore.result != null ? (restore.result.getBoolean("restored") ? "restored" : "not-restored") : restore.code;
        return;
      }
      if (AlphaCredentialStore.arrived.tryAcquire(1, TimeUnit.MILLISECONDS))
        return;
    }
    throw new AssertionError("The restore neither settled nor reached the Cloud read");
  }
  static JSONObject observe() throws Exception {
    boolean recovering = (Boolean) read("recoveringLegacy");
    check(recovering || AlphaCredentialStore.stage.equals("none"), "A finished restore is still in the store");
    return new JSONObject()
        .put("epoch", read("recoveryEpoch"))
        .put("recovering", recovering)
        .put("owner", recovering ? owner : 0)
        .put("closed", read("closed"))
        .put("stage", AlphaCredentialStore.stage)
        .put("intentCurrent", AlphaLocalAgentPlugin.credentialIntents.isCurrent(restoreIntent))
        .put("legacy", AlphaCredentialStore.legacy)
        .put("legacyAtRequest", legacyAtRequest)
        .put("slot", AlphaCredentialStore.slot.equals("sign-in") || AlphaCredentialStore.slot.equals("restored") ? AlphaCredentialStore.slot : "empty")
        .put("commitsSinceRequest", Math.min(3, commits))
        .put("answer", answer)
        .put("refusals", Math.min(3, refusals));
  }
  public static void main(String[] args) throws Exception {
    JSONArray trace = new JSONArray(Files.readString(Path.of(args[0])));
    JSONArray observed = new JSONArray();
    for (int i = 0; i < trace.length(); i++) {
      JSONObject step = trace.getJSONObject(i), picks = step.getJSONObject("picks");
      switch (step.getString("action")) {
        case "init":
          AlphaCredentialStore.legacy = picks.getString("legacy");
          legacyAtRequest = AlphaCredentialStore.legacy;
          break;
        case "":
          break;
        case "restoreRequested": {
          PluginCall call = new PluginCall();
          plugin.restoreSavedSignIn(call);
          if (call.settled.getCount() == 0) {
            check("login-active".equals(call.code), "A refused restore answered " + call.code);
            refusals++;
          } else {
            arrived();
            restore = call;
            owner = (Long) read("recoveryEpoch");
            restoreIntent = AlphaLocalAgentPlugin.credentialIntents.current();
            legacyAtRequest = AlphaCredentialStore.legacy;
            commits = 0;
            answer = "none";
          }
          break;
        }
        case "signInStep": {
          // Each entry point the shared client refuses or ends without taking a credential intent.
          PluginCall call = new PluginCall();
          switch (steps++ % 4) {
            case 0: plugin.startGoogle(call); break;
            case 1: plugin.startEmail(call); break;
            case 2: plugin.startPhone(call); break;
            default: plugin.cancel(call);
          }
          break;
        }
        case "signInCommits":
          plugin.completeSignIn();
          commits++;
          break;
        case "intentSuperseded":
          AlphaLocalAgentPlugin.reserveCredentialIntent();
          break;
        case "restoreReads":
          AlphaCredentialStore.expires = picks.getBoolean("expires");
          AlphaCredentialStore.read.release();
          settledOrReading();
          // The clock passed the key's expiry: the request's view of the unchanged bytes moves with it.
          if (AlphaCredentialStore.expires && "expired".equals(answer))
            legacyAtRequest = "expired";
          AlphaCredentialStore.expires = false;
          break;
        case "restoreEnds":
          AlphaCredentialStore.cloud = picks.getString("cloud");
          AlphaCredentialStore.answered.release();
          check(restore.settled.await(5, TimeUnit.SECONDS), "The restore did not answer");
          answer = restore.result != null ? (restore.result.getBoolean("restored") ? "restored" : "not-restored") : restore.code;
          break;
        case "destroy":
          plugin.handleOnDestroy();
          break;
        default:
          throw new AssertionError("No product step for " + step.getString("action"));
      }
      observed.put(observe());
    }
    System.out.println(observed);
    System.exit(0);
  }
}
