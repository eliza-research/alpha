package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.reset.DataReset;
import ai.eliza.plugins.system.reset.DataResetCopy;

/**
 * Alpha's registration of the shared reset coordinator (plugin-native-system reset.DataReset):
 * installed marker names, recovery component and process, product copy and the bounded work that
 * runs before Android's package-scoped clear (ResetBeforeDispatch: Alpha's own calendar, then Cloud
 * key revocation). Behavior (fresh device credential, durable marker, listener acknowledgement first,
 * bounded recovery and fail-closed admission before providers) is upstream; issue #409.
 */
final class AlphaDataReset {
 /** reset-alpha.pending/.failures and :reset_recovery are installed identities: an interrupted reset
  * from an earlier build must still resume, so they never change. */
 static final DataReset RESET=DataReset.builder("reset-alpha",ResetRecoveryActivity.class)
  .recoveryProcessSuffix(ResetRecoveryActivity.PROCESS_SUFFIX).logTag("AlphaReset")
  .beforeDispatch(ResetBeforeDispatch.STEP).build();
 static final DataResetCopy COPY=DataResetCopy.forProduct("Alpha")
  .disclosure("Permanently delete Alpha's local conversations, Notes and drafts, passwords, settings, downloads in Alpha's private storage, and sign-ins. When Alpha has Calendar access, its \"On this phone\" calendar and events are deleted too. Stop its agent and pending work. There is no backup or undo.\n\nAlpha also asks Cloud to revoke this phone's sign-in when Cloud can be reached. Device-wide photos and files, remote Gmail and Cloud data, and your Cloud plan are not deleted or cancelled. Other apps are not reset. Alpha will close; open it again to start fresh.")
  .progressMessage("Finishing up… Alpha closes in a few seconds.")
  .recoveryRemoteNote("(Alpha may already have asked Cloud to revoke this phone's sign-in.)").build();
 private AlphaDataReset(){}
}
