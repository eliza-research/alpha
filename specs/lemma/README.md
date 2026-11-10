# Function verification

`npm run lemma:check` checks the pinned LemmaScript 0.6.6 generation against the
committed proof companions, then runs Dafny 4.11.0. `npm run lemma:regen` updates
generation after an intentional source/specification change. Review and commit
both companions. `lemmascript.json` selects JavaScript UTF-16 string semantics;
these initial policies use no mathematical-number approximation or extern axiom.

The first admitted production function is `residentBootStateLost` in
`apps/app/src/runtime/resident-recovery.ts`. Its contract classifies exactly
`dead`, `restarting` and `booting` as invalidating the renderer's resident binding.
The existing wrapper still handles a missing native snapshot. Native status
delivery, lifecycle timing and recovery effects are outside this function proof.

The source list is `LemmaScript-files.txt`. Missing or differently versioned Dafny
records `skipped-no-qualified-backend`, never a passing proof. CI sets
`LEMMA_REQUIRE_BACKEND=1`, so missing qualification fails verification. Receipts
under `test-results/lemma/check.json` bind the source, lockfile, configuration,
generated companions and checker output. A changed generated artifact fails the
check even when the compiler would otherwise refresh it in place.

The original audit's deletion, layout, launcher and route-policy targets mostly
now live upstream. Annotate and review them upstream before advancing the consumer
pin; do not edit `vendor/eliza` or `.eliza/client-features` to increase proof counts.
This initial function proof does not complete issue #856's full adoption wave or
establish Android, AOSP, provider or physical-device acceptance.
