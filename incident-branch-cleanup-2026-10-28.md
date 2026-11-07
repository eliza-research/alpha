# AlphaCompute branch compromise: cleanup record (2026-10-28)

On 2026-10-27, 22:45–23:36 UTC, the GitHub account `gabrielbarbera` force-pushed forged commits to 102 non-default branches across 26 AlphaCompute repositories, in two waves. The forged commits reuse real authors' names and messages. They add a remote code loader that downloads and `eval`s code, an obfuscated `init` script hooked into npm `dev`/`build`, a hidden VS Code task that runs on `folderOpen`, and payload files disguised as fonts. Some also edit unrelated source files (for example attestation, safety and transport code in shroud-go).

## What was done

- Every affected branch now has the exact file tree of its last pre-attack commit. History was not rewritten: a restore commit sits on top of each forged commit, so the forged commits are still in history and must not be checked out.
- `alphaphone` `codex/merge-build-latest-20261026` (#624) and `codex/alpha-reviewed-release-join-20261027` (#632) had already been cleaned by NubsCarson; I verified both trees match their pre-attack state.
- `shroud-go` `feat/apps-connector-demo`: Andrei Pfau pushed 9 commits on top of the forged commit. Only the 24 paths the attacker changed were restored; Andrei's 35 paths are unchanged.
- Verification: all branches' current trees match their pre-attack trees (shroud-go apps-connector-demo excepted, as above). None contains `init`, `.env` or a `folderOpen` task, and an org code search finds no payload marker.

## Still required (owners)

1. Remove `gabrielbarbera` from the org and revoke the account's tokens, SSH keys and OAuth/app grants until they confirm what happened. It still had write access during cleanup and could push again.
2. Rotate Actions secrets in every repo below. CI ran on forged commits there, often on `pull_request` from same-repo branches, so secrets were available.
3. Anyone who fetched, checked out, or opened one of these branches in VS Code between 22:45 UTC on Oct 27 and the cleanup should treat that machine as possibly compromised. That includes Andrei Pfau, who committed on top of an infected `shroud-go` branch. Check for unexpected processes and outbound connections and rotate local credentials.
4. Turn on protection that blocks force-pushes and requires signed commits on shared branches. Review audit-log events for `gabrielbarbera` (and that account's PAT usage) from Oct 21 onward. Earlier pushes to `alpha-compute` `staging` and `vera` came from the same account and were not inspected in depth.

## CI runs on forged commits

| Repository | Workflow runs |
|---|---|
| dstack-tee | 24 |
| vera | 22 |
| altx-compute-terminal | 10 |
| rafay-plugins | 10 |
| corpus-app | 8 |
| shroud-go | 7 |
| alphaphone | 6 |
| shroud-swarm-worker | 6 |
| alphabox-deploy | 4 |
| alpha-infra | 4 |
| vera.report | 4 |
| alpha-compute | 2 |
| confidential-platform | 2 |
| corpus-supervisor | 2 |
| expenseATON | 2 |
| midnight-ton-bridge | 2 |
| confidential-plane | 1 |
| kata-containers | 1 |

## Branches

| Repository | Branch | Pre-attack | Forged | Clean head |
|---|---|---|---|---|
| alpha-compute | `codex/alphaphone-verification-page` | `0e82c199c` | `1a34dbc77` | `06b006fc4` |
| alpha-compute | `fix/staging-cloudflare-zone-id` | `50503c7ab` | `2f5a17b8b` | `9cd27fa52` |
| alpha-compute | `infra/terraform-s3-backend-and-config-fixes` | `4e314b7b2` | `3e8079ccd` | `de52a8ba7` |
| alpha-compute | `infra/tf-backend-and-deploy-fixes` | `656ba73e6` | `8f2c04e6d` | `0f71bec17` |
| alpha-compute | `staging` | `49a480a8e` | `41ac0baca` | `3a13b2fd8` |
| alpha-infra | `feat/mcp` | `f0748da80` | `f800b5e54` | `936461104` |
| alpha-infra | `prd01/alpha-1-g0-profile` | `8c8af304d` | `586872d12` | `d1987b3c5` |
| alpha-infra | `prd01/alpha-1-host-image` | `c2569e844` | `e08412842` | `26177bfad` |
| alpha-infra | `prd01/version-audit` | `dd385b0fd` | `8fa3e01d5` | `b1744a974` |
| alpha-infra | `prd06/draft-pool-moves` | `4d5b701af` | `367e5e46b` | `65a61d4e1` |
| alpha-tech-ops | `docs/confidential-infrastructure-target-architecture` | `d6600e5b9` | `a4d5f4ccc` | `d5528f1a5` |
| alpha-tech-ops | `docs/confidential-plane-current` | `ca096da5c` | `da76ec995` | `04aa71cb6` |
| alpha-tech-ops | `docs/confidential-stack-as-built` | `639fd5f2f` | `d93761bca` | `03c70fb94` |
| alpha-tech-ops | `docs/prd-012-netbox-rafay` | `e7d7cd3b8` | `e4259b02e` | `4796bb802` |
| alpha-tech-ops | `docs/target-architecture-aws-nitro` | `86a986856` | `cc831af91` | `81c66dd0a` |
| alphabox-deploy | `contracts-p2-hardening` | `fc7d5fbac` | `36a0de8e6` | `a6508d373` |
| alphabox-deploy | `feat/documents-in-netbox-extraction` | `6e6bedf23` | `a07f0335f` | `1875d4e63` |
| alphabox-deploy | `feat/netbox-logs-dashboard` | `d537a5c92` | `c4de0572a` | `d67d79412` |
| alphabox-deploy | `feat/shroud-usage-tab-grafana` | `6c09c4a2b` | `4e338accb` | `d7bd11fe2` |
| alphabox-deploy | `fix/contracts-bulk-upload-hardening` | `8c7053ec5` | `035fe22c9` | `1256c829d` |
| alphaphone | `claude/c1-notes-clock` | `9ca8a6073` | `0cefd6e47` | `e4907419a` |
| alphaphone | `claude/c1-shell` | `cc7cb00b2` | `131cd0e63` | `ba5c75a3b` → rebuilt `54d7fb432` (forged history removed) |
| alphaphone | `codex/alpha-causal-calendar-schema-8cc-20261027` | `00a31c2bc` | `cc3f7a709` | `56cd16b5e` |
| alphaphone | `codex/alpha-reviewed-release-join-20261027` | `a56d3e7b9` | `61d293f61` | `5e903af01` |
| alphaphone | `codex/merge-build-latest-20261026` | `c8f5212e0` | `39ef59401` | `4e031d13d` |
| altx-compute-terminal | `codex/data-api-latest-settles` | `410aa9ce7` | `7ec43bd75` | `a3920dcf1` |
| altx-compute-terminal | `feat/apisix-enable-fixes` | `d7e61e833` | `636f7a8ec` | `0a6ad0e1f` |
| altx-compute-terminal | `fix/snyk-security-findings` | `7364aacf9` | `bf9751de1` | `c7bf0d98e` |
| altx-compute-terminal | `snyk-upgrade-2c8e3af4136f03dc40ee7c8516697f23` | `acf8b38ba` | `ff8659083` | `ea9e4020c` |
| altx-compute-terminal | `snyk-upgrade-b59e422a4cd5043994929110c81178db` | `6af3da510` | `7c2a40624` | `62585fbc1` |
| confidential-plane | `chore/bump-golang-x-deps-and-toolchain` | `2f19ca158` | `ede29cb4a` | `6b9a6d0b2` |
| confidential-plane | `chore/bump-pgx-v5.10.0` | `9528fc268` | `b492c8d54` | `a6c2ec2d4` |
| confidential-plane | `ci/dev-prod-plane-split` | `f74f2a282` | `6cca11d34` | `9f0fc513f` |
| confidential-plane | `plan-024-canonical-compose-hash` | `d7ce164fb` | `61b24fbf4` | `7b6c33de5` |
| confidential-plane | `revert/skip-gpu-attestation` | `2c78f5d49` | `a8cfbef92` | `0b82daebb` |
| confidential-platform | `core/coco-revision-v2` | `cb2359e25` | `28dcf1ad4` | `bfc20b6dc` |
| confidential-platform | `kms/custodian-sealed-store` | `613429eba` | `df2b0b073` | `c0b4fd40c` |
| confidential-platform | `kms/customer-evidence` | `14b19204c` | `c6323830f` | `a3367852a` |
| confidential-platform | `signer/portal-embed-view` | `7922eaf58` | `0506163bc` | `890f044a4` |
| confidential-platform | `signer/revision-v2-and-embed` | `cd3543b67` | `556e737e3` | `4a5b5c8b2` |
| corpus-app | `fix/answer-content-copy` | `a77ac7dc4` | `66529f579` | `9753935a5` |
| corpus-app | `fix/mobile-thread-layout` | `9260c0313` | `399dd435b` | `2f613759e` |
| corpus-app | `fix/prod-deploy-by-revision` | `f8c088e66` | `ef8a13498` | `c6a57151b` |
| corpus-app | `fix/session-lifetime` | `2c8197a4d` | `90e9966c5` | `ffa5d72ae` |
| corpus-app | `fix/session-recovery` | `2f408ab78` | `01668436f` | `65674b3ec` |
| corpus-harness | `feat/step-and-turn-figures` | `888bd65e3` | `2b1f6e5ed` | `1047bae93` |
| corpus-supervisor | `dev` | `e7ace12cb` | `5ac463561` | `6d9ce758a` |
| corpus-supervisor | `prd04/supervisor-on-kata` | `aff5fc99c` | `bd966ff33` | `2c6ffc571` |
| corpus-supervisor | `q146/coco-render` | `68c11df19` | `b6641c0a0` | `8fc88212f` |
| corpus-supervisor | `q146/coco-spec` | `5667ce7c6` | `6ad9b7d41` | `b68084e28` |
| creative-ops | `claude/check-whimpering-failed-45hnug` | `8ac24bf0d` | `6c4c9e720` | `088028983` |
| creative-ops | `feature/comment-mentions` | `2ea45ca04` | `dfb732984` | `a2a54f7c8` |
| creative-ops | `feature/notion-history-property` | `437895c03` | `c0802e436` | `623205e24` |
| dstack-tee | `chore/sync-upstream-20260914` | `0937e3038` | `c6cd4a33f` | `ac94a4bb1` |
| dstack-tee | `codex/core-components-test-infrastructure` | `ad6f2fd12` | `f98ae12ba` | `612320a1f` |
| dstack-tee | `codex/sync-upstream-20260922` | `80c0003c7` | `770e7f7c1` | `4997d8d2a` |
| dstack-tee | `codex/sync-upstream-20260923` | `54c78ba62` | `52845fe26` | `8f1aecc9b` |
| dstack-tee | `next` | `89fe3184b` | `0aff5f6c3` | `7d0d17d78` |
| enclave.alpha | `feat/enclave-chat` | `bc45adbca` | `ba9a280dc` | `2e287d9de` |
| enclave.alpha | `feat/server-side-enclave-proxy` | `156d6fb58` | `df27c06b5` | `db0caa2ce` |
| enclave.alpha | `fix/enclave-disclosure-guardrails` | `e463d7ab2` | `1a212b358` | `8a9562fd9` |
| expenseATON | `dev` | `7c8e59598` | `a08b3a270` | `c4f0bd2ab` |
| expenseATON | `enterprise` | `92da3abcd` | `56e7f7d69` | `05e5d5d6f` |
| expenseATON | `hotfix/EA-user-deactivation` | `531d3f06c` | `8b3acbbeb` | `57a7aaacb` |
| expenseATON | `staging` | `ab56c8200` | `0457b6e52` | `9c0be8267` |
| kata-containers | `alphacompute/4.0.0-numa-order` | `6f8e78c81` | `4f381d01a` | `177efe72a` |
| kata-containers | `runtime-numa-pxb-order` | `3322beb2a` | `6da6ed8e9` | `2bfb80dcf` |
| midnight-ton-bridge | `bridge-web-app` | `a9879a951` | `8286e6def` | `7bb442db8` |
| midnight-ton-bridge | `cleanup/followups` | `53bf87c9f` | `c871878ee` | `f3488e871` |
| midnight-ton-bridge | `infra/aws-hosting` | `9329cae07` | `2229ea2fc` | `daeb47694` |
| midnight-ton-bridge | `review/automated-relayer` | `fca059f2d` | `53f0d07a3` | `83adcf8a4` |
| midnight-ton-bridge | `review/fund-safety-fixes` | `78bb48c39` | `90b07d54a` | `49a96a556` |
| platform-documents | `dev` | `fe068b84b` | `4ef2b87fb` | `e4548aca3` |
| rafay-plugins | `feat/encrypted-volumes` | `70544873b` | `149ecb4cf` | `e6012b874` |
| rafay-plugins | `feat/fortanix-sku` | `ac5310ed7` | `b764806d9` | `b5c7d9473` |
| rafay-plugins | `feat/kms-endpoints-configmap` | `e56f36431` | `f46213cdb` | `53a301d05` |
| rafay-plugins | `feat/sovereign-placement-partner-bundle` | `6b6bfb983` | `d4b2f2ed3` | `f675adf41` |
| rafay-plugins | `prd03/bare-metal-handover-verify` | `52fc93a3a` | `c2836e9e7` | `e9e5bbc37` |
| right2compute | `staging` | `0443f8450` | `b08e10cdb` | `74093b800` |
| shroud-go | `codex/fix-attestation-fail-closed` | `38eb30f1b` | `4b5ccf8eb` | `18abe7033` |
| shroud-go | `feat/apps-connector-demo` | `12d34ad7f` | `db7cc5b6f` | `6cd33e190` |
| shroud-go | `feat/mcp` | `86936784e` | `5a325f94c` | `9c7501ad9` |
| shroud-go | `feat/mcp-wildcard-scope` | `7356f3239` | `ac17cfbdd` | `6222dedf2` |
| shroud-go | `feat/pod-namespace-per-instance` | `eeb25ca73` | `ce15c881c` | `cf055da49` |
| shroud-swarm-worker | `feat/inference-shim` | `e2718cf96` | `5d7646e3a` | `e9f600564` |
| shroud-swarm-worker | `feat/refuse-gateway-fallback` | `bc6eeeefc` | `145f23a64` | `df35cf856` |
| shroud-swarm-worker | `fix/sealed-model-and-reasoning` | `68b718c58` | `126632723` | `c9093a07f` |
| shroud-swarm-worker | `fix/snyk-critical-cves` | `a200d2aa0` | `2f2229f20` | `fb47041b2` |
| shroud-swarm-worker | `fix/update-actually-applies` | `e8404e72d` | `6f42de627` | `098abfb53` |
| sqlx | `scram-channel-binding` | `1bb869585` | `640c76de0` | `8657375b0` |
| sqlx | `v0.9.0-direct-tls` | `a890b1609` | `223e11760` | `9b32d7edd` |
| trade-compliance-training | `codex/staged-course-email-delivery` | `3abbffb31` | `5c6fbee46` | `f4b68bd72` |
| trade-compliance-training | `fix-live-check` | `6cb10fed1` | `bb441a9b2` | `37d9a98c0` |
| trade-compliance-training | `hosted-lms` | `fb86d3c02` | `beda6b57f` | `a597dee48` |
| trade-compliance-training | `lms-n8n-workflow` | `7bafdddfe` | `bd348965c` | `fb8721d8a` |
| trade-compliance-training | `public-course` | `8644038f9` | `9083c6688` | `7bdc737c6` |
| vera | `codex/enclave-restart-tests` | `cce013069` | `3edbd2060` | `831e575f1` |
| vera | `dependabot/github_actions/staging/github/codeql-action/upload-sarif-4.39.1` | `e1da49481` | `de323e546` | `87bf37f79` |
| vera | `fix/alb-idle-timeout-cloudfront-keepalive` | `00f7ca162` | `7261521fd` | `a0ffa6457` |
| vera | `snyk-upgrade-493b2e18df02072c0e6cec529637ab71` | `fc381f1a4` | `f5d25c4f7` | `3073abf9e` |
| vera.report | `codex/expand-ci-checks` | `3c7667023` | `fe28329bd` | `824860bd1` |
| vera.report | `staging` | `a9252880b` | `855be532a` | `942e4884b` |

## History rewrite (2026-10-28, later)

The restore commits left the forged commits in branch history. Every affected branch has now been rewritten so no branch or tag in the 26 repositories reaches any forged commit:

- 87 branches that still pointed at their restore commit were force-pushed (leased on the restore commit) back to the original pre-attack commit. In every case the forged commit was an amend of that commit (same parent), and its tree equals the restore tree.
- `alphaphone` `claude/c1-shell` (#646) was rebuilt by cherry-picking its two post-restore commits onto `cc7cb00b2` (head `54d7fb432`, same tree).
- `alphaphone` `codex/alpha-reviewed-release-join-20261027` (#632) and its side branches `claude/fix632-member`, `claude/fix632-misc`, `claude/fix632-notes` (which inherited forged `61d293f61` and, through the "Join cleaned #624 head" merge, `39ef59401`) were rewritten commit-for-commit with identical trees, authors, dates and messages, replacing parent `5e903af01`→`a56d3e7b9` and `4e031d13`→`c8f5212e`. New #632 head `3055e3633`.
- 13 listed branches had already been rebuilt by their owners (confidential-platform, shroud-go, shroud-swarm-worker, platform-documents `dev`); verified clean.
- Final scan: no `refs/heads` or `refs/tags` in any of the 26 repositories contains a forged commit.

Anyone with a local checkout of an affected branch must `git fetch` and `git reset --hard origin/<branch>` (or rebase); a plain `git pull` would merge the forged history back.
