package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.reset.DataReset;
import ai.eliza.plugins.system.reset.DataResetCopy;
import ai.eliza.plugins.system.reset.DataResetPlugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Alpha's installed plugin name. Native disclosure, fresh device credential, durable recording
 * and single bounded dispatch are the shared DataResetPlugin; renderer arguments authorize nothing. */
@CapacitorPlugin(name="AlphaReset")
public final class AlphaResetPlugin extends DataResetPlugin {
 @Override protected DataReset reset(){return AlphaDataReset.RESET;}
 @Override protected DataResetCopy copy(){return AlphaDataReset.COPY;}
}
