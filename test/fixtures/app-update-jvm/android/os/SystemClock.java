package android.os;
/** Controlled boot uptime; ordinary scenarios begin outside Android's first-update throttle. */
public final class SystemClock {
 public static volatile long uptime=35_000L;
 public static long uptimeMillis(){return uptime;}
}
