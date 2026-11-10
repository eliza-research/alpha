package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Test APK only (package ai.elizaresearch.alphaphone.test, signed by the instrumentation key): a
 * native sign-in form for the Autofill campaign. It never sends anything; "Sign in" only finishes
 * the activity, which ends the autofill session so Android may offer Save. The status line shows
 * the username and the SHA-256 of the password field, so the test can check a fill without reading
 * a masked field. */
public final class PasswordFillFixtureActivity extends Activity {
 static final String USERNAME = "Fixture username", PASSWORD = "Fixture password", SIGN_IN = "Sign in", STATUS = "Fixture status";
 private static String sha(String value) {
  try {
   StringBuilder hex = new StringBuilder();
   for (byte b : MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
   return hex.toString();
  } catch (Exception unavailable) { return "unavailable"; }
 }
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  LinearLayout layout = new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(32, 96, 32, 32);
  EditText username = new EditText(this);username.setContentDescription(USERNAME);username.setHint("Username");
  username.setAutofillHints(View.AUTOFILL_HINT_USERNAME);username.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
  EditText password = new EditText(this);password.setContentDescription(PASSWORD);password.setHint("Password");
  password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
  password.setAutofillHints(View.AUTOFILL_HINT_PASSWORD);password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
  TextView status = new TextView(this);status.setContentDescription(STATUS);
  Runnable update = () -> status.setText("user=" + username.getText() + ";password=" + (password.length() == 0 ? "empty" : sha(password.getText().toString())));
  TextWatcher watcher = new TextWatcher() {
   @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
   @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
   @Override public void afterTextChanged(Editable s) { update.run(); }
  };
  username.addTextChangedListener(watcher);password.addTextChangedListener(watcher);update.run();
  Button signIn = new Button(this);signIn.setText(SIGN_IN);signIn.setOnClickListener(view -> finish());
  layout.addView(username);layout.addView(password);layout.addView(signIn);layout.addView(status);
  setContentView(layout);
 }
 static String expectedStatus(String username, String password) { return "user=" + username + ";password=" + sha(password); }
}
