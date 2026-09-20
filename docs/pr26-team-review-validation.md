# PR #26 team review and validation — 2026-09-20

## Review and corrections

Three independent reviewers inspected database/TLS behavior, Worker lifecycle/test isolation,
and Next/OpenNext/authentication. Confirmed findings were posted to PR #26 before a different
three-agent implementation team applied the fixes. No confirmed web/auth regression was found.

| Review thread                                                                             | Correction                                                                                                                                 | Regression evidence                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Endpoint overrides](https://github.com/Relayerfi/pickler/pull/26#discussion_r4056779353) | Invocation URLs accept only application_name; reject endpoint, TLS, timeout and encoded-host overrides.                                    | Tests inspect actual pg.Client connection parameters without network calls, including remote plaintext and transaction-port bypasses.              |
| [Fixture isolation](https://github.com/Relayerfi/pickler/pull/26#discussion_r4056779354)  | Controlled execution requires a separate temporary Supabase stack and matching private database identity before claim/recovery/scheduling. | Refused Queue and Cron invocations leave foreign queued jobs, history, evidence and agents unchanged. Production repository algorithms are reused. |
| [Failure cleanup](https://github.com/Relayerfi/pickler/pull/26#discussion_r4056779355)    | Track users immediately after creation; attempt every access revocation and close the pool even if cleanup fails.                          | Failure after grant/before agent creation and failed-revocation cases both pass.                                                                   |

Fresh-stack acceptance additionally exposed a bootstrap dependency: PostgREST cannot be healthy
when configured to expose application schemas before migrations create them. The setup now starts
with public/graphql_public, initializes its marker, applies the reconciled migrations, and runs an
explicit marker-guarded expose-api step. The generated configuration regression prevents recurrence.

## Verification

Tested implementation commit: `8a893a28be71c4f95eb54cdec58636b38a3e9028`.

- Format, lint, all ten workspace type checks, staging topology and diff checks passed.
- Full Supabase suite: **260 passed, zero failed**, with one explicitly opt-in Worker flow skipped
  in the ordinary suite. That flow was run separately and passed.
- Six workspace builds, including local Mastra, passed.
- API/research Worker dry runs and the OpenNext web Worker build passed.
- No paid provider call, real trade, hosted database change, deployment or merge occurred.

## Dedicated three-Worker flow

The disposable Supabase project `pickler-workers-9b79c297` used API port 55521 and PostgreSQL
port 55522. Its private identity marker was verified before controlled operations. The web was
compiled for that stack; the actual Hono API, Queue and controlled consumer ran under workerd.
The fresh setup was verified using the documented official CLI 2.111.0 and minimal service set.

| Scenario         | Run ID                                 | Result               | Events |
| ---------------- | -------------------------------------- | -------------------- | ------ |
| Abstention       | `6c7fa12e-61b7-461b-828d-cd903b31ef66` | completed / ABSTAIN  | 17     |
| Trade proposal   | `7a978081-e71d-40c2-b058-70bec67d8199` | completed / TRADE    | 19     |
| Provider failure | `7639a3ec-a7bc-4252-8a13-fed55e514bf7` | failed / no decision | 13     |

The flow verified two-user onboarding, enablement, idempotence, cross-tenant rejection, private
polling, evidence, refresh/logout and revocation. These are synthetic integration results, never
live forecasts or executed orders.

The controlled Worker process and dedicated Supabase stack were stopped afterward. Its volumes
and results remain available for inspection. Original local environment files were restored;
the ordinary Supabase stack was not reset or stopped. Earlier shared-storage acceptance records
remain historical and are superseded by this dedicated-storage validation.

Remote staging acceptance remains pending permanent credentials and deployment configuration.
PR #22 remains untouched. The later three-investigation paid acceptance cap is unchanged.
