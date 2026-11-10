# Alpha Phone R8 rules.
# Modelled on vendor/eliza/packages/app/platforms/android/app/proguard-rules.pro.
# Release builds are minified and resource-shrunk; mapping.txt is written to
# android/app/build/outputs/mapping/<variant>Release/mapping.txt and must be
# retained with every distributed release APK to symbolicate crash reports.

# Capacitor: the bridge resolves plugins, @PluginMethod, @PermissionCallback and
# @ActivityCallback members by reflection from the WebView.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.community.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Upstream elizaOS native plugins (camera, location, system, calendar, reminders,
# network policy). Their manifest components are instantiated by name.
-keep class ai.eliza.plugins.** { *; }
-keep class ai.elizaos.plugins.** { *; }

# Upstream NativeProcessSupervisor and Chromium browser-surface helpers are staged
# verbatim from the pinned checkout; keep their names and members intact.
-keep class ai.eliza.plugins.agent.runtime.NativeProcessSupervisor { *; }
-keep class ai.eliza.plugins.browsersurface.** { *; }

# Manifest components Android instantiates by class name.
-keep class ai.elizaresearch.alphaphone.MainActivity { *; }
-keep class ai.elizaresearch.alphaphone.AlphaAssistActivity { *; }
-keep class ai.elizaresearch.alphaphone.AlphaMailPdfActivity { *; }
-keep class ai.elizaresearch.alphaphone.ElizaAgentService { *; }
-keep class ai.elizaresearch.alphaphone.AlphaNotificationListener { *; }
-keep class ai.elizaresearch.alphaphone.ReminderReceiver { *; }
-keep class ai.elizaresearch.alphaphone.IsolatedPdfService { *; }
-keep class ai.elizaresearch.alphaphone.AlphaMailFileProvider { *; }

# WorkManager instantiates workers reflectively from persisted class names, so
# names must stay stable across app updates.
-keep class ai.elizaresearch.alphaphone.HostedDeliveryWorker { *; }
-keep class ai.elizaresearch.alphaphone.ElizaTasksWorker { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Pinned local-agent runtime staged by scripts/stage-local-agent-sources.ts.
# JNI symbol names (libelizavoicejni) depend on the exact class and method names,
# and the service resolves hidden platform APIs by reflection.
-keep class ai.elizaresearch.alphaphone.ElizaVoiceNative { *; }
-keep class ai.elizaresearch.alphaphone.ElizaBionicInferenceServer { *; }
-keep class ai.elizaresearch.alphaphone.BionicDecodeLoop { *; }
-keep class ai.elizaresearch.alphaphone.BionicDecodeLoop$* { *; }
-keep class ai.elizaresearch.alphaphone.BgeEmbeddingSession { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# Developer hooks are absent from release; registration is reflective and only
# attempted when BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS is true (debug + flag).

# WebView JavaScript interfaces.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# AndroidX (kept wholesale, as upstream does, because Capacitor and WebKit
# resolve several AndroidX entry points reflectively).
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# Kotlin coroutines (pulled in by upstream Kotlin plugins).
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# Crash-report symbolication.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses,EnclosingMethod
