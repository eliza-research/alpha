# Vault coordinator refinement

The driver executes `passwordManagerGroups`, `passwordEntryPage`, returned input callbacks and the real lifecycle handlers. Its shared `PasswordsClient` uses controlled native ports. Nine schedules cover typed-secret retirement, backgrounding, damaged-vault review, metadata held across Lock/expiry/leave, and reset authentication held across page retirement or a new refresh.

A Boolean represents whether the editor contains a secret. The receipt excludes the synthetic secret text. Lock and expiry advance the read generation and clear the reset review; leaving also retires the task's page lifetime. A late native operation cannot publish a notice, metadata or reset from a retired page. A refresh invalidates a previous reset review even when the damaged state returns. Android authentication, encrypted storage and actual autofill remain platform obligations.
