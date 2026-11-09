package android.content;

import java.util.HashMap;
import java.util.Map;

/** The ContentValues subset used by the provider assertions and mutation fixtures. */
public final class ContentValues {
 private final Map<String,Object> values = new HashMap<>();

 public void put(String key, Integer value) { values.put(key, value); }
 public void put(String key, Long value) { values.put(key, value); }
 public void put(String key, String value) { values.put(key, value); }
 public void putNull(String key) { values.put(key, null); }
 public int size() { return values.size(); }
 public Object get(String key) { return values.get(key); }

 public String getAsString(String key) {
  Object value = get(key);
  return value == null ? null : value.toString();
 }

 public Long getAsLong(String key) {
  Object value = get(key);
  if (value == null) return null;
  return value instanceof Number ? ((Number) value).longValue() : Long.valueOf(value.toString());
 }
}
