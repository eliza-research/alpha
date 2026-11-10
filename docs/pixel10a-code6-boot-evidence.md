# Pixel 10a development image: October 19, 2026

The Cloud-profile development image built from Alpha commit
`e240ddab76ba1341fabb394e11e6212f64a09838` and reviewed Eliza pin
`0296e2c929d45bf66873a1e360a1d260e8b1125d` passed archive admission,
wipe/flash and initial boot on Pixel 10a (stallion). This is an unlocked,
development-signed image, not a qualified production release. Later main commits,
including PRs #579 and #580, are not installed in this image; these results apply
only to the exact e240 artifact recorded here.

The [sanitized evidence record](pixel10a-code6-boot-evidence.json) contains exact
artifact hashes and digests of the retained private build/device receipts. Device
identifiers, account data and licensed image payloads are not committed.

## Validation performed

- Full `npm run verify` at `df0886902ab79dc5b40bc598a188963c689bbb9c`:
  1,704 passing tests, two skips, no failures; typecheck, web build and production
  dependency audit passed. The final e240 delta changed only the browser resident
  host and its test; both focused host tests passed at e240.
- Normal `npm run android:build -- --runtime-profile=cloud` passed for launcher
  and standalone variants at e240, version code 6, version name
  `0.1.0-cloud-0296e2c929-e240ddab7`, with test mocks disabled.
- The admitted AOSP launcher preserved all 2,035 non-signature APK entries
  byte-for-byte during stored JNI/DEX normalization, 16 KiB alignment and signing
  with the original development certificate. Its hash was verified again from
  the completed product image and the booted device.
- Normal `m -j4 droid target-files-package` and `m -j4 updatepackage` completed.
  Streaming archive admission compared every image to the exact canonical
  target-files images, verified firmware hashes and requirements, fastboot
  instructions, AVB chains, APK signer/version/profile/runtime pin, provider
  payload and absence of temporary boot diagnostics.
- Authorized wipe/flash exited successfully. Initial boot reported
  `sys.boot_completed=1`, SELinux `Enforcing`, and the exact version-6 APK under
  `/product/app/AlphaPhone`. MainActivity started and its process remained alive;
  the screen was dozing with keyguard present.

## HOME provisioning and remaining boundaries

After the wipe, HOME had no role holder and resolved to Android's chooser.
This matches the documented development staging policy: other launchers remain
installed, and only admitted `--production` staging emits the preferred-HOME
provisioning overlay. Provisioned/setup-complete settings do not select a HOME
application when multiple equal-priority handlers remain.

The first immediate reboot after selecting Alpha retained its HOME role but lost
its preferred-activity update: MAIN/HOME resolved to Android's chooser, and the
preferred entry still named the disabled Provision activity. The pinned AOSP
`PreferredActivityHelper.addPreferredActivity` updates the in-memory preference
then schedules persistence; `PackageManagerService.WRITE_SETTINGS_DELAY` is ten
seconds. A successful role command is not a disk-persistence barrier.

The operator re-granted HOME, verified Alpha resolution, waited 25.8 seconds and
then rebooted. This check passed: boot completed, SELinux remained enforcing,
Alpha retained the HOME role, and MAIN/HOME resolved to
`ai.elizaresearch.alphaphone/.MainActivity` with `isDefault=true`.

For this development provisioning workflow, use the Android default-app chooser
or the documented `cmd package set-home-activity` operation, verify both the role
and intent resolution, and allow more than 20 seconds for the delayed settings
write before a test reboot. If a stale preference already exists, explicitly
remove the Alpha HOME role and select it again before waiting. Recheck boot,
role and resolution afterward. This is a development test procedure, not a
production provisioning policy or an AOSP source patch.

The device had no default network. Native Cloud sign-in, subscription and inference
acceptance remain unverified. Browser integration results and a separately installed
Cuttlefish APK do not establish those Pixel outcomes. Release signing, locked
verified boot, rollback/recovery drills, always-on listener qualification, physical
radio/audio/camera behavior and user acceptance remain separate gates.

See [Pixel staging](pixel10a-staging.md) and the
[source contract](pixel10a-source-contract.md) for the unchanged production gates.
