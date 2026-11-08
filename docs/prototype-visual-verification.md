# Authoritative prototype visual verification

Reference: https://alpha-phone-prototype.pages.dev/; HTML snapshot SHA-256 `fd1ee08878c9ae8e8e0d112cc42e3b687326f290b1f86ddaca0f737cdb79afff`. This report concerns the extracted presentation fixture, not completion of native integrations or production behavior. Since October 4 the fixture data and images, `?fixture=1` and `?start=` presets exist only in builds with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`; the capture script runs against the development server with that switch on, and production builds swap the fixture module for an empty one. The rejected former renderer is not a visual baseline.

## Evidence and method

[Capture script](../scripts/prototype-capture.mjs) records the live reference and local fixture for each named state in light/dark themes, with each `[data-screen]` captured at 412 × 915 pixels, device scale 1, US English, America/New_York, reduced motion and loaded fonts. The remote desktop viewport is 960 × 1020; local phone viewport is 412 × 915. Screenshots crop to the phone content element, excluding the demo rail and outer device bezel.

[Comparison script](../scripts/compare-prototype.py) reads existing screenshots only:

```sh
python3 scripts/compare-prototype.py --captures test-results/prototype-all
```

It requires Pillow and NumPy; it does not install dependencies or operate a browser. Its fixed comparison rectangle is x `[12,400)`, y `[44,871)`, totaling 320,876 pixels. This excludes status-bar clock and preview rounded corners. It also omits the bottom 44px gesture region, so equality there is **not** established. A changed pixel means at least one RGB channel differs by more than 16. Mean absolute channel error uses all channels inside that rectangle. No adaptive masking, registration or rescaling hides discrepancies. Dimension mismatch is separately reported.

Generated ignored artifacts:

- `test-results/prototype-all/manifest.json`: source URLs, state/theme, fonts, browser errors, screenshot hashes and dimensions.
- `test-results/prototype-all/comparison/metrics.json`: paired metrics and corresponding input hashes.
- `test-results/prototype-all/comparison/<theme>-<state>.png`: amplified RGB difference heatmap, excluded pixels black.
- `test-results/prototype-all/comparison/contact-*.png`: groups of reference, local, difference thumbnails, in that order.

## Capture admission

Wait for visible image and CSS background-image decoding under a bounded host
timer independent of the paused page clock. Record dimensions and decode failures.
HTTP responses of 400 or greater, request failures, page errors and decode
failures/timeouts make a capture unsuccessful even when a screenshot exists.
A failed hosted font request cannot be relabeled a clean runtime pass. Preserve
original captures and identify any replacements and their source hashes.

## Extraction integrity

All 49 local reference assets were downloaded, including all 42 WebPs, both SVG logos, Denton, the helper and two React distribution scripts. Bundled Google fonts bring the manifest to 53 records (font files may be shared across weights). Every local asset was rehashed and matched [asset-manifest.json](../apps/app/src/prototype/asset-manifest.json). The template body exactly matches the downloaded HTML and the model exactly matches its original inline script apart from import/export wrappers. JavaScript syntax checks passed. The phone-only helper retains the original root theme binding and clones the exact screen content while excluding demonstration furniture.

The remote alpha-only Fraunces endpoint fails. The local copy uses official full-family italic weights 300/400 as a documented fallback; Public Sans and Denton are bundled. Remote capture `FAILED` status due solely to that external font request is not the same as missing screenshot or broken layout: the manifest retains the error, and comparison can still inspect the captured image. It is also not a clean remote runtime pass. Any used fallback glyph differences must remain visible in metrics.

## Completed initial sweep — 136 paired captures

The sweep captured 68 states (60 app entries plus eight shell entries) in each of light and dark themes: 136 reference and 136 local screenshots. All 136 local captures report clean success. The reference has four clean captures and 132 marked failed because the external Fraunces request failed; screenshots still exist for every pair. None of these external failures is silently relabeled a clean pass.

All 136 pairs are 412 × 915 with no dimension mismatch. In the documented interior region:

- 89 pairs have zero pixels exceeding the channel-difference threshold.
- 134 pairs differ in fewer than 1% of pixels; median changed-pixel percentage is 0%.
- Light lock differs by 1.1528%, visibly the main clock (6:12 versus 6:14).
- Dark Maps navigation differs by **10.6465%** and is an open deterministic-comparison item, explained below.

Contact sheets were inspected for Phone, Messages, Inbox, Calendar, Camera, Photos, Maps, Notes, Contacts, Files, Wallet, Workflows, Settings and shell surfaces across both themes. Full-size inspections of larger discrepancies found:

| State | Difference | Assessment |
| --- | --- | --- |
| Light Calendar month | 0.4385% | Current-time timeline marker changes between 6:11 and 6:13. Header, month grid, account switches and event-card geometry match. |
| Light Contacts detail | 0.3746% | Summary text says missed call at 5:59 PM versus 6:01 PM. Other displayed geometry matches. |
| Light/dark Phone recents and voicemail | Up to 0.2294% | Differences concentrate at relative-time/call timestamp text. |
| Light/dark Maps route | Up to 0.0639% | Arrival-time text changes. |
| Dark Maps navigation | 10.6465% | Full-size reference shows 0.3 mi / 9 min; local shows 0.2 mi / 8 min and map auto-centering shifts roads horizontally. The ongoing simulated navigation advanced to different instants. This is a real image discrepancy; same-state labels alone do not establish equal dynamic state. Freeze time/timers consistently and recapture before calling it a visual match. |
| Voice/recording | Small residuals | Animated waveform/timer state is not frozen by the capture harness; reduced motion does not freeze JavaScript timers. |

No static layout or missing-image mismatch was identified in the reviewed pairs. This is narrower than proving every screen pixel identical: border/status/gesture regions were excluded, some thumbnails were the inspection level, reference font requests failed, and dynamic time was not synchronized. The 136 presets also do not exercise every nested Settings page, scroll position, modal, provider error or user-created content state.

Next acceptance work: deterministic dynamic-state recapture, deeper Settings/modal/error-state coverage, and live Android phone comparisons with real provider data. Native functionality, tap/gesture behavior, keyboard/safe-area handling, actual capture/ASR/model actions, lock security and accessibility are not proven by this presentation-fixture sweep.

## Deterministic follow-up

The capture harness now accepts `--deterministic`. Before navigation it installs Playwright's clock and pauses at `2026-09-29T18:00:00.000Z`. After loading/fonts it advances exactly the configured settle interval (700ms by default); manifests record `deterministic`, `fixedDate`, `elapsedMs` and observed `capturedDate`. This keeps network/font load time from advancing simulations.

A first follow-up at `test-results/prototype-deterministic` covers Maps navigation/route, lock, Calendar/day/month, Phone/voicemail, Contacts detail, voice and note recording in both themes: 40 screenshots/20 pairs. All observed dates are exactly `2026-09-29T18:00:00.700Z`. All 20 local captures are clean; 18 reference captures retain the external Fraunces failure and two are clean. Maps navigation in **both** themes now has zero changed pixels; the previous 10.6465% outlier was time/progress-dependent. Lock, map arrival times and contact timestamps likewise have zero changed pixels. Calendar month and Phone each differ at 0.0009% (three pixels at this mask size).

Note recording differs at 0.3606% light / 0.3740% dark in that first follow-up: the reference displays the beginning of a live transcript (“Quick”), while the local snapshot does not. Both display 0:00, with different final waveform bars. This is retained as a real snapshot discrepancy. The harness is being checked with 50ms clock steps and a browser task flush between steps because one 700ms jump can batch timer-driven React state differently across renderer versions. That follow-up uses a separate `test-results/prototype-deterministic-frames` directory and does not overwrite the first evidence.

The 50ms-step follow-up is complete: **20/20 local captures clean, 20 paired screenshots, 17 pairs with zero thresholded changed pixels, and three pairs with only three changed pixels each (0.0009%)**. All 40 reference/local captures report the exact same observed time `2026-09-29T18:00:00.700Z`. All dark-theme pairs, Maps navigation in both themes, both lock screens and both recording states now have zero thresholded differences. The previously missing “Quick” transcript and waveform difference disappear when React can commit between simulated timer ticks; no application code was changed to obtain this result.

The three residual light-theme pairs are Calendar month, Phone recents and voicemail. Their changed pixels are exactly `(146,844)`, `(144,846)`, `(142,848)`, in the small assistant-pill glyph area, not shifted screen layout. These are not declared byte-identical; the recorded font fallback and rasterization remain plausible contributors. The contact sheet was visually inspected. The remote font failures remain present and separate from pixel metrics.

Reproduction of the final targeted pass (supply your installed Playwright modules/browser paths):

```sh
node scripts/prototype-capture.mjs --deterministic \
  --modules=/path/to/node_modules --executable=/path/to/chromium \
  --local=http://127.0.0.1:5175/ \
  --states=maps:nav,maps:route,lock,calendar,calendar:month,phone,phone:voicemail,contacts:detail,voice \
  --out=test-results/prototype-deterministic-frames
python3 scripts/compare-prototype.py --captures test-results/prototype-deterministic-frames
```

Final targeted artifacts: `test-results/prototype-deterministic-frames/manifest.json`, `comparison/metrics.json`, `comparison/contact-01.png` and per-state heatmaps. This resolves the initial dynamic navigation/clock discrepancies for the selected fixture instants; it does not extend acceptance to untested interaction states, excluded screen regions or production native-provider behavior.

## Full deterministic recapture, build 10 source

The complete 136-state-pair recapture is saved under `test-results/prototype-final9` (272 images). Comparison completed on 2026-09-29. All dimensions match and the maximum thresholded interior pixel difference is 0.0134%; no local capture console errors were recorded. This is a fixture-mode visual comparison, not a native-flow acceptance result. The fixed comparison excludes the top/bottom 44 pixels and side 12 pixels, with a 16-channel-value threshold. The reference still reports its failed Google Fonts request; the locally bundled font fallback and small animated/antialiased differences require this qualification. Metrics and difference/contact sheets are in its `comparison` directory.
