# Native Cloud authentication deployment diagnosis — October 24, 2026

This record covers public service probes and the supported Cloud registration
administration workflow. It does not establish a completed user sign-in, Google
consent, mobile credential issuance, or phone acceptance.

## Public observations

Observed on October 24, 2026 (approximately 11:20–11:25 UTC):

| Request | Result | Meaning |
| --- | --- | --- |
| `GET https://api.eliza.app/api/v1/app-auth/mobile/config`, client `ai.alphacompute.alphaphone`, environment `production`, redirect `https://eliza.app/alphaphone/auth/callback` | HTTP 503, `server_configuration_error`, “Configured mobile App Auth app is not active and approved” | The registered client cannot presently issue the required mobile credential. Reconfirmed after the failed repair. |
| `GET /steward/auth/providers?tenantId=elizacloud` | HTTP 200; email and Google enabled | Provider discovery works; no account was authenticated. |
| `POST /steward/auth/email/code/send` with `{}` | HTTP 400, “email is required” | The email-code route exists. No address was supplied and no email was sent. |
| `GET https://eliza.app/.well-known/assetlinks.json` | HTTP 200; Alpha package and the installed development signer's SHA-256 listed | The previously observed missing association file is now deployed. Device verification and production signing remain separate checks. |
| `GET https://eliza.app/alphaphone/auth/callback` | HTTP 200 | The fallback return page exists. This is not successful Android App Link handling. |
| Steward Google authorize with the exact Alpha callback, `tenant_id=elizacloud`, fresh S256 challenge/state and `prompt=select_account` | HTTP 400, “redirect_uri is not allowed for this tenant” | The tenant callback allowlist blocks Google before provider login. No authorization URL nonce/state or provider credentials are retained here. |
| `GET /steward/tenants/elizacloud/redirect-urls` without authentication | HTTP 401, “Authentication required” | The supported tenant administration route exists; an authorized operator session is required. |

## Supported registration diagnosis and repair

The `elizaOS/eliza` **Mobile App Auth Registration Admin** workflow accepts the
exact client, environment and operation. Its protected registry resolves the
client's app UUID; the workflow does not ask the operator to copy secrets into a
shell command or chat.

1. [Initial diagnostic run](https://github.com/elizaOS/eliza/actions/runs/40089604953)
   used the repository's default `develop` branch and was rejected before execution
   because production permits `main` only. No protection rule was changed.
2. [Diagnostic run on permitted main](https://github.com/elizaOS/eliza/actions/runs/40089648101)
   selected `target_environment=production`, `operation=diagnose`,
   `client=ai.alphacompute.alphaphone`. Required schemas were present. It failed
   with `ELIZA_MOBILE_APP_AUTH_APP_ID does not resolve to an apps registration`.
3. [Scoped repair run on main](https://github.com/elizaOS/eliza/actions/runs/40089720955)
   selected the same client/environment and `operation=repair`. It failed at
   `authority.organization_active`. The registered Alpha app row was absent and
   the protected creation organization was missing or inactive. The repair
   transaction rolled back; no registration changes were committed.

The repair implementation validates organization activity, owner activity,
same-organization membership, owner/admin role, unique callback ownership and
generated-key ownership. An absent app row requires the protected organization
and owner inputs. No organization was activated, no owner was invented and no
other application's registration was reused.

## Remaining configuration work

### Follow-up inventory (October 24 Pacific time)

[Read-only Alpha inventory run](https://github.com/elizaOS/eliza/actions/runs/40156329036)
completed successfully with the database identity matching its protected pins.
All three Worker bindings were present. The exact Alpha callback has one app
row, which is active and approved and has a valid owner. Zero callback rows
match the protected organization/owner settings. Public mobile/config still
returns 503 and Google authorize still returns the callback-allowlist 400.

This narrows the issue: the configured missing app ID is not evidence that no
Alpha callback registration exists. Reconcile the registry with the intended
existing registration after confirming its organization ownership; do not
create a duplicate app or copy the other product's primary registration.
No signed-in Cloud tenant administration session was available in the connected
browser, so no tenant allowlist or ownership setting was changed.

For mobile credential issuance, reconcile the **production** protected inputs:

- `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON`: enabled Alpha client with its intended app
  UUID and exact production callback.
- `ELIZA_MOBILE_APP_AUTH_ORGANIZATION_ID` and
  `ELIZA_MOBILE_APP_AUTH_OWNER_USER_ID`: the intended active organization and its
  active authorized owner/admin. Determine whether these references are stale or
  require legitimate organization recovery; do not activate an unrelated row.
- After reconciliation, rerun the supported `repair` operation for the Alpha
  client on `main`, then `diagnose`, and require public mobile/config HTTP 200
  with the matching binding and S256.

For Google, the tenant `elizacloud` must admit exactly
`https://eliza.app/alphaphone/auth/callback` in `allowedRedirectUrls`. The supported
canonical endpoint is
`POST https://api.eliza.app/steward/tenants/elizacloud/redirect-urls` with
`{"url":"https://eliza.app/alphaphone/auth/callback"}`. It appends rather than
replacing other callbacks and records an audit event. Source requires an
owner/admin session and recent MFA according to tenant policy. No such session
was supplied in this investigation. `STEWARD_OAUTH_ALLOWED_REDIRECTS` is not a
substitute: the authorize request specifies `tenant_id` and uses that tenant's
allowlist. Read back the list, then require authorize to redirect to Google's
account origin before attempting user sign-in.

Keep the deployed `ELIZA_ANDROID_ASSET_LINKS_JSON` association aligned with the
actual installed signer and enable the corresponding callback intent filter in
the APK. Android must verify the host. A successful email or Google Steward
session still needs the mobile connect/token/ack sequence; the registration 503
cannot be fixed by displaying a hosted login page.

## Source references

The administration workflow and scripts were inspected through GitHub at the
selected repository refs:

- `.github/workflows/mobile-app-auth-registration-admin.yml`
- `packages/scripts/cloud/admin/repair-mobile-app-auth-registration.ts`
- `packages/scripts/cloud/admin/verify-mobile-app-auth-registration.ts`

The callback and operator contracts were inspected in the existing local shared
source checkout `eliza-alpha-internal-auth`:

- `packages/cloud/api/README.md`, “Alpha Phone in-app sign-in”
- `packages/auth/src/server/api/routes/tenant-config.ts`, redirect URL routes and
  `requireRecentTenantAdminMfa`

No secrets, authorization codes, user tokens or private account contents are
included in this record. The failed workflow checks are configuration evidence,
not successful integration acceptance.
