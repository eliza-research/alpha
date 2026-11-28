package ai.alphacompute.thinapp;

import ai.eliza.plugins.browsersurface.BrowserSealedText;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android Keystore AES-256-GCM text sealer implementing {@link BrowserSealedText} for thin browser stores. */
final class KeystoreSealedText implements BrowserSealedText {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final String alias;
    private final int maxBytes;

    KeystoreSealedText(String alias, int maxBytes) {
        this.alias = alias;
        this.maxBytes = maxBytes;
    }

    @Override public String seal(String plain) throws Exception {
        byte[] bytes = plain.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > maxBytes) throw new IllegalArgumentException("Payload exceeds browser store limit");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(bytes);
        byte[] framed = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, framed, 0, iv.length);
        System.arraycopy(ciphertext, 0, framed, iv.length, ciphertext.length);
        return Base64.encodeToString(framed, Base64.NO_WRAP);
    }

    @Override public String open(String sealed) throws Exception {
        byte[] framed = Base64.decode(sealed, Base64.NO_WRAP);
        if (framed.length <= IV_BYTES) throw new IllegalArgumentException("Malformed sealed browser payload");
        byte[] iv = new byte[IV_BYTES];
        byte[] ciphertext = new byte[framed.length - IV_BYTES];
        System.arraycopy(framed, 0, iv, 0, IV_BYTES);
        System.arraycopy(framed, IV_BYTES, ciphertext, 0, ciphertext.length);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(TAG_BITS, iv));
        byte[] plain = cipher.doFinal(ciphertext);
        return new String(plain, StandardCharsets.UTF_8);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(alias, null);
        if (entry instanceof KeyStore.SecretKeyEntry secretEntry) {
            return secretEntry.getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }
}
