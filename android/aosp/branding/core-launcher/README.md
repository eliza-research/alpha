# Alpha core launcher and shared Files defaults

This source packet belongs to Alpha's OS image, not per-device customization. It requires the exact frameworks/base revision in SOURCE-INPUTS.json.

- Core-launcher classification hides Alpha from the routine foreground-app manager only while the enabled preinstalled Alpha owns Home. Other apps, a sideloaded impostor, another selected launcher, and unknown identity keep normal controls. Voice Stop/Mute, App Info, ANR handling and renderer recovery are unchanged.
- Native Quick Settings defaults omit unavailable Wallet, Cast, mobile-data and device-control shortcuts. Both the normal and split layouts are defined in OS resources. The repository migrates only exact prior stock layouts, including Alpha's original stock layout. Other saved layouts remain intact; the standard editor stays available.
- Provisioning and the post-update boot check grant the declared shared-storage app-op only to installed enabled system Alpha for the primary user, outside device-owner management and only while the app-op is unconfigured. An existing allow or deny remains untouched. App-private storage permissions are not granted.

Run `python3 prepare.py --fetch` to fetch any missing public hash-pinned baseline inputs and reproduce the patch. An existing mismatched baseline fails without replacement. Then use the existing admission tool:

`python3 ../system-entry/apply.py /path/to/frameworks/base --manifest manifest.json`

The tool is read-only unless explicitly given `--apply`. Source policy tests do not prove a compiled SystemUI, booted image, update migration or Pixel behavior. Build and qualify the signed OS together with the keyboard change before deployment; do not replace the launcher's app data.
