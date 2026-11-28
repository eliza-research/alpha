// spec/app/voice/index.md, "Story: Hold a spoken conversation"; spec/app/voice/route.md, "Story: Choose where speech is processed"; spec/app/platform/index.md, "Story: Reach the phone's native capabilities"
package ai.alphacompute.alphaphone;

import ai.eliza.plugins.passwords.PasswordSurfaces;
import ai.eliza.plugins.signin.CredentialJson;
import ai.eliza.plugins.signin.CredentialReader;
import ai.eliza.plugins.signin.DeviceCustody;
import ai.eliza.plugins.signin.SignInRegistration;
import ai.eliza.voice.SpeechStreamBridgePlugin;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashMap;
import java.util.Map;

/**
 * eliza's Cloud speech relay under Alpha's identity: the reviewed origin and the signed-in key of each cloud
 * the sign-in registration names, read from the phone's own custody, and a session that ends as soon as a
 * password surface opens.
 */
@CapacitorPlugin(name = "ElizaCloudSpeech", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class AlphaCloudSpeechPlugin extends SpeechStreamBridgePlugin {
 private static final String SIGN_IN = "ElizaSignIn";
 private AlphaCloudSpeechAuthority authority;
 private final PasswordSurfaces.Listener secretSurface = visible -> { if (visible) retireSpeechAuthority(); };

 @Override public void load() {
  super.load();
  authority = new AlphaCloudSpeechAuthority(origins(), origin -> DeviceCustody.reader(getContext(), origin), PasswordSurfaces::visible);
  PasswordSurfaces.addListener(secretSurface);
 }

 @Override protected void handleOnDestroy() {
  PasswordSurfaces.removeListener(secretSurface);
  super.handleOnDestroy();
  if (authority != null) authority.close();
 }

 @Override protected String cloudOrigin(String environment) { return authority.origin(environment); }

 @Override protected Credential readCredential(String environment, String expectedId, long epoch) {
  CredentialReader.Credential key = authority.read(environment, expectedId, epoch);
  return new Credential(key.value(), key.keyExpiresAt());
 }

 @Override protected long authorityEpoch() { return authority.epoch(); }

 @Override protected boolean sensitiveSurfaceActive() { return PasswordSurfaces.visible(); }

 @Override protected void credentialRefused(String environment, String credentialId, String reason) { authority.refused(environment, credentialId, reason); }

 void cancelReadingSpeech(String requestId) {
  if (requestId == null || requestId.isBlank()) return;
  retireSpeechAuthority();
 }

 @Override protected String diagnosticFormat() { return "alpha-cloud-stream-timing-v1"; }

 void onOverlayResume() { handleOnResume(); }
 void onOverlayPause() { handleOnPause(); }
 void onOverlayDestroy() { handleOnDestroy(); }

 private Map<String, String> origins() {
  Map<String, String> origins = new HashMap<>();
  try {
   com.getcapacitor.Bridge bridge = getBridge();
   com.getcapacitor.CapConfig capConfig = bridge == null ? null : bridge.getConfig();
   com.getcapacitor.PluginConfig pluginConfig = capConfig == null ? null : capConfig.getPluginConfiguration(SIGN_IN);
   org.json.JSONObject json = pluginConfig == null ? null : pluginConfig.getConfigJSON();
   if (json == null) json = loadSignInConfigFromAssets();
   if (json != null) {
    String config = json.toString();
    for (SignInRegistration.Environment environment : SignInRegistration.parse(CredentialJson.object(CredentialJson.parse(config), SIGN_IN)).environments())
     origins.put(environment.name, environment.apiOrigin);
   }
  } catch (IllegalArgumentException | NullPointerException refused) {
   origins.clear();
  }
  if (origins.isEmpty() && BuildConfig.CLOUD_API_ORIGIN != null && !BuildConfig.CLOUD_API_ORIGIN.isBlank()) {
   origins.put("production", BuildConfig.CLOUD_API_ORIGIN);
  }
  return origins;
 }

 private org.json.JSONObject loadSignInConfigFromAssets() {
  try (java.io.InputStream in = getContext().getAssets().open("capacitor.config.json")) {
   byte[] bytes = AlphaUtil.readBounded(in, 256 * 1024, null);
   org.json.JSONObject root = new org.json.JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
   org.json.JSONObject plugins = root.optJSONObject("plugins");
   return plugins == null ? null : plugins.optJSONObject(SIGN_IN);
  } catch (Exception unavailable) {
   return null;
  }
 }
}
