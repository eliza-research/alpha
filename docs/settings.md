# Settings

Settings belongs to Alpha's renderer in `apps/app/src/prototype/settings-adapter.ts`. The top
screen has General, Privacy, Apps and About. The Account control in its header opens the shared Account
sheet. Category pages have Back to Settings. App settings return to Apps.

## Categories

| Entry | Current controls |
| --- | --- |
| Account header | Balance, membership, code entry, Google & email, AI connection |
| General | Display, Notifications and the available device or recovery controls |
| Privacy | App permissions and Ask before taking actions |
| Apps | Browser, Calendar, Camera, Files, Inbox, Maps, Notes, Passwords, Photos and Workflows |
| About | Version information and Open source licenses |

The Account sheet is reused by Settings, setup and a billing refusal. It shows the
verified account balance, membership, included usage and access window. A missing
balance stays unavailable; it is not shown as zero. Code entry appears on request.
AI connection uses the existing provider controls in the same sheet. Google & email
uses its existing account manager and returns to Account when closed. Billing opens
the existing account billing page; no purchase is performed in the app. Sign out
requires confirmation tied to the current account and preserves local data and keys.
The old Account & plan page and separate billing-review prompt are retired.

Display owns the app's theme and text-size controls. Notifications reads back the platform's
notification state. Android notification settings are explicit handoffs. A browser offers its
own alert toggle and does not claim Android permission or channel state.

App permissions reports the permissions available to this platform. Android permission controls
open the appropriate system settings. Browser facts identify browser-managed access. An unreadable action preference keeps required review on. Its switch is unavailable for editing
until the preference can be read. The recovery control preserves the original bytes until the
owner reviews recovery.

App settings remain with their existing owners. Calendar uses the canonical Calendar flow,
Passwords uses the selected provider or development vault, Inbox links to Google & email, and
Workflows exposes its alert preference. The other app pages expose the permissions or options that
are currently available. They do not create alternate stores or provider connections.

The product About page has no Problem log or Export diagnostics entry. The diagnostic data
contracts remain covered by `test/diagnostics-export.test.mjs`. The former mail-image preference
has no Settings control in this layout.

## Navigation and identity

Android Back follows the displayed parent. Leaving New or Edit password for the password list
clears the in-memory draft, including its typed password, while leaving the list unlocked. Leaving
the password surface locks it through the existing password owner.

Repeated rows use stable entity identities, including package names, action identifiers and
license identities. Loading additional permission or account information must preserve keyboard
focus on the same control. A pending response from an earlier account cannot replace the current
account's state or notification.

## Verification

`test/browser/settings.production.spec.ts` covers the grouped routes and product-only controls.
`test/browser/settings-truth.production.spec.ts` covers native readback fixtures, account and plan
presentation, unreadable preferences and delayed permission reads. `test/browser/password-entry-back.spec.ts`
covers New and Edit password navigation. These browser fixtures do not establish Android device,
AOSP image, provider or user acceptance.

The earlier flat Settings and hidden-empty-card proposal remains in `docs/ui-refresh-2026-11`
with its historical TLA inputs. The corresponding Quint legacy models retain those references.
