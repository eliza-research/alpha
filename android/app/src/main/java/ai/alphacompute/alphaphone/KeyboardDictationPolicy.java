package ai.alphacompute.alphaphone;

/** A dictation result belongs to one editor and one explicit capture, never the next field. */
final class KeyboardDictationPolicy {
 enum State { READY, RECORDING, TRANSCRIBING, CLOSED }
 private long generation;
 private String recordingId;
 private State state = State.CLOSED;
 long open() { recordingId = null; state = State.READY; return ++generation; }
 boolean bindRecording(long ticket, String id) {
  if (!is(ticket, State.RECORDING) || id == null || id.isEmpty()) return false;
  recordingId = id; return true;
 }
 boolean ownsRecording(String id) { return state == State.RECORDING && recordingId != null && recordingId.equals(id); }
 long start() {
  if (state != State.READY) throw new IllegalStateException("Dictation is busy");
  recordingId = null; state = State.RECORDING; return ++generation;
 }
 boolean stop(long ticket) {
  if (!is(ticket, State.RECORDING)) return false;
  state = State.TRANSCRIBING; return true;
 }
 boolean finish(long ticket, boolean sameField, boolean sameAuthority) {
  if (!is(ticket, State.TRANSCRIBING) || !sameField || !sameAuthority) return false;
  close(); return true;
 }
 boolean is(long ticket, State expected) { return ticket == generation && state == expected; }
 void close() { recordingId = null; ++generation; state = State.CLOSED; }
 State state() { return state; }
 static boolean usesDirect(String provider, boolean unbound) {
  if (unbound || !("cerebras".equals(provider) || "elizacloud".equals(provider))) throw new IllegalStateException("Choose a voice provider in Alpha");
  return "cerebras".equals(provider);
 }
 static boolean permitted(int inputType, int imeOptions) {
  int kind = inputType & 0xf, variation = inputType & 0xff0;
  return inputType != 0 && (imeOptions & 0x1000000) == 0
    && !(kind == 1 && (variation == 0x80 || variation == 0x90 || variation == 0xe0))
    && !(kind == 2 && variation == 0x10);
 }
}
