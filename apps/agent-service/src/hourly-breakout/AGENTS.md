# Local hourly breakout screen host

Read the repository, agent-service, trading, infrastructure and public-reader instructions first.
This directory composes configuration v10 `perps-hourly-breakout-fixed-screen-v1` locally.
Trading owns the candidate, coordinator, acceptance definitions and financial rules. Infrastructure
owns durable financial state and independent diagnostic leases. The public runtime owns the one
guarded Perpl reader. Never construct models, Exa, signing clients or Studio initialization here.

`prepare`, `preflight`, `status`, `stop`, `report`, `audit-export`, `audit` and `replay` are restricted
commands. `stability` is the separately authorized, one-shot, nonfinancial 24-hour capture. The
financial `run` gate requires future authorization and never starts from the disabled template.
Offline analysis dispatches before environment/provider composition and writes a new directory.
Only a dedicated loopback DATABASE_URL-only file is accepted by local database composition.

The fixed source window is frozen before any public call. All 4,320 original 20-second windows and
1,440 canonical minute identities survive misses, stopping and unavailable data. Offset 20/40
captures cannot rescue canonical minutes. Keep common preparation separate from price coverage.
Source J receipts never establish financial V acceptance. Clock receipts use synchronous ordered
paired samples, nonzero outward intervals, per-boundary certificates and an append-only synced
journal. External UTC authority remains explicitly unverified.

All artifacts, including concurrent report temporary files, share the 16 GiB reserved byte budget.
Retain every original snapshot in parts no larger than 64 MiB. Only the contiguous first 32 MiB of
wire evidence may truncate, with explicit truncation. Never trim immutable capture journals.
One coalesced read-only worker publishes verified derived generations and the pointer last; retain
only the current and previous verified derived generations. Safe HTML/CSV exclude raw histories.
Tests use controlled clocks/readers/stores only. Never start a public capture as implementation
acceptance, resume an old session, replace historical evidence or clean up this worktree.

`source-qualification.ts` applies the native frame validator at both outward receipt bounds for
each copied market. An expired market does not erase valid peers; a mixed generation or identity
failure remains fatal. Live capture and offline analysis share this projection. Every verified
derived generation includes its exact source manifest, and retained prior output is checked against
its published byte hashes before replacing the report pointer. Source cross-review tests include a
controlled successful 24-hour fixed grid; this fixture is not public availability acceptance.
Source replay requalifies saved snapshots and checks their hashes. Its report labels transport
reconstruction as not performed and the retained stream prefix as validated public message events,
not original TCP, compressed-frame or TLS bytes. Original public HTTP text-body hashes stay separate.

The unified npm evaluate script ends Node options explicitly before the script path. Keep the
`--` in `node --import tsx -- src/evaluate.ts`: CLI `--env-file` is a host argument and must not
be consumed by Node before protocol, offline, or authorization checks.

Rejected PostgreSQL clock samples retain safe numeric RTT proof before throwing. Nonfinite clock
values are explicit nulls in rejected evidence, never accepted samples. The legacy financial
zero-containing RTT check remains unchanged in `clock.ts`. New source-only captures instead select
`source-independent-database-clock-v1` in `source-database-clock.ts`: the host clock owns J/calendar
and PostgreSQL alone owns lease expiration. Record the complete measured database-minus-host offset
interval, including nonzero offsets, with the same one-millisecond quantization margin. Never adjust
timestamps or claim that independent clocks were synchronized or externally UTC-verified.

The source sampler rejects nonfinite values, local/monotonic/database regression, foreign process
epochs and overlapping probes. It retains one preceding sample, bridging preflight/start/renewal/end. The manifest and
diagnostic metadata pin the policy/hash; offline analysis revalidates that exact journal and requires
its endpoints before acceptance. Historical manifests without that policy keep their old meaning.
Source and future financial manifests retain the first rejected clock proof independently of the
primary failure, including a safe secondary journal-write code. A missing historical rejected sample
remains unverifiable. Preflight saves rejection evidence before public composition with the same budget.

Clock qualification failure does not bypass owned technical cleanup. A fresh guard and the adapter's
transactional fence still protect diagnostic lease release; a confirmed release stays confirmed if
its local ACK journal fails. Known or newly detected ownership loss prohibits subsequent database
calls. Cleanup never creates financial work or restarts a source capture. With no J comparisons,
derived reports return null maximum intervals rather than an invented observed zero.

The single source attempt at frozen commit `12758b5bd045f9ce7726a4606db522a29362a407` interrupted
with `CLOCK_INCOMPATIBLE` before any public request or scheduled source window. Preserve its original
empty journals, failed report and unconfirmed cleanup. Later read-only clock measurements are a
separate diagnostic, not reconstruction of the lost startup sample. The corrected code has controlled
validation only; no source retry or financial acceptance is implied.

On 2026-10-16 the operator explicitly authorized the independent source-clock correction and one new
24-hour nonfinancial attempt. Use a fresh diagnostic identity/directory after controlled validation
and freeze; retain the first failed capture. This grants no financial run, model, signer, automatic
repeat, automation, merge or deployment. The new source policy does not supply financial V acceptance.
