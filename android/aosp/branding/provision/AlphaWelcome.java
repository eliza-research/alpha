package com.android.provision;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Process;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.view.View;

/** Alpha's first-run presentation; the existing provisioner owns completion. */
final class AlphaWelcome {
    private static int dp(Activity a, int value) {
        return Math.round(value * a.getResources().getDisplayMetrics().density);
    }

    static void show(Activity activity, Runnable completed) {
        final int foreground = Color.WHITE;
        activity.getWindow().setStatusBarColor(Color.rgb(5, 5, 5));
        activity.getWindow().setNavigationBarColor(Color.rgb(5, 5, 5));
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(5, 5, 5));
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_VERTICAL);
        column.setPadding(dp(activity, 28), dp(activity, 48), dp(activity, 28), dp(activity, 32));
        scroll.addView(column);
        ImageView mark = new ImageView(activity);
        mark.setImageResource(R.drawable.alpha_mark);
        mark.setContentDescription(activity.getString(R.string.alpha_name));
        LinearLayout.LayoutParams markLayout = new LinearLayout.LayoutParams(dp(activity, 88), dp(activity, 88));
        markLayout.bottomMargin = dp(activity, 36);
        column.addView(mark, markLayout);
        TextView title = text(activity, activity.getString(R.string.alpha_welcome), 34, foreground);
        title.setAccessibilityHeading(true);
        column.addView(title);
        TextView description = text(activity, activity.getString(R.string.alpha_setup_description), 17, Color.rgb(204, 204, 214));
        description.setPadding(0, dp(activity, 16), 0, dp(activity, 36));
        column.addView(description);
        button(activity, column, R.string.alpha_wifi, () -> open(activity, Settings.ACTION_WIFI_SETTINGS));
        button(activity, column, R.string.alpha_security, () -> open(activity, "android.app.action.SET_NEW_PASSWORD"));
        TextView notice = text(activity, "", 16, foreground);
        notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        column.addView(notice);
        Button settings = button(activity, column, R.string.alpha_home_settings,
                () -> open(activity, Settings.ACTION_HOME_SETTINGS));
        settings.setVisibility(View.GONE);
        Button next = button(activity, column, R.string.alpha_continue, () -> {});
        Completion completion = new Completion(activity, completed, next, settings, notice);
        next.setOnClickListener(view -> completion.begin());
        next.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.BLUE));
        TextView footer = text(activity, activity.getString(R.string.alpha_setup_footer), 14, Color.rgb(180, 180, 194));
        footer.setPadding(0, dp(activity, 24), 0, 0);
        column.addView(footer);
        activity.setContentView(scroll);
    }

    private static final class Completion {
        private static final String ALPHA = "ai.alphacompute.alphaphone";
        private static final String PREPARE_TELEPHONY = ALPHA + ".action.PREPARE_TELEPHONY_ROLES";
        private static final String FRESH_TELEPHONY = ALPHA + ".fresh_telephony_setup";
        private static final long STEP_TIMEOUT_MS = 15000;
        private final Activity activity;
        private final Runnable completed;
        private final Button next, settings;
        private final TextView notice;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private boolean waiting;
        private int generation;
        private int step;
        Completion(Activity activity, Runnable completed, Button next, Button settings, TextView notice) {
            this.activity = activity; this.completed = completed; this.next = next;
            this.settings = settings; this.notice = notice;
        }
        void begin() {
            if (waiting || activity.isFinishing() || activity.isDestroyed()) return;
            final int attempt = ++generation;
            if (!eligible()) return;
            RoleManager roles = activity.getSystemService(RoleManager.class);
            if (roles == null) { fail(R.string.alpha_home_failed); return; }
            PackageManager packages = activity.getPackageManager();
            boolean telephony = packages.hasSystemFeature(FRESH_TELEPHONY)
                    && packages.hasSystemFeature(PackageManager.FEATURE_TELEPHONY);
            String[] required = telephony
                    ? new String[]{RoleManager.ROLE_HOME, RoleManager.ROLE_DIALER, RoleManager.ROLE_SMS}
                    : new String[]{RoleManager.ROLE_HOME};
            waiting = true;
            next.setEnabled(false);
            notice.setText(telephony ? R.string.alpha_roles_checking : R.string.alpha_home_checking);
            for (String role : required) {
                try {
                    if (!roles.isRoleAvailable(role)) { fail(roleFailure(role)); return; }
                } catch (IllegalStateException | SecurityException failure) { fail(roleFailure(role)); return; }
            }
            if (telephony) prepareTelephony(roles, required, attempt);
            else assignRoles(roles, required, attempt, 0);
        }

        private void prepareTelephony(RoleManager roles, String[] required, int attempt) {
            if (!eligible()) return;
            int operation = beginStep(attempt, R.string.alpha_roles_failed);
            Intent request = new Intent(PREPARE_TELEPHONY)
                    .setClassName(ALPHA, ALPHA + ".AlphaTelephonySetupReceiver")
                    .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
            try {
                activity.sendOrderedBroadcast(request, null, new BroadcastReceiver() {
                    @Override public void onReceive(Context context, Intent intent) {
                        if (!current(attempt, operation)) return;
                        ++step;
                        if (getResultCode() == Activity.RESULT_OK) assignRoles(roles, required, attempt, 0);
                        else fail(R.string.alpha_roles_failed);
                    }
                }, handler, Activity.RESULT_CANCELED, null, null);
            } catch (IllegalStateException | SecurityException failure) { fail(R.string.alpha_roles_failed); }
        }

        private void assignRoles(RoleManager roles, String[] required, int attempt, int start) {
            if (!eligible()) return;
            for (int index = start; index < required.length; index++) {
                String role = required[index];
                int failureMessage = roleFailure(role);
                try {
                    if (held(roles, role)) continue;
                    if (!eligible()) return;
                    int nextRole = index + 1;
                    int operation = beginStep(attempt, failureMessage);
                    roles.addRoleHolderAsUser(role, ALPHA, 0, Process.myUserHandle(),
                            activity.getMainExecutor(), accepted -> {
                                if (!current(attempt, operation)) return;
                                ++step;
                                try {
                                    if (AlphaFreshSetupPolicy.roleVerified(Boolean.TRUE.equals(accepted), held(roles, role))) {
                                        assignRoles(roles, required, attempt, nextRole);
                                    } else fail(failureMessage);
                                } catch (IllegalStateException | SecurityException failure) { fail(failureMessage); }
                            });
                    return;
                } catch (IllegalStateException | SecurityException failure) { fail(failureMessage); return; }
            }
            for (String role : required) {
                try {
                    if (!held(roles, role)) { fail(roleFailure(role)); return; }
                } catch (IllegalStateException | SecurityException failure) { fail(roleFailure(role)); return; }
            }
            finishPresets();
        }

        private boolean eligible() {
            if (AlphaFreshPresets.eligible(activity)) return true;
            fail(R.string.alpha_setup_state_changed);
            return false;
        }

        private int beginStep(int attempt, int failureMessage) {
            final int operation = ++step;
            handler.postDelayed(() -> {
                if (current(attempt, operation)) fail(failureMessage);
            }, STEP_TIMEOUT_MS);
            return operation;
        }

        private boolean current(int attempt, int operation) {
            return waiting && generation == attempt && step == operation
                    && !activity.isFinishing() && !activity.isDestroyed();
        }

        private static int roleFailure(String role) {
            return RoleManager.ROLE_HOME.equals(role) ? R.string.alpha_home_failed : R.string.alpha_roles_failed;
        }

        private boolean held(RoleManager roles, String role) {
            return roles.getRoleHoldersAsUser(role, Process.myUserHandle()).equals(java.util.Collections.singletonList(ALPHA));
        }

        private void finishPresets() {
            if (!AlphaFreshPresets.eligible(activity)) { fail(R.string.alpha_setup_state_changed); return; }
            AlphaFreshSetupPolicy.ImeResult keyboard = AlphaFreshPresets.ensureKeyboard(activity);
            if (keyboard == AlphaFreshSetupPolicy.ImeResult.FAILED || keyboard == AlphaFreshSetupPolicy.ImeResult.SKIPPED) {
                fail(R.string.alpha_keyboard_failed); return;
            }
            try {
                String palette = Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.THEME_CUSTOMIZATION_OVERLAY_PACKAGES);
                if ((palette == null || palette.isEmpty() || palette.equals("{}")) && !AlphaAppearance.applyPalette(activity)) {
                    fail(R.string.alpha_appearance_preset_failed); return;
                }
            } catch (IllegalStateException | SecurityException failure) { fail(R.string.alpha_appearance_preset_failed); return; }
            waiting = false;
            completed.run();
        }
        private void fail(int message) {
            waiting = false;
            next.setEnabled(true); next.setText(R.string.alpha_retry_setup);
            boolean home = message == R.string.alpha_home_failed;
            String action = home ? Settings.ACTION_HOME_SETTINGS
                    : message == R.string.alpha_roles_failed ? Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS
                    : message == R.string.alpha_keyboard_failed ? Settings.ACTION_INPUT_METHOD_SETTINGS
                    : Settings.ACTION_SETTINGS;
            settings.setText(home ? R.string.alpha_home_settings : R.string.alpha_open_settings);
            settings.setOnClickListener(view -> open(activity, action));
            settings.setVisibility(View.VISIBLE); notice.setText(message);
        }
    }

    private static TextView text(Activity a, String value, int size, int color) {
        TextView result = new TextView(a);
        result.setText(value); result.setTextSize(size); result.setTextColor(color);
        result.setFontFeatureSettings("kern");
        return result;
    }

    private static Button button(Activity a, LinearLayout parent, int label, Runnable action) {
        Button result = new Button(a);
        result.setText(label); result.setAllCaps(false); result.setTextColor(Color.WHITE);
        result.setTextSize(16); result.setMinHeight(dp(a, 56));
        result.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(36, 36, 42)));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.bottomMargin = dp(a, 12);
        parent.addView(result, layout);
        result.setOnClickListener(view -> action.run());
        return result;
    }

    private static void open(Activity a, String action) {
        Intent intent = new Intent(action);
        if (intent.resolveActivity(a.getPackageManager()) != null) a.startActivity(intent);
    }
}
