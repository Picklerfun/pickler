# Perpl reliability validation

## Historical incident

The perps-20260929-v2 log ends with `LEASE_LOST: Study ownership expired`. Last reported valid observation: 2026-09-29 05:59:13 UTC; timeout: 05:59:48 UTC. macOS power logs record `Entering Sleep state due to Clamshell Sleep` at 2026-09-29 07:59:42 +0200 (05:59:42 UTC), with a 900-second sleep interval and a maintenance dark wake at 08:14:42 +0200.

A documented system sleep exceeded the 90-second lease by a large margin and coincided with observation ending. This demonstrates an interruption incompatible with continued lease renewal; the old runner did not record its last renewal, so the exact failed renewal/DB instant cannot be reconstructed. The public-data skew incident occurred separately and is not explained away by sleep. No provider, model, price or timestamp is substituted.

## Changes under validation

Joint public acquisition, transient data omission before execution, atomic paper-write fencing by study lease, unchanged lease duration/cadence, and local renewal diagnostics. Historical sessions and monetary budgets are preserved. No trading, paid calls, or deployment is authorized by this validation.

## Acceptance run

Pending the single thirty-minute public acquisition check. Results will be recorded here with commit, counts and remaining limitations. Controlled tests do not establish public availability.
