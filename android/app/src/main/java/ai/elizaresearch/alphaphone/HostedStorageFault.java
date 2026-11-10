package ai.elizaresearch.alphaphone;
/** Storage recovery is explicit; never reset the inbox client ID on corruption. */
final class HostedStorageFault extends Exception {HostedStorageFault(Throwable cause){super("Encrypted result storage unavailable",cause);}}
