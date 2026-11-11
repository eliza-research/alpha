package com.android.provision;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
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

import java.util.Collections;

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
        boolean initialTelephonyRoles = Completion.hasInitialTelephonyRoles(activity);
        int descriptionText = initialTelephonyRoles
                ? R.string.alpha_setup_telephony_description : R.string.alpha_setup_description;
        TextView description = text(activity, activity.getString(descriptionText), 17, Color.rgb(204, 204, 214));
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
        Completion completion = new Completion(activity, completed, next, settings, notice, initialTelephonyRoles);
        next.setOnClickListener(view -> completion.begin());
        next.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.BLUE));
        TextView footer = text(activity, activity.getString(R.string.alpha_setup_footer), 14, Color.rgb(180, 180, 194));
        footer.setPadding(0, dp(activity, 24), 0, 0);
        column.addView(footer);
        activity.setContentView(scroll);
    }

    private static final class Completion {
        private static final String ALPHA_PACKAGE = "ai.alphacompute.alphaphone";
        private static final String INITIAL_TELEPHONY_ROLES_FEATURE =
                ALPHA_PACKAGE + ".feature.INITIAL_TELEPHONY_ROLES";

        private enum InitialRole {
            HOME(RoleManager.ROLE_HOME, R.string.alpha_home_checking, R.string.alpha_home_failed),
            DIALER(RoleManager.ROLE_DIALER, R.string.alpha_dialer_checking, R.string.alpha_dialer_failed),
            SMS(RoleManager.ROLE_SMS, R.string.alpha_sms_checking, R.string.alpha_sms_failed);

            final String name;
            final int checking, failure;

            InitialRole(String name, int checking, int failure) {
                this.name = name;
                this.checking = checking;
                this.failure = failure;
            }
        }

        private final Activity activity;
        private final Runnable completed;
        private final Button next, settings;
        private final TextView notice;
        private final InitialRole[] initialRoles;
        private boolean waiting;
        private int generation;

        static boolean hasInitialTelephonyRoles(Activity activity) {
            return activity.getPackageManager().hasSystemFeature(INITIAL_TELEPHONY_ROLES_FEATURE, 1);
        }

        Completion(Activity activity, Runnable completed, Button next, Button settings, TextView notice,
                boolean initialTelephonyRoles) {
            this.activity = activity;
            this.completed = completed;
            this.next = next;
            this.settings = settings;
            this.notice = notice;
            this.initialRoles = initialTelephonyRoles ? InitialRole.values() : new InitialRole[] { InitialRole.HOME };
        }

        void begin() {
            if (waiting || !stillFresh()) return;
            waiting = true;
            next.setEnabled(false);
            settings.setVisibility(View.GONE);
            ensureRoles(activity.getSystemService(RoleManager.class), 0);
        }

        private void ensureRoles(RoleManager roles, int start) {
            for (int i = start; i < initialRoles.length; i++) {
                if (!stillFresh()) return;
                InitialRole role = initialRoles[i];
                try {
                    if (roles == null || !roles.isRoleAvailable(role.name)) {
                        fail(role.failure);
                        return;
                    }
                    if (held(roles, role)) continue;
                    if (stillFresh()) requestRole(roles, role, i + 1);
                } catch (IllegalStateException | SecurityException failure) {
                    fail(role.failure);
                }
                return;
            }
            finishPresets(roles);
        }

        private void requestRole(RoleManager roles, InitialRole role, int nextRole) {
            int request = ++generation;
            notice.setText(role.checking);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (waiting && generation == request && stillFresh()) fail(role.failure);
            }, 15000);
            roles.addRoleHolderAsUser(role.name, ALPHA_PACKAGE, 0, Process.myUserHandle(),
                    activity.getMainExecutor(), accepted -> {
                        if (!waiting || generation != request || !stillFresh()) return;
                        try {
                            if (!Boolean.TRUE.equals(accepted) || !held(roles, role)) {
                                fail(role.failure);
                                return;
                            }
                        } catch (IllegalStateException | SecurityException failure) {
                            fail(role.failure);
                            return;
                        }
                        ensureRoles(roles, nextRole);
                    });
        }

        private boolean held(RoleManager roles, InitialRole role) {
            return Collections.singletonList(ALPHA_PACKAGE)
                    .equals(roles.getRoleHoldersAsUser(role.name, Process.myUserHandle()));
        }

        private boolean stillFresh() {
            if (activity.isFinishing() || activity.isDestroyed()) return false;
            if (AlphaFreshPresets.eligible(activity)) return true;
            fail(R.string.alpha_setup_state_changed);
            return false;
        }

        private void finishPresets(RoleManager roles) {
            if (!stillFresh()) return;
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

            // Earlier roles may have changed while the next grant was pending.
            for (InitialRole role : initialRoles) {
                try {
                    if (roles.isRoleAvailable(role.name) && held(roles, role)) continue;
                } catch (IllegalStateException | SecurityException failure) {
                    // A failed read cannot establish a holder.
                }
                fail(role.failure);
                return;
            }
            if (!stillFresh()) return;
            waiting = false;
            completed.run();
        }

        private void fail(int message) {
            waiting = false;
            next.setEnabled(true); next.setText(R.string.alpha_retry_setup);
            boolean home = message == R.string.alpha_home_failed;
            boolean phoneRole = message == R.string.alpha_dialer_failed || message == R.string.alpha_sms_failed;
            String action = home ? Settings.ACTION_HOME_SETTINGS
                    : phoneRole ? Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS
                    : message == R.string.alpha_keyboard_failed ? Settings.ACTION_INPUT_METHOD_SETTINGS
                    : Settings.ACTION_SETTINGS;
            settings.setText(home ? R.string.alpha_home_settings
                    : phoneRole ? R.string.alpha_default_apps_settings : R.string.alpha_open_settings);
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
