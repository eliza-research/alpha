// spec/app/assistant/composer.md, "A write that lands clears any sending mark, and one that finds another revision stops until both texts are kept or the message it marks is checked"
package ai.alphacompute.alphaphone;

import org.json.JSONException;
import org.json.JSONObject;

/** The draft rows Ask Alpha may write to its slot: a revision, a text and a sending flag, and beside a sending mark the message it last sent. */
final class AlphaDraftRow {
 private static final long MAX_REVISION = 9_007_199_254_740_991L;
 private static final String[] MARK = {"lastSentId", "lastSentWire"};

 private AlphaDraftRow() {}

 /** Whether {@code next} is a row Ask Alpha writes: a whole revision from 1, a text, a sending flag, and only on a sending mark a string {@code lastSentId} and {@code lastSentWire}. */
 static boolean admits(String next) {
  try {
   JSONObject row = new JSONObject(next);
   Object revision = row.opt("revision");
   if (!(revision instanceof Integer || revision instanceof Long)
     || row.getLong("revision") < 1 || row.getLong("revision") > MAX_REVISION
     || !(row.opt("sending") instanceof Boolean sending) || !(row.opt("text") instanceof String)) return false;
   int extra = 0;
   for (String key : MARK) {
    if (!row.has(key)) continue;
    if (!sending || !(row.opt(key) instanceof String)) return false;
    extra += 1;
   }
   return row.length() == 3 + extra;
  } catch (JSONException malformed) {
   return false;
  }
 }
}
