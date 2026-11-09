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

The callback and persona follow-up
([elizaOS/eliza#39173](https://github.com/elizaOS/eliza/pull/39173)) merged as
`1f02663576bab24e7cace610247270aab927b7a0` from reviewed head
`2b1fec8d91661d4380ddce02b5ec0c8073e9f101`. Review removed the overly broad
default-biography matcher in the earlier `ac18377c` candidate. A SHA-256
fingerprint recognizes the exact retired stock biography; caller-edited profiles
remain caller-owned.

The earlier reviewed pin `489efc0b0e53ccbf9554f6017ac0d7b94f7056e8`
([elizaOS/eliza#39181](https://github.com/elizaOS/eliza/pull/39181)) includes
that reviewed repair and the consumer configuration refactor. Alpha owns its OS
descriptor and browser sign-in registration. Shared code selects explicit
consumer configuration without an Alpha package or route switch. The merged
develop source also changes live-capture admission and cancellation and adds the
resident producer's migrated PGlite snapshot. The dependency lock and recorded
engine/model bytes are unchanged; native, device and user qualification do not
transfer to this application.

The current pin `dae11e0b7e3f40e5434fea21fd7c127e416f7016`
([elizaOS/eliza#39180](https://github.com/elizaOS/eliza/pull/39180)) merges
those sources with the reviewed notice-publication cleanup and Unicode-safe Gmail
body bound. Shared code takes an optional caller-owned body limit; Alpha selects
32,000 characters in its own host entrypoints. The consumer uses upstream behavior
directly and carries no source patches. The dependency lock, recorded engine/model
bytes and shared speech inputs are unchanged from `489efc0b`; historical built
reviews retain their original pins. Current native, device and user qualification
remain pending.

The separately reviewed source `450087e00e6dc1c289aab0c3e424560b7040d163`
retains the callback identity and exact stock-biography fingerprint, preserves
edited biographies and includes the reviewed foreground updater gate, scheduler,
source tests and bounded model. Its six-file delta from `ac18377c5a` changes no
native source or dependency lock. The source is published on
[`codex/alphaphone-identity-ota-reviewed-20261109`](https://github.com/elizaOS/eliza/tree/450087e00e6dc1c289aab0c3e424560b7040d163).

Its reviewed child `6f414658b08cf8075d8fb12ece2ec968a221af7e`
([elizaOS/eliza#39180](https://github.com/elizaOS/eliza/pull/39180)) adds shared
notice-cleanup and Unicode-safe Gmail body-limit fixes with owning-module
regressions. The three production postimages match the prior reviewed fixes;
that source selection retires its local behavior patches. These source-only
reviews retain their exact records and do not qualify new built artifacts or
transfer device, security or user acceptance.

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
