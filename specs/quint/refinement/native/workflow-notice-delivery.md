# Native workflow notice delivery

[WorkflowNoticeDelivery](../../native/WorkflowNoticeDelivery.qnt) models one ordinary workflow step notice. Its delivery ledger is independent of the native canonical tap slot and the renderer's navigation state.

| Boundary | Source and observed state |
| --- | --- |
| Worker admission | The extracted `NotificationsHostPlugin.postWorkflow` and `workflowReceipt` methods run through the pinned `ForegroundNoticeGate`. The fixture controls focus and bridge lifetime independently. |
| Route claim | `NoticeRoutes.prepare` reads the durable owner and writes the immutable binding, route, and opaque token. Exact retry preserves the token. A second foreground check can reject after the route was prepared. |
| Delivery claim | `NoticeDelivery.publish` validates the exact binding and content digest. The `applying` or `failed` record precedes any notification manager post. A committed claim with a lost reply still controls later attempts. |
| Manager effect | The full `HostNoticePoster` uses Alpha's channel, tag, private lockscreen presentation, timeout, and prepared token. The fake manager controls whether the row is immediately listed, delayed, dismissed, mismatched, or whether the call fails before or after the effect. |
| Acknowledgement | The terminal receipt write follows the exact active-list check. A lost write reply and a lost manager reply are separate. An exact receipt read can reconcile applying or unknown to succeeded without posting again. |
| Owner withdrawal | `NoticeCoordinator.withdrawOtherOwners` writes the owner before touching receipts or cancelling. A failed receipt write can leave the manager row active. Repeating the withdrawal can complete cancellation without publishing again. |

The host-JVM campaign binds pinned shared source, product configuration, adapters, and model inputs before execution. It compiles full shared route, owner, delivery, coordinator, poster, and foreground gate classes. It extracts the relevant bridge methods and Alpha overrides because the installed bridges depend on Capacitor and Android. Controlled ports cover one operation key and one active bridge call. The old bridge can be destroyed and replaced while the synthetic store and manager retain their state. The bounded model distinguishes absent, applying, failed, unknown, succeeded, and withdrawn receipts.

The campaign covers selected scheduling and storage failures. Production secure storage, multiple processes and notice keys, real Android permission and notification delivery, approval suspension and quiet resume, and tap consumption require separate evidence. Every owner, operation, and notification body in the campaign is synthetic.
