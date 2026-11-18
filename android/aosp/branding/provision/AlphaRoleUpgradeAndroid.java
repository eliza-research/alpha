package com.android.role.controller.service;

import android.app.admin.DevicePolicyManager;
import android.app.role.RoleManager;
import android.content.ApexEnvironment;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.UserHandle;
import android.os.UserManager;
import android.provider.Settings;
import android.util.AtomicFile;

import com.android.role.controller.model.Role;
import com.android.role.controller.model.Roles;
import com.android.role.controller.util.UserUtils;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.util.List;

/** Runs only on RoleControllerService's serialized worker. */
final class AlphaRoleUpgradeAndroid implements AlphaRoleUpgrade.Port {
    private final Context context;
    private final UserHandle user;
    private final RoleManager roles;
    private final RoleControllerServiceImpl controller;

    AlphaRoleUpgradeAndroid(Context context, UserHandle user, RoleManager roles,
            RoleControllerServiceImpl controller) {
        this.context = context;
        this.user = user;
        this.roles = roles;
        this.controller = controller;
    }

    @Override public boolean eligible() {
        // The in-process role controller owns Permission's per-user system data.
        // The remote app keeps Android's regular role behavior.
        if (!ownsMarkers()
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
        if (policy == null || users == null || policy.getDeviceOwnerComponentOnAnyUser() != null
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

    private boolean ownsMarkers() {
        return UserHandle.SYSTEM.equals(user) && "android".equals(context.getPackageName());
    }

    private AtomicFile stateFile(String role) {
        File directory = ApexEnvironment.getApexEnvironment("com.android.permission")
                .getDeviceProtectedDataDirForUser(user);
        return new AtomicFile(new File(directory, "alpha_role_identity_upgrade_v1_" + role));
    }

    @Override public String state(String role) {
        AtomicFile file = stateFile(role);
        try {
            String value = new String(file.readFully(), StandardCharsets.UTF_8);
            if (AlphaRoleUpgrade.PENDING.equals(value) || AlphaRoleUpgrade.DONE.equals(value)) {
                return value;
            }
            throw new IllegalStateException("Invalid Alpha role transition state for " + role);
        } catch (IOException error) {
            // FileInputStream also throws FileNotFoundException for access errors. Only a
            // confirmed missing marker allows the default pass to start a fresh migration.
            if (error instanceof FileNotFoundException
                    && Files.notExists(file.getBaseFile().toPath(), LinkOption.NOFOLLOW_LINKS)) {
                return "";
            }
            throw new IllegalStateException("Cannot read Alpha role transition state", error);
        }
    }

    @Override public boolean save(String role, String value) {
        AtomicFile file = stateFile(role);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } catch (IOException error) {
            if (output != null) file.failWrite(output);
            return false;
        }
        file.finishWrite(output);
        // Owner requests reach save() outside the default pass's catch, on the system
        // server's role worker: an unreadable marker refuses the write instead of throwing.
        try {
            return value.equals(state(role));
        } catch (IllegalStateException unreadable) {
            return false;
        }
    }
    @Override public boolean adopt(String role) {
        return controller.onAddRoleHolder(role, AlphaRoleUpgrade.ALPHA, 0);
    }
    @Override public boolean restorePrevious(String role) {
        return controller.onAddRoleHolder(role, AlphaRoleUpgrade.PREVIOUS, 0);
    }

    boolean keepOwnerChoice(String role) {
        return !ownsMarkers() || !AlphaRoleUpgrade.ROLES.contains(role)
                || save(role, AlphaRoleUpgrade.DONE);
    }
}
