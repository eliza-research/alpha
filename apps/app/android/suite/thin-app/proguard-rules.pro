-keep class ai.alphacompute.thinapp.** { *; }
-keep class ai.alphacompute.runtime.** { *; }
-keep class ai.alphacompute.ipc.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
