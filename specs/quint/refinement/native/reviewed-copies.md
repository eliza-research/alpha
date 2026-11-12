# Reviewed attachment copies

The main and assistant bridges share the installed `mail-attachments` cache and
provider authority. `ReviewedCopies` serializes the first successful directory listing
with file creation and registration. It writes and syncs bytes off that lock. Each bridge
can revoke its own copy, and later sweeps can retire expired, completed peer copies.
`AlphaMailFileProvider` separately enforces read-only access, the installed URI path and
the file-age limit.

| Modeled boundary | Executed source |
| --- | --- |
| First/later sweep, atomic reservation, exact-byte write and scoped cleanup | `ReviewedCopies.java` |
| Expired and future timestamp handling and read-only provider path | `AlphaMailFileProvider.java` with a controlled base FileProvider |
| URI construction and exact read grant revocation | Pinned `ReviewedFileHandoff.java` with controlled Android context and URI ports |

The previous source allowed a second bridge to register a fresh file while the first
directory listing was held. The first sweep then deleted that file. The pinned shared
writer also clears the cache before each write, which is its documented single-copy
contract. Alpha now owns concurrent file creation while keeping the shared URI and
grant helpers. The installed authority, path, filename shape and expiry remain the same.

Run `bun test test/quint-reviewed-copies-refinement.test.mjs` to compile the actual
classes and replay the bounded host schedules. Each scenario starts a fresh JVM and
uses real temporary files. Latches hold the first listing against a peer load and a
peer write. Other scenarios cover failed listing recovery, exact age thresholds,
owner cancellation, stale revocation, an injected write fault, and provider admission.

The model separates physical files from registered owners. A provider expiry can
unlink a file before its owner's scheduled URI revocation. The JVM port observes that
separation. Actual Android Binder grants, descriptor transfer, Capacitor and viewer
lifecycle, cancellation inside the byte-write syscall and failed file deletion remain
separate source or installed-device obligations.
