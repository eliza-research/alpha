package ai.elizaresearch.alphaphone;

import java.io.IOException;

/** Production Cloud speech admission; developer pairing has a separate policy. */
final class CloudSpeechPolicy {
 private CloudSpeechPolicy() {}
 static String host(String profile, boolean mocks, String environment) throws IOException {
  if (!mocks && !"cloud".equals(profile)) throw new IOException("Network speech is not enabled");
  if ("production".equals(environment)) return CloudDeployment.PRODUCTION_API_HOST;
  if (mocks && "staging".equals(environment)) return CloudDeployment.STAGING_API_HOST;
  throw new IOException("Cloud speech environment is unavailable");
 }
 static void requireProvider(String profile, String provider) throws IOException {
  if ("cloud".equals(profile) && !"cartesia".equals(provider)) throw new IOException("Cartesia speech is unavailable");
 }
}
