# Gmail agent mailbox recovery

[GmailAgentMailboxRecovery](../../services/GmailAgentMailboxRecovery.qnt) covers the selected-owner mailbox mutation helper. The replay invokes the actual `gmailAgentMailbox`, Alpha `CloudProtocol` and the prepared upstream `ManagedGmailMailboxClient`. All transport and storage are in memory. The protocol receives an opaque synthetic reference and sends no bearer value. The fixture prohibits external fetch, browser launch and credential-store mutations.

The replay checks the exact selected scope and stable turn ID before any route call. It then checks the wire message, selected grant, observed history, prepared proposal and SHA-256 of the actual returned review. The grant readback must contain the selected connected account with the mailbox capability. An abort between grant readback and transport dispatch leaves the prepared receipt intact.

The in-memory receipt ledger retains its state between successive invocations. A non-prepared prior receipt does not lead to another message read or dispatch. Success evidence must name the selected provider message and verify the requested labels for archive, trash, mark-read or mark-unread. A dispatch error can lead to one read of the exact turn. An abort before that read suppresses it. An abort or invalid receipt during that read leaves the original dispatch error as the result. A durable prior prepared receipt can be reviewed again by a later invocation.

The 45 traces compare 299 checkpoints. Bounds are one selected grant, two representative IDs and revisions and at most two sequential invocations. The ledger models external replies as test inputs. Concurrent invocations, provider durability and mutation, outer agent account selection and installed account acceptance remain separate.

```sh
bun test test/quint-gmail-agent-mailbox-recovery.test.mjs
```
