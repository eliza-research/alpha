# November 9 UI and browser return source review

Base: coverage from `46a8a7a673`. Reviewed implementation: `915483a172`.
The hashes record this reviewed source delta. They do not renew previous runtime,
source-refinement, signing, device or user acceptance receipts.

| Changed paths | Review and model allocation |
| --- | --- |
| agent-adapter, alpha-client, connection-ui, local-agent, remote-protocol, development-cloud-agents | Image payload is forwarded using the existing request identity and cancellation path. Sent attachment leaves the composer and is retained under owner, agent, origin, conversation and message identity. History restores only the current binding. ChatAttachments adds explicit successful-write/reload, owner/conversation isolation, failed-send restoration and in-place preview scenarios. Existing AssistantConversation and session models retain send/admission obligations. No cross-device persistence claim. |
| camera-adapter, model, template | Alpha shutter captures an image and prepares a chat draft; it does not submit it. Photos rereads the selected item before attaching. Video understanding remains disabled. Album management delegates to existing library operations; selection moves into menus. Existing media/trash/window models remain applicable; ChatAttachments covers the attachment boundary. |
| inline-modal, phone.css, template, model, browser-adapter | Assistant remains reachable over app views; activation closes the inline sheet before moving focus. Grip dismissal uses a downward threshold and unregisters its listeners. Browser content fills the viewport beneath overlays. ShellNavigation gains grip dismissal and assistant-from-sheet scenarios. DockClearanceOwnership retains measurement ownership; visual browser/device layout acceptance is separate. |
| automations-adapter, automations.css, automations-protocol, workflow-adapter | Schedule edit preserves identity and timezone and requires returned fields to match. Run reports a raced execution as already running, not a fresh success. Recovery UI is removed, but durable pending intents, reconciliation and per-owner locks remain. WorkflowExecution still governs reviewed execution and unknown outcomes; no execution was enabled by presentation changes. |
| browser/clock, clock-adapter, agent-calendar-adapter, home-calendar-selection, home-overview-cards | Alarm entry moves away from Calendar while existing device action and foreground-only browser behavior remain. Home excludes ended events and hides only an empty brief. Feed freshness/ownership checks are retained. Existing DeviceActions, CalendarPresentation and PreferencesAndPresentation cover the boundaries; labels and placement require visual QA. |
| browser-cloud-dev-bridge, google-connection-ui | Host injects its own loopback return after validating the request, with a random one-use ten-minute state bound to host and credential. Renderer never chooses an arbitrary return URL. BroadcastChannel merely triggers a canonical read; exact returned connection must be present before closing the panel. BrowserGoogleReturn adds host/nonce/replay/expiry/owner/readback cases. Native return remains separate. |
| cloud-resident-host | Explicit selected Cerebras Qwen model now also handles image description through the existing Cloud or Direct provider paths. No credentials, account, paid cap or embedding selection changed. DevelopmentHost and ResidentRuntime retain lifecycle boundaries; real provider image result was separately verified. |

Retained limitations: finite models and sampled traces do not prove every implementation
state or real provider behavior. Existing state-audit-required flags remain. Native
Browser layering, final APK, Pixel checks, fresh-account signup and production rollouts
are not approved by this ledger refresh.
