#!/usr/bin/env python3
"""Prepare the pinned Alpha OS policy packet locally; never mutate an AOSP checkout."""
from pathlib import Path
import argparse
import difflib
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'system-entry'))
from portable_tools import fetch_pinned_googlesource, reject_symlinks, require, safe_relative_path

PIN = json.loads((ROOT / 'SOURCE-INPUTS.json').read_text())
CACHE = ROOT / '.cache'
BASE = CACHE / 'baseline'
OUT = CACHE / 'staged'
changes = {}
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fetch', action='store_true', help='Fetch only missing hash-pinned public AOSP inputs')
args = parser.parse_args()
if args.fetch:
    for row in PIN['files']:
        relative = safe_relative_path(row['path'], 'input path')
        target = BASE / relative
        url = f"https://android.googlesource.com/platform/frameworks/base/+/{PIN['revision']}/{row['path']}?format=TEXT"
        fetch_pinned_googlesource(url, target, row['beforeSha256'], CACHE)


def original(path):
    relative = safe_relative_path(path, 'baseline path')
    target = BASE / relative
    reject_symlinks(target, CACHE, 'baseline path')
    data = target.read_bytes()
    row = next(row for row in PIN['files'] if row['path'] == path)
    require(sha(data) == row['beforeSha256'], 'Pinned source drift: ' + path)
    return data.decode()


def replace(text, old, new):
    require(text.count(old) == 1, 'Source anchor drift: ' + old)
    return text.replace(old, new, 1)


def edit(path, text):
    changes[path] = (original(path), text)


fgs = 'packages/SystemUI/src/com/android/systemui/qs/FgsManagerController.kt'
text = original(fgs)
text = replace(text, '        fun updateUiControl() {', '''        private fun isCoreLauncher(): Boolean {
            if (packageName != AlphaCoreLauncherPolicy.PACKAGE) return false
            return try {
                val app = packageManager.getApplicationInfoAsUser(packageName, 0, userId)
                val home = packageManager.resolveActivityAsUser(
                    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                    PackageManager.MATCH_DEFAULT_ONLY, userId,
                )
                AlphaCoreLauncherPolicy.protects(
                    packageName, app.enabled && app.flags and android.content.pm.ApplicationInfo.FLAG_SUSPENDED == 0,
                    app.flags and (android.content.pm.ApplicationInfo.FLAG_SYSTEM or
                        android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0,
                    home?.activityInfo?.packageName == packageName,
                )
            } catch (_: PackageManager.NameNotFoundException) { false }
              catch (_: SecurityException) { false }
        }

        fun updateUiControl() {
            val coreLauncher = isCoreLauncher()''')
text = replace(text, '                when (backgroundRestrictionExemptionReason) {',
    '                if (coreLauncher) UIControl.HIDE_ENTRY\n                else when (backgroundRestrictionExemptionReason) {')
text = replace(text, 'if (isStoppableApp(packageName)) {',
    'if (!coreLauncher && isStoppableApp(packageName)) {')
text = replace(text, '        val addedPackages =\n', '''        // A Home change can hide a row already cached by the open dialog. Remove it
        // without marking it stopped so normal controls return when Home changes away.
        packages.keys.filter {
            it.packageName == AlphaCoreLauncherPolicy.PACKAGE &&
                it.uiControl == UIControl.HIDE_ENTRY
        }.forEach { runningApps.remove(it) }

        val addedPackages =
''')
text = replace(text, '            initialized = true', '''            // Refresh cached core-launcher classification when Home or package state changes.
            val refreshAlphaCoreLauncher = {
                val alphaPackages = synchronized(lock) {
                    runningTaskIdentifiers.keys.filter {
                        it.packageName == AlphaCoreLauncherPolicy.PACKAGE
                    }
                }
                if (alphaPackages.isNotEmpty()) {
                    alphaPackages.forEach { it.updateUiControl() }
                    synchronized(lock) {
                        updateNumberOfVisibleRunningPackagesLocked()
                        updateAppItemsLocked()
                    }
                }
            }
            broadcastDispatcher.registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        refreshAlphaCoreLauncher()
                    }
                },
                IntentFilter("android.intent.action.ACTION_PREFERRED_ACTIVITY_CHANGED"),
                executor = backgroundExecutor,
                user = UserHandle.ALL,
                flags = Context.RECEIVER_NOT_EXPORTED,
            )
            userTracker.userContext.registerReceiverAsUser(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        if (intent.data?.schemeSpecificPart == AlphaCoreLauncherPolicy.PACKAGE) {
                            backgroundExecutor.execute(refreshAlphaCoreLauncher)
                        }
                    }
                },
                UserHandle.ALL,
                IntentFilter().apply {
                    addAction(Intent.ACTION_PACKAGE_CHANGED)
                    addAction(Intent.ACTION_PACKAGE_REPLACED)
                    addDataScheme("package")
                },
                null,
                null,
                Context.RECEIVER_NOT_EXPORTED,
            )
            broadcastDispatcher.registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        val changed = intent.getStringArrayExtra(Intent.EXTRA_CHANGED_PACKAGE_LIST)
                        if (changed != null && AlphaCoreLauncherPolicy.PACKAGE in changed) {
                            refreshAlphaCoreLauncher()
                        }
                    }
                },
                IntentFilter().apply {
                    addAction(Intent.ACTION_PACKAGES_SUSPENDED)
                    addAction(Intent.ACTION_PACKAGES_UNSUSPENDED)
                },
                executor = backgroundExecutor,
                user = UserHandle.ALL,
                flags = Context.RECEIVER_NOT_EXPORTED,
            )

            initialized = true''')
edit(fgs, text)

repo = 'packages/SystemUI/src/com/android/systemui/qs/pipeline/data/repository/UserTileSpecRepository.kt'
text = original(repo)
text = replace(text, '''    private suspend fun loadTilesFromSettingsAndParse(userId: Int): List<TileSpec> {
        val loadedTiles = loadTilesFromSettings(userId)
        if (loadedTiles.isNotEmpty()) {
            _tilesUpgradePath.send(TilesUpgradePath.ReadFromSettings(loadedTiles.toSet()))
        } else {
            _tilesUpgradePath.send(TilesUpgradePath.DefaultSet)
        }
        return parseTileSpecs(loadedTiles, userId)
    }''', '''    private suspend fun loadTilesFromSettingsAndParse(userId: Int): List<TileSpec> {
        val loadedTiles = loadTilesFromSettings(userId)
        val reviewedVersion = withContext(backgroundDispatcher) {
            secureSettings.getIntForUser(AlphaQsDefaultsPolicy.VERSION_SETTING, 0, userId)
        }
        val shouldRecordVersion = defaultTiles.any { it.spec == AlphaQsDefaultsPolicy.ALPHA } &&
            reviewedVersion < AlphaQsDefaultsPolicy.VERSION
        val migrated = AlphaQsDefaultsPolicy.shouldMigrate(
            loadedTiles.map { it.spec }, defaultTiles.map { it.spec }, reviewedVersion,
        )
        val selected = if (migrated) defaultTiles else loadedTiles
        val parsedTiles = parseTileSpecs(selected, userId)
        if (shouldRecordVersion) {
            val toStore = parsedTiles
                .filter { it !is TileSpec.Invalid }
                .joinToString(DELIMITER, transform = TileSpec::spec)
            withContext(backgroundDispatcher) {
                // Commit the version atomically on backgroundDispatcher after storing any migrated
                // layout. Custom owner layouts also record VERSION so a future reboot never
                // overwrites them if they later resemble stock tiles.
                val written = if (migrated) {
                    secureSettings.putStringForUser(SETTING, toStore, null, false, userId, true)
                } else {
                    true
                }
                if (written) {
                    secureSettings.putIntForUser(
                        AlphaQsDefaultsPolicy.VERSION_SETTING, AlphaQsDefaultsPolicy.VERSION, userId,
                    )
                }
            }
        }
        if (loadedTiles.isNotEmpty()) {
            _tilesUpgradePath.send(TilesUpgradePath.ReadFromSettings(parsedTiles.toSet()))
        } else {
            _tilesUpgradePath.send(TilesUpgradePath.DefaultSet)
        }
        return parsedTiles
    }''')
edit(repo, text)

config = 'packages/SystemUI/res/values/config.xml'
text = original(config)
alpha = 'custom(ai.alphacompute.alphaphone/.AlphaQuickSettingsTile),'
text = replace(text,
    'internet,bt,dnd,cast,flashlight,airplane,rotation,wallet,alarm,controls,screenrecord,battery',
    alpha + 'internet,bt,dnd,airplane,rotation,flashlight,battery,alarm,screenrecord')
text = replace(text,
    'wifi,bt,cell,cast,dnd,wallet,airplane,rotation,flashlight,battery,alarm,controls,screenrecord',
    alpha + 'wifi,bt,dnd,airplane,rotation,flashlight,battery,alarm,screenrecord')
edit(config, text)

permission = 'services/core/java/com/android/server/pm/permission/DefaultPermissionGrantPolicy.java'
text = original(permission)
text = replace(text, '    private final PackageManagerInternal mServiceInternal;',
    '    private final PackageManagerInternal mServiceInternal;\n    private boolean mAlphaStorageReceiverRegistered;')
text = replace(text, '    public void grantDefaultPermissions(int userId) {',
    '    public void grantDefaultPermissions(int userId) {\n        registerAlphaStorageBootReceiver();')
text = replace(text, '    public void scheduleReadDefaultPermissionExceptions() {',
    '    public void scheduleReadDefaultPermissionExceptions() {\n        registerAlphaStorageBootReceiver();')
text = replace(text, '        pm.apply();\n    }',
    '        pm.apply();\n        grantAlphaSharedStorageDefault(pm, userId);\n    }')
text = replace(text, '    private void grantSignatureAppsNotificationPermissions(', '''    /** One-time primary-user factory default; explicit owner modes and managed devices are retained. */
    private void grantAlphaSharedStorageDefault(PackageManagerWrapper pm, int userId) {
        if (userId != UserHandle.USER_SYSTEM) return;
        android.app.admin.DevicePolicyManager policy =
                mContext.getSystemService(android.app.admin.DevicePolicyManager.class);
        if (policy == null || policy.getDeviceOwnerComponentOnAnyUser() != null
                || policy.isOrganizationOwnedDeviceWithManagedProfile()) return;
        boolean alreadyApplied = android.provider.Settings.Secure.getIntForUser(
                mContext.getContentResolver(), AlphaSharedStoragePolicy.GRANTED_SETTING, 0, userId) != 0;
        if (alreadyApplied) return;
        PackageInfo pkg = pm.getSystemPackageInfo(AlphaSharedStoragePolicy.PACKAGE);
        if (pkg == null || pkg.applicationInfo == null) return;
        android.app.AppOpsManager ops = mContext.getSystemService(android.app.AppOpsManager.class);
        if (ops == null) return;
        int uid = UserHandle.getUid(userId, UserHandle.getAppId(pkg.applicationInfo.uid));
        boolean installed = pkg.applicationInfo.enabled
                && (pkg.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_INSTALLED) != 0
                && (pkg.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SUSPENDED) == 0;
        boolean preinstalled = pkg.applicationInfo.isSystemApp()
                || pkg.applicationInfo.isUpdatedSystemApp();
        try {
            int mode = ops.unsafeCheckOpRawNoThrow(
                    android.app.AppOpsManager.OPSTR_MANAGE_EXTERNAL_STORAGE, uid, pkg.packageName);
            if (mode != android.app.AppOpsManager.MODE_DEFAULT) {
                // Owner already chose allow/deny; record the one-time marker so a later reset never re-grants.
                android.provider.Settings.Secure.putIntForUser(
                        mContext.getContentResolver(), AlphaSharedStoragePolicy.GRANTED_SETTING, 1, userId);
                return;
            }
            if (AlphaSharedStoragePolicy.shouldGrant(userId, pkg.packageName, installed,
                    preinstalled,
                    com.android.internal.util.ArrayUtils.contains(pkg.requestedPermissions,
                            Manifest.permission.MANAGE_EXTERNAL_STORAGE),
                    true, alreadyApplied)) {
                ops.setUidMode(android.app.AppOpsManager.OPSTR_MANAGE_EXTERNAL_STORAGE,
                        uid, android.app.AppOpsManager.MODE_ALLOWED);
                android.provider.Settings.Secure.putIntForUser(
                        mContext.getContentResolver(), AlphaSharedStoragePolicy.GRANTED_SETTING, 1, userId);
            }
        } catch (IllegalArgumentException | SecurityException error) {
            Log.w(TAG, "Alpha shared storage default was not applied", error);
        }
    }

    private void grantSignatureAppsNotificationPermissions(''')
text = replace(text, '    private void grantPermissionsToSysComponentsAndPrivApps(', '''    /** Both callers run from PackageManagerService.systemReady, after Activity Manager exists. */
    private synchronized void registerAlphaStorageBootReceiver() {
        if (mAlphaStorageReceiverRegistered) return;
        mContext.registerReceiverAsUser(new android.content.BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
                    grantAlphaSharedStorageDefault(NO_PM_CACHE, UserHandle.USER_SYSTEM);
                }
            }
        }, UserHandle.SYSTEM, new android.content.IntentFilter(Intent.ACTION_BOOT_COMPLETED),
                null, mHandler, Context.RECEIVER_NOT_EXPORTED);
        mAlphaStorageReceiverRegistered = true;
    }

    private void grantPermissionsToSysComponentsAndPrivApps(''')
edit(permission, text)

for name, target in {
    'AlphaCoreLauncherPolicy.java': 'packages/SystemUI/src/com/android/systemui/qs/',
    'AlphaQsDefaultsPolicy.java': 'packages/SystemUI/src/com/android/systemui/qs/pipeline/data/repository/',
    'AlphaSharedStoragePolicy.java': 'services/core/java/com/android/server/pm/permission/',
}.items():
    changes[target + name] = (None, (ROOT / name).read_text())

patch = []
files = []
for path, (before, after) in sorted(changes.items()):
    relative = safe_relative_path(path, 'staged path')
    target = OUT / relative
    reject_symlinks(target, CACHE, 'staged path')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(after)
    patch.extend(difflib.unified_diff((before or '').splitlines(True), after.splitlines(True),
        fromfile='a/' + path if before is not None else '/dev/null', tofile='b/' + path))
    files.append({'path': path, 'beforeSha256': sha(before.encode()) if before is not None else None,
        'afterSha256': sha(after.encode()), 'new': before is None})
data = ''.join('\n' if line == ' \n' else line for line in patch).encode()
(ROOT / 'alpha-core-launcher.patch').write_bytes(data)
(ROOT / 'manifest.json').write_text(json.dumps({'schema': 1, 'project': PIN['project'],
    'revision': PIN['revision'], 'targetAppId': 'ai.alphacompute.alphaphone', 'patch': 'alpha-core-launcher.patch', 'patchSha256': sha(data),
    'files': files}, indent=2) + '\n')
print(json.dumps({'files': len(files), 'sha256': sha(data)}))
