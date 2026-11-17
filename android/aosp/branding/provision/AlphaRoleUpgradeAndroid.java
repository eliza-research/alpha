package com.android.role.controller.service;

import android.app.admin.DevicePolicyManager;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.UserHandle;
import android.os.UserManager;
import android.provider.Settings;

import com.android.role.controller.model.Role;
import com.android.role.controller.model.Roles;
import com.android.role.controller.util.UserUtils;

import java.util.List;

/** Runs only on RoleControllerService's serialized worker. */
final class AlphaRoleUpgradeAndroid implements AlphaRoleUpgrade.Port {
    private final Context context;
    private final UserHandle user;
    private final RoleManager roles;
    private final RoleControllerServiceImpl controller;
    private final SharedPreferences state;

    AlphaRoleUpgradeAndroid(Context context, UserHandle user, RoleManager roles,
            RoleControllerServiceImpl controller) {
        this.context = context;
        this.user = user;
        this.roles = roles;
        this.controller = controller;
        state = UserUtils.getUserContext(context, user).createDeviceProtectedStorageContext()
                .getSharedPreferences("alpha_role_identity_upgrade_v1", Context.MODE_PRIVATE);
    }

    @Override public boolean eligible() {
        if (!UserHandle.SYSTEM.equals(user)
                || !context.getPackageManager().hasSystemFeature(AlphaRoleUpgrade.ALPHA + ".aosp_image")
                || !context.getPackageManager().hasSystemFeature(AlphaRoleUpgrade.ALPHA + ".fresh_telephony_setup")) {
            return false;
        }
        Context owner = UserUtils.getUserContext(context, user);
        if (Settings.Secure.getInt(owner.getContentResolver(), Settings.Secure.USER_SETUP_COMPLETE, 0) == 0) {
            return false;
        }
        DevicePolicyManager policy = owner.getSystemService(DevicePolicyManager.class);
        UserManager users = owner.getSystemService(UserManager.class);
        if (policy == null || users == null || policy.getDeviceOwnerComponentOnCallingUser() != null
                || users.isManagedProfile()) return false;
        try {
            ApplicationInfo app = owner.getPackageManager().getApplicationInfo(AlphaRoleUpgrade.ALPHA, 0);
            return app.enabled && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0
                    && (app.flags & (ApplicationInfo.FLAG_DEBUGGABLE | ApplicationInfo.FLAG_SUSPENDED)) == 0;
        } catch (PackageManager.NameNotFoundException missing) {
            return false;
        }
    }

    @Override public boolean qualified(String roleName) {
        Role role = Roles.get(context).get(roleName);
        return role != null && role.isAvailableAsUser(user, context)
                && role.isPackageQualifiedAsUser(AlphaRoleUpgrade.ALPHA, user, context);
    }

    @Override public List<String> holders(String role) { return roles.getRoleHolders(role); }
    @Override public String state(String role) { return state.getString(role, ""); }
    @Override public boolean save(String role, String value) {
        return state.edit().putString(role, value).commit();
    }
    @Override public boolean adopt(String role) {
        return controller.onAddRoleHolder(role, AlphaRoleUpgrade.ALPHA, 0);
    }
    @Override public boolean restorePrevious(String role) {
        return controller.onAddRoleHolder(role, AlphaRoleUpgrade.PREVIOUS, 0);
    }

    boolean keepOwnerChoice(String role) {
        return !AlphaRoleUpgrade.ROLES.contains(role) || save(role, AlphaRoleUpgrade.DONE);
    }
}
