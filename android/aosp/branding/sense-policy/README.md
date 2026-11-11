# Alpha Sense image policy

This bundle adds private `system_ext` policy for `alpha_stallion_phone` only.
`alpha-sense-policy.patch` modifies `build/make/core/board_config.mk` after the
locked stallion BoardConfig is loaded. Apply it to the verified AOSP build copy
at the revision recorded in `manifest.json`, then admit it as
`--applied-build-patch alpha-sense-policy`. Copy the admitted Alpha staging
output to `vendor/alphaphone` using the regular image build process. When the
listener APK is present, the board requires the complete policy directory.

Staging verifies that the public release certificate matches the admitted
launcher and listener signer. It writes a certificate-and-package-scoped
`mac_permissions.xml` in `listener/sepolicy`. A private `seapp_contexts` entry
selects `alpha_sense_app` for that label, package and privileged install. The
app uses Android's baseline app domain, its own private data type and explicit
service lookups for consent UI, notifications, AppOps and audio capture. The
policy denies direct network socket creation and does not add network, broad
privileged-app, platform-app or audio HAL domain membership.

The pinned CP2A release and its inherited configs leave
`android.content.pm.ignore_mac_permissions_package` disabled. This flag changes
how Android interprets the certificate-and-package stanza, so an image release
must verify the built policy and the installed process and data contexts. Host
staging tests cover the source and build-selection contract. G7 requires an
enforcing build and on-device evidence, including the microphone and indicator
checks under the dedicated domain.
