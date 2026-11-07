# Browser continuity and durable bookmarks

By the October 7 owner decision, browser tabs keep sign-ins: normal tabs share one persistent browser profile. As an engineering choice that follows from it, normal tabs and history are restored after a cold start. Private tabs are ephemeral. See [sign-ins, private tabs and site data](prototype-browser-integration.md#sign-ins-private-tabs-and-site-data).

The browser retains tabs, selected tab, history and bookmark state across view resets. Normal tabs and history are also saved to disk (below). Overlays still reset and native surfaces still hide on departure.

Explicit user bookmarks use the existing menu/library without new chrome. Native Android stores at most 100 unique HTTPS URLs (4096 characters each) encrypted with AES-GCM and an Android Keystore key. Embedded credentials, whitespace/control characters and non-HTTPS schemes are rejected. Bookmark changes are serialized and the renderer changes only after native commit succeeds. Failed decryption or writes preserve the existing ciphertext and report failure instead of silently replacing it. The store contains no page content, form data, history, cookies or credentials. URLs are not sent to the agent. The native child website has no app bridge. Bookmark URLs can themselves contain private query parameters, which is why plaintext preferences are not used.

Cold startup restores bookmarks, saved normal tabs and history. Saved tabs and history live in upstream `BrowserSessionStore` (Alpha's prefs `alpha-browser-session`, see `AlphaBrowserStores`), AES-GCM encrypted with an Android Keystore key like bookmarks: at most 8 tabs (id, last committed address, title) and 100 history addresses, no page content, form data, cookies or credentials. The selected restored tab loads its last committed address when the browser is shown; nothing is resubmitted. Normal tabs use the persistent sign-in profile of the October 7 owner decision ([decisions](decisions.md#october-7-owner-product-decisions), P-04); private tabs are never saved and their profiles are purged on close and at startup. Clear browsing data removes saved tabs, history and the normal profile's cookies, site data and cache; bookmarks are kept. There is no account synchronization, vault credential storage or automatic page summarization.

`BrowserContinuityInstrumentedTest#tabsSurviveAppNavigationAndBookmarksSurviveActivityRecreation` exercises two actual HTTPS WebViews sharing the persistent profile, native back/forward, app switching, user bookmark creation/navigation/removal, native ciphertext readback, encrypted saved tabs and Activity recreation with restored tabs, history and site storage. This test is not process-death evidence. `sameActivityReloadAndMockRoundTripRetireNativeProfiles` checks that normal-tab storage and cookies survive host reloads while private-tab profiles are purged.

`node scripts/test-native-restart.mjs bookmark APP.apk MATCHING_TEST.apk OUTPUT` with the [owned-emulator configuration](verification.md) runs `bookmarkProcessRestartPhase` in separate instrumentation processes. It saves a UUID-scoped bookmark through the real UI with a sign-in-style cookie and localStorage value and an open private tab, force-stops the app, requires a different PID, verifies that the private profile was deleted, that only the normal tab is restored with its cookie and storage, and a restored library entry, explicitly opens that bookmark, removes it through the UI, then force-stops again and verifies removal in another PID. Cleanup removes only its recorded synthetic bookmark (all other bookmarks are preserved) and clears saved tabs and history. APK hashes and phase outcomes are archived. Require both distributions to pass prepare, verify in a new PID, verifyRemoved in another PID, and scoped cleanup. The shared upstream lifecycle verifies archived/installed APKs and uses a fresh secondary Android user, retaining it if termination or cleanup is uncertain.

### Open failure: bookmark process-restart verify (release-07)

The last qualification run of `bookmarkProcessRestartPhase` failed in the `verify` phase with
"Actual isolated HTTPS document not restored": after the force-stop, the restored normal tab never
showed `https://example.com/?alpha_bookmark_restart=<uuid>` in a new PID. The October 8 change
does not claim a fix. It removes one way this can happen: a restored tab's background load used to
drop its saved address when native tab creation or the first navigation was rejected (for example
while the host document was being replaced during `liveMode()`), leaving an empty tab. It now keeps
the saved address and retries, at most twice, the next time the tab is shown
(`browser-adapter.ts`, `restoreAttempts`). Whether that was the cause is unproven; the phase must be
rerun on both distribution variants through `scripts/test-native-restart.mjs bookmark`.
`BrowserSigninsInstrumentedTest#signinProcessRestartPhase` adds a cold-start check that opens the
site in a new tab rather than relying on tab restoration, so a restoration failure and a lost
sign-in cookie are reported separately once a runner case (`signinPhase`: prepare, verify, cleanup)
exists.

## Android provider capability

Private tabs, Clear browsing data and Clear data for this site require
`WebViewFeature.DELETE_BROWSING_DATA` for profile-scoped browsing-data deletion;
without it they are refused with an update message. Normal tabs keep their data
by decision P-04 and need only `MULTI_PROFILE`, `GET_WEB_VIEW_RENDERER` and
multi-process mode, so they still open on such a provider; the user then cannot
clear their data from the browser until the WebView is updated. Detect the feature at runtime rather than
assuming support from an Android API or WebView version. Production requires a
maintained, trusted WebView provider and its update policy. A development emulator
provider or a successful APK build does not qualify the shipping provider.
