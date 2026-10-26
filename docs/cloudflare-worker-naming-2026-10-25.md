# Public web Worker naming

## Scope

The owner confirmed on 2026-10-25 that the deployment serving `pickler.fun` should be identified
as production. The target name is `pickler-web-production`, replacing `pickler-web-staging`.
This document describes a rollout to perform after this change is merged; it is not evidence
that the remote rename has already happened.

Only the existing public web Worker's name and its self-reference change. Preserve its immutable
identity, deployed version, custom domains, build integration, public build variables, secrets,
preview isolation, API binding, and access policies. Keep `API` targeting `pickler-api-staging`.
Do not rename or promote the API, research, trading, indexer, databases, queues, or Hyperdrive.
The separate production-environment specification remains a distinct project.

## Coordinated rollout

1. Record the existing Worker's immutable identity, active version, custom domains, self-reference,
   and production/preview build settings. Record read-only HTTP checks for the public landing,
   Studio sign-in, and a safe same-origin API read before making changes.
2. Hold automatic production builds while coordinating the merge and remote rename. Preserve the
   prior trigger settings so they can be restored; do not disable authentication or other security
   controls. A name mismatch must not deploy a second Worker from the old configuration.
3. Merge the reviewed configuration change only with explicit owner authorization and passing
   required checks. It updates the web name, self-reference, and topology validation together.
4. Rename the existing Worker in place to `pickler-web-production` using the supported dashboard
   or Workers API rename operation. Do not create a replacement Worker or detach custom domains.
   Confirm that the immutable identity, active version, and attached domains remain the same.
5. Check the deployed `WORKER_SELF_REFERENCE` and update its target to `pickler-web-production`
   if the in-place rename did not update it. Retain all other bindings and variables. Keep the
   connected build integration targeting the renamed Worker and verify it matches the committed
   Wrangler name. Preserve the web-only build and preview settings documented in the build guide.
6. Repeat the read-only public and same-origin API checks. Confirm that the landing still renders,
   Studio sign-in is available, private routes retain their guards, and preview builds retain no
   backend access. Do not sign transactions, activate agents, or run paid providers for this check.
7. Restore the previous production build trigger setting and update the resource inventory with
   the actual new name and verification evidence. The public custom domains remain canonical;
   check any callers of the old workers.dev hostname before relying on that hostname after rename.

If validation fails, restore the previous name and self-reference on the same Worker while
production builds remain held. Restore the previous committed configuration through a reviewed
revert, then restore the prior trigger settings. Do not delete resources or modify stored data.

## Local verification

Run `npm run check:staging` and the controlled deployment adapter tests. They check the public web
name, self-reference, existing API binding, and the unchanged deployment order without contacting
deployed services. Controlled Studio fixtures intentionally keep their local staging names.

## References

- [Workers rename support](https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/)
- [Workers build name mismatch handling](https://developers.cloudflare.com/workers/ci-cd/builds/automatic-prs/)
- [workers.dev hostnames](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
