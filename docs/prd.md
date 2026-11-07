# Alpha Phone — working PRD

Version: 0.5, 2026-10-29. Product scope is approved through the owner's 32 answers,
amended by the [October 29 owner decisions](decisions.md#october-29-owner-decisions)
(P-57 to P-76); requirement text changed by them names its entry.
[Decisions](decisions.md#october-12-owner-decisions) and the
[implementation plan](implementation-plan.md) supersede older scope/defaults.
This is a requirements document, not acceptance evidence. [Sources](sources.md)
retain prototype and upstream provenance.

## Outcome

A personal agent phone with an independent Alpha Compute UI, locally resident
orchestration, on-device speech by default (P-60) and useful native tools. Eliza
Cloud supplies managed inference, subscription, Gmail, optional Google Calendar and Maps services; it never hosts Alpha's agent.
Keep prototype styling and identity separate from real data/capability claims.

## Users and primary journeys

1. Unlock the actual OS, open Alpha/installed apps and retain task context.
2. Start the local agent; sign in only for managed services. No hosted-agent pairing.
3. Dictate into an editable draft, or enter an interruptible voice conversation (local speech by default, P-60).
4. Use Gmail in either distribution and Phone/Contacts/SMS only on the AOSP image.
5. Query the full permitted photo library and control Maps through agent tools.
6. Inspect and approve effects, recover from interruption and reset local Alpha data.

## Scope and requirements

| ID | Requirement | Priority / acceptance |
| --- | --- | --- |
| AP-01 | Distinct branded Home, library and assistant with independent identity | P0; real navigation, app discovery, one Android shade and launcher Home swipe |
| AP-02 | Standalone and launcher packaging; Alpha AOSP capability distinct from flavor | P0; four APKs, offline shell, stock settings/recovery and no AOSP-only tools in standalone |
| AP-03 | Owner-bound Eliza Cloud service sign-in and subscription entitlement | P0; local-only agent, no provisioning/pairing, expiry/revoke/isolation and no per-turn billing network hop; catalog v1 and its per-minute limits (P-62); "Membership & credits" off the resident agent (P-59) |
| AP-04 | Resident orchestration, state, tool approvals and powered-on scheduling | P0; hosted text inference disclosed, no hosted agent, missed occurrences after a 30-minute window (P-75) and no duplicate effects |
| AP-05 | Compact/full assistant, keyboard, navigation and responsive continuity | P0; drafts, focus, scroll and tasks survive layout and lifecycle changes |
| AP-06 | Native on-device STT/TTS by default, with Settings switches for local or cloud STT and TTS (P-60); separate dictation and voice-assistant modes | P0; Clef semantic end-of-turn in Eliza Cloud plus the long-gap endpoint (P-60), automatic conversation submission, barge-in; true last-input-to-first-audible latency; disclosure of what cloud speech sends and a defined offline/no-plan fallback (P-60); AOSP always-on listening and hardware invocation included, with the G7 listener SELinux domain (P-61) |
| AP-07 | Daily overview, agenda, attention and resident briefs | P1; actual sources, freshness/empty/error states; phone-powered-on schedules only |
| AP-08 | Phone, SMS/MMS and Contacts only on Alpha AOSP | P0 AOSP; real native providers/roles with Alpha preassigned as default dialer and SMS app (P-75), owned carrier endpoints, emergency system access; hidden and capability-gated elsewhere |
| AP-09 | Gmail, Calendar and reviewed cross-app mail attachments | P1; incremental Gmail scopes, real delivery, optional Google Calendar connection and explicit local-first sync, availability semantics, durable deletion Undo and source/account isolation; [Cloud Calendar boundary](decisions.md#october-15-google-calendar-service-decision) |
| AP-10 | Browser, camera, full permitted Photos, Cloud Maps on Google Maps Platform (P-64), Notes and Files | P1; normal third-party cookies allowed, ephemeral private tabs, eligible autofill, native secure camera, agent Maps controls with Google attribution and caching terms (P-64), local speech by default (P-60), canonical Notes records (P-59) with three-day Trash; no app-data import/export |
| AP-11 | Resident workflows, approvals and run history | P1; bounded permissions, durable receipts, missed recovery, owner-return notices and no powered-off execution |
| AP-12 | Settings, subscriptions, permissions, local or cloud STT and TTS switches (P-60), system shade and reset | P0; truthful state, responsive controls, no backup/import/export, confirmed private-data reset |
| AP-13 | Wallet | Deferred: removed from MVP; views, native adapters and agent actions remain disabled in both distributions |
| AP-14 | Pixel 10a Android 17 image, signing, listening and unattended update/recovery (P-75) | Release gate; exact input/signer lock; release keys as GitHub Actions secrets for a CI signing job, certificates for Alpha Compute, first versionName 0.1.0 (P-58); Cuttlefish boot and physical hardware/OTA/user qualification separate; unlocked pilot units are not production-representative (P-70); Shaw release owner |
| AP-15 | Accessibility and resilience across intentional responsive layouts | P0; large text, TalkBack, keyboard, rotation, process death, permission loss, offline and repeated HOME |

## Explicit limits and decisions

All 32 choices are resolved as policy; implementation TODOs remain open in the
[approved backlog](owner-approved-mvp-plan-2026-10-12.md). P-01 and P-07 are superseded:
manual send applies to dictation and conversation voice submits automatically. Speech
is on the device by default; cloud STT and cloud TTS exist only as explicit Settings
choices, never as an automatic fallback, and Clef end-of-turn runs in Eliza Cloud
(P-60). Production Maps uses Google Maps Platform through Eliza Cloud (P-64).
Local speech does not imply an offline language model. Hosted inference receives disclosed selected context.
Full photo access is local permission scope, not bulk Cloud upload authorization.

Passkeys, Telegram, Discord and Wallet are outside MVP. No app-data migration,
backup or import/export workflow is planned. Ordinary Files and attachment operations
remain. Secure camera, Clock, shade and emergency facilities remain native/system
surfaces. Always-on listening is an AOSP MVP gate and never implicitly enabled.

## Current implemented versus accepted

The source still contains behavior that differs from this policy, including Cloud
speech selection that predates P-60's Settings switches, credit-oriented onboarding
and deferred Phone/SMS/Contacts. The approval itself changes no runtime or qualification record. Use
[current status](mvp-current-status.md), [requirements.json](requirements.json),
[verification](verification.md) and each TODO for implementation gaps and evidence.
APK builds, native emulator/HOME checks, full AOSP boot, real services, physical
hardware and user acceptance remain distinct. No existing failure is retired by
changing the prose.
