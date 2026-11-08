package ai.elizaresearch.alphaphone;

import com.getcapacitor.annotation.CapacitorPlugin;

/** Legacy plugin name and package identity; behavior is owned by upstream ElizaSense. The reset
 * coordinator reaches the same-signer listener through upstream SenseListenerClient directly. */
@CapacitorPlugin(name="AlphaListener")
public final class AlphaListenerPlugin extends ai.eliza.plugins.system.SensePlugin {}
