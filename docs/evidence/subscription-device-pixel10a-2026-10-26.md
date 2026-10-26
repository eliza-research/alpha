# Subscription admission on a Pixel 10a — 2026-10-26

Issue [#410](https://github.com/AlphaCompute/alphaphone/issues/410). Device observation, not
acceptance: Cloud inference never bound, so no admitted AI turn, rate-limit refusal, latency or
audio-under-limit result exists from this run.

## Device and build

- Pixel 10a (`67091JEA313850`), `Alpha/alpha_stallion_phone/stallion:17/CP2A.260605.016/eng.shaw:userdebug/test-keys`.
- Alpha `0.1.0-native-ff9c826-v11` (pin `ff9c8264550efd64fd0119c6ff50f99eb8561977`), installed 2026-10-25.
- Signed in to production Eliza Cloud as the owner's account before this run (sign-in expires
  2026-11-24). No code was redeemed and no plan was changed.

## Observed

1. **Plan state.** Settings › Eliza Cloud account & plan shows the account and the plan
   "Eliza Cloud credits": Cloud reports no organization subscription with organization credits,
   which the contract admits as credit-funded inference (section 4). No balance or top-up is shown.
2. **Agent blocked by an interrupted evidence archive.** The resident never started:
   `agent-restart-diagnostics.jsonl` repeated `IPC recovery required: interrupted evidence archive
   requires review`. An owner-confirmed archive of the eight retained `ipc-recovery-*` directories
   (2026-10-25 08:23) had moved one directory and stopped, leaving `ipc-reviewed-pending-0e5a77bd…`.
   `IpcStartupRecovery` refuses startup while a pending archive exists, and the in-app review is
   offered only for the retention limit, so the phone had no in-app way out.
3. **Manual completion (this run).** The pending manifest (`review.json`, schema 1) listed the same
   eight directories; all 24 on-device entries matched it by name. Through `run-as`, the remaining
   seven directories were moved into the pending archive and it was renamed to
   `ipc-reviewed-0e5a77bd…`, the archive's own final step. Nothing was deleted. The resident then
   started ("Agent execution: On this device").
4. **Cloud inference cannot bind.** Native starts the resident unbound at app launch; binding Cloud
   inference needs one stop and restart. That stop is refused every time:
   `WorkflowSurvivorInventory.processIdentity` → `readlink /proc/<pid>/exe` fails with `ENOENT`
   (the resident exits during its own stop inventory), logged as `Resident stop identity unproven`.
   The service then stays "stopping" and Alpha reports "AI could not be connected to your Eliza
   Cloud plan: Shutdown is still pending" or "Local agent is stopping; wait for stopped status
   before starting." Reproduced three times (app start, Reconnect agent, cold start after
   force-stop). A cold start can also fail the identity read once with a `SocketException`
   (`ALPHA_TRANSPORT:IDENTITY:STATUS:-1`), shown as "Eliza Cloud cannot be reached"; Retry recovered.

## Fix and remaining

The stop race is fixed upstream on branch `fix/resident-stop-vanished-process` (commit
`d4964fada0`, based on elizaOS/eliza `develop` `04658de1b942`): `processes()` reads each identity
through the existing `observePresent` absence proof. A JVM run of `WorkflowSurvivorInventoryTest`
passes the new test; the one failing test (`expiredStopDeadline…`, `SystemClock` native) fails
identically on unmodified `develop` outside Gradle. It is not yet reviewed, merged or pinned, and
no build containing it has run on a device.

An interrupted owner-confirmed archive still has no in-app recovery; that is a separate upstream gap.
After the fix is pinned and installed: bind Cloud inference, send an AI turn, and record admission,
refusal and latency evidence on this device.
