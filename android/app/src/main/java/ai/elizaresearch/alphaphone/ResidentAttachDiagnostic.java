package ai.elizaresearch.alphaphone;

/** Content-free classification of one failed attach. Never stores exception text. */
final class ResidentAttachDiagnostic {
  enum Stage { TOKEN, STATUS, ENROLLMENT }
  Stage stage = Stage.TOKEN;
  private int status;

  void response(int value) { status = value >= 100 && value <= 599 ? value : 0; }

  String failure(Throwable error) {
    String kind = error instanceof java.net.SocketTimeoutException ? "SocketTimeoutException"
      : error instanceof java.io.IOException ? "IOException"
      : error instanceof SecurityException ? "SecurityException"
      : error instanceof IllegalStateException ? "IllegalStateException"
      : error instanceof org.json.JSONException ? "JSONException" : "Exception";
    return "category=resident-attach method=GET stage=" + stage.name().toLowerCase(java.util.Locale.ROOT)
      + " status=" + status + " errorClass=" + kind;
  }
}
