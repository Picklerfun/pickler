# Direct PostgreSQL Worker validation — 2026-09-19

> Historical pre-review validation. The controlled consumer used shared local storage at this
> point; the team review found and corrected that isolation defect. See
> [review follow-up](pr26-team-review-validation.md) for the dedicated-stack acceptance.

## Result and tested version

Implementation commit: `ae513281ddf9f312774f80e77b3d71b8a9da6a91`.
This record supersedes the connection topology in the earlier local validation record.
No remote Worker was deployed, no Hyperdrive resource was created, and no paid provider call
was made. The permanent Supabase password and hosted TLS/transaction acceptance remain pending.

The API and research Worker now use DATABASE_URL through pg/Drizzle. Deployed pools are scoped
to one invocation, capped at two connections, and require the Supabase session pooler on port
5432 with TLS verification. Local tests explicitly use loopback PostgreSQL without TLS.
Workers uses platform TLS verification; local plaintext tests do not prove hosted certificate
compatibility. Existing Supabase HTTP product adapters and Auth remain unchanged.

## Automated checks

- `npm run format:check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: all ten workspaces passed.
- `npm run test:supabase`: 250 passed, zero failures; the explicit local Worker test is skipped
  in this command and was run separately below.
- `npm run build`: all six build workspaces passed, including the local Mastra bundle.
- `npm run build:workers`: web OpenNext build and backend dry runs passed. The API and research
  dry runs were repeated after their final entry-point changes and passed.
- `npm run check:staging`: topology passed; this does not assert remote provisioning or secrets.
- `git diff --check`: passed.

New tests cover rejected TLS overrides and non-session destinations, independent pools,
closure after query failures, lease renewal with one of two connections occupied, Queue
acknowledgement without retry loops, cleanup on database failure and disabled-admission Cron.
Staging HTTP responses conceal unexpected provider/database details and logs omit raw errors.
The existing suite also covers tenant isolation, permissions, quotas, budgets, migration-history
reconciliation, configuration invalidation, lease loss and scheduling behavior.

## Compiled three-Worker acceptance

The OpenNext web Worker ran on loopback port 8790, delegated to the actual Hono Worker, and
sent Queue messages to the separate controlled research test entry under workerd. PostgreSQL
was the local Supabase database on port 54522. The production consumer never imports these
controlled providers and has no environment switch to enable them.

`npm run test:workers-local` passed against that stack. It created two labelled local users,
verified login, profile/workspace onboarding, disabled access, operator enablement, idempotent
agent creation and admission, private polling, cross-tenant run/evidence rejection, token refresh,
logout and access revocation. Research used the actual core runner and persistent lease protocol.

| Controlled scenario | Run ID                                 | Terminal result      | Events |
| ------------------- | -------------------------------------- | -------------------- | ------ |
| Abstention          | `75e153aa-4b7d-4428-add7-7a12788dbfa6` | completed / ABSTAIN  | 17     |
| Trade proposal      | `108a943c-bcb9-4434-b0d7-e7523a01531b` | completed / TRADE    | 19     |
| Provider failure    | `2bcb5ebd-231f-4953-bfa5-bd2e4ed1ec37` | failed / no decision | 13     |

These are synthetic integration fixtures, not live market assessments, profitability evidence
or executed orders. Provider usage is not fabricated; no paid model was invoked.

## Browser check

The compiled `/console` was inspected in the browser. A controlled research was launched from
the form and advanced through polling from running to completed / TRADE. The page displayed
forecast range, contrary evidence, successful policy checks and 19 execution events. Pausing
changed the agent to Paused and disabled research admission. Sign out returned to `/signin`.
The original frontend design was retained. Earlier browser checks of signup, growth and cookies
remain historical evidence; their automated regression suite passed again in this change.

Test users created by the automated acceptance had research access revoked. The browser test
agent was paused. The controlled Worker stack was stopped after verification; labelled local
results remain available in PostgreSQL for inspection.

## Pending hosted acceptance

Obtain an authorized permanent PostgreSQL credential; never deploy the temporary CLI login.
Verify hosted connection, certificate trust, transactions and fresh reads from the deployed
Worker before enabling admissions. Complete dedicated Cloudflare resource setup, Auth callbacks,
and deployment from an identified commit following the staging guide. No new schema migration
is needed for this transport change; check the already-applied reconciled history without resets.

The later paid acceptance remains capped at three investigations: two manual (one per tenant)
and one scheduled after validation. No automatic paid retries, forced trades, production deploy,
PR #22 integration, or automatic merge is part of this delivery.
