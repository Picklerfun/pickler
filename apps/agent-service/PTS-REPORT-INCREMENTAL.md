# Incremental local PTS report capture

Local PTS v8/v9 report workers now reuse verified native evidence parts when their original
database rows have not changed. Financial execution, ownership fences, query deadlines, candidate
policies and the original interrupted study remain unchanged.

## Consistency and integrity

Infrastructure still opens one scoped `REPEATABLE READ READ ONLY` transaction. It reads the
current study record and every current round/event identity in deterministic order, computes a
native SHA-256 fingerprint, and fetches original payloads on misses. The fingerprint covers the
complete round document or event key/date/kind/data. It is not an xmin, timestamp or last-slot
watermark. Updates, backdated inserts and deletions are therefore checked on each capture.

The native fingerprint uses PostgreSQL's built-in
[SHA-256 and UTF-8 conversion functions](https://www.postgresql.org/docs/17/functions-binarystring.html).
It is separate from the canonical audit digest. No extension, migration, table or historical
rewrite is introduced. The exporter's optional typed reuse callback is a trusted sink contract,
not an authorization source.

The host opts into reuse only for the local report source. It requires matching original
configuration, a verified revision-index hash, a recognized revision policy, and existing part
bytes matching their SHA-256 and length. Missing parts are fetched again; corrupt parts or indices
fail publication. Record/accounts/attempts/movements are read anew in the same snapshot.
Only currently enumerated rows enter the new manifest, so deleted rows do not survive as history.

The additive audit v2 fields are `sourceCapture`, `sourceIndexHash` and per-part
`sourceRevision`. Existing v1 packets and v2 manifests without them remain readable; their first
fresh incremental capture creates the index. The canonical v1/v2 payload hash has exactly the same
meaning. Revision metadata is never passed to trading as financial evidence.

Complete payload verification now verifies each part's bytes and incorporates those same bytes
into the aggregate digest in one file pass. It still reads all original parts. Source reuse avoids
retransferring, decoding and canonicalizing unchanged PostgreSQL payloads; it does **not** eliminate
the server's native fingerprint scan, local complete-hash verification or the full report's replay
and rendering work. Report generation remains in a separate worker with a read-only one-connection
role and no inherited environment, providers or financial writes.

## Controlled verification

`test/pts-report-incremental.test.ts` uses disposable PostgreSQL databases and covers basic v8,
intraday v9 and the independent fast candidate, original canonical hash and decision-row parity,
mutable/deleted/backdated evidence, concurrent snapshot writes, missing/corrupt source parts,
index integrity, scope/version changes, legacy manifests and actual worker publication.
Existing source-isolation, offline, coordinator and query-containment checks remain relevant.

Run PostgreSQL tests only against the isolated controlled physical server, never a prospective or
historical study server. Models, signing and provider transports are not used. The benchmark
compares full and incremental captures with identical inputs on the same pool, alternating order
across thirty pairs per scenario. It reports actual monotonic elapsed time, median, nearest-rank
p95, exact fetched/reused counts and canonical hash verification. Synthetic serialization load
is not market evidence.

## Limits and next validation

Controlled capture improvement does not prove historical timeout causality or trading profit.
The original 90-round interrupted study, pending positions and unknown historical monetary
reservations remain intact. A new prospective validation needs its own identity and a clean
frozen tested commit; this repair never resumes or closes the interrupted study retrospectively.
Both strategies retain long and short support. No PTS prospective fill or profitability is implied.

## Captured source-only measurements

Controlled isolated PostgreSQL measurements on 2026-10-12 used one original round and three
original events, each with 2 MiB of additional synthetic serialization load. Both paths used
the same pool and identical original inputs, alternating order. Every scenario has thirty
measurements per path; all 180 resulting payload hashes were verified.

| Scenario                   | Full median / p95 (ms) | Incremental median / p95 (ms) | Native payloads fetched per capture |
| -------------------------- | ---------------------- | ----------------------------- | ----------------------------------- |
| Unchanged, warm parts      | 332.39 / 388.95        | 109.28 / 132.74               | 4 versus 0                          |
| One original event changed | 419.11 / 554.87        | 307.02 / 346.48               | 4 versus 1                          |
| First capture, new files   | 533.55 / 598.43        | 632.27 / 692.72               | 4 versus 4                          |

The unchanged median decreased by 67.1%; the one-event update decreased by 26.7%. Cold capture
regressed by 18.5% (98.72 ms of median overhead), including native fingerprinting and miss queries.
This overhead is reported, not hidden by warm-only statistics. Full mode in the paired benchmark
also uses the new single-pass file verification, isolating the reuse difference. Neither path
includes worker startup, report rendering or public acquisition. These are controlled measured
durations, not estimates extrapolated to the original 1 GiB study, prospective acceptance or P&L.
