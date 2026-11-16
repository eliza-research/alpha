package ai.eliza.plugins.passwords;

import ai.eliza.plugins.securestore.nativeonly.PasswordVaultFrame;
import android.hardware.biometrics.BiometricPrompt;
import android.os.SystemClock;
import android.security.keystore.KeyInfo;
import com.getcapacitor.PluginCall;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.InvalidKeyException;
import java.security.Key;
import java.security.KeyStoreSpi;
import java.security.Provider;
import java.security.Security;
import java.security.cert.Certificate;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.KeySpec;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactorySpi;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

public final class VaultReadbackTraces {
  private static final String SYNTHETIC_PASSWORD = "synthetic-vault-readback-secret";
  private static final Map<String, Key> keys = new HashMap<>();
  private static PasswordsConfig config;

  /** Only this disposable host JVM sees this provider. It cannot create or access device keys. */
  public static final class FixtureProvider extends Provider {
    public FixtureProvider() {
      super("AndroidKeyStore", "1", "In-memory vault replay key registry");
      put("KeyStore.AndroidKeyStore", FixtureKeys.class.getName());
      put("SecretKeyFactory.AES", FixtureKeySpec.class.getName());
    }
  }

  public static final class FixtureKeys extends KeyStoreSpi {
    @Override public Key engineGetKey(String alias, char[] password) { return keys.get(alias); }
    @Override public boolean engineContainsAlias(String alias) { return keys.containsKey(alias); }
    @Override public void engineDeleteEntry(String alias) { keys.remove(alias); }
    @Override public Enumeration<String> engineAliases() { return Collections.enumeration(keys.keySet()); }
    @Override public int engineSize() { return keys.size(); }
    @Override public boolean engineIsKeyEntry(String alias) { return keys.containsKey(alias); }
    @Override public boolean engineIsCertificateEntry(String alias) { return false; }
    @Override public void engineLoad(InputStream input, char[] password) {
      check(input == null && password == null, "External key store input");
    }
    @Override public void engineStore(OutputStream output, char[] password) { throw new AssertionError(); }
    @Override public void engineSetKeyEntry(String alias, Key key, char[] password, Certificate[] chain) { throw new AssertionError(); }
    @Override public void engineSetKeyEntry(String alias, byte[] key, Certificate[] chain) { throw new AssertionError(); }
    @Override public void engineSetCertificateEntry(String alias, Certificate cert) { throw new AssertionError(); }
    @Override public Certificate[] engineGetCertificateChain(String alias) { throw new AssertionError(); }
    @Override public Certificate engineGetCertificate(String alias) { throw new AssertionError(); }
    @Override public Date engineGetCreationDate(String alias) { throw new AssertionError(); }
    @Override public String engineGetCertificateAlias(Certificate cert) { throw new AssertionError(); }
  }

  public static final class FixtureKeySpec extends SecretKeyFactorySpi {
    @Override protected KeySpec engineGetKeySpec(SecretKey key, Class<?> type) {
      check(type == KeyInfo.class && keys.get(config.alias) == key, "Unexpected fixture key");
      return new KeyInfo(config.unlockSeconds, config.biometric);
    }
    @Override protected SecretKey engineGenerateSecret(KeySpec spec) throws InvalidKeySpecException {
      throw new InvalidKeySpecException("Fixture keys are pre-seeded");
    }
    @Override protected SecretKey engineTranslateKey(SecretKey key) throws InvalidKeyException {
      throw new InvalidKeyException("Fixture keys are pre-seeded");
    }
  }

  private static void check(boolean value, String fixedMessage) {
    if (!value) throw new AssertionError(fixedMessage);
  }

  private final PasswordsPlugin bridge = new PasswordsPlugin();
  private final PasswordVaultAccess access;
  private final JSONArray steps = new JSONArray();
  private final Path file;
  private final Path sibling;
  private final byte[] frame;

  private VaultReadbackTraces(Path sandbox) throws Exception {
    check(Security.getProvider("AndroidKeyStore") == null, "Expected an isolated host JVM");
    check(Security.addProvider(new FixtureProvider()) > 0, "Could not install fixture provider");
    System.setProperty("alpha.fixture.vault", Files.createTempDirectory(sandbox, "vault-case-").toString());
    access = PasswordVaultAccess.get(bridge.getContext());
    config = access.config;
    file = config.directory.toPath().resolve("vault.enc");
    sibling = file.resolveSibling("unrelated.dat");
    Files.writeString(sibling, "unrelated synthetic bytes");

    SecretKey key = new SecretKeySpec(new byte[32], "AES");
    keys.put(config.alias, key);
    JSONObject record = new JSONObject()
        .put("id", "seed").put("label", "Example").put("username", "fixture")
        .put("bindings", new JSONArray().put("https://example.invalid"))
        .put("updatedAt", 1).put("revision", 1).put("password", SYNTHETIC_PASSWORD);
    byte[] plaintext = new JSONArray().put(record).toString().getBytes(StandardCharsets.UTF_8);
    try {
      frame = PasswordVaultFrame.seal(key, config.aad, plaintext);
    } finally {
      Arrays.fill(plaintext, (byte) 0);
    }
    Files.write(file, frame);
  }

  private static PluginCall invoke(Consumer<PluginCall> method) {
    PluginCall call = new PluginCall();
    method.accept(call);
    if (call.result != null) {
      check(!call.result.toString().contains(SYNTHETIC_PASSWORD), "Synthetic password escaped through the bridge");
    }
    return call;
  }

  private static JSONObject accepted(PluginCall call) {
    check(call.result != null && call.rejection == null, "Bridge did not accept operation");
    return call.result;
  }

  private static void refused(PluginCall call, String code) {
    check(call.result == null && code.equals(call.rejection), "Bridge did not refuse with " + code);
  }

  private JSONObject observe() {
    JSONObject status = accepted(invoke(bridge::status));
    boolean locked = status.getBoolean("locked");
    check(status.getBoolean("available"), "Expected to exercise an available vault");
    check((status.getLong("unlockRemainingMs") == 0) == locked, "Incoherent native grant readback");
    return new JSONObject().put("s.vaultOpen", !locked).put("s.resets", Files.exists(file) ? 0 : 1);
  }

  private void checkpoint(String label, String... actions) {
    JSONArray path = new JSONArray();
    for (String action : actions) path.put(new JSONObject().put("name", action));
    steps.put(new JSONObject().put("label", label).put("action", path).put("expect", observe()));
  }

  private PluginCall authenticate() {
    PluginCall call = invoke(bridge::unlock);
    check(call.result == null && call.rejection == null && access.pending() &&
        PasswordSurfaces.visible(), "Native unlock failed to hold an owned platform challenge");
    return call;
  }

  private void finishAuthentication(PluginCall call) {
    BiometricPrompt.deliverSuccess();
    check(accepted(call).getBoolean("unlocked") && !PasswordSurfaces.visible(),
        "Native prompt did not admit and retire the challenge");
  }

  private void retained() throws Exception {
    check(Arrays.equals(frame, Files.readAllBytes(file)), "Retained vault bytes changed");
  }

  private void lock() {
    check(accepted(invoke(bridge::lock)).getBoolean("locked"), "No native lock acknowledgement");
  }

  private void damageAndReview() throws Exception {
    finishAuthentication(authenticate());
    checkpoint("fresh native grant", "unlock");
    check(keys.remove(config.alias) != null, "Lost-key fixture was not seeded");
    refused(invoke(bridge::list), "key-invalidated");
    retained();
    checkpoint("lost key invalidates the live native grant", "keyInvalidated");
    // Review itself belongs to the renderer. The host fixture supplies that intent.
    checkpoint("renderer requests reset review", "reviewReset");
  }

  private void metadata() throws Exception {
    finishAuthentication(authenticate());
    JSONObject row = accepted(invoke(bridge::list)).getJSONArray("entries").getJSONObject(0);
    check(row.keySet().equals(Set.of("id", "label", "username", "revision", "updatedAt", "bindings"))
        && row.getString("id").equals("seed") && row.getLong("revision") == 1,
        "Unexpected native metadata projection");
    check(row.getJSONArray("bindings").getJSONObject(0).keySet().equals(Set.of("kind", "facet", "display")),
        "Unexpected native binding projection");
    checkpoint("authenticated encrypted readback yields only allowlisted metadata", "unlock");

    refused(invoke(bridge::reset), "invalid");
    retained();
    checkpoint("reset of a readable vault refuses and preserves its bytes");
    lock();
    refused(invoke(bridge::list), "locked");
    checkpoint("explicit lock closes native listing", "lock");
  }

  private void retiredReset() throws Exception {
    damageAndReview();
    PluginCall challenge = authenticate();
    checkpoint("renderer awaits a held native reset authentication", "beginResetAuthentication");
    lock();
    checkpoint("leaving calls the native lock before authentication returns", "leave");
    BiometricPrompt.deliverSuccess();
    refused(challenge, "cancelled");
    check(BiometricPrompt.signal.cancelled && !PasswordSurfaces.visible(), "Retired prompt retained native custody");
    refused(invoke(bridge::reset), "locked");
    retained();
    checkpoint("late OS success cannot revive the retired grant or delete the vault", "authenticationRefused");
  }

  private void authorizedReset() throws Exception {
    damageAndReview();
    PluginCall challenge = authenticate();
    checkpoint("fresh reset authentication is pending", "beginResetAuthentication");
    refused(invoke(bridge::reset), "locked");
    retained();
    finishAuthentication(challenge);
    retained();
    check(accepted(invoke(bridge::reset)).getBoolean("reset"), "Expected exact damaged vault reset");
    check(!Files.exists(file), "Damaged record survived the acknowledged reset");
    check(accepted(invoke(bridge::list)).getJSONArray("entries").isEmpty(), "Reset readback is not empty");
    checkpoint("authenticated reset removes only the unreadable vault", "authenticateReset", "resetDamagedVault");
    refused(invoke(bridge::reset), "invalid");
    checkpoint("already-empty vault cannot be reset again");
  }

  private void expiredReset() throws Exception {
    damageAndReview();
    finishAuthentication(authenticate());
    check(observe().getBoolean("s.vaultOpen"), "Fresh reset credential never opened the native grant");
    SystemClock.now += config.unlockSeconds * 1000L;
    refused(invoke(bridge::reset), "locked");
    retained();
    checkpoint("elapsed native window refuses reset and preserves unreadable bytes", "authenticateReset", "lock");
  }

  public static void main(String[] args) throws Exception {
    String name = args[0];
    VaultReadbackTraces trace = new VaultReadbackTraces(Path.of(args[1]));
    JSONObject initial = trace.observe();
    refused(invoke(trace.bridge::list), "locked");
    trace.checkpoint("renderer opens saved passwords while native listing remains locked", "open");
    switch (name) {
      case "metadata" -> trace.metadata();
      case "retired-reset" -> trace.retiredReset();
      case "authorized-reset" -> trace.authorizedReset();
      case "expired-reset" -> trace.expiredReset();
      default -> throw new AssertionError("Unknown vault readback scenario");
    }
    check(Files.readString(trace.sibling).equals("unrelated synthetic bytes"), "An unrelated file was changed");
    System.out.println(new JSONObject().put("name", name).put("expect", initial).put("steps", trace.steps));
  }
}
