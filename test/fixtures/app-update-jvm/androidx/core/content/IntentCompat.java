package androidx.core.content;
public final class IntentCompat {public static <T> T getParcelableExtra(android.content.Intent in,String name,Class<T> type){return type.cast(in.extra(name));}}
