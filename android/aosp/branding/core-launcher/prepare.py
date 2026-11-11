#!/usr/bin/env python3
"""Prepare the pinned Alpha OS policy packet locally; never mutate an AOSP checkout."""
from pathlib import Path
import argparse
import base64
import difflib
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parent
PIN = json.loads((ROOT / 'SOURCE-INPUTS.json').read_text())
BASE = ROOT / '.cache/baseline'
OUT = ROOT / '.cache/staged'
changes = {}
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fetch', action='store_true', help='Fetch only missing hash-pinned public AOSP inputs')
args = parser.parse_args()
if args.fetch:
    for row in PIN['files']:
        relative = Path(row['path'])
        assert not relative.is_absolute() and '..' not in relative.parts, 'Unsafe input path'
        target = BASE / relative
        if target.exists():
            assert sha(target.read_bytes()) == row['beforeSha256'], 'Existing baseline drift'
            continue
        expected = f"https://android.googlesource.com/platform/frameworks/base/+/{PIN['revision']}/{row['path']}?format=TEXT"
        assert row['url'] == expected, 'Unexpected source host or revision'
        data = base64.b64decode(urllib.request.urlopen(expected, timeout=20).read())
        assert sha(data) == row['beforeSha256'], 'Downloaded source drift'
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream: stream.write(data)

def original(path):
    data = (BASE / path).read_bytes()
    row = next(row for row in PIN['files'] if row['path'] == path)
    assert sha(data) == row['beforeSha256'], 'Pinned source drift: ' + path
    return data.decode()

def replace(text, old, new):
    assert text.count(old) == 1, 'Source anchor drift: ' + old
    return text.replace(old, new, 1)

def edit(path, text):
    changes[path] = (original(path), text)

fgs = 'packages/SystemUI/src/com/android/systemui/qs/FgsManagerController.kt'
text = original(fgs)
text = replace(text, 'if (!uiControlInitialized) {',
    'if (!uiControlInitialized || packageName == AlphaCoreLauncherPolicy.PACKAGE) {')
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
text = replace(text, '            initialized = true', '''            // Refresh cached classification when the owner changes the selected Home app.
            broadcastDispatcher.registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        synchronized(lock) {
                            runningTaskIdentifiers.keys
                                .filter { it.packageName == AlphaCoreLauncherPolicy.PACKAGE }
                                .forEach { it.updateUiControl() }
                            updateNumberOfVisibleRunningPackagesLocked()
                            updateAppItemsLocked()
                        }
                    }
                },
                IntentFilter("android.intent.action.ACTION_PREFERRED_ACTIVITY_CHANGED"),
                executor = backgroundExecutor,
                flags = Context.RECEIVER_NOT_EXPORTED,
            )

            initialized = true''')
edit(fgs, text)

repo = 'packages/SystemUI/src/com/android/systemui/qs/pipeline/data/repository/UserTileSpecRepository.kt'
text = original(repo)
text = replace(text, '    private var isHeadlessSystemUser = false',
    '    private var isHeadlessSystemUser = false\n    private var alphaDefaultsMigrationPending = false')
text = replace(text, '        val loadedTiles = loadTilesFromSettings(userId)',
    '''        val loadedTiles = loadTilesFromSettings(userId)
        val reviewedVersion = withContext(backgroundDispatcher) {
            secureSettings.getIntForUser(AlphaQsDefaultsPolicy.VERSION_SETTING, 0, userId)
        }
        alphaDefaultsMigrationPending = defaultTiles.any { it.spec == AlphaQsDefaultsPolicy.ALPHA } &&
            reviewedVersion < AlphaQsDefaultsPolicy.VERSION
        val selected = if (AlphaQsDefaultsPolicy.shouldMigrate(
                loadedTiles.map { it.spec }, defaultTiles.map { it.spec }, reviewedVersion)) defaultTiles else loadedTiles
        val parsedTiles = parseTileSpecs(selected, userId)''')
text = replace(text, 'TilesUpgradePath.ReadFromSettings(loadedTiles.toSet())',
    'TilesUpgradePath.ReadFromSettings(parsedTiles.toSet())')
text = replace(text, '        return parseTileSpecs(loadedTiles, userId)', '        return parsedTiles')
text = replace(text, '            secureSettings.putStringForUser(SETTING, toStore, null, false, forUser, true)',
    '''            val written = secureSettings.putStringForUser(SETTING, toStore, null, false, forUser, true)
            // Commit the version only after the selected layout was stored. A later owner edit,
            // even one recreating the old stock order, is never migrated a second time.
            if (written && alphaDefaultsMigrationPending && secureSettings.putIntForUser(
                    AlphaQsDefaultsPolicy.VERSION_SETTING, AlphaQsDefaultsPolicy.VERSION, forUser)) {
                alphaDefaultsMigrationPending = false
            }''')
edit(repo, text)

config = 'packages/SystemUI/res/values/config.xml'
text = original(config)
alpha = 'custom(ai.elizaresearch.alphaphone/.AlphaQuickSettingsTile),'
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
text = replace(text, '    private void grantSignatureAppsNotificationPermissions(', '''    /** Primary-user factory default only; explicit owner modes and managed devices are retained. */
    private void grantAlphaSharedStorageDefault(PackageManagerWrapper pm, int userId) {
        if (userId != UserHandle.USER_SYSTEM) return;
        android.app.admin.DevicePolicyManager policy =
                mContext.getSystemService(android.app.admin.DevicePolicyManager.class);
        if (policy == null || policy.getDeviceOwnerComponentOnAnyUser() != null) return;
        PackageInfo pkg = pm.getSystemPackageInfo(AlphaSharedStoragePolicy.PACKAGE);
        if (pkg == null) return;
        android.app.AppOpsManager ops = mContext.getSystemService(android.app.AppOpsManager.class);
        if (ops == null) return;
        int uid = UserHandle.getUid(userId, UserHandle.getAppId(pkg.applicationInfo.uid));
        boolean installed = pkg.applicationInfo.enabled
                && (pkg.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_INSTALLED) != 0
                && (pkg.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SUSPENDED) == 0;
        try {
            int mode = ops.unsafeCheckOpRawNoThrow(
                    android.app.AppOpsManager.OPSTR_MANAGE_EXTERNAL_STORAGE, uid, pkg.packageName);
            if (AlphaSharedStoragePolicy.shouldGrant(userId, pkg.packageName, installed,
                    pkg.applicationInfo.isSystemApp(),
                    com.android.internal.util.ArrayUtils.contains(pkg.requestedPermissions,
                            Manifest.permission.MANAGE_EXTERNAL_STORAGE),
                    mode == android.app.AppOpsManager.MODE_DEFAULT)) {
                ops.setUidMode(android.app.AppOpsManager.OPSTR_MANAGE_EXTERNAL_STORAGE,
                        uid, android.app.AppOpsManager.MODE_ALLOWED);
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
    target = OUT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(after)
    patch.extend(difflib.unified_diff((before or '').splitlines(True), after.splitlines(True),
        fromfile='a/' + path if before is not None else '/dev/null', tofile='b/' + path))
    files.append({'path': path, 'beforeSha256': sha(before.encode()) if before is not None else None,
        'afterSha256': sha(after.encode()), 'new': before is None})
data = ''.join('\n' if line == ' \n' else line for line in patch).encode()
(ROOT / 'alpha-core-launcher.patch').write_bytes(data)
(ROOT / 'manifest.json').write_text(json.dumps({'schema': 1, 'project': PIN['project'],
    'revision': PIN['revision'], 'targetAppId':'ai.elizaresearch.alphaphone', 'patch': 'alpha-core-launcher.patch', 'patchSha256': sha(data),
    'files': files, 'compilation': 'pending', 'imageBuilt': False, 'deviceQualified': False,
    'ownerCustomLayoutsPreserved': True, 'ownerExplicitStorageModesPreserved': True,
    'appPrivateStorageGranted': False, 'crashRecoveryAndVoiceControlsChanged': False}, indent=2) + '\n')
print(json.dumps({'files': len(files), 'sha256': sha(data), 'imageBuilt': False}))
