package ai.alphacompute.alphaphone;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.autofill.AutofillManager;
import com.getcapacitor.JSObject;

/** Provider metadata only. Never reads credentials, vault state or form values. */
final class PasswordProviderSupport {
    static final String PACKAGE = "proton.android.pass";
    // The original publisher's signing certificate.
    static final String CERTIFICATE = "dcc9439ec1a6c6a8d0203f3423ee42bcc8b970628e53cb73a0393f398dd5b853";

    static boolean trusted(Context context) {
        byte[] certificate = new byte[CERTIFICATE.length() / 2];
        for (int i = 0; i < certificate.length; i++) {
            certificate[i] = (byte) Integer.parseInt(CERTIFICATE.substring(i * 2, i * 2 + 2), 16);
        }
        return context.getPackageManager().hasSigningCertificate(PACKAGE, certificate, PackageManager.CERT_INPUT_SHA256);
    }

    static JSObject status(Context context) {
        JSObject result = new JSObject();
        result.put("installation", "unknown");
        result.put("selection", "unknown");
        result.put("support", "unknown");
        try {
            ApplicationInfo app = context.getPackageManager().getApplicationInfo(PACKAGE, 0);
            result.put("installation", !trusted(context) ? "unrecognized-publisher" : app.enabled ? "installed" : "disabled");
        } catch (PackageManager.NameNotFoundException absent) {
            result.put("installation", "absent");
        } catch (RuntimeException unavailable) { /* Preserve unknown, never infer absence. */ }
        try {
            AutofillManager manager = context.getSystemService(AutofillManager.class);
            if (manager != null) {
                result.put("support", manager.isAutofillSupported() ? "available" : "unavailable");
                ComponentName service = manager.getAutofillServiceComponentName();
                result.put("selection", service == null ? "none" : PACKAGE.equals(service.getPackageName()) ? "proton" : "other");
            }
        } catch (RuntimeException unavailable) { /* Selection remains unknown. */ }
        return result;
    }

    static Intent intent(Context context, String action) {
        if ("settings".equals(action)) {
            AutofillManager manager = context.getSystemService(AutofillManager.class);
            if (trusted(context) && manager != null && manager.isAutofillSupported()) {
                return new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:" + PACKAGE));
            }
            return new Intent(Settings.ACTION_SETTINGS);
        }
        if ("install".equals(action)) return new Intent(Intent.ACTION_VIEW, Uri.parse("https://proton.me/pass/download"));
        if ("open".equals(action)) {
            if (!trusted(context)) throw new IllegalStateException("Provider publisher is not verified");
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(PACKAGE);
            if (launch == null) throw new IllegalStateException("Provider app is unavailable");
            return launch;
        }
        throw new IllegalArgumentException("Unsupported password provider action");
    }
}
