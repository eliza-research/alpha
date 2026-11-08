import assert from "node:assert/strict";

export const between = (text, start, end) => {
  const from = text.indexOf(start),
    to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end} located`);
  return text.slice(from, to);
};
/** Exact production methods exercised by the shared chain and source-refinement fixtures. */
export function chainMethods(plugin) {
  return {
    ACTUAL_CREDENTIAL_IDENTITY: between(
      plugin,
      " @PluginMethod public void credentialIdentity(",
      " /**\n  * Called once when an explicit attempt",
    ).replace("@PluginMethod ", ""),
    ACTUAL_CALLER_REQUEST: between(
      plugin,
      " private static String callerRequestId(",
      " @PluginMethod public void startGoogle(",
    ),
    ACTUAL_CANCEL: between(
      plugin,
      " @PluginMethod public void cancel(",
      " /** Post-authentication consent",
    ).replace("@PluginMethod ", ""),
    ACTUAL_START_CODE: between(
      plugin,
      " @PluginMethod public void startEmail(",
      " /** Check registration and tenant SMS policy",
    ).replaceAll("@PluginMethod ", ""),
    ACTUAL_CALLBACK: between(
      plugin,
      " private boolean captureCallback(",
      " /** Retire only the captured record",
    ),
    ACTUAL_BROWSER_LIFECYCLE: between(
      plugin,
      " @Override protected void handleOnPause()",
      " @Override protected void handleOnDestroy()",
    ),
    ACTUAL_BURN: between(
      plugin,
      " private void burnUnclaimedPending(Attempt owner)",
      " // ── Email code and MFA:",
    ),
    ACTUAL_VERIFY:
      between(
        plugin,
        " private void verify(PluginCall call, boolean mfa)",
        " private void release(",
      ) +
      between(
        plugin,
        " private void completeOrRequireMfa(",
        " // ── Shared tail:",
      ),
    ACTUAL_RELEASE: between(
      plugin,
      " private void release(",
      " /** A retained MFA event",
    ),
    ACTUAL_COMPLETE: between(
      plugin,
      " private void complete(",
      " /** The saved key",
    ),
    ACTUAL_PREVIOUS_TOKEN: between(
      plugin,
      " private static String previousToken(",
      " /** Bounded retry",
    ),
    ACTUAL_ACK: between(
      plugin,
      " private boolean acknowledge(",
      " /** A key stored before",
    ),
    ACTUAL_RESUME_ACKS: between(
      plugin,
      " private void resumeAcknowledgements()",
      " // ── Outcomes and transport",
    ),
    ACTUAL_DESTROY: between(
      plugin,
      " @Override protected void handleOnDestroy()",
      " private void run(Runnable task)",
    ),
    ACTUAL_OUTCOMES: between(
      plugin,
      " private void finish(",
      " /** Cloud refusing",
    ),
    ACTUAL_INSTANT: between(
      plugin,
      " private static long instant(",
      " private Response post(",
    ),
  };
}

export function injectMethods(template, methods) {
  let source = template;
  for (const [name, body] of Object.entries(methods)) {
    assert.ok(body, name);
    const marker = `/* ${name} */`;
    assert.equal(source.split(marker).length, 2, `One harness marker for ${name}`);
    source = source.replace(marker, body.replace(/^ private (static )?/gm, " $1"));
  }
  return source;
}
