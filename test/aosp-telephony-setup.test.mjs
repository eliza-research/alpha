import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { jvmSkip, root, runJvm } from "./fixtures/jvm-tools.mjs";

const launcher = path.join(root, "android/app/src/launcher");
const packageName = "ai.alphacompute.alphaphone";
const java = path.join(launcher, "java", ...packageName.split("."));

test("fresh telephony preparation is a privileged, explicit launcher receiver", () => {
  const manifest = flavor => fs.readFileSync(path.join(root, "android/app/src", flavor, "AndroidManifest.xml"), "utf8");
  assert.match(manifest("launcher"), /<receiver android:name="\.AlphaTelephonySetupReceiver" android:exported="true"\s+android:permission="android\.permission\.MANAGE_ROLE_HOLDERS" \/>/);
  assert.doesNotMatch(manifest("main"), /AlphaTelephonySetupReceiver/);
  assert.doesNotMatch(manifest("launcher"), /<uses-permission[^>]*MANAGE_ROLE_HOLDERS/);
});

test("fresh telephony preparation acknowledges only complete image component readback", { skip: jvmSkip("javac") }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-telephony-setup-"));
  try {
    // Replay the production receiver and component synchronizer with host stand-ins for Android.
    const sources = {
      "Activity.java": `package android.app;
        public class Activity { public static final int RESULT_OK = -1, RESULT_CANCELED = 0; }`,
      "BroadcastReceiver.java": `package android.content;
        public abstract class BroadcastReceiver {
          public boolean ordered = true;
          public int result = -1;
          public boolean isOrderedBroadcast() { return ordered; }
          public void setResultCode(int code) {
            if (!ordered) throw new AssertionError("unordered result");
            result = code;
          }
          public abstract void onReceive(Context context, Intent intent);
        }`,
      "ComponentName.java": `package android.content;
        public class ComponentName {
          public final Class<?> type;
          public ComponentName(Context context, Class<?> type) { this.type = type; }
        }`,
      "Context.java": `package android.content;
        import android.content.pm.PackageManager;
        public class Context {
          public boolean image;
          public final PackageManager packages = new PackageManager();
          public PackageManager getPackageManager() { return packages; }
        }`,
      "Intent.java": `package android.content;
        public class Intent {
          private final String action;
          public Intent(String action) { this.action = action; }
          public String getAction() { return action; }
        }`,
      "PackageManager.java": `package android.content.pm;
        import android.content.ComponentName;
        import java.util.HashMap;
        import java.util.Map;
        public class PackageManager {
          public static final int COMPONENT_ENABLED_STATE_DEFAULT = 0, COMPONENT_ENABLED_STATE_ENABLED = 1, DONT_KILL_APP = 1;
          public final Map<Class<?>, Integer> states = new HashMap<>();
          public Class<?> denied, ignored;
          public int writes;
          public int getComponentEnabledSetting(ComponentName component) { return states.getOrDefault(component.type, 0); }
          public void setComponentEnabledSetting(ComponentName component, int wanted, int flags) {
            if (flags != DONT_KILL_APP) throw new AssertionError("setup must keep the receiver alive");
            if (component.type == denied) throw new SecurityException();
            if (component.type != ignored) states.put(component.type, wanted);
            writes++;
          }
        }`,
      "Log.java": `package android.util;
        public class Log {
          public static void w(String tag, String message) {}
          public static void w(String tag, String message, Throwable error) {}
        }`,
      "MmsFileProvider.java": "package ai.eliza.plugins.messages; public class MmsFileProvider {}",
      "TelephonySetupHarness.java": `package ${packageName};
        import android.app.Activity;
        import android.content.Context;
        import android.content.Intent;
        class AlphaImageCapability { static boolean verified(Context context) { return context.image; } }
        class AlphaInCallService {}
        class AlphaCallActivity {}
        class AlphaDialPadActivity {}
        class AlphaSmsDeliverReceiver {}
        class AlphaMmsWapPushReceiver {}
        class AlphaMmsResultReceiver {}
        class AlphaRespondViaMessageService {}
        class AlphaSmsComposeActivity {}
        public class TelephonySetupHarness {
          private static void check(boolean condition, String message) {
            if (!condition) throw new AssertionError(message);
          }
          public static void main(String[] args) {
            var receiver = new AlphaTelephonySetupReceiver();
            var context = new Context();
            var prepare = new Intent("${packageName}.action.PREPARE_TELEPHONY_ROLES");
            receiver.onReceive(context, prepare);
            check(receiver.result == Activity.RESULT_CANCELED && context.packages.writes == 0, "stock must refuse setup");
            context.image = true;
            receiver.onReceive(context, new Intent("other"));
            receiver.onReceive(context, null);
            check(receiver.result == Activity.RESULT_CANCELED && context.packages.writes == 0, "action must match");
            receiver.ordered = false;
            receiver.onReceive(context, prepare);
            check(context.packages.writes == 0, "setup must be ordered");
            receiver.ordered = true;
            context.packages.denied = AlphaInCallService.class;
            context.packages.ignored = AlphaSmsComposeActivity.class;
            receiver.onReceive(context, prepare);
            check(receiver.result == Activity.RESULT_CANCELED && context.packages.states.size() == 7, "partial enablement must fail");
            context.packages.denied = null;
            receiver.onReceive(context, prepare);
            check(receiver.result == Activity.RESULT_CANCELED && context.packages.states.size() == 8, "ignored write must fail readback");
            context.packages.ignored = null;
            receiver.onReceive(context, prepare);
            check(receiver.result == Activity.RESULT_OK && context.packages.states.size() == 9, "complete retry must succeed");
            check(context.packages.states.values().stream().allMatch(state -> state == 1), "all components must be enabled");
            int writes = context.packages.writes;
            receiver.onReceive(context, prepare);
            check(receiver.result == Activity.RESULT_OK && context.packages.writes == writes, "repeated preparation is idempotent");
            context.image = false;
            AlphaTelephonyRoles.sync(context);
            check(context.packages.states.values().stream().allMatch(state -> state == 0), "launcher still restores stock defaults");
          }
        }`,
    };
    const files = Object.entries(sources).map(([name, source]) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, source);
      return file;
    });
    runJvm([...files, path.join(java, "AlphaTelephonyRoles.java"), path.join(java, "AlphaTelephonySetupReceiver.java")],
      `${packageName}.TelephonySetupHarness`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
