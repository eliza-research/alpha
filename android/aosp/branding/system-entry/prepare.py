#!/usr/bin/env python3
"""Deterministic, task-local preparation. Does not touch a checkout or a VM."""
from pathlib import Path
import argparse, difflib, hashlib, json, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs-root', type=Path, default=ROOT / '.cache')
args = parser.parse_args()
DATA = args.inputs_root.resolve()
REPO = next(path for path in ROOT.parents if (path / 'app.config.json').is_file())
BASE = DATA / 'baseline'
OUT = DATA / 'staged'
INPUTS = json.loads((ROOT / 'SOURCE-INPUTS.json').read_text())
PREFIX = 'packages/SystemUI/'
changes = {}

def sha(data): return hashlib.sha256(data).hexdigest()
def original(path):
    data = (BASE / path).read_bytes()
    row = next(x for x in INPUTS['files'] if x['path'] == path)
    assert sha(data) == row['beforeSha256'], path
    return data.decode()
def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)
def edit(path, text): changes[path] = (original(path), text)
def add(path, text):
    assert not (BASE / path).exists(), path
    changes[path] = (None, text)

config = PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/'
module = config + 'KeyguardDataQuickAffordanceModule.kt'
text = original(module)
text = replace_once(text, '        fun quickAffordanceConfigs(\n',
    '        fun quickAffordanceConfigs(\n            alpha: AlphaAssistantQuickAffordanceConfig,\n')
text = replace_once(text, '            return setOf(\n', '            return setOf(\n                alpha,\n')
edit(module, text)

add(config + 'AlphaSystemEntryPolicy.java', '''/* Copyright (C) 2026 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0. */
package com.android.systemui.keyguard.data.quickaffordance;

/** Product entry admission only; it never asserts account, inference or microphone state. */
public final class AlphaSystemEntryPolicy {
    public static final String PACKAGE = "ai.elizaresearch.alphaphone";
    public static final String ACTIVITY = PACKAGE + ".AlphaAssistActivity";
    private AlphaSystemEntryPolicy() {}
    public static boolean available(boolean enabled, int user, boolean switching,
            String targetPackage, String targetClass, boolean activityEnabled, boolean exported,
            boolean appEnabled, boolean systemApp, boolean suspended) {
        return enabled && user >= 0 && !switching && PACKAGE.equals(targetPackage)
                && ACTIVITY.equals(targetClass) && activityEnabled && exported && appEnabled
                && systemApp && !suspended;
    }
}
''')

add(config + 'AlphaAssistantQuickAffordanceConfig.kt', '''/* Copyright (C) 2026 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0. */
package com.android.systemui.keyguard.data.quickaffordance

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import com.android.systemui.ActivityIntentHelper
import com.android.systemui.animation.Expandable
import com.android.systemui.common.shared.model.ContentDescription
import com.android.systemui.common.shared.model.Icon
import com.android.systemui.dagger.SysUISingleton
import com.android.systemui.dagger.qualifiers.Main
import com.android.systemui.res.R
import com.android.systemui.settings.UserTracker
import com.android.systemui.shade.ShadeDisplayAware
import java.util.concurrent.Executor
import javax.inject.Inject
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Optional picker choice. Existing slots, defaults, selections and secure-camera paths stay intact. */
@SysUISingleton
class AlphaAssistantQuickAffordanceConfig @Inject constructor(
    @ShadeDisplayAware private val context: Context,
    private val activityIntentHelper: ActivityIntentHelper,
    private val userTracker: UserTracker,
    @Main private val mainExecutor: Executor,
) : KeyguardQuickAffordanceConfig {
    override val key = "alpha_assistant"
    override val pickerIconResourceId = R.drawable.ic_alpha_system_mark
    override fun pickerName() = context.getString(R.string.alpha_system_open_assistant)

    private fun intent() = Intent(Intent.ACTION_ASSIST).apply {
        component = ComponentName(AlphaSystemEntryPolicy.PACKAGE, AlphaSystemEntryPolicy.ACTIVITY)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    private fun available(): Boolean {
        val user = userTracker.userId
        if (!context.resources.getBoolean(R.bool.config_alpha_system_entry_enabled) ||
            userTracker.isUserSwitching) return false
        val target = try {
            // Include non-direct-boot-aware activities: Android's normal strong-auth gate owns launch.
            activityIntentHelper.getTargetActivityInfo(intent(), user, false)
        } catch (_: SecurityException) { null } ?: return false
        val app = target.applicationInfo ?: return false
        return AlphaSystemEntryPolicy.available(
            context.resources.getBoolean(R.bool.config_alpha_system_entry_enabled),
            user, userTracker.isUserSwitching || user != userTracker.userId,
            target.packageName, target.name, target.enabled, target.exported, app.enabled,
            app.flags and ApplicationInfo.FLAG_SYSTEM != 0,
            app.flags and ApplicationInfo.FLAG_SUSPENDED != 0,
        )
    }

    private fun state(): KeyguardQuickAffordanceConfig.LockScreenState =
        if (available()) KeyguardQuickAffordanceConfig.LockScreenState.Visible(
            icon = Icon.Resource(R.drawable.ic_alpha_system_mark,
                ContentDescription.Resource(R.string.alpha_system_unlock_assistant)),
        ) else KeyguardQuickAffordanceConfig.LockScreenState.Hidden

    override val lockScreenState: Flow<KeyguardQuickAffordanceConfig.LockScreenState> = callbackFlow {
        val users = object : UserTracker.Callback {
            override fun onBeforeUserSwitching(newUser: Int) {
                trySend(KeyguardQuickAffordanceConfig.LockScreenState.Hidden)
            }
            override fun onUserChanged(newUser: Int, userContext: Context) { trySend(state()) }
        }
        val packages = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.data?.schemeSpecificPart == AlphaSystemEntryPolicy.PACKAGE) trySend(state())
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addDataScheme("package")
        }
        userTracker.addCallback(users, mainExecutor)
        var registered = false
        try {
            context.registerReceiver(packages, filter, Context.RECEIVER_NOT_EXPORTED)
            registered = true
            trySend(state())
            awaitClose { }
        } finally {
            userTracker.removeCallback(users)
            if (registered) context.unregisterReceiver(packages)
        }
    }

    override suspend fun getPickerScreenState(): KeyguardQuickAffordanceConfig.PickerScreenState =
        if (available()) KeyguardQuickAffordanceConfig.PickerScreenState.Default()
        else KeyguardQuickAffordanceConfig.PickerScreenState.UnavailableOnDevice

    override fun onTriggered(expandable: Expandable?): KeyguardQuickAffordanceConfig.OnTriggeredResult {
        if (!available()) return KeyguardQuickAffordanceConfig.OnTriggeredResult.Handled(false)
        // Existing interactor requires unlock/strong-auth; no caller data, capture or Cloud request.
        return KeyguardQuickAffordanceConfig.OnTriggeredResult.StartActivity(
            intent = intent(), canShowWhileLocked = false,
        )
    }
}
''')

view_path = PREFIX + 'src/com/android/systemui/shade/AlphaShadeWordmarkView.java'
add(PREFIX + 'src/com/android/systemui/shade/AlphaShadeWordmarkPolicy.java', '''/* Copyright (C) 2026 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0. */
package com.android.systemui.shade;

/** Pure decorative admission; an existing control or privacy indicator always wins. */
public final class AlphaShadeWordmarkPolicy {
    private AlphaShadeWordmarkPolicy() {}
    public static boolean fits(boolean enabled, float width, float height,
            float requiredWidth, float requiredHeight, boolean collision) {
        return enabled && !collision && Float.isFinite(width) && Float.isFinite(height)
                && Float.isFinite(requiredWidth) && Float.isFinite(requiredHeight)
                && requiredWidth > 0 && requiredHeight > 0
                && width >= requiredWidth && height >= requiredHeight;
    }
}
''')
add(view_path, '''/* Copyright (C) 2026 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0. */
package com.android.systemui.shade;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Typeface;
import android.graphics.Rect;
import android.util.AttributeSet;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.widget.TextView;
import com.android.systemui.res.R;
import com.android.systemui.statusbar.policy.Clock;
import com.android.systemui.privacy.AbstractOngoingPrivacyChip;

/** Decorative identity in reserved header space. Never a status chip or an interactive action. */
public final class AlphaShadeWordmarkView extends TextView {
    private final Rect brandBounds = new Rect();
    private final Rect otherBounds = new Rect();
    public AlphaShadeWordmarkView(Context context) { this(context, null); }
    public AlphaShadeWordmarkView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setText(R.string.alpha_system_brand);
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        setTypeface(Typeface.create("serif", Typeface.NORMAL));
        setSingleLine(true);
        setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        setClickable(false);
        setFocusable(false);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        // Header is text-only: TextView's relative compound drawable can anchor independently
        // of END-aligned text in a wide constraint slot. The picker keeps Alpha's exact mark.
    }

    /** Text scales normally. If the reserved slot cannot contain it, omit decoration, not controls. */
    @Override protected void onDraw(Canvas canvas) {
        float requiredWidth = getPaint().measureText(getText().toString())
                + getCompoundPaddingLeft() + getCompoundPaddingRight();
        float requiredHeight = getPaint().getFontMetrics().bottom - getPaint().getFontMetrics().top
                + getCompoundPaddingTop() + getCompoundPaddingBottom();
        boolean enabled = getResources().getBoolean(R.bool.config_alpha_system_entry_enabled);
        if (!AlphaShadeWordmarkPolicy.fits(enabled, getWidth(), getHeight(),
                requiredWidth, requiredHeight, false) || !getGlobalVisibleRect(brandBounds)) return;
        // Crop to the actual END-aligned wordmark, not its wider match-constraint slot.
        int contentWidth = (int) Math.ceil(requiredWidth);
        if (getLayoutDirection() == LAYOUT_DIRECTION_RTL) brandBounds.right = brandBounds.left + contentWidth;
        else brandBounds.left = brandBounds.right - contentWidth;
        // Clock rendering is transformed during expansion. Measured layout slots alone do not
        // establish non-overlap. A positive visual collision drops decoration for this frame.
        if (collides(getRootView())) return;
        super.onDraw(canvas);
    }

    private boolean collides(View view) {
        if (view == this || !view.isShown()) return false;
        if ((view instanceof Clock || view instanceof AbstractOngoingPrivacyChip)
                && visiblyOpaque(view) && view.getGlobalVisibleRect(otherBounds)
                && Rect.intersects(brandBounds, otherBounds)) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (collides(group.getChildAt(i))) return true;
        }
        return false;
    }

    private boolean visiblyOpaque(View view) {
        for (View current = view; current != null;) {
            if (current.getAlpha() <= 0f) return false;
            ViewParent parent = current.getParent();
            current = parent instanceof View ? (View) parent : null;
        }
        return true;
    }
}
''')

compose = PREFIX + 'compose/features/src/com/android/systemui/shade/ui/composable/ShadeHeader.kt'
text = original(compose)
start = text.index('fun ContentScope.ExpandedShadeHeader(')
end = text.index('/**\n * The status bar that appears above both', start)
body = text[start:end]
body = replace_once(body,
    '    Box(modifier = modifier.sysuiResTag(ShadeHeader.TestTags.Root)) {\n',
    '''    Box(modifier = modifier.sysuiResTag(ShadeHeader.TestTags.Root)) {
        // The reserved privacy band is otherwise empty. Decorative identity yields to privacy.
        if (LocalContext.current.resources.getBoolean(R.bool.config_alpha_system_entry_enabled) &&
            !viewModel.isPrivacyChipVisible) {
            AndroidView(
                factory = { com.android.systemui.shade.AlphaShadeWordmarkView(it) },
                update = { it.setTextColor(textColor.toArgb()) },
                modifier = Modifier.align(Alignment.TopEnd)
                    .height(viewModel.statusBarHeightPx.toDp(LocalContext.current).dp)
                    .widthIn(max = 180.dp),
            )
        }
''')
text = text[:start] + body + text[end:]
edit(compose, text)

layout = PREFIX + 'res/layout/combined_qs_header.xml'
text = original(layout)
text = replace_once(text, '\n    <androidx.constraintlayout.widget.Guideline\n        android:id="@+id/qqs_header_bottom_guideline"', '''
    <!-- Reserved expanded-header band only. This view does not take input or displace controls. -->
    <com.android.systemui.shade.AlphaShadeWordmarkView
        android:id="@+id/alpha_shade_wordmark"
        android:layout_width="0dp"
        android:layout_height="0dp"
        android:layout_marginEnd="8dp"
        android:alpha="0"
        android:importantForAccessibility="no"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toStartOf="@id/privacy_container"
        app:layout_constraintTop_toTopOf="parent"
        app:layout_constraintBottom_toBottomOf="@id/privacy_container" />

    <androidx.constraintlayout.widget.Guideline
        android:id="@+id/qqs_header_bottom_guideline"''')
edit(layout, text)

# Each constraint set adds only our view. Existing IDs, rules and privacy/clock transitions stay exact.
for filename, alpha, expanded in [('qs_header.xml', '1', True), ('qqs_header.xml', '0', False),
                                   ('large_screen_shade_header.xml', '0', False)]:
    path = PREFIX + 'res/xml/' + filename
    text = original(path)
    node = '''
    <Constraint android:id="@id/alpha_shade_wordmark">
        <Layout
            android:layout_width="0dp"
            android:layout_height="0dp"
            android:layout_marginEnd="8dp"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toStartOf="@id/privacy_container"
            app:layout_constraintTop_toTopOf="parent"
            app:layout_constraintBottom_toBottomOf="@id/privacy_container" />
        <PropertySet android:alpha="''' + alpha + '''" />
    </Constraint>
'''
    edit(path, replace_once(text, '</ConstraintSet>', node + '\n</ConstraintSet>'))

add(PREFIX + 'res/values/alpha_system_entry.xml', '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Default off; the Alpha product overlay enables this additive native presentation. -->
    <bool name="config_alpha_system_entry_enabled">false</bool>
    <string name="alpha_system_brand" translatable="false">Alpha</string>
    <string name="alpha_system_open_assistant">Open Alpha</string>
    <string name="alpha_system_unlock_assistant">Unlock to open Alpha</string>
</resources>
''')
logo = REPO / 'apps/app/public/logo-mark.svg'
svg = ET.fromstring(logo.read_text())
assert svg.attrib['viewBox'] == '0 0 120 120'
paths = [x.attrib['d'] for x in svg if x.tag.endswith('path')]
assert len(paths) == 1
add(PREFIX + 'res/drawable/ic_alpha_system_mark.xml', '''<?xml version="1.0" encoding="utf-8"?>
<!-- Exact path from Alpha's existing logo-mark.svg; tint is supplied by the native surface. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="120" android:viewportHeight="120">
    <path android:fillColor="#FFFFFFFF" android:pathData="''' + paths[0] + '''" />
</vector>
''')

if OUT.exists():
    # Regenerate only previously recorded task outputs, never an external tree.
    assert OUT.parent == DATA and OUT.name == 'staged'
else: OUT.mkdir(parents=True)
for row in INPUTS['files']:
    target = OUT / row['path']; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((BASE / row['path']).read_bytes())
patch = []
manifest = []
for path, (before, after) in sorted(changes.items()):
    target = OUT / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text(after)
    patch.extend(difflib.unified_diff((before or '').splitlines(True), after.splitlines(True),
        fromfile='a/'+path if before is not None else '/dev/null', tofile='b/'+path))
    manifest.append({'path':path,'beforeSha256':sha(before.encode()) if before is not None else None,
                     'afterSha256':sha(after.encode()),'new':before is None})
# Unified patches need explicit markers for upstream XML that intentionally lacks an EOF newline.
patch_bytes=''.join(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n'
                    for line in patch).encode()
reviewed = json.loads((ROOT/'manifest.json').read_text())
assert sha(patch_bytes) == reviewed['patchSha256'], 'Generated patch differs from reviewed manifest'
(DATA/'alpha-native-system-entry.patch').write_bytes(patch_bytes)
overlay=DATA/'product-overlay/values/alpha-system-entry.xml';overlay.parent.mkdir(parents=True,exist_ok=True)
overlay.write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="config_alpha_system_entry_enabled">true</bool>
    <bool name="custom_lockscreen_shortcuts_enabled">true</bool>
    <string-array name="config_keyguardQuickAffordanceDefaults" translatable="false">
        <item>bottom_start:alpha_assistant</item>
        <item>bottom_end:camera</item>
    </string-array>
</resources>
''')
record={'schema':1,'project':'frameworks/base','revision':INPUTS['revision'],
    'patch':'alpha-native-system-entry.patch','patchSha256':sha(patch_bytes),'files':manifest,
    'identity':{'source':str(logo.relative_to(REPO)),'sourceSha256':sha(logo.read_bytes()),'exactSvgPathPreserved':True,
                'font':'Android serif system family; no new font payload','header':'Text-only wordmark in native foreground; keyguard icon uses existing native product tint','existingProductBlue':'#0000FF','existingProductDarkBlue':'#B8C0FF'},
    'productOverlay':{'path':'product-overlay/values/alpha-system-entry.xml','sha256':sha(overlay.read_bytes()),
        'resources':{'config_alpha_system_entry_enabled':True,'custom_lockscreen_shortcuts_enabled':True,
            'config_keyguardQuickAffordanceDefaults':['bottom_start:alpha_assistant','bottom_end:camera']},
        'destination':'Existing AlphaSystemUIOverlay resource directory; do not add another competing overlay package'},
    'selectionDefaultsChanged':True,'savedSelectionsChanged':False,'compilation':'pending','imageBuilt':False,'deviceQualified':False}
(DATA/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patchSHA256':record['patchSha256'],'compilation':'pending'}))
