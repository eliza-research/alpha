# Alpha OS branding layer

This extends the existing Alpha identity and native Android screens. It does not replace
Settings, SystemUI, the keyguard, navigation controllers, permissions or account flows.

## Reused implementation

| Surface | Reused authority | Alpha customization |
| --- | --- | --- |
| Boot animation | Existing Alpha SVG; pinned elizaOS/os brand-independent frame packer | Alpha blue field, white mark, short reveal |
| Lock/Home wallpaper | Existing Alpha launcher mark and palette; Android WallpaperManager | Dark wallpaper, Alpha mark; native clock and notifications remain |
| Native Settings, Wi-Fi, screen security | Complete AOSP Settings activities and preference hierarchy | DeviceDefault/Material color roles and app label |
| Shade and Quick Settings | Complete AOSP SystemUI controllers, tiles and notification layouts | Shared system palette and Alpha labels |
| Navigation | Existing Android Back/Home gesture engine and security gates | Home and edge Back only; overview and horizontal quick-switch disabled by the Alpha product policy |
| Keyboard | Complete AOSP LatinIME input engine, languages, suggestions and accessibility | Alpha light/dark colors; dark default when no theme preference has been saved |
| First-run setup | Existing Provision enterprise branch, completion and disable logic; existing Alpha account/permission onboarding | An additive welcome step links to the full native Wi-Fi/security screens and then Alpha |

The initial firmware splash and unlocked-bootloader warning belong to Google's signed
firmware. Hardware manufacturer, provider identities, legal notices, security/error colors
and truthful permission text are not relabeled as Alpha-owned services.

## Build and admission

`scripts/generate-alpha-os-branding.mjs` renders the existing vector with the established
Sharp toolchain, then uses the hash-pinned shared OS packer in `tools.lock.json`. Set
`ALPHA_BRANDING_RENDER_PACKAGE` to a prepared package.json that resolves Sharp, and
`ALPHA_OS_SOURCE_ROOT` to the pinned OS checkout. Render into a new output directory.

Five explicit overlay packages use unique Alpha identities and a declared priority above
the retained factory overlays. This avoids the duplicate package names used by factory
and automatically generated framework overlays. LatinIME alone uses the static product
overlay path because its theme uses private app attributes.

The stage script in the local builder records exact base hashes before the two small
Provision edits. It retains Android's existing device-owner branch and completion methods.
The main Alpha app remains nonprivileged. The separate existing platform provisioner owns
provisioning and default Home selection; its wallpaper action uses the normal platform API.
Existing user theme preferences are preserved during first-run completion. Applying Alpha
wallpaper/colors is an explicit user action.

Component compile, packaged image verification and physical screen checks are separate gates.
Current source/assets are preparation, not evidence that every branded screen is installed
or accepted. Verify light/dark contrast, 200% text, RTL, lock/AOD, shade/Quick Settings,
Wi-Fi, VPN, hotspot, screen security, permissions, accessibility, gestures and the Back/Home button fallback.
Never reset device provisioning or wipe the owner merely to preview the welcome screen.

## Home/Back and keyboard policy

The owner requested Home plus Back, with no Recents or swipe-and-hold task switcher.
`home-back-keyboard.patch` adds a default-off Launcher3 product resource and uses its
existing overview-command admission path. Alpha enables it through the overlay.
Completed upward pulls go Home; horizontal switching and pause-to-overview are disabled.
Existing Home-disabled/security states and secondary-display rejection remain intact.
The framework uses Android's normal gestural navigation dimensions and edge Back handler.
The optional button fallback contains Back/Home and the keyboard switcher, not Recents.

LatinIME's default-theme resource applies only without a saved theme choice. Input engines,
languages, predictions, correction, emoji, dictation affordances and permission behavior remain
the existing implementation. Both light and dark themes retain their existing style items.
LatinIME's overlay is compiled into its APK through the scoped
`PRODUCT_ENFORCE_RRO_EXCLUDED_OVERLAYS` entry: its private style attributes cannot be
resolved from a separately generated runtime-overlay package. Other packages retain
their normal overlay behavior.

`home-back-keyboard-inputs.json` binds each source edit to its exact original SHA-256.
Local preparation, host policy tests and guarded GCP staging live under the task's
`builder/` directory. Host tests are logic evidence; component compilation and physical
gesture/keyboard acceptance must be recorded separately.
