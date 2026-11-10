package ai.alphacompute.alphaphone;

import java.io.IOException;

/** Production Cloud speech admission; developer pairing has a separate policy.
 * Every build packages on-device speech and may use Cloud speech: the renderer chooses the
 * route at run time, and native code admits only the production host and Cartesia. */
final class CloudSpeechPolicy {
 private CloudSpeechPolicy() {}
 static String host(boolean mocks, String environment) throws IOException {
  if ("production".equals(environment)) return CloudDeployment.PRODUCTION_API_HOST;
  if (mocks && "staging".equals(environment)) return CloudDeployment.STAGING_API_HOST;
  throw new IOException("Cloud speech environment is unavailable");
 }
 static void requireProvider(String provider) throws IOException {
  if (!"cartesia".equals(provider)) throw new IOException("Cartesia speech is unavailable");
 }
}
