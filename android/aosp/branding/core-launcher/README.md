# Alpha core launcher and shared Files defaults

This source packet belongs to Alpha's OS image, not per-device customization. It requires the exact frameworks/base revision in SOURCE-INPUTS.json.

- Core-launcher classification hides Alpha from the routine foreground-app manager only while the enabled preinstalled Alpha owns Home. Other apps, a sideloaded impostor, another selected launcher, and unknown identity keep normal controls. Voice Stop/Mute, App Info, ANR handling and renderer recovery are unchanged.
- Native Quick Settings defaults omit unavailable Wallet, Cast, mobile-data and device-control shortcuts. OS resources define both normal and split layouts. Migration version 3 updates known stock layouts and replaces an exact legacy Alpha tile in custom layouts. The remaining tiles keep their order. The repository records the version after saving the selected layout, then keeps subsequent owner edits.
- Provisioning and the post-update boot check grant the declared shared-storage app-op only to installed enabled system Alpha for the primary user, outside device-owner management and only while the app-op is unconfigured. An existing allow or deny remains untouched. App-private storage permissions are not granted.

The normal `scripts/stage-alpha-os-branding.py` always includes this packet in fresh-image and OS-update source staging. It verifies the exact baseline and patch outputs in scratch space, then uses the existing all-file admission and backup transaction. There is no phone-side customization step.

Run `python3 prepare.py --fetch` to fetch missing public hash-pinned baseline inputs and reproduce the packet. An existing mismatched baseline fails without replacement. For separate read-only admission use the existing tool:

`python3 ../system-entry/apply.py /path/to/frameworks/base --manifest manifest.json`

The tool is read-only unless explicitly given `--apply`. Source policy tests do not prove a compiled SystemUI, booted image, update migration or Pixel behavior. Build and qualify the signed OS together with the keyboard change before deployment; do not replace the launcher's app data.

The launcher and its tile use `ai.alphacompute.alphaphone`. Existing installations under the previous package have a separate Android sandbox. Qualify the image transition and its data retention before deploying it to those phones.
