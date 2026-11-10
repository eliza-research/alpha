# Isolated staging Cloud inference QA

The ordinary Mac QA launcher uses direct Cerebras. Signing into a Cloud account in Alpha connects managed services; it does not switch that launcher's text route. Subscription-gate staging QA also stops at admission and is not an inference benchmark.

`scripts/start-cloud-qa.ts` launches the normal Eliza source entrypoint with a canonical staging Cloud route in a separate private profile. It requires an explicitly selected staging credential file, an exact model, and a separate port. It refuses existing non-QA profiles and active Alpha port conventions. It neither copies the current user's profile nor embeds a credential in Vite variables or source. Production phone inference binding is unchanged.

Provide these host-side inputs:

- `ALPHA_QA_PROFILE`: a fresh absolute directory reserved for this QA run.
- `ALPHA_QA_PORT`: an independently checked free loopback port, such as 47859.
- `ALPHA_QA_CLOUD_KEY_FILE`: the absolute owner-only regular file containing the already authorized **staging** QA key. Do not use the production Google/Cloud profile or paste a key into the command.
- `ALPHA_QA_MODEL`: the exact reviewed Cloud model for the matched comparison.
- `ALPHA_ELIZA_SOURCE` and `ALPHA_BUN`: the reviewed Eliza source and its pinned Bun executable, as with `start-local-remote.ts`.

Then run `node scripts/start-cloud-qa.ts`. The private profile records its route, source commit, port, and PID in `process.json`; the key stays in the child process environment and is omitted from that receipt. No prompt is submitted by this launcher. Startup does not establish owner identity or an inference success: the receipt intentionally starts with `identityVerified: false`.

For the actual Alpha UI, use a separate preview origin and empty browser Cloud profile with the normal Vite local-agent bridge:

- `VITE_LOCAL_AGENT=1`, `ELIZA_DEV_ALLOW_TEST_MOCKS=1`;
- `ALPHA_LOCAL_AGENT_ORIGIN=http://127.0.0.1:<QA runtime port>`;
- `ALPHA_LOCAL_AGENT_TOKEN_FILE=<QA profile>/owner-token`;
- `ALPHA_BROWSER_CLOUD_PROFILE=<QA profile>/browser-cloud`;
- a separate preview port (check it is free) and a new tab for that origin.

Do not point the active 5209 preview at this runtime. Do not reuse its origin storage or existing Cloud credentials. Normal local pairing and agent readiness must complete before a benchmark prompt. The QA owner must verify the credential against staging through the normal authenticated runtime/Cloud surfaces, then record the provider route, exact model, prompt, context, source hashes, trace IDs, UI timings, and tool/stream receipts. Keep Cloud-versus-direct comparisons matched. No result from this launcher qualifies an Android build or physical device.
