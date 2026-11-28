from pathlib import Path
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
BRANDING_SYSTEM_ENTRY = ROOT.parent / 'branding' / 'system-entry'
sys.path.insert(0, str(BRANDING_SYSTEM_ENTRY))

from portable_tools import android_api_jar, find_repo_root, java_binary

REPO = find_repo_root(ROOT)
API = android_api_jar(36)
ANDROID_NS = '{http://schemas.android.com/apk/res/android}'
RELEASE_SIGNER = ROOT.parent / 'signing' / 'release-signer.json'


def find_aidl_binary():
    explicit = os.environ.get('ALPHA_AIDL_BIN')
    if explicit:
        return Path(explicit).expanduser().resolve()
    sdk_root = API.parent.parent.parent
    build_tools = sdk_root / 'build-tools'
    if build_tools.is_dir():
        candidates = sorted(build_tools.iterdir(), reverse=True)
        for directory in candidates:
            candidate = directory / 'aidl'
            if candidate.is_file():
                return candidate
    raise RuntimeError(f'aidl binary not found under {build_tools}')


HIDDEN_API_STUBS = {
    'android/os/InputEventInjectionSync.java': (
        'package android.os;'
        'public interface InputEventInjectionSync {'
        '    int NONE = 0;'
        '    int WAIT_FOR_RESULT = 1;'
        '    int WAIT_FOR_FINISHED = 2;'
        '}'
    ),
    'android/hardware/input/InputManagerGlobal.java': (
        'package android.hardware.input;'
        'import android.view.InputEvent;'
        'public final class InputManagerGlobal {'
        '    public static InputManagerGlobal getInstance() { return null; }'
        '    public boolean injectInputEvent(InputEvent event, int mode) { return false; }'
        '}'
    ),
    'android/window/ScreenCapture.java': (
        'package android.window;'
        'public final class ScreenCapture {'
        '    public static final class ScreenCaptureParams {'
        '        public static final int SECURE_CONTENT_POLICY_REDACT = 0;'
        '        public static final int SECURE_CONTENT_POLICY_CAPTURE = 1;'
        '        public static final int SECURE_CONTENT_POLICY_THROW_EXCEPTION = 2;'
        '        public static final int PROTECTED_CONTENT_POLICY_REDACT = 0;'
        '    }'
        '}'
    ),
    'android/window/ScreenCaptureInternal.java': (
        'package android.window;'
        'import android.graphics.Bitmap;'
        'import android.graphics.ColorSpace;'
        'import android.hardware.HardwareBuffer;'
        'public final class ScreenCaptureInternal {'
        '    public static class CaptureArgs {'
        '        public static class Builder<T extends Builder<T>> {'
        '            @SuppressWarnings("unchecked")'
        '            protected T getThis() { return (T) this; }'
        '            public T setSecureContentPolicy(int policy) { return getThis(); }'
        '            public T setProtectedContentPolicy(int policy) { return getThis(); }'
        '            public CaptureArgs build() { return new CaptureArgs(); }'
        '        }'
        '    }'
        '    public static class ScreenCaptureListener {}'
        '    public static abstract class SynchronousScreenCaptureListener extends ScreenCaptureListener {'
        '        public abstract ScreenshotHardwareBuffer getBuffer();'
        '    }'
        '    public static class ScreenshotHardwareBuffer {'
        '        public HardwareBuffer getHardwareBuffer() { return null; }'
        '        public ColorSpace getColorSpace() { return null; }'
        '        public boolean containsSecureLayers() { return false; }'
        '        public Bitmap asBitmap() { return null; }'
        '    }'
        '    public static SynchronousScreenCaptureListener createSyncCaptureListener() { return null; }'
        '}'
    ),
    'android/view/IWindowManager.java': (
        'package android.view;'
        'import android.os.RemoteException;'
        'import android.window.ScreenCaptureInternal;'
        'public interface IWindowManager {'
        '    void captureDisplay(int displayId, ScreenCaptureInternal.CaptureArgs captureArgs,'
        '            ScreenCaptureInternal.ScreenCaptureListener listener) throws RemoteException;'
        '}'
    ),
    'android/view/WindowManagerGlobal.java': (
        'package android.view;'
        'public final class WindowManagerGlobal {'
        '    public static IWindowManager getWindowManagerService() { return null; }'
        '}'
    ),
}


class ControlBridgePlanTest(unittest.TestCase):
    def test_aosp_build_manifest_permissions_and_sepolicy_invariants(self):
        bp = (ROOT / 'Android.bp').read_text()
        self.assertIn('name: "AlphaControlBridge"', bp)
        self.assertIn('privileged: true', bp)
        self.assertIn('product_specific: true', bp)
        self.assertIn('certificate: "platform"', bp)
        self.assertIn('platform_apis: true', bp)
        self.assertIn('name: "AlphaControlBridgePrivappPermissions"', bp)

        mk = (ROOT / 'control-bridge.mk').read_text()
        self.assertIn('AlphaControlBridge', mk)
        self.assertIn('AlphaControlBridgePrivappPermissions', mk)
        self.assertIn('SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += $(alpha_control_bridge_dir)/sepolicy', mk)

        manifest = ET.fromstring((ROOT / 'AndroidManifest.xml').read_text())
        self.assertEqual(manifest.attrib['package'], 'ai.alphacompute.controlbridge')
        perms = {node.attrib[ANDROID_NS + 'name'] for node in manifest.findall('uses-permission')}
        self.assertEqual(perms, {
            'android.permission.INJECT_EVENTS',
            'android.permission.READ_FRAME_BUFFER',
            'android.permission.ACCESS_SURFACE_FLINGER',
            'android.permission.WRITE_SECURE_SETTINGS',
        })
        self.assertNotIn('android.permission.INTERNET', perms)

        privapp = ET.fromstring((ROOT / 'privapp-permissions-alpha-control.xml').read_text())
        blocks = privapp.findall('privapp-permissions')
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].attrib['package'], 'ai.alphacompute.controlbridge')
        granted = {p.attrib['name'] for p in blocks[0].findall('permission')}
        self.assertEqual(granted, {
            'android.permission.READ_FRAME_BUFFER',
            'android.permission.WRITE_SECURE_SETTINGS',
        })

        te = (ROOT / 'sepolicy' / 'alpha_control_bridge.te').read_text()
        self.assertIn('type alpha_control_bridge, domain, coredomain;', te)
        self.assertIn('app_domain(alpha_control_bridge)', te)
        self.assertNotIn('net_domain(', te)
        self.assertIn('neverallow alpha_control_bridge self:{ tcp_socket udp_socket rawip_socket icmp_socket packet_socket }', te)
        for svc in ['window_service', 'input_service', 'surfaceflinger_service', 'accessibility_service', 'settings_service']:
            self.assertIn(svc, te)

        seapp = (ROOT / 'sepolicy' / 'seapp_contexts').read_text().strip()
        self.assertIn('seinfo=platform', seapp)
        self.assertIn('name=ai.alphacompute.controlbridge', seapp)
        self.assertIn('isPrivApp=true', seapp)
        self.assertIn('domain=alpha_control_bridge', seapp)

        service_src = (ROOT / 'src/ai/alphacompute/control/AlphaControlBridgeService.java').read_text()
        self.assertIn('static final boolean CAPTURE_SECURE_LAYERS = false;', service_src)
        self.assertIn('PackageManager.MATCH_SYSTEM_ONLY', service_src)
        self.assertIn('hasSigningCertificate(', service_src)
        self.assertIn('isKeyguardLocked()', service_src)
        self.assertIn('isDeviceLocked()', service_src)
        self.assertIn('isUserUnlocked()', service_src)
        self.assertIn('ai.alphacompute.alphaphone/ai.alphacompute.control.AlphaAccessibilityService', service_src)
        self.assertNotIn('//', service_src)

    def test_aidl_compiles_with_android_api36_and_policy_runs_on_jvm(self):
        self.assertTrue(API.exists(), 'Android API 36 android.jar required')
        aidl_bin = find_aidl_binary()
        expected_signer = json.loads(RELEASE_SIGNER.read_text())['signerSha256'].lower()
        self.assertRegex(expected_signer, r'^[0-9a-f]{64}$')

        with tempfile.TemporaryDirectory(prefix='alpha-control-bridge-') as directory:
            tmp = Path(directory)
            gen_dir = tmp / 'gen'
            stub_dir = tmp / 'stubs'
            classes_dir = tmp / 'classes'
            gen_dir.mkdir()
            stub_dir.mkdir()
            classes_dir.mkdir()

            aidl_file = ROOT / 'aidl/ai/alphacompute/control/IAlphaControlBridge.aidl'
            subprocess.run(
                [str(aidl_bin), f'-I{ROOT / "aidl"}', f'-o{gen_dir}', str(aidl_file)],
                check=True,
                capture_output=True,
            )
            generated_aidl = gen_dir / 'ai/alphacompute/control/IAlphaControlBridge.java'
            self.assertTrue(generated_aidl.is_file())

            compile_files = [
                str(generated_aidl),
                str(ROOT / 'src/ai/alphacompute/control/AlphaControlBridgeService.java'),
            ]
            for rel, content in HIDDEN_API_STUBS.items():
                path = stub_dir / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                compile_files.append(str(path))

            harness = tmp / 'BridgePolicyTest.java'
            harness.write_text(f'''
package ai.alphacompute.control;

import android.view.KeyEvent;
import android.view.MotionEvent;

public final class BridgePolicyTest {{
    private static void check(boolean condition, String label) {{
        if (!condition) {{
            throw new AssertionError("Failed: " + label);
        }}
    }}

    private static String toHex(byte[] bytes) {{
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {{
            sb.append(String.format("%02x", b & 0xff));
        }}
        return sb.toString();
    }}

    public static void main(String[] args) {{
        check(AlphaControlBridgeService.PROTOCOL_VERSION == 1, "protocol version");
        check(!AlphaControlBridgeService.CAPTURE_SECURE_LAYERS, "secure layers hardcoded false");
        check("{expected_signer}".equals(toHex(AlphaControlBridgeService.ALPHA_SIGNER_SHA256)),
                "signer digest matches release-signer.json");
        check(AlphaControlBridgeService.ALPHA_DEBUG_SIGNER_HEX.equals(
                toHex(AlphaControlBridgeService.decodeHexDigest(
                        AlphaControlBridgeService.ALPHA_DEBUG_SIGNER_HEX))),
                "debug signer hex decodes cleanly");
        check(AlphaControlBridgeService.isAuthorizedSigner(false, true, false),
                "user build accepts release signer");
        check(!AlphaControlBridgeService.isAuthorizedSigner(false, false, true),
                "user build strictly rejects debug signer");
        check(AlphaControlBridgeService.isAuthorizedSigner(true, false, true),
                "userdebug build accepts debug signer");
        check(!AlphaControlBridgeService.isAuthorizedSigner(true, false, false),
                "userdebug build rejects unknown signer");

        String talkback = "com.google.android.marvin.talkback/.TalkBackService";
        String alpha = AlphaControlBridgeService.ALPHA_ACCESSIBILITY_COMPONENT;
        String enabled = AlphaControlBridgeService.updateEnabledAccessibilityServices(talkback, true);
        check(enabled.equals(talkback + ":" + alpha), "preserves TalkBack when enabling Alpha");

        String deduped = AlphaControlBridgeService.updateEnabledAccessibilityServices(
                talkback + ":ai.alphacompute.alphaphone/.control.AlphaAccessibilityService:" + alpha, true);
        check(deduped.equals(talkback + ":" + alpha), "deduplicates shorthand and full Alpha entries");

        String disabled = AlphaControlBridgeService.updateEnabledAccessibilityServices(enabled, false);
        check(disabled.equals(talkback), "disabling Alpha leaves TalkBack untouched");

        check(AlphaControlBridgeService.updateEnabledAccessibilityServices(alpha, false).isEmpty(),
                "disabling sole Alpha entry yields empty list");

        check(AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_ENTER), "allows ENTER");
        check(AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_DEL), "allows DEL");
        check(AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_BACK), "allows BACK");
        check(!AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_POWER), "blocks POWER");
        check(!AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_HOME), "blocks HOME");
        check(!AlphaControlBridgeService.isAllowedKeyCode(KeyEvent.KEYCODE_VOLUME_UP), "blocks VOLUME_UP");

        check(AlphaControlBridgeService.isAllowedMotionAction(MotionEvent.ACTION_DOWN), "allows DOWN");
        check(AlphaControlBridgeService.isAllowedMotionAction(MotionEvent.ACTION_MOVE), "allows MOVE");
        check(AlphaControlBridgeService.isAllowedMotionAction(MotionEvent.ACTION_UP), "allows UP");
        check(AlphaControlBridgeService.isAllowedMotionAction(MotionEvent.ACTION_CANCEL), "allows CANCEL");
        check(!AlphaControlBridgeService.isAllowedMotionAction(MotionEvent.ACTION_OUTSIDE), "blocks OUTSIDE");

        check(AlphaControlBridgeService.isValidCoordinate(10.5f, 20.0f), "valid coords");
        check(!AlphaControlBridgeService.isValidCoordinate(-1.0f, 0.0f), "rejects negative X");
        check(!AlphaControlBridgeService.isValidCoordinate(Float.NaN, 0.0f), "rejects NaN");

        check(AlphaControlBridgeService.clampMaxWidth(100) == 360, "clamps min width");
        check(AlphaControlBridgeService.clampMaxWidth(4096) == 1440, "clamps max width");
        check(AlphaControlBridgeService.clampJpegQuality(10) == 40, "clamps min quality");
        check(AlphaControlBridgeService.clampJpegQuality(100) == 85, "clamps max quality");
        System.out.println("PASS control-bridge compile and policy tests");
    }}
}}
''')
            compile_files.append(str(harness))

            subprocess.run(
                [
                    java_binary('javac'),
                    '--release', '17',
                    '-Xlint:all',
                    '-classpath', str(API),
                    '-d', str(classes_dir),
                    *compile_files,
                ],
                check=True,
                capture_output=True,
            )
            output = subprocess.check_output(
                [
                    java_binary('java'),
                    '-cp', f'{classes_dir}:{API}',
                    'ai.alphacompute.control.BridgePolicyTest',
                ],
                text=True,
            )
            self.assertIn('PASS control-bridge compile and policy tests', output)


if __name__ == '__main__':
    unittest.main(verbosity=2)
