# Password manager and provider setup

October 7 owner decision ([decisions](decisions.md#october-7-owner-product-decisions), P-05): an integrated password manager is in scope as a reusable elizaOS upstream component consumed by Alpha. Proton Pass, described below, remains an optional alternative provider. The implementation below is decided and built, not yet accepted on a device (see Evidence boundary).

Settings → Password manager (also opened from the Browser menu) now has two parts: Alpha's own
**integrated password manager**, built on the shared upstream `plugin-native-passwords` plugin,
and **Other password providers**, the existing Proton Pass setup/status flow. Both remain
available; Android lets the user select exactly one Autofill provider.

## Integrated password manager

Implementation: the shared upstream `plugins/plugin-native-passwords` module, consumed from
Alpha's reviewed Eliza pin. Alpha owns identity and policy:
`android/app/src/main/res/values/eliza_passwords.xml` (vault directory `passwords` under the
no-backup directory, Keystore alias and AAD `alpha.passwords.vault.v1`, 60 s unlock window,
biometric allowed, host identifies itself as a browser), the service declaration in `AndroidManifest.xml`,
`PasswordsPlugin` registration in `MainActivity`, the browser's engine-attested field adapter
(`BrowserLoginFields` with its isolated-world reporter, and `BrowserFieldOrigin`, both shared from
`plugin-native-browser-surface` at the reviewed pin; Alpha passes the vault's two extras keys), the
top-level-origin extra in `AlphaBrowserPlugin.CredentialWebView`, and the renderer screens in
`apps/app/src/passwords`.

| Capability | Behavior |
| --- | --- |
| Unlock | Platform BiometricPrompt: strong biometric or the device credential. Requires a secure screen lock. The Keystore key itself requires user authentication within the 60 s window and an unlocked device; an in-process grant (also ≤60 s) must exist too. Leaving the password pages, backgrounding Alpha or stopping the Activity locks. |
| List and search | Metadata only: name, username, bindings (website host or app label), update time. Search is local over that metadata. |
| Add, edit, delete | Name, username, one or more exact HTTPS websites (`https://host[:port]`), and a typed (write-only) or natively generated password. App bindings come only from a save capture and can be kept or removed, not hand-entered. Delete needs a second tap. |
| Generate | Native `SecureRandom`, 16/20/32 characters, every character class present, ambiguous glyphs excluded. The value is stored directly and never returned to the renderer. |
| Show and copy | Native only. Show opens a FLAG_SECURE dialog that hides after 30 s or when Alpha stops. Copy marks the clip sensitive and attempts to clear it after 45 s. If Android hides clipboard ownership, clearing waits until Alpha resumes. A replaced or unidentifiable clip is never deleted. |
| Damaged vault | If the key is lost or permanently invalidated (for example, the screen lock was removed), the vault is reported as undecryptable. The only action is "Delete saved passwords and start over": two taps and a fresh unlock, and native code refuses it while the vault is still readable. |
| Set as autofill service | Opens Android's own confirmation (`Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE` for Alpha's package, falling back to Settings). The status row reports only what `AutofillManager#getAutofillServiceComponentName` reads back on refresh or resume. Opening the screen is never treated as selection. |
| Fill | Native app fields through Android Autofill. Website fields in Alpha's browser only with an engine-attested per-field origin (see Browser fill below); without it they are refused. HTTP-auth prompts are filled only for an engine-authenticated challenge origin (`BrowserHttpAuthOrigin.bind`); Android WebView reports none, so the prompt says fill is off and manual entry is used. |
| Save | "Save password?" is offered by Android after a sign-in; Alpha's prompt names the site or app and username, and writes only after Save and a fresh unlock. Save and Fill close their own grants after completion. Same binding and username updates the existing entry. |
| Export | None in this version. Any future export must require explicit confirmation and a fresh authentication. |

Fill rules (implemented in the shared `PasswordFormPolicy`, tested on a JVM):

- A fill request never opens the vault. Android shows one "Fill with a saved password" choice with
  no values; selecting it opens the FLAG_SECURE picker, which always asks for a fresh unlock (an
  earlier unlock in Settings or another fill is not reused) and lists only entries bound to the
  exact request subject. Every fill needs that authentication and an explicit choice.
- Websites: accepted only from a trusted native adapter that reports the exact origin of
  every login field. Standard WebView structures do not supply that information. Alpha's
  browser supplies it through `BrowserLoginFields` (below) where the WebView supports it, and
  is unsupported otherwise. Top-level origin or domain metadata alone is insufficient.
  No third-party browser is trusted by default.
- Apps: the framework-reported package, matched only if `PackageManager#hasSigningCertificate`
  confirms the signer recorded at save time (rotation-aware). Alpha's own native UI and its
  renderer WebView are never filled.
- Matching is exact: `accounts.example.com` and `example.com` are different bindings,
  as are origins on different ports. Native field-origin metadata must preserve that distinction.

### Threat model

| Asset / boundary | Protection | Residual risk |
| --- | --- | --- |
| Vault at rest | One AES-256-GCM frame (`PasswordVaultFrame`, random 96-bit IV generated by Keystore per write) with host AAD in the no-backup directory; non-exportable Keystore key requiring user authentication and an unlocked device; `allowBackup=false` and data-extraction rules exclude everything. | Root or a compromised OS. StrongBox is not asserted. Removing the screen lock permanently invalidates the key; the vault becomes unreadable (reported as `key-invalidated`) and can only be deleted. Because the device credential is always accepted, the key is bound to the lock-screen secure ID, so enrolling a new biometric does not invalidate it (enrolling already requires the credential). Any device unlock also opens the Keystore window; the in-app grant from Alpha's own prompt is still required. |
| Agent, model, logs, journal, notifications, crash data | No bridge method resolves with a secret; the shared client rebuilds responses from allowlisted fields and rejects any secret-like key; errors never echo input; native code has no logging; nothing is written to view state, storage, toasts, notifications or the action journal; the agent observation is `sensitive` (no view, no selection) on every password page, and the agent client then refuses to send. No agent action, workflow step or backend code can reach the vault bridge (static test). | A password the user is typing exists in renderer memory until save/leave. The agent sees no labels or origins at all in this version. |
| Fill into the wrong origin | App signer binding and explicit native per-field origins for any browser adapter, one-shot in-memory tokens (Intents carry only a random token), user choice per fill. In Alpha's browser the per-field origin is the WebView engine's `sourceOrigin` for the field's frame, admitted only when it equals the committed top-level HTTPS origin; values go only to that frame. Standard WebView structures are refused. | Without WebView support for isolated-world scripts and message listeners, browser fill stays off. Never synthesize field origins from the top-level URL or page JavaScript. A same-origin page (or a same-origin frame embedded through another site's frame) receives that origin's credentials, as in any browser. A site can read a password that is filled, typed or pasted into it. A compromised renderer process can misreport which fields exist, but not the frame origin. |
| Save capture | Captured values stay in memory behind a one-shot token (5 min), consumed once; nothing is written without Save and unlock. | Process death drops the capture (fails closed). |
| Reveal / clipboard | FLAG_SECURE, timed hide, sensitive clip flag (Android 13+ hides previews), timed clearing. | Expiry is best effort: other apps may have clipboard access on older Android versions, and Android may defer ownership checks until Alpha resumes. Alpha never clears a replaced or unidentifiable clip. |
| Renderer compromise | Cannot read secrets; cannot mint app bindings; can trigger unlock prompts and native reveal/copy only after a real unlock. | A compromised renderer could rename/delete entries while unlocked. |

### Export and import

Alpha registers the shared `ElizaPasswordTransfer` plugin from the reviewed upstream
pin. Export uses Android's document picker, requires fresh authentication after the
picker returns, and asks for confirmation before writing an unencrypted CSV. The
native implementation streams bounded rows rather than building a second full vault
copy. A failed export warns that the selected file may still contain passwords.

Import reads a user-picked CSV, reviews every admitted HTTPS origin, and adds entries
atomically without replacing saved website/username pairs. Invalid origins, app bindings,
duplicate entries and unsupported rows are skipped. Input is bounded to 2 MiB and
1,000 rows. Backgrounding cancels the operation; the native worker keeps exclusive
ownership until it exits. Only counts cross the bridge, checked by the shared client.
Alpha refreshes vault state after an interrupted import or export.

[Upstream PR #34879](https://github.com/elizaOS/eliza/pull/34879) contains the exact-head
CSV, streaming, atomic-store and native consumer evidence. Four consumer cases and
the separate native store case passed on API 35. These establish the shared module's
fixture behavior, not integrated Alpha, biometric or physical-device acceptance.

### Passkeys

Passkeys are outside MVP under the approved #402 policy. Alpha's browser disables
WebAuthn even where the installed provider supports it. Use a password or the
explicit Open in another browser action; private tabs ask before handing over
the address. Alpha does not detect passkey-only pages. Future system-provider
support requires separate browser/image qualification.
The integrated password manager does not provide passkeys or store TOTP secrets.

### Evidence boundary

`npm run verify` runs the JVM custody/policy tests, the shared client tests and the Alpha
boundary tests; Playwright covers the Settings UI with the flag-only development vault
(`?mode=dev`, `ELIZA_DEV_ALLOW_TEST_MOCKS=1`) and a controlled native bridge. The upstream native consumer fixture passed three tests at
`352d7a0855b713319cbe1acdab5fbf556fb85aa8` on API 35: Android app save, device-credential
unlock, cancellation during authentication, retry, explicit account choice and fill. See
[upstream PR #34835](https://github.com/elizaOS/eliza/pull/34835) for the recording, exact APK hashes
and cleanup evidence. This does not establish Alpha WebView, cross-origin iframe, biometric or
physical-device acceptance. The production bundle audit refuses the development vault strings.

### Browser fill (engine-attested field origins)

Standard WebView structures do not provide authoritative per-field origins, so the shared provider
requires the native `PasswordAutofillPolicy.FIELD_ORIGIN` contract for every login field and refuses
them. Alpha's browser supplies that contract itself, from the WebView engine:

- `BrowserLoginFields` installs, before a tab loads anything, a `WebViewCompat.WebMessageListener`
  and a document-start script (`BrowserLoginFields.SCRIPT`) in an **isolated JavaScript
  world** of every frame (`JS_INJECTION_IN_FRAME_AND_WORLD`). Page script cannot reach that world's
  channel, so it cannot post reports or read fill values sent to it. The script reports trusted
  focus on a username/password field of its own frame; its message has no origin, address or frame
  field (the parser accepts none).
- The origin is only the listener's engine-supplied `sourceOrigin` and `isMainFrame`.
  `BrowserFieldOrigin.bind` admits it only when it is HTTPS, equals the tab's committed top-level
  origin (scheme, host and port), and the tab is selected, shown, resumed, committed, finished,
  error-free and has no site prompt open. The binding then holds only for that navigation. A
  report a replaced document sent late can at most bind that dead document's reply proxy; the
  script's random document id and origin check drop its fill.
- **Frame policy:** the top-level document and same-origin frames are filled. A frame of any other
  origin (including a same-site subdomain or another port), a sandboxed frame (opaque origin) or
  cleartext is refused. A same-origin frame nested inside another site's frame passes the
  native rule (its engine origin is the top-level one); the isolated-world script refuses to
  report it because its ancestor chain is not same-origin. A same-origin frame holds the same
  site's credentials, and values travel only to it.
- Admitted fields appear to Android Autofill as virtual children of a transparent, non-interactive
  view over the tab, with the engine origin as web domain and `FIELD_ORIGIN`, and the committed
  top-level origin as `TOP_ORIGIN_EXTRA`. The tab WebView's own structure is then excluded, so no
  field is offered twice. This narrows what other providers see in Alpha's browser: only
  username/password pairs (exactly one password field) are offered, so addresses, cards,
  one-time codes, sign-up and change-password forms, closed shadow DOM and non-HTTPS frames
  (about:blank, srcdoc) get no provider suggestions there. The selected provider (the integrated vault, Proton or another) owns
  unlock, the choice and Save exactly as for apps; the integrated vault's `PasswordFormPolicy`
  admits the exact origin.
- Fill values from the provider are posted only through the reply proxy of the frame that
  reported the field; the script writes them only into a field it registered in that document,
  after checking its own origin. On a trusted form submit the script sends the registered fields'
  values to the bound session, and the page-initiated navigation that follows commits it so the
  provider can offer Save. Script-driven sign-ins without a form submit are not captured.
- A binding is revoked on focus to other fields, unload of the bound document (a frame navigating
  on its own included), navigation, tab change, site prompt, error, close and renderer loss; late
  values are dropped. Re-focusing the same fields keeps the binding, so a fill result that arrives
  after a provider's unlock screen still matches. Revocation never reports the fields invisible,
  so cancel paths do not turn into Save offers. Ending a binding exits the field without
  cancelling the session (a sign-in's unload must not discard its Save), so an old popup can
  stay up briefly; a choice from it is dropped. A provider's unlock screen pauses Alpha; values are
  applied only once the tab is resumed and shown again.
- Nothing in this path logs, stores or forwards a value, and nothing reaches the renderer bridge or
  the agent. `AlphaBrowser.loginFillStatus` reports only whether the WebView supports it.
- When `WEB_MESSAGE_LISTENER` or `JS_INJECTION_IN_FRAME_AND_WORLD` is unsupported, or setup fails,
  the tab keeps the WebView's own structure; the integrated vault refuses it, and Settings says
  "Off: this Android System WebView cannot report which site owns a sign-in field". When
  supported, Settings says only that the WebView supports it; filling depends on the selected
  service and is not device-qualified.
- Chromium's own Autofill code may still call the framework for the excluded WebView (empty
  requests, its own commit on form submission, keyboard inline suggestions tied to the WebView).
  How that interacts with the attested fields must be checked on a device.

Evidence: the shared `BrowserFieldOriginTest` (JVM, in `plugin-native-browser-surface`, run at the
pin by `test/login-surfaces.test.mjs`; wrong origin, cross-origin, subdomain,
port and sandboxed frames, cleartext, binding expiry on navigation, hidden/paused/deselected tabs, spoofed
script messages, unsupported WebView, revocation, and the pinned `PasswordFormPolicy` on the
adapter's structure), source guards in `test/login-surfaces.test.mjs`, and
`test/browser/login-field-reporter.spec.ts` (the script in desktop Chromium with a stand-in
channel: trusted events only, no origin in messages, fills only registered fields of its own
document, silent in cross-origin frames). None of these runs WebView, the isolated world, a
provider, a vault or a device.

`PasswordBrowserFillInstrumentedTest` checked the real framework's unavailable result for
standard top-level and cross-origin forms before this adapter; both standalone and launcher
passed on API 35. It now expects, where the WebView supports attested fields, an offer for the
top-level form (never chosen) and still no offer for a cross-origin iframe; that version has
not yet run. Successful fill and Save with the integrated vault and with Proton, on a
release-signed APK and a device, remain to be qualified.

## Other password providers (Proton Pass)
Alpha Settings → Password manager reports a read-only Android snapshot. The Browser menu opens the same detail page. The UI distinguishes an absent, disabled, publisher-unrecognized or verified Proton package; no provider, another provider, or Proton selection; and Android autofill availability. Unknown observations remain unknown. A selected package is named as verified Proton only when its publisher matches the pinned certificate. A disabled verified package is labeled disabled.

The original Proton publisher SHA256 is pinned in `config/native-apps.json`. Android's rotation-aware `PackageManager.hasSigningCertificate` verifies that identity; package visibility is limited to `proton.android.pass`. No vault, passwords, form contents or unlock state is queried or sent to the agent. These metadata observations can become stale, so launch/setup authenticates the package again and the UI refreshes on app resume or explicit Refresh.

Choose password provider opens Android's public provider picker when the verified provider and autofill are available. Missing picker handlers fall back to Android Settings with search guidance. Without a verified provider, the Settings handoff remains generic. Android owns confirmation, selection and cancellation. Alpha never sets secure settings, forces a grant, enables a service or treats opening the picker as successful selection. The install action opens Proton's official download page; it does not download/install an APK. Open Proton Pass requires the pinned publisher again at dispatch.

Browser-only builds explain that the browser/OS manages passwords, offer no fake native installation/selection controls, and cannot report Android provider state. Mock mode, which exists only in `ELIZA_DEV_ALLOW_TEST_MOCKS=1` builds, keeps its simulated UI and does not install the live setup adapter. The development sample password provider is likewise flag-only; production builds and distribution APKs show only the real Android provider status.

This is onboarding, not official-provider acceptance. The embedded Alpha browser is distinct from a browser on Proton's recognized-browser list. Preserve any provider warning. Setup does not establish password saving/filling, cross-origin matching, unlock/resume or release-signed/physical-device compatibility; those remain the password acceptance gates in `browser-autofill-integration.md` and the MVP completion plan. Alpha neither restyles nor bypasses provider-owned vault/security UI.

Primary references:

- [AutofillManager](https://developer.android.com/reference/android/view/autofill/AutofillManager): `isAutofillSupported` and `getAutofillServiceComponentName` report device/user support and selected service. `hasEnabledAutofillServices` is deliberately not used: it asks whether the calling app itself provides the selected service.
- [Android autofill setup](https://developer.android.com/identity/autofill/autofill-services): user enablement and public provider picker.
- [AOSP15 CredentialsPickerActivity](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/android15-release/src/com/android/settings/applications/credentials/CredentialsPickerActivity.java) and [Settings manifest](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/android15-release/AndroidManifest.xml): exported package-scheme request action routes into the combined picker. Alpha does not infer selection from activity results.
- [PackageManager signing verification](https://developer.android.com/reference/android/content/pm/PackageManager#hasSigningCertificate(java.lang.String,%20byte[],%20int)): publisher verification respects proof of signing-key rotation.
- [Proton Android setup](https://proton.me/support/pass-setup-android) and the pinned provider constraints in `browser-autofill-integration.md`.

HTTP-auth provider fill and save require an engine-authenticated challenge (`BrowserHttpAuthOrigin.bind`):
the exact request URL after redirects (scheme, host, port), a realm matching WebView's, a top-level
request, engine-validated TLS and the tab's current navigation, on the selected, shown, resumed tab
with no other prompt. The observed main-frame target can only refuse a binding (a later redirect).
Android WebView reports only host and realm, so Alpha's browser uses `STANDARD_WEBVIEW`, which reports
no challenge: the prompt states why password-manager fill is off, the fields are excluded from
Autofill with no hints, and manual entry remains. A bound prompt's binding is revoked on Cancel,
dismissal, a repeated challenge, navigation, tab change, close or renderer loss; revoked or unbound fields
leave every Autofill request, report no typed value even to a manual request, and drop late fill values. The shared JVM test (`BrowserHttpAuthOriginTest`, run at the pin by `test/login-surfaces.test.mjs`) covers
redirects, frames, wrong origin/port/realm, cleartext, stale and hidden tabs, lock (pause) and cancel;
it does not run a provider, a vault, Android's structure code or a device.
