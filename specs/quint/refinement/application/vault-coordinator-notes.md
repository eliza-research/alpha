# Vault coordinator refinement

The source driver executes `passwordManagerGroups`, `passwordEntryPage`, the
input callbacks they return and the real lifecycle handlers. It uses the pinned
shared `PasswordsClient` response validation with controlled native ports.

Four schedules observe 24 checkpoints. They cover typing followed by leaving,
typing followed by backgrounding, reviewing a damaged-vault reset followed by
leaving and a pending native unlock followed by leaving and native cancellation.
Only a Boolean records whether a draft contains typed secret bytes. The raw
trace serialization is checked for the synthetic secret marker.

The source advances its generation on refresh and on leaving an active manager.
Leaving clears its draft, metadata, damaged-state display and reset review.
The model now preserves those transitions. A pending native operation can still
settle afterward and publish a fixed notice. The model keeps that operation
separate from the cleared review.

The native port models `lock` retiring a credential challenge, following the
pinned `CredentialAccessSession` contract used by `PasswordVaultAccess`.
The JVM implementation of that grant and actual Android authentication are
outside this driver. No vault reset or other real credential operation executes.

Save, remove, transfer, origin-bound fill and additional operation interleavings
remain open. The existing development-vault adapter continues to check its
separate unlock and metadata projection.
