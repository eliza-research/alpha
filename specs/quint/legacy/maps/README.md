# Historical Maps source replay

The driver mounts flag-off Maps in Chromium. The current Alpha adapter,
shared Maps screen and controller, Cloud provider and browser location
adapter run on real source. The fixture supplies a synthetic account's
`mapsRequest` port, a closed map style and synthetic precise location fixes.
No route, search text or location reaches an external service.

The comparison observes the mounted screen and conversation, actual accepted
route, installed provider and capability attempt. It checks selected shared
projections for capability success and failure, explicit search recovery,
result selection, Directions after explicit origin entry, Start, End,
conversation minimization and arrival. A fresh off-route fix keeps guidance
and prompts for an explicit reroute. A real touch on the rendered button
checks the exact route request endpoints. The same mounted replay checks
guidance controls, Map information, attribution links and status text at
412×915, 360×640, 915×412 and 640×360 with 100% and 150% browser text.
The landscape checks also open and close Map information by touch, sample
the first disclosure action and check the controls on the right-docked
assistant. These are derived renderer checks over the shell's measured
dock clearance. End and arrival also release the synthetic location watch.

The separate mismatch receipts capture these differences.

- A failed passive capability read records an offline diagnostic, while the
  mounted base status continues to say “Add a location.” A search waiting on
  a failed read displays the offline error. The historical current profile
  expects a generic provider prompt in the latter case.
- Directions initially requires an explicit origin and makes no route
  request. The historical action already has an accepted route.
- Minimizing the conversation keeps current guidance active. The historical
  current profile leaves navigation.
- Arrival releases location and retains the accepted route in its arrival state.
  The historical action clears the route at arrival.
- A failed explicit reroute clears the accepted route and ends guidance.
  The historical proposed fault and off-route sequence retains the route.
  A refusal of one current route request can occur with the provider still
  installed, unlike the original fault's service-session transition.

The original current and proposed profiles, transitions and fairness
declarations are preserved. The replay helper exposes a deterministic
selection of the original cloud-fault branch. Informational status messages
are outside the historical error categories. Real subscription and identity
changes, agent request liveness, background navigation, device permission
prompts and Calendar return remain separate. This comparison does not check
the historical fairness assumptions.

With authenticated client features and Playwright Chromium prepared, run
`node --import=tsx --test test/quint-legacy-maps-refinement.test.mjs`.
