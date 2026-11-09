package ai.alphacompute.alphaphone;

import java.lang.reflect.Field;
import org.json.JSONArray;
import org.json.JSONObject;

/** Serialization and read-only observation. No implementation policy is evaluated here. */
public final class Trace {
 public final JSONObject value;
 final JSONArray steps = new JSONArray();
 public Trace(String name, JSONObject initial) {
  value = new JSONObject().put("name", name).put("init", action("init")).put("expect", initial).put("steps", steps);
 }
 public static JSONObject action(String name, Object... args) { return new JSONObject().put("name", name).put("args", new JSONArray(args)); }
 public void step(String name, JSONObject observation, Object... args) {
  steps.put(new JSONObject().put("label", name).put("action", action(name, args)).put("expect", observation));
 }
 public void macro(String label, JSONObject observation, JSONObject... actions) {
  steps.put(new JSONObject().put("label", label).put("action", new JSONArray(actions)).put("expect", observation));
 }
 public void stutter(String label, JSONObject observation) {
  steps.put(new JSONObject().put("label", label).put("action", JSONObject.NULL).put("expect", observation));
 }
 public static JSONObject fields(Object... pairs) {
  JSONObject out = new JSONObject();
  for (int i = 0; i < pairs.length; i += 2) out.put("s." + pairs[i], pairs[i + 1]);
  return out;
 }
 public static Object read(Object instance, String fieldName) throws Exception {
  for (Class<?> type = instance.getClass(); type != null; type = type.getSuperclass()) {
   try {
    Field field = type.getDeclaredField(fieldName);
    field.setAccessible(true);
    return field.get(instance);
   } catch (NoSuchFieldException missing) { /* The shared implementation can own this field. */ }
  }
  throw new NoSuchFieldException(fieldName);
 }
}
