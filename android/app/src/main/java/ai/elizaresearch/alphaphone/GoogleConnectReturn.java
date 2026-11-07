package ai.elizaresearch.alphaphone;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pure parsing of Eliza Cloud's Google connector return (no Android classes; runs on a plain JVM).
 *
 * Alpha starts the connector with redirectUrl {@code https://<appLinkHost>/alphaphone/google/return?state=S}.
 * Cloud answers in one of two shapes:
 * <ul>
 *  <li>with {@code APP_OAUTH_RETURN_URLS} configured: the fragment {@code #state=S&result=connected|denied|failed[&connectionId=C]};</li>
 *  <li>otherwise (success only): the query {@code ?state=S&google_connected=true&platform=google&connection_id=C}.</li>
 * </ul>
 * The result carries no secret: the grant itself stays in Cloud and Alpha reads it back.
 */
final class GoogleConnectReturn {
 private GoogleConnectReturn() {}
 static final String PATH = "/alphaphone/google/return";
 private static final String STATE = "[A-Za-z0-9_-]{43}";
 private static final String CONNECTION = "[A-Za-z0-9_-]{1,128}";

 /** {state, result, connectionId?} or null for anything that is not exactly one of the two shapes. */
 static Map<String, String> parse(String encodedQuery, String encodedFragment) {
  Map<String, String> fragment = params(encodedFragment), query = params(encodedQuery);
  if (fragment == null || query == null) return null;
  Map<String, String> out = new LinkedHashMap<>();
  if (!fragment.isEmpty()) {
   if (!query.isEmpty() && !(query.size() == 1 && query.containsKey("state"))) return null;
   String state = fragment.get("state"), result = fragment.get("result"), connection = fragment.get("connectionId");
   if (state == null || !state.matches(STATE) || result == null) return null;
   if (!fragment.keySet().stream().allMatch(k -> k.equals("state") || k.equals("result") || k.equals("connectionId"))) return null;
   if (!result.equals("connected") && !result.equals("denied") && !result.equals("failed")) return null;
   if (result.equals("connected") != (connection != null)) return null;
   if (connection != null && !connection.matches(CONNECTION)) return null;
   out.put("state", state); out.put("result", result); if (connection != null) out.put("connectionId", connection);
   return out;
  }
  String state = query.get("state"), connection = query.get("connection_id");
  if (state == null || !state.matches(STATE)) return null;
  if (!"true".equals(query.get("google_connected")) || !"google".equals(query.get("platform"))) return null;
  if (connection == null || !connection.matches(CONNECTION)) return null;
  if (!query.keySet().stream().allMatch(k -> k.equals("state") || k.equals("google_connected") || k.equals("platform") || k.equals("connection_id"))) return null;
  out.put("state", state); out.put("result", "connected"); out.put("connectionId", connection);
  return out;
 }

 /** Decoded parameters; null when a name repeats or the input is malformed; empty for no input. */
 private static Map<String, String> params(String encoded) {
  Map<String, String> out = new LinkedHashMap<>();
  if (encoded == null || encoded.isEmpty()) return out;
  if (encoded.length() > 2048) return null;
  try {
   for (String pair : encoded.split("&", -1)) {
    int eq = pair.indexOf('=');
    if (eq <= 0) return null;
    String name = URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8.name());
    String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8.name());
    if (out.put(name, value) != null) return null;
   }
  } catch (Exception malformed) { return null; }
  return out;
 }
}
