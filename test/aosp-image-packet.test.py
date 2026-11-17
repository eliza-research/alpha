"""Hermetic checks of the canonical Pixel source-packet admission and stage preimages.

Runs from test/python-suites.test.mjs with only repository files, Bun and synthetic stage
fixtures: no AOSP checkout, generated branding assets or signed APK. The full packet run over
pinned AOSP inputs stays in aosp-fresh-presets.test.py. Neither proves an actual signed image.
"""
from pathlib import Path
import importlib.util, json, os, subprocess, tempfile, unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('alpha_branding_stage', REPO/'scripts/stage-alpha-os-branding.py')
stage = importlib.util.module_from_spec(spec); spec.loader.exec_module(stage)
BUN = os.environ.get('ALPHA_BUN', 'bun')
CANONICAL = json.loads((REPO/'app.config.json').read_text())['appId']
RETAINED = 'ai.elizaresearch.alphaphone'
run = subprocess.check_output

def bun(code, *args):
    return run([BUN, '-e', code, *args], text=True, cwd=REPO)

def tree(package, *flags):
    return run([BUN, 'test/fixtures/telephony-launcher-tree.mjs', package, *flags], text=True, cwd=REPO)

class ImagePacket(unittest.TestCase):
    def stage_dir(self, root):
        """A synthetic published image stage; the APK bytes are a boundary fixture, not an APK."""
        apk = root/'Launcher.apk'; apk.write_bytes(b'isolated signed-tool boundary fixture, not an APK')
        config = json.loads((REPO/'app.config.json').read_text())
        product = json.loads((REPO/'android/aosp/pixel10a-product.json').read_text())
        self.signer = json.loads((REPO/product['signer']['apkDescriptor']).read_text())['signerSha256']
        self.descriptor = {'packageName': CANONICAL, 'moduleName': config['moduleName'], 'apkSha256': stage.digest(apk.read_bytes()),
                           'certificateSha256': self.signer, 'development': False}
        (root/'launcher.json').write_text(json.dumps(self.descriptor))
        handlers = root/'provisioning/alpha-telephony-components.xml'; handlers.parent.mkdir(parents=True)
        handlers.write_text('isolated normal-stage handler binding fixture')
        self.product = product

    def admission(self, root, app_id=CANONICAL, **overrides):
        # The admission comes from stage-aosp's own exported builder, the same code main() runs.
        values = {'output': str(root), 'appId': app_id, 'apkSha256': self.descriptor['apkSha256'],
                  'sourceLockSha256': self.product['sourceLock']['sha256'],
                  'platformCertificateSha256': self.product['signer']['platformCertificateSha256'], **overrides}
        return json.loads(bun('const {imagePolicyAdmission} = await import("./scripts/stage-aosp.ts");'
                              'console.log(JSON.stringify(imagePolicyAdmission(JSON.parse(process.argv.at(-1)))));', json.dumps(values)))

    def tools(self, manifest, package=CANONICAL, signer=None, badging_extra=''):
        def call(args, **kwargs):
            if args[0] == 'apksigner-fixture': return 'Signer #1 certificate SHA-256 digest: ' + (signer or self.signer) + '\n'
            if args[0] == BUN: return run(args, **kwargs, stderr=subprocess.PIPE)
            self.assertEqual(args[0], 'aapt-fixture')
            if args[2] == 'xmltree': return manifest['tree']
            return "package: name='" + package + "' versionCode='80'\n" + badging_extra
        return call

    def test_stage_aosp_admission_is_accepted_and_every_binding_is_rechecked(self):
        with tempfile.TemporaryDirectory(prefix='alpha-image-packet-') as d:
            root = Path(d); self.stage_dir(root)
            admission = self.admission(root)
            self.assertEqual(admission['packageName'], CANONICAL)
            file = root/'image-policy-admission.json'; file.write_text(json.dumps(admission))
            manifest = {'tree': tree(CANONICAL)}
            with patch.object(stage.subprocess, 'check_output', side_effect=self.tools(manifest)):
                self.assertEqual(stage.image_identity(root, 'aapt-fixture', 'apksigner-fixture'), admission)
                # The receiver and nine-handler qualifiers run through the production TypeScript.
                for broken in [tree(CANONICAL, '--without-setup-receiver'), manifest['tree'].replace('BIND_INCALL_SERVICE', 'UNRELATED'),
                               manifest['tree'].replace(CANONICAL, 'other.package')]:
                    with self.subTest(manifest=broken[-60:]):
                        manifest['tree'] = broken
                        with self.assertRaises(subprocess.CalledProcessError): stage.image_identity(root, 'aapt-fixture', 'apksigner-fixture')
                manifest['tree'] = tree(CANONICAL)
                for key, value in [('schema', 2), ('packageName', RETAINED), ('packageName', 'unknown.package'), ('apkSha256', '0'*64),
                                   ('launcherDescriptorSha256', '0'*64), ('sourceLockSha256', '0'*64),
                                   ('platformCertificateSha256', '0'*64), ('handlerDefaultsSha256', '0'*64)]:
                    with self.subTest(key=key, value=value):
                        file.write_text(json.dumps({**admission, key: value}))
                        with self.assertRaises(AssertionError): stage.image_identity(root, 'aapt-fixture', 'apksigner-fixture')
                file.write_text(json.dumps(admission))
            # A debuggable launcher, a different packaged name or signer is refused from the tools' own output.
            for kwargs, message in [({'badging_extra': 'application-debuggable\n'}, 'debuggable'),
                                    ({'package': 'other.package'}, 'canonical identity'),
                                    ({'signer': '0'*64}, 'Staged APK signer')]:
                with self.subTest(message=message), patch.object(stage.subprocess, 'check_output', side_effect=self.tools(manifest, **kwargs)):
                    with self.assertRaisesRegex(AssertionError, message): stage.image_identity(root, 'aapt-fixture', 'apksigner-fixture')

    def test_stage_aosp_never_builds_an_admission_for_another_identity_or_without_evidence(self):
        with tempfile.TemporaryDirectory(prefix='alpha-image-packet-') as d:
            root = Path(d); self.stage_dir(root)
            for app_id, overrides, message in [(RETAINED, {}, 'staged only for ' + CANONICAL),
                                               (CANONICAL, {'sourceLockSha256': None}, 'admitted sourceLockSha256'),
                                               (CANONICAL, {'platformCertificateSha256': 'x'}, 'admitted platformCertificateSha256')]:
                with self.subTest(message=message):
                    with self.assertRaises(subprocess.CalledProcessError) as raised:
                        run([BUN, '-e', 'const {imagePolicyAdmission} = await import("./scripts/stage-aosp.ts");'
                             'imagePolicyAdmission(JSON.parse(process.argv.at(-1)));',
                             json.dumps({'output': str(root), 'appId': app_id, 'apkSha256': self.descriptor['apkSha256'],
                                         'sourceLockSha256': self.product['sourceLock']['sha256'],
                                         'platformCertificateSha256': self.product['signer']['platformCertificateSha256'], **overrides})],
                            text=True, cwd=REPO, stderr=subprocess.PIPE)
                    self.assertIn(message, raised.exception.stderr)

    def test_packet_command_pins_the_generated_product_and_the_planner_reads_that_stage(self):
        with tempfile.TemporaryDirectory(prefix='alpha-image-packet-') as d:
            root = Path(d); generated = b'# Generated Pixel launcher stage product\n'
            (root/'product.mk').write_bytes(generated)
            command = json.loads(bun('const [output] = process.argv.slice(-1);'
                'console.log(JSON.stringify((await import("./scripts/stage-aosp.ts")).brandingPacketCommand('
                '{output, source: "/aosp", assets: "/assets", reportSha256: "0".repeat(64), aapt: "aapt-fixture", apksigner: "apksigner-fixture"})));', str(root)))
            branded = (root/'product.mk').read_bytes()
            # stage-aosp appends exactly the planner's include and passes the pre-include hash.
            self.assertEqual(branded, generated + stage.BRANDING_SUFFIX)
            self.assertEqual(command[command.index('--product-mk-sha256')+1], stage.digest(generated))
            self.assertEqual(command[command.index('--image-stage')+1], str(root))
            self.assertEqual(Path(command[command.index('--packet-output')+1]).parent, root)
            self.assertNotIn('--source-inputs', command); self.assertNotIn('--apply', command)
            self.assertIsNone(stage.branding_product(branded, stage.digest(generated), root))
            for current, pin in [(b'# other\n' + branded, stage.digest(generated)), (branded, stage.digest(b'other')), (generated, stage.digest(generated)),
                                 (branded + stage.BRANDING_SUFFIX, stage.digest(generated + stage.BRANDING_SUFFIX))]:
                with self.subTest(current=current[-40:]), self.assertRaises(AssertionError):
                    stage.branding_product(current, pin, root)
            # Without an image stage the source-tree path keeps its explicit preimage pin.
            self.assertEqual(stage.branding_product(generated, stage.digest(generated), None), branded)
            with self.assertRaisesRegex(AssertionError, 'preimage pin'): stage.branding_product(generated, stage.digest(b'other'), None)
            # vendor/alphaphone preimages come from the image stage, never from the source tree.
            source = root/'aosp'
            self.assertEqual(stage.stage_preimage(source, root, 'vendor/alphaphone/product.mk'), root/'product.mk')
            self.assertEqual(stage.stage_preimage(source, root, 'frameworks/base/x'), source/'frameworks/base/x')
            self.assertEqual(stage.stage_preimage(source, None, 'vendor/alphaphone/product.mk'), source/'vendor/alphaphone/product.mk')
            with self.assertRaisesRegex(AssertionError, 'Unsafe'): stage.stage_preimage(source, root, 'vendor/alphaphone/../x')

    def test_exact_packet_command_plans_from_the_image_stage_not_the_source_tree(self):
        """main() runs with brandingPacketCommand's exact argv. Pinned AOSP objects and the core
        policy are synthetic ports here; the stage/source-tree preimage selection is the real code."""
        with tempfile.TemporaryDirectory(prefix='alpha-image-packet-') as d:
            root = Path(d); image = root/'stage'; image.mkdir(); aosp = root/'aosp'; assets = root/'assets'; assets.mkdir()
            generated = b'# Generated Pixel launcher stage product\n'; (image/'product.mk').write_bytes(generated)
            branding = 'vendor/alphaphone/branding/branding.mk'; reviewed = (stage.BRAND/'branding.mk').read_bytes()
            # The stage holds the reviewed branding bytes; an older source-tree install holds other bytes.
            (image/'branding').mkdir(); (image/'branding/branding.mk').write_bytes(reviewed)
            (aosp/'vendor/alphaphone/branding').mkdir(parents=True)
            (aosp/'vendor/alphaphone/product.mk').write_bytes(b'# older source-tree install\n')
            (aosp/branding).write_bytes(b'# older unreviewed branding\n')
            for name, data in [('bootanimation.zip', b'boot fixture'), ('default_wallpaper.png', b'wallpaper fixture')]: (assets/name).write_bytes(data)
            (assets/'branding-assets.json').write_text(json.dumps({'sourceLogoSha256': stage.digest((REPO/'apps/app/public/logo-mark.svg').read_bytes()),
                'width': 1080, 'height': 2424, 'accent': '#0000FF', 'wallpaperBackground': '#000000',
                'bootAnimationSha256': stage.digest(b'boot fixture'), 'wallpaperSha256': stage.digest(b'wallpaper fixture')}))
            command = json.loads(bun('const [output, source, assets, reportSha256] = process.argv.slice(-4);'
                'console.log(JSON.stringify((await import("./scripts/stage-aosp.ts")).brandingPacketCommand('
                '{output, source, assets, reportSha256, aapt: "aapt-fixture", apksigner: "apksigner-fixture"})));',
                str(image), str(aosp), str(assets), stage.digest((assets/'branding-assets.json').read_bytes())))
            provision = {'src/com/android/provision/DefaultActivity.java': b'class DefaultActivity {\n    void onCreate() {\n        finishSetup();\n    }\n\n    private void finishSetup() {}\n}\n',
                         'AndroidManifest.xml': b'<manifest>\n    <application>\n    </application>\n</manifest>\n'}
            controller_path = 'PermissionController/role-controller/java/com/android/role/controller/service/RoleControllerServiceImpl.java'
            controller = b'''class RoleControllerServiceImpl {
    private RoleManager mUserRoleManager;
    void defaults() {
        mUserRoleManager.setRoleNamesFromController(roleNames);
    }
    @Override
    @WorkerThread
    public boolean onAddRoleHolder(String roleName) {
        boolean added = false;
    }
    public boolean onRemoveRoleHolder(String roleName) {
        boolean dontKillApp = hasFlag(flags, 0);
    }
    public boolean onClearRoleHolders(String roleName) {
        boolean dontKillApp = hasFlag(flags, 0);
    }
}
'''
            real_pinned = stage.pinned
            def pinned(project, path):
                row = real_pinned(project, path)
                if project == 'packages/modules/Permission' and path == controller_path:
                    return {**row, 'sha256': stage.digest(controller)}
                return {**row, 'sha256': stage.digest(provision[path])} if project == 'packages/apps/Provision' and path in provision else row
            def git_show(args, **kwargs):
                project = Path(args[2]).relative_to(aosp.resolve())
                self.assertIn(str(project), ['packages/apps/Provision', 'packages/modules/Permission'])
                self.assertEqual(args[:2], ['git', '-C']); self.assertEqual(args[3], 'show')
                if str(project) == 'packages/modules/Permission':
                    self.assertEqual(args[4].split(':', 1)[1], controller_path)
                    return controller
                return provision[args[4].split(':', 1)[1]]
            identity = {'schema': 1, 'packageName': CANONICAL}
            def admitted(path, aapt, apksigner):
                self.assertEqual((path, aapt, apksigner), (image.resolve(), 'aapt-fixture', 'apksigner-fixture')); return identity
            def run_main():
                with patch.object(stage, 'check_revision'), patch.object(stage, 'core_policy_plan', return_value={}), \
                     patch.object(stage, 'pinned', side_effect=pinned), patch.object(stage.subprocess, 'check_output', side_effect=git_show), \
                     patch.object(stage, 'image_identity', side_effect=admitted), patch('sys.argv', command):
                    stage.main()
            run_main()
            receipt = json.loads((image/'source-packet.json').read_text())
            self.assertEqual(receipt['state'], 'SIGNED_IMAGE_SOURCE_PACKET_NOT_APPLIED'); self.assertEqual(receipt['imageIdentityAdmission'], identity)
            rows = {row['path']: row for row in receipt['files']}
            self.assertEqual(rows[branding]['beforeSha256'], stage.digest(reviewed)); self.assertFalse(rows[branding]['changed'])
            self.assertNotIn('vendor/alphaphone/product.mk', rows, 'the stage product.mk already carries its pinned include')
            for name, row in rows.items():
                if name.startswith('vendor/alphaphone/'):
                    copy = image/name[len('vendor/alphaphone/'):]
                    self.assertEqual(row['beforeSha256'], stage.digest(copy.read_bytes()) if copy.exists() else None, name)
            self.assertEqual((aosp/branding).read_bytes(), b'# older unreviewed branding\n')
            self.assertFalse((aosp/'packages').exists(), 'packet generation never writes the source tree')
            # A stage copy that differs from the reviewed bytes is refused, whatever the source tree holds.
            for name in ['source-packet.json', 'source-packet.zip']: (image/name).unlink()
            (image/'branding/branding.mk').write_bytes(b'# unreviewed stage branding\n'); (aosp/branding).write_bytes(reviewed)
            with self.assertRaisesRegex(AssertionError, 'Unreviewed existing stage file: ' + branding): run_main()

    def test_packet_requires_admission_and_never_applies(self):
        with tempfile.TemporaryDirectory(prefix='alpha-image-packet-') as d:
            root = Path(d); aosp = root/'aosp'; aosp.mkdir(); assets = root/'assets'; assets.mkdir()
            base = ['stage-alpha-os-branding.py', '--aosp-root', str(aosp), '--assets-dir', str(assets), '--assets-report-sha256', '0'*64,
                    '--receipt', str(root/'receipt.json')]
            with patch('sys.argv', base + ['--packet-output', str(root/'packet.zip')]):
                with self.assertRaisesRegex(AssertionError, 'requires normal signed-image admission'): stage.main()
            with patch.object(stage, 'image_identity', return_value={'packageName': CANONICAL}), \
                 patch('sys.argv', base + ['--image-stage', str(root), '--packet-output', str(root/'packet.zip'), '--apply']):
                with self.assertRaisesRegex(AssertionError, 'does not apply source'): stage.main()
            with patch.object(stage, 'image_identity', return_value={'packageName': CANONICAL}), \
                 patch('sys.argv', base + ['--image-stage', str(root), '--packet-output', str(aosp/'packet.zip')]):
                with self.assertRaisesRegex(AssertionError, 'publish with its admitted image stage'): stage.main()
            self.assertFalse((root/'receipt.json').exists())

if __name__ == '__main__': unittest.main(verbosity=2)
