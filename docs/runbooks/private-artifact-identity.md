# Private artifact identity

The protected signing and publication jobs use GitHub OpenID Connect and the reviewed Google identity in `scripts/ci/private-artifact-identity.json`. They do not use `ALPHA_PRIVATE_APK_STORAGE_TOKEN`.

The trust condition requires repository ID1396333361, owner ID314117943, `main`, the `release` environment, a manual workflow run and one of the two exact release workflow paths. The identity can read objects under `unsigned/` and `signed/` in the existing private APK bucket. It can create new objects only under `signed/`. It cannot list, delete or overwrite objects, change IAM, or read signing keys. The transport still checks object generation, digest, size and create-only preconditions.

The workflow requests a one-hour storage access token after the protected job starts. It does not create a credential file. The signing keys stay in the existing release environment and are read only by the existing signing step. Existing main-only admission, reviewed source ancestry, artifact verification and release-environment approval remain required.

## Provisioning and verification

Apply the JSON identity with the project owner account. Create the named service account without keys, the two custom roles, the workload pool and its GitHub OIDC provider. Map every claim in `attributeMapping`; use `attributeCondition` unchanged. Grant `roles/iam.workloadIdentityUser` to `principalSet` on that service account. Grant each custom role to the service account on the named bucket with its exact condition. Preserve existing policies and compare their etags when applying changes. Refuse an existing resource that differs from the reviewed JSON.

Read back the provider, service-account policy and both bucket bindings. Keep those public configuration receipts outside the repository. A successful configuration check is not a signed APK or a live token exchange. The first protected release run must prove token issuance, exact download, signature verification and exclusive upload before device acceptance.

References: [Google deployment federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [GitHub token claims](https://docs.github.com/en/actions/reference/security/oidc), [Google authentication action](https://github.com/google-github-actions/auth), [Cloud Storage IAM conditions](https://docs.cloud.google.com/storage/docs/access-control/iam).
