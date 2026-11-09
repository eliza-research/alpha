# Alpha Compute identity

The November 9 company rename sets the Android application ID to
`ai.alphacompute.alphaphone`. Standalone and launcher APKs share this ID. Java
packages, the Sense listener, image provisioning, component names, IPC names,
provider authorities, permissions and test fixtures use the same namespace.
The pinned upstream source supplies the matching company text, Pixel configuration
and autofill origin extras.

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

Repository and release URLs keep the existing GitHub organization, which is a
separate identifier from the company name.
