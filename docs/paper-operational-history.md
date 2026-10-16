# Product Paper operational state and history

This change is local and requires review. It does not deploy Workers, apply hosted migrations,
change schedules, enable admissions or invoke paid providers.

## Read and write contracts

Product checks, approvals, owner closes and supervision use `executionSnapshot`: the current
account, open positions, unexpired pending attempts and exact current-day accounting scalars.
Closed positions, terminal attempts, ledger evidence and size-up arrays stay out of this read.
`attemptResult` resolves one idempotency key and `position` reads one scoped position.
`historyPage` pages positions, terminal/pending attempts, movements and size-up facts with a fixed
sequence watermark and an opaque account/kind-bound cursor (50 default,100 maximum). Funding
postings use their epoch's atomic commit-fact sequence, so later visibility cannot appear behind
an existing cursor. Unconverted history refuses this archive port explicitly. `closedPositions` uses a monotonic close-sequence
cursor (50 rows by default,100 maximum) bound to its account and initial maximum close sequence.
Unconverted history returns complete=false; a missing converted P&L total is an error, not zero.
The close sequence means a position created earlier and closed later cannot fall
behind an existing creation-time watermark.

Explicit operator `snapshot` and `view` retain full historical behavior, including size-up arrays
reconstructed from the private normalized history. Product HTTP reads do not invoke these ports.
Mutation views additionally expose this operation's bounded `changes`: changed positions,
terminal attempts and newly posted movements. These deltas do not repopulate the operational
history arrays and require no archival read. Financial writers update account/day/position totals and record facts under the existing account
and ownership fences, in the same transaction as their ledger and attempts. Booking times and
integer rounding remain unchanged. Opening margin and each size-up count on their actual UTC day.
Historical backfill resolves fee attribution with indexed key/range reads instead of a full ledger
fold for every position.

Record HTTP reads load one cached checkpoint with at most721 hourly chart samples. They do not
recalculate lifetime ledger windows. Each financial movement updates the checkpoint; a backdated
fact starts a resumable rebuild of100 facts per transaction with a fixed upper sequence. New
arrivals do not reset this watermark. Responses expose revision,asOf and complete; clients hide
incomplete record statistics and chart data until the rebuild catches up. Closed-position P&L and
hit-rate preserve the existing formula: opening/size-up fees plus close movements, excluding
funding. Aggregate realized cash and fees/funding still include funding.

## Funding coverage and recovery

Active product positions retain a scalar confirmed funding-covered-through checkpoint. Immediate
validation requests at most a one-hour window, overlapping the previous window by30 seconds, and
rechecks existing event identities through point keys. The existing provider complete-window
assertion is mandatory. Incomplete or estimated evidence cannot advance that position's coverage;
a disputed observation commits no new funding or coverage progress. Immutable openedAt values
remain unchanged. Missing current required coverage or a dispute blocks additional exposure;
reducing closes remain available.

Historical audits fix a finalized canonical RPC block hash/number/time, a cutoff and a closed
sequence cohort. No provider call runs under the financial row lock. The exact anchor is checked
before each position and immediately before the atomic commit; a changed/unavailable anchor or
an event beyond that block pauses processing. One invocation handles at most50 positions,
uses one-hour windows with overlapping boundaries and stops after a20-second work budget. The
composition shares the existing24-request ceiling across actual Perpl HTTP requests and all
canonical RPC operations. Capture/reverification each consume two RPC operations.

Each successful position/window saves its durable cursor and staged postings. Ownership expires
after60 seconds and is fenced by its random owner token; interruption releases ownership when
possible, while process death permits expiry/takeover. A new owner resumes the saved cursor.
Staged postings have no cash, ledger or record visibility until the full epoch commits. Its
aggregate funding delta, cash, UTC-day total and record fact become visible together. Replaying
an already staged or visible event cannot credit it twice.

Closed positions newer than the anchor remain uncovered even if the fixed epoch finishes its
older window. Coverage completion does not advance past them, and the next epoch captures a
fresh anchor promptly. Once coverage is current, a complete historical audit is not repeated
more often than once per24 hours. A genuine evidence dispute stays fail closed for explicit
operator investigation; it is never silently overwritten or automatically charged again.

## Additive rollout and operator conversion

1. Review/apply migration0050 through the normal database migration process. All new tables use
   RLS and revoke Data API roles. This document is not permission to run a hosted migration.
2. Publish the compatible writer/read implementation through the normal reviewed release. New
   accounts use operational storage. Unconverted accounts refuse new exposure while remaining
   closeable through the bounded close-only path, preserving legacy parent history server-side.
   Existing pending closes can finish; failed pending attempts can release their reservations.
3. Preflight an account with the separate operator database connection. Active positions or
   unexpired owned attempts make conversion ineligible; do not freeze an account needing exits.
4. Explicitly advance conversion one page at a time until complete. Every page/cursor update is
   transactional and safe to resume after a crash. The phases copy/verify100 positions, construct
   indexed per-position/day totals, copy100 ledger facts, normalize100 size-up facts, compact100
   position documents, copy100 closed totals and advance100 projection facts. Only a complete
   projection permits atomic cutover. Original parent evidence stays in paper_storage.original.
5. Check operational mode, record completeness, cash/ledger parity and outstanding funding
   coverage before considering new exposure. No startup or HTTP handler runs conversion.

From the repository root with Node22.22+ and the separately configured operator connection:

```sh
node --import tsx packages/infrastructure/src/persistence/paper-storage-operator.ts ACCOUNT_ID
node --import tsx packages/infrastructure/src/persistence/paper-storage-operator.ts ACCOUNT_ID --apply
```

`DATABASE_MIGRATION_URL` is required; hosted TLS uses `DATABASE_MIGRATION_CA_CERT` through the
existing migration transport. The default command is preflight. `--apply` advances exactly one
transaction; repeat deliberately until complete. It does not migrate schemas, deploy or call
providers. Do not put credentials in command arguments or commit them.

A frozen account rejects ordinary financial writers. Operational mode rejects older writers that
would replace the compact account with stale full history. Rolling back to an older financial
binary is therefore intentionally fenced; retain the compatible close path and use a forward
repair rather than disabling the fence or restoring the old parent over newer ledger activity.
The additive schema and preserved evidence remain available for investigation. Schema DDL creates
sequences and indexes over existing position/attempt tables; PostgreSQL may scan/backfill those
rows during migration. The100-entity bound describes the explicit frozen account conversion,
not an assertion that every DDL/index operation has constant work.

## Controlled validation

The Paper tests use disposable local PostgreSQL databases and injected venue/anchor data, never
hosted credentials. The100000-position/100000-movement fixture measures the historical document
byte lower bound server-side, then records actual compact serialized bytes, returned rows and
statement count without transferring the archival payload. One controlled run measured200001 archive entities,
45388895 bytes as the historical document JSON-text lower bound, and a475-byte compact JSON-text
snapshot returned as one row in three statements (BEGIN, one SELECT,COMMIT with a fixed test
clock). These are local fixture measurements, not deployed network/billing measurements; the
archive entity count is not a claim about the older adapter's PostgreSQL wire-row count.
Projection tests independently fold
100000 facts in1000 bounded passes and compare exact cached financial statistics with the
existing golden implementation, including crash/rollback and backdated arrivals.

Other regressions cover epoch all-or-nothing visibility, retained cutoff/cohort, interrupted-page
continuation, future-of-anchor closes, incremental coverage/disputes, writer fencing, migration
resume/parity, legacy exits, current-day counters and existing simulator/runtime behavior.

Final local PostgreSQL verification used a test-only60-second connection/statement deadline
preload because this shared host intermittently timed out even on isolated one-row reads. The
production database transport deadlines are unchanged. Controlled results establish local
accounting and bounded transfer behavior; they do not establish hosted latency or provider
acceptance.
