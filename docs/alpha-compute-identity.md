# Alpha Compute identity

The November 9 company rename sets the Android application ID to
`ai.alphacompute.alphaphone`. Standalone and launcher APKs share this ID. Java
packages, the Sense listener, image provisioning, component names, IPC names,
provider authorities, permissions and test fixtures use the same namespace.
The reviewed upstream merge `86ab55fd81f68a2c5dd4fd32e1c1431723648c58`
([elizaOS/eliza#39153](https://github.com/elizaOS/eliza/pull/39153)) supplies the
matching company text, Pixel configuration and autofill origin extras. It retains
the earlier merged cleanup sources and the historical persona signatures needed
to recognize existing default profiles; the original rename-only branch pin is
not the final admitted source.

The earlier follow-up pin `ac18377c5a9e4eb7afeac1c62a026ad3be95733e`
([elizaOS/eliza#39173](https://github.com/elizaOS/eliza/pull/39173)) completes
the remaining callback and default-persona references. A SHA-256 fingerprint
retains exact recognition of historical default biographies without retaining
the former company text in source. This four-file update changes no native,
model or dependency input and transfers no earlier qualification.

The earlier pin `450087e00e6dc1c289aab0c3e424560b7040d163` retains that
callback identity and the original stock-biography fingerprint. It preserves
edited biographies and includes the reviewed foreground updater gate and scheduler
with their source tests and bounded model. The six-file delta from `ac18377c5a`
changes no native source or dependency lock. The source is published on
[`codex/alphaphone-identity-ota-reviewed-20261109`](https://github.com/elizaOS/eliza/tree/450087e00e6dc1c289aab0c3e424560b7040d163).

The current pin `6f414658b08cf8075d8fb12ece2ec968a221af7e`
([elizaOS/eliza#39180](https://github.com/elizaOS/eliza/pull/39180)) is its reviewed
child. It adds exact shared notice-cleanup and Unicode-safe Gmail body-limit fixes
plus owning-module regressions. The three production files match the prior reviewed
postimages, and all local behavior patches are retired. The dependency lock is
unchanged. Current build and installed qualification remain separate from this
source review.

Android treats the renamed package as a separate installation. It cannot replace
an APK from the earlier namespace or inherit that package's private data, Android
roles, grants, Keystore entries or update sessions. This change supplies no data
migration. Update manifests and release evidence must describe APKs built for the
new identity; earlier APK hashes and device results do not qualify it.

Before real sign-in or image provisioning, register the new Cloud/App Auth client,
OAuth callbacks and signed-package asset links, and refresh package-specific role,
listener and image policies. The return URL path and Cloud service origins retain
their configured values. The browser and password service must use the matching
autofill origin-extra namespace; earlier browser binaries do not provide it.

The native embedding JNI class also changes. The previous native-library receipt
cannot qualify the new identity, so the embedding host requires a rebuilt and
reviewed candidate. Voice and physical-device acceptance remain separate gates.
Historical reports retain their original hashes and dates; company/package text
in those reports has been renamed and is not fresh execution evidence.
The historical native OTA report is retained verbatim at an immutable revision;
[its reference](evidence/launcher-ota-native-validation-20261109.json) records the
original blob and digest instead of relabelling its captured facts.

Repository and release URLs keep the existing GitHub organization, which is a
separate identifier from the company name.
