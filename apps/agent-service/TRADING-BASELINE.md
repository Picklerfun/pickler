# Trading baseline preservation and recovery

This local operator workflow preserves original PTS reference material, recoverable Git commits
and all explicitly inventoried trading histories. It implements no PTS detector, strategy, market
read, model call, scheduler, monetary reservation or deployment. SMA and previous financial records
are unchanged. [The independent candidate catalog](../../knowledge/trading/pts-versions/README.md)
names `pts-trend-reversal@0.1.0`, draft, unregistered and disabled, separately from
`pts-course@1.0.0` and the implementation commit.

## Commands and isolation

The unified `evaluate` CLI dispatches these commands before provider composition. Never pass
`--env-file`, `--config` or `--allow-paid` to baseline operations.

```sh
npm run evaluate -- baseline-export --inventory /absolute/operator-inventory.json --output /absolute/new-backup
npm run evaluate -- baseline-verify --state /absolute/new-backup/manifest.json --output /absolute/new-verification
npm run evaluate -- baseline-restore-check --state /absolute/new-backup/manifest.json --restore-target /absolute/isolated-target.json --output /absolute/new-restoration
```

All output directories must be new and disjoint from source roots and backups. No overwrite,
symlink traversal, automatic discovery of arbitrary databases, application launch, session restart
or budget reset is allowed. Failed/partial output remains available for diagnosis; a corrected
attempt requires a different directory and must not replace it. Original files are never removed.

`baseline-export` takes `trading-baseline-inventory-v1`, validated in
`src/trading-baseline/contracts.ts`. The explicit private input contains:

- `repository`: absolute clean isolated checkout; `ptsPath` and `candidatePath`: relative paths.
- `references`: at least three fully qualified Git refs with expected 40-character commits and
  `annotated` flags. Include original PTS, the tested SMA commit
  `0bf07d70037878da1edb93cc8325c7d9d1670b32`, and the delivery branch. Annotated tags must already
  exist. An existing ref with a different target/type is rejected, never replaced or forced.
- `roots`: distinct IDs and absolute study directories. Inventory every directory including other
  available worktrees; list unavailable origins explicitly instead of silently omitting them.
- `files`: every relative file path, root ID, SHA-256, byte size and `mtimeMs`, captured before
  export. Credential/private diagnostic paths may have null fingerprints; they are excluded.
- `databases`: distinct IDs, absolute `envFile`, `configurationFiles` provenance and tools.
  An optional `origin` defaults to `direct-local`. A `stopped-volume-copy` records the original
  container, volume, port, PostgreSQL system identifier and an inventoried evidence root. This
  origin requires an independently prepared copy of a stopped volume mounted read-only; recovery
  happens only in that copy. The exporter never starts or repairs an original server. A logical
  snapshot taken after recovery of a copy describes that copy, not a global historical instant.
  Only `DATABASE_URL` is parsed. Literal loopback PostgreSQL only; no query/fragment or host override.
- `unavailable`: explicit `{ kind, source, code }` entries; any such entry prevents completeness.

PostgreSQL tools are either `{ "kind": "native", "directory": "/absolute/pg-bin" }` or
`{ "kind": "docker", "container": "local-postgres-container" }`. Docker tools verify the
published PostgreSQL port matches the connection. No shell is used; connection credentials are
passed through a restricted child environment, never arguments or logs. Match tool/server major
versions. Ordinary tests make no provider calls.

The restore target file contains only `envFile` and `tools`, with the same tool contract. Its
database URL is an administrator connection to a **different, isolated PostgreSQL cluster**.
The command generates each fresh `pickler_baseline_check_<UUID>` destination itself. It rejects
the source cluster system identifier and original local ports before creating a destination.
Never point it at the original database. Restore copies are set to default read-only, retain
unknown reservations and pending records, and are not valid sources for resumed sessions or new
budgets. They remain available for inspection; cleanup of only these disposable copies is an
explicit operator action, not part of restoration.

## Integrity and interpretation

The sealed `trading-baseline-v1` manifest relates Git refs/bundle, all files/exclusions, database
snapshots and verification state. `seal.json` hashes the exact manifest bytes. Separate verification
and restoration results record their analyzer commit, leaving the capture manifest immutable.
Hashes detect corruption, not authenticity; this is not a digital signature or encrypted archive.

The Git bundle is standalone, with annotated original-material and SMA references even when that
SMA commit is outside main. Offline verification reconstructs it in an empty Git database and
validates the original course schemas/examples, all source hashes/line references, complete
non-overlapping fragment coverage and the independently disabled candidate.

File capture checks expected fingerprints, source/copy hashes, timestamps and the final full
directory inventory. Changing, absent, truncated, inaccessible or unsupported entries are explicit
and prevent completeness. Credential files, private raw administrative errors and detected textual
secrets are excluded and enumerated. Existing opaque binary captures/dumps remain private and
hash-verified; no public artifact is made from them. Files/directories use private permissions.

Each database uses one `REPEATABLE READ READ ONLY` transaction with `pg_export_snapshot()`. The
table scan and `pg_dump --snapshot` share it; no financial service `view()` or recovery mutation is
called. Every non-system table (including migrations/Mastra/other application schemas) is hashed
using sorted per-row SHA-256 of PostgreSQL `to_jsonb(row)::text`, UTC/ISO dates, retaining duplicates
and exact decimal strings. Columns, study identities and sequence state are also recorded.
Sequences are not MVCC: their state is rechecked after dumping; any change prevents completeness.
Consistency is **per database**, not a global instant shared with other bases or copied files.

Restoration runs `pg_restore --single-transaction --exit-on-error`, without owner/ACL replay.
Referenced policy roles are created without login on the disposable cluster when needed. It
compares complete table hashes/counts/columns, sequences and study identities with the saved
snapshot. This preserves states, omissions, positions, funding, reservations and unknown usage
without assigning new meanings. Missing data is not reconstructed.

`baseline-verify` is offline: no environment, database, runtime/provider adapter or network is
loaded. It validates contracts, seal, artifact hashes, private permissions, inventories, Git
recovery and PTS integrity. Reports provide JSON/CSV/HTML with safe escaping. A partial capture can
have verified available artifacts, but still exits nonzero and remains **partial**. Only a complete
capture followed by successful isolated restore of all snapshots is accepted as recoverable.

## Tests

Build shared packages, then run `apps/agent-service/test/trading-baseline.test.ts` and
`packages/infrastructure/test/trading-baseline.test.ts` with the Node test runner. The explicit
PostgreSQL restore regression also needs `BASELINE_PG_TOOLS`, `BASELINE_RESTORE_DATABASE_URL` and
`BASELINE_RESTORE_PG_TOOLS`, plus `TEST_DATABASE_URL` for the disposable source fixture. Tool values
are JSON using the contract above. The restore server must be separate; no provider/trading keys
are needed. The test creates/removes its own source/restore databases only and checks read-only
recovery, duplicate rows, exact numeric values, pending funding and unknown reserved usage.

Run format, lint, types, architecture, relevant PostgreSQL tests and affected Node/Workers builds.
No CI/provider calls or executable PTS selection are introduced.

## Local delivery boundary

The operator's private baseline is stored under
`/Users/gilbertsahumada/Documents/pickler-trading-backups`, outside the repository. Dumps, captures,
inventories and environment files must never enter Git or a PR. The original Spanish course files
are committed byte for byte; English catalog/tool documentation is separately versioned.

This protects against project edits or cleanup, not loss of the computer. No external backup,
encryption key management, retention schedule, disaster-recovery policy, automatic retry or
strategy activation is added. Future executable PTS work requires another delivery with frozen
reviewed rules and explicit selection. A version number alone never authorizes trading.
