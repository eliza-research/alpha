package ai.elizaresearch.alphaphone;

import java.util.Map;

/** Plain-JVM checks for the Google connector return parser. */
public final class GoogleConnectReturnTest {
 private static int checks = 0;
 private static void check(boolean ok, String name) { checks++; if (!ok) throw new AssertionError(name); }
 public static void main(String[] args) {
  String state = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  check(state.length() == 43, "fixture state length");
  Map<String, String> fragment = GoogleConnectReturn.parse("state=" + state, "state=" + state + "&result=connected&connectionId=conn_1");
  check(fragment != null && "connected".equals(fragment.get("result")) && "conn_1".equals(fragment.get("connectionId")) && state.equals(fragment.get("state")), "fragment success");
  Map<String, String> denied = GoogleConnectReturn.parse(null, "state=" + state + "&result=denied");
  check(denied != null && "denied".equals(denied.get("result")) && !denied.containsKey("connectionId"), "fragment denied");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&result=denied&connectionId=x") == null, "denied carries no connection");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&result=connected") == null, "connected needs a connection");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&result=maybe") == null, "unknown result");
  check(GoogleConnectReturn.parse(null, "state=short&result=failed") == null, "short state");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&result=failed&extra=1") == null, "extra fragment key");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&state=" + state + "&result=failed") == null, "repeated key");
  Map<String, String> query = GoogleConnectReturn.parse("state=" + state + "&google_connected=true&platform=google&connection_id=abc-123", null);
  check(query != null && "connected".equals(query.get("result")) && "abc-123".equals(query.get("connectionId")), "query success");
  check(GoogleConnectReturn.parse("state=" + state + "&google_connected=true&platform=gmail&connection_id=abc", null) == null, "wrong platform");
  check(GoogleConnectReturn.parse("state=" + state + "&google_connected=true&platform=google&connection_id=abc&proof=x", null) == null, "extra query key");
  check(GoogleConnectReturn.parse("state=" + state, null) == null, "bare request URL is not a result");
  check(GoogleConnectReturn.parse(null, null) == null, "nothing");
  check(GoogleConnectReturn.parse("state=" + state + "&x=1", "state=" + state + "&result=failed") == null, "fragment with foreign query");
  check(GoogleConnectReturn.parse(null, "state=" + state + "&result=connected&connectionId=" + "a".repeat(129)) == null, "long connection id");
  check(GoogleConnectReturn.parse(null, "%zz=1") == null, "malformed encoding");
  System.out.println("PASS google connect return (" + checks + " checks)");
 }
}
