# Protected native Power voice dispatch

This reviewed Android 17 patch keeps ordinary assist, Quick Settings and lock-screen
invocations surface-only. It strips the Power invocation marker at the public search
service for non-system callers. SystemUI can launch the exact protected Alpha Power
component only for the selected assistant on a provisioned, unlocked current user.
Caller text, URI and assist context are not forwarded to that component.

The manifest binds both framework files to revision
94b4c163b7dfe5ce3607f7bb8456f9573f7de57d and requires the existing Alpha system-entry
resource/source patch. Unknown preimages, partial applications and unrelated source
changes must be reviewed through the normal whole-source inventory verifier. Do not
change the immutable baseline inventory to make modified files appear stock.

Both Android services and SystemUI compiled successfully on the preserved stallion
builder. Compiled SearchManager bytecode contains the caller-UID check and marker
removal; the SystemUI dex contains the protected component. This is component evidence,
not Binder, hardware, microphone, complete image or production-release acceptance.

The app component must use the current shared Sense owner/session/generation authority.
The older d4fbb prototype is not compatible with the newer shared Sense integration and
must not restore the deleted local invocation wrapper or legacy Agent authority.
Missing or ineligible protected app components use the existing ordinary assist path.

Before activation, qualify the matching app and native source tuple, whole source
inventory, signature/permission enforcement from a separate UID, spoofed invocation
refusal, lock/restore/visibility/cancellation, role and real Power dispatch. Cloud voice
still needs finite microphone-to-transcript-to-agent-to-playback acceptance. No offline
model, wake-word listener or additional provider stack is required by this patch.
