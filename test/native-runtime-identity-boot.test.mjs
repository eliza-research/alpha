import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, delimiter } from "node:path";
import { execFileSync } from "node:child_process";
import { javaBinary, jsonJar, jsonJarSkip } from "./fixtures/jvm-tools.mjs";
const root = resolve(import.meta.dirname, "..");
const service = readFileSync(
  join(
    root,
    "vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAgentService.java",
  ),
  "utf8",
);
const plugin = readFileSync(
  join(
    root,
    "android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java",
  ),
  "utf8",
);
function method(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing actual method ${signature}`);
  const body = source.indexOf("{", start);
  let depth = 1,
    end = body + 1;
  for (; end < source.length && depth; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  assert.equal(depth, 0);
  return source.slice(start, end);
}
test("a rejected old-target listening peer stays unready and unattachable without false absence", {
  skip: jsonJarSkip,
}, () => {
  const temporary = mkdtempSync(join(tmpdir(), "native-identity-boot-"));
  try {
    let projection;
    const getter = method(
      service,
      "public static JSONObject getLocalAgentBootState(",
    );
    if (service.includes("static JSONObject projectLocalAgentBootState(")) {
      projection = method(
        service,
        "static JSONObject projectLocalAgentBootState(",
      );
      assert.match(
        getter,
        /return projectLocalAgentBootState\(status, socketListening,/,
      );
      assert.match(
        getter,
        /instance != null \|\| !serviceLifecycleCompletion\.isDone\(\)/,
      );
    } else {
      // Run the old actual projection too, so the regression fails on false readiness,
      // rather than only because a newly extracted helper did not exist yet.
      const start = getter.indexOf("JSONObject result = new JSONObject();");
      const body = getter
        .slice(start, getter.lastIndexOf("}"))
        .replace(
          "instance != null || !serviceLifecycleCompletion.isDone()",
          "serviceActive",
        );
      projection = `static JSONObject projectLocalAgentBootState(String status,boolean socketListening,boolean serviceActive,boolean hasStartWorker,boolean detached,long ageMs,int attempts)throws JSONException {${body}}`;
    }
    const terminal = method(
      service,
      "private static boolean isTerminalBootStatus(",
    );
    const refusal = method(plugin, "static String startupRefusalMessage(");
    const shutdown = method(
      plugin,
      "private static boolean shutdownConfirmed(",
    );
    const grace = service.match(
      /(?:private|public) static final long AGENT_BOOT_GRACE_MS\s*=\s*([^;]+);/,
    );
    assert.ok(grace);
    writeFileSync(
      join(temporary, "NativeBootHarness.java"),
      `package ai.elizaresearch.alphaphone;
import org.json.JSONObject;import org.json.JSONException;import ai.eliza.plugins.agent.runtime.ResidentAttachment;
public class NativeBootHarness {
 static final long AGENT_BOOT_GRACE_MS=${grace[1]};
 static class IpcStartupRecovery {static final String RETENTION_LIMIT="ipc-recovery-retention-limit";}
 ${projection}
 ${terminal}
 ${refusal}
 ${shutdown}
 static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 static ResidentAttachment.Facts facts(){ResidentAttachment.Facts f=new ResidentAttachment.Facts();f.accepting=true;f.currentRoot="fixture-root";f.enrolledRoot="fixture-root";f.ownerToken="fixture-owner";f.ownerIdentity="fixture-identity";f.expiresAt=200000;f.now=1;f.launchedGeneration="fixture-generation";f.currentGeneration="fixture-generation";return f;}
 public static void main(String[] args)throws Exception {
  JSONObject rejected=projectLocalAgentBootState("runtime-identity-unavailable",true,true,false,false,-1,0);
  check("dead".equals(rejected.optString("state")),"rejected old-target peer must not appear listening/ready");
  check("runtime-identity-unavailable".equals(rejected.optString("reason")),"existing finite refusal reason must survive");
  check(rejected.optBoolean("socketListening")&&rejected.optBoolean("serviceActive"),"actual live observations must remain true");
  check("runtime-not-running".equals(ResidentAttachment.refusal(rejected,facts())),"old-target peer must not attach");
  check(!ResidentAttachment.describe(ResidentAttachment.refusal(rejected,facts())).optBoolean("attachable"),"renderer must see unattachable");
  check(startupRefusalMessage(rejected.optString("reason"))!=null,"existing startup refusal must be surfaced");
  check(!shutdownConfirmed(rejected),"rejection must not falsely confirm shutdown/absence");
  JSONObject running=projectLocalAgentBootState("running",true,true,false,true,100,0);
  check("listening".equals(running.optString("state"))&&ResidentAttachment.refusal(running,facts())==null,"valid current runtime must still attach");
  JSONObject starting=projectLocalAgentBootState("starting",false,true,true,false,0,0);
  check("booting".equals(starting.optString("state")),"ordinary cold start must stay booting");
  System.out.println("PASS actual boot projection -> startup refusal -> resident attach; live observations retained, no false shutdown");
 }
}`,
    );
    execFileSync(
      javaBinary("javac"),
      [
        "--release",
        "11",
        "-cp",
        jsonJar,
        "-d",
        temporary,
        join(
          root,
          "vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/ResidentAttachment.java",
        ),
        join(temporary, "NativeBootHarness.java"),
      ],
      { timeout: 60000 },
    );
    const output = execFileSync(
      javaBinary("java"),
      [
        "-cp",
        temporary + delimiter + jsonJar,
        "ai.elizaresearch.alphaphone.NativeBootHarness",
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    assert.match(
      output,
      /PASS actual boot projection -> startup refusal -> resident attach/,
    );
    assert.match(
      service,
      /currentStatus\s*=\s*"runtime-identity-unavailable";\s*appendDiagnosticEvent\("runtime-adoption-refused"/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
