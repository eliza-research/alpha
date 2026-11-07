package ai.elizaresearch.alphaphone;

public final class ResidentAttachDiagnosticTest {
  static final String SECRET = "Bearer-private-token owner-private body-private";
  static final class PrivateOwnerException extends Exception {
    PrivateOwnerException() { super(SECRET); }
    @Override public String toString() { throw new AssertionError("Exception text must not be read"); }
    @Override public String getMessage() { throw new AssertionError("Exception message must not be read"); }
  }
  static void equal(String actual, String expected) {
    if (!actual.equals(expected)) throw new AssertionError(actual);
  }
  public static void main(String[] args) throws Exception {
    ResidentAttachDiagnostic probe = new ResidentAttachDiagnostic();
    equal(probe.failure(new PrivateOwnerException()),
      "category=resident-attach method=GET stage=token status=0 errorClass=Exception");
    probe.stage = ResidentAttachDiagnostic.Stage.STATUS;
    for (int status : new int[]{200,401,403,503}) {
      probe.response(status);
      String line = probe.failure(new org.json.JSONException(SECRET));
      equal(line,"category=resident-attach method=GET stage=status status="+status+" errorClass=JSONException");
      if (line.contains(SECRET)) throw new AssertionError("Diagnostic leaked content");
    }
    for (int invalid : new int[]{-1,0,99,600,Integer.MAX_VALUE}) {
      probe.response(invalid);
      equal(probe.failure(new java.net.SocketTimeoutException(SECRET)),
        "category=resident-attach method=GET stage=status status=0 errorClass=SocketTimeoutException");
    }
    probe.stage = ResidentAttachDiagnostic.Stage.ENROLLMENT;
    probe.response(200);
    equal(probe.failure(new IllegalStateException(SECRET)),
      "category=resident-attach method=GET stage=enrollment status=200 errorClass=IllegalStateException");
    System.out.println("PASS content-free resident attach diagnostic");
  }
}
