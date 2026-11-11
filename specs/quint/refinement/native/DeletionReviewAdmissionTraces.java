package ai.alphacompute.alphaphone;

import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/** Enumerates four-call histories using the actual review token and returned results. */
public final class DeletionReviewAdmissionTraces {
 static JSONObject observe(DeletionReviewAdmission token, int admissions, int settlements, boolean returned) throws Exception {
  int state = ((AtomicInteger) Trace.read(token, "state")).get();
  String phase = switch (state) {
   case 0 -> "queued";
   case 1 -> "admitted";
   case 2 -> "retired";
   default -> throw new AssertionError("Unknown review token state " + state);
  };
  return Trace.fields("phase", phase, "admissions", admissions, "settlements", settlements, "returned", returned);
 }
 public static void main(String[] args) throws Exception {
  JSONArray traces = new JSONArray();
  String[] operations = {"admit", "retire", "settle"};
  for (int sequence = 0; sequence < 81; sequence++) {
   DeletionReviewAdmission token = new DeletionReviewAdmission();
   Trace trace = new Trace("review lease sequence " + sequence, observe(token, 0, 0, false));
   int encoded = sequence, admissions = 0, settlements = 0;
   boolean returned = false;
   for (int step = 0; step < 4; step++, encoded /= operations.length) {
    String action = operations[encoded % operations.length];
    switch (action) {
     case "admit" -> {returned = token.admit(); if (returned) admissions++;}
     case "retire" -> token.retire();
     case "settle" -> {returned = token.settle(); if (returned) settlements++;}
     default -> throw new AssertionError(action);
    }
    trace.step(action, observe(token, admissions, settlements, returned));
   }
   traces.put(trace.value);
  }
  System.out.println(traces);
 }
}
