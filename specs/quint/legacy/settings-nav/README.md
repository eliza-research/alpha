# Historical Settings navigation source replay

The replay mounts the flag-off Alpha renderer in Chromium with synthetic native
and resident ports. It opens the shipped Settings screens through visible
controls and delivers the same `alpha-back` event the renderer handles from the
native bridge. Each stable navigation observation checks the selected renderer
route and visible page title. License search uses the packaged notices and
verifies filtering, selection, and retained search on Back. The sign-out control
opens a real browser confirmation. The driver dismisses it and checks that the
selected plan and synthetic durable Cloud owner survive.

The replay aliases call the unchanged historical `SettingsNav` initializers and
actions. Both profiles cover the About and license list stack, Calendar and
password settings entry and return, and account plan entry. The proposed replay
also covers sign-out confirmation and dismissal. The Apps and Account grouping
pages project to the historical root at the shared navigation boundary. The
license query and the round trip to an extra detail page leave the shared list
projection unchanged. The historical proposed safety predicate and the
configured current-profile safety subset are checked on their own model states.

Separate expected observation mismatches record the historical current direct
sign-out and root Wi-Fi row, the extra mounted license detail in both designs,
and a mounted account information row absent from the historical proposed page.
The full rendered inventory, Android's system settings and reset confirmation,
physical Back delivery, accepted sign-out, and real Cloud operations are outside
the checked schedules.

With the authenticated client features and Playwright Chromium prepared, run
`node --import=tsx --test test/quint-legacy-settings-nav-refinement.test.mjs`.
