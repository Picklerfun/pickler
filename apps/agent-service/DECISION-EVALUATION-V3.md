# Evaluator v3 laboratory revision

V3 changes only the local evaluator. V2 source and immutable execution records remain intact.
The user authorized delegated review, then requested fixes and bounded validation. This does not
change deployed research, databases, trading, or the standard for independent human validation.

## Changes

`src/evaluation/v3/provider.ts` versions the scope question independently from truth: a source can
contradict a claim while addressing the correct event. The conflict question compares source
statements about the same fact; full practice and an Out game status are compatible. The LLM
control adds an explicit flat JSON schema instruction while retaining JSON-object transport and
strict validation. It is named `llm-format-v3`, not the original-instruction v2 baseline.

`policy.ts` keeps every v2 closure check, including the Jev mismatch/conflict veto. It skips backup
when no known matching event/date citation is possible, when source metadata has a known mismatch,
or when Jev's scope/conflict answers would veto a backup. Uncertainty remains RESEARCH/ABSTAIN;
no search is executed. Backup calls remain blind, real and conditional; routing is simulated.

`runner.ts` invokes the current-model control and Jev v3 once per case; the cascade reuses that Jev
response. Internal persisted adapter keys retain `llm-original`, `jev-v2` and `cascade-v2` for
shared response types; the manifest and reports explicitly identify them as v3. No original Jev
control is rerun. All semantic/API failures stop the batch without retry or repair. The old
invalid assessment cannot be diagnosed to a specific field because its raw content was not
retained; controlled malformed-shape tests establish rejection behavior, not its historical cause.

## Budget and freezing

`RevisionLedger` reads v2 accounting before each reservation. V2 plus v3 together may start at
most 176 calls and account for at most USD 0.50, including the unresolved v2 charge reservation.
The older v1 campaign is additionally counted against the overall USD 1.00 ceiling. The shared
v2 execution lock prevents simultaneous admission across revisions. No ledger reset is allowed.

Four previously observed development cases (Adkins availability, Vea Friday absence, Molden
competing status and Cox availability) are followed by the existing 32-case replay. Maximum
additional calls are 12 + 96 = 108, exactly the remaining allowance after v2's 68 started calls.
A veto may reduce that number. Previously evaluated cases, including six completed former holdout
cases, are not a new independent holdout. Reference/context review remains assistant-delegated.

Each phase directory is exclusive and cannot be restarted. A v3 failure blocks subsequent paid
phases. Dataset hash, all instructions, policy, models, rates and endpoint are frozen across phases.
Known model usage is priced at verified maximum published rates, not provider invoices; original
unknown charges remain reserved. Numeric criteria describe replay performance only and cannot
establish independent validation or production eligibility.

## Commands

Run from the repository root with the existing ignored dataset and verified-price files:

```sh
npm run evaluate:decisions:v3 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/decision-v2-frozen-delegated-01.json --phase dev
```

Offline preflight never contacts providers. Explicit paid execution adds:

```sh
npm run evaluate:decisions:v3 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/decision-v2-frozen-delegated-01.json --phase dev \
  --prices apps/agent-service/.data/v2-verified-prices-2026-09-26.json --allow-paid
```

After an error-free development phase, `--phase holdout` runs the 32-case replay under the same
frozen configuration. Never continue after a failure, change prices/models between phases, or
repeat a started request. New revisions require deliberate authorization and the same remaining
shared budget. Reports and request records are private under `.data/decision-evaluation-v3`.

## Checks

The v3 test suite covers correct contradictions, practice versus availability instructions,
vetoed backup suppression, permitted blind backup selection, invalid baseline shapes without
repair, private reference exclusion, and shared cross-version dollar/call ceilings. Run it with:

```sh
node --import tsx --test apps/agent-service/test/decision-v3.test.ts
npm run typecheck --workspace=@pickler/agent-service
npm run lint
npm run format:check
npm run build --workspace=@pickler/agent-service
```
