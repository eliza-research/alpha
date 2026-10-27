# Fresh Alpha device presets

The first-run provisioner completes only after Alpha is confirmed as Home and eligible
presets have been checked. A rejected grant, timeout, unavailable role service, or failed
readback leaves retry and native Home-settings recovery. Callbacks and timers are bound
to an attempt generation. The existing enterprise workflow and upstream setup completion
methods remain unchanged. Completed, managed, profile and secondary-user installations
do not receive first-run setting writes.

`AlphaFreshSetupPolicy` is the decision engine used by privileged `AlphaFreshPresets`.
Keyboard selection is explicit only when the selected-IME setting is empty: resolve the
installed system LatinIME by its actual package/service, retain enabled entries/subtypes,
enable it if needed, then write and read back the selected id. Any selected IME is preserved,
without guessing whether Android or a person chose it. This is not an IME migration.
A fresh-image test must still show that the shipped image's initial IME is Alpha LatinIME;
a preserved unrelated selection does not prove that factory default.

The settings and update path come from pinned Android 17 source. The null-token fallback
in `InputMethodManager.setInputMethod` explicitly recommends direct secure-setting updates;
the input service requires the selected method to be enabled. Provision already holds
`WRITE_SECURE_SETTINGS`. Managed-device checks use the calling-user owner query rather than
`isDeviceManaged()` (which can require `MANAGE_USERS`). No management permission is added.
`source-inputs.json` records exact primary-source revisions/hashes and these boundaries.

Palette writes occur only while first-run eligibility holds and no palette is saved.
Write failure cannot report successful completion. Existing colors and IME choices remain
authoritative. The explicit `AlphaAppearance` action is for in-place development updates;
fresh wallpaper is supplied by the image's framework default resource without that action.

## Reproducible source staging

From the repository root:

```sh
python3 scripts/fetch-alpha-os-preset-inputs.py --output /path/to/pinned-inputs
python3 scripts/stage-alpha-os-branding.py \
  --aosp-root /path/to/android \
  --assets-dir /path/to/generated-alpha-assets \
  --assets-report-sha256 <reviewed-assets-json-sha256> \
  --source-inputs /path/to/pinned-inputs \
  --product-mk-sha256 <accepted-product-mk-preimage> \
  --receipt /path/to/new-source-receipt.json
```

The default is admission only: actual Git revisions, exact Provision preimages, logo/asset
report and payload hashes, and every existing target are checked before mutation. The
setup-icon bytes come directly from the existing `android/app/src/main/res/drawable/app_icon.xml`:
its pinned 180dp blue-circle icon, 36-unit inset, scaling and clipping are retained exactly,
rather than generating replacement artwork. The asset directory is an explicitly pinned
build input, not an instruction to select an older local asset archive; retain the owner's
current admitted boot animation when producing an incremental image.
The reviewed system-entry flags and Alpha Start/Camera End defaults enter the existing overlay identity.
All current visual overlays, including independently owned hardware-invocation defaults,
are copied byte-exact. Staging changes no app APK, listener/assistant implementation, user
data, provisioning bit or live device setting.

Add `--apply` only for an owner-reviewed source checkout. Preimages are rechecked before
the first write; changed existing source is retained beside the new receipt. For a staged
tree, pass its preserved receipt with `--prior-receipt` and `--prior-receipt-sha256`.
Unknown file contents fail closed. Use a new receipt path. Historical task-local staging
scripts remain evidence; this source-owned entrypoint replaces their branding/Provision
preparation for the next producer. It does not apply the separate policy patches or build.

Focused local checks reuse installed Java and exact cached inputs/assets:

```sh
ALPHA_FRESH_PRESET_INPUTS=/path/to/pinned-inputs \
ALPHA_BRANDING_ASSETS=/path/to/generated-alpha-assets \
python3 test/aosp-fresh-presets.test.py
```

These execute the policy on the JVM and stage/apply disposable source fixtures. They do
not prove factory boot, role-manager/IME runtime behavior, component/resource build,
simulator or physical acceptance. Those remain gates before the combined preserving Pixel
update; no wipe is part of this work.
