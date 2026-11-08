package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.reset.DataReset;
import ai.eliza.plugins.system.reset.DataResetCopy;
import ai.eliza.plugins.system.reset.DataResetRecoveryActivity;

/**
 * Alpha's installed recovery component for a confirmed reset that could not finish (issue #409).
 * The manifest keeps it unexported in its own {@link #PROCESS_SUFFIX} process, which installs none
 * of Alpha's content providers and starts no agent, renderer, listener or notification code. The
 * surface (never a completion claim, fresh retry, listener settings, Phone, Android Settings) is
 * the shared DataResetRecoveryActivity.
 */
public final class ResetRecoveryActivity extends DataResetRecoveryActivity {
 static final String PROCESS_SUFFIX=":reset_recovery";
 @Override protected DataReset reset(){return AlphaDataReset.RESET;}
 @Override protected DataResetCopy copy(){return AlphaDataReset.COPY;}
}
