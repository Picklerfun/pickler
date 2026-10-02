# Perpl model timeout diagnosis — October 2, 2026

## Correction

Perpl's model adapter retains its twenty-second request deadline and unchanged prompts, model,
token limits and routing. A deadline cancellation now produces `MODEL_TIMEOUT`, including while
waiting for headers or reading a response body. Operator cancellation produces `MODEL_CANCELLED`.
Lease-related business errors retain their original code, HTTP failures remain `MODEL_HTTP_FAILURE`,
and non-HTTP transport failures produce `MODEL_TRANSPORT_FAILURE`. Provider bodies, credentials and
raw exception messages are excluded. Existing round persistence stores these business error codes;
no public DTO, migration or automatic retry was added.

## Historical incident

The original `perps-20261001-rest-paced` round 28 failed on the direct and fallback DeepSeek calls.
Their durations were 19,995 and 20,003 ms. Jev completed in 622 ms. The original persisted error was
`STUDY_OPERATION_FAILED`; the timing is consistent with the twenty-second deadline, but missing
historical transport diagnostics prevent establishing the exact cause. Do not overwrite that error
with a retrospectively inferred timeout or claim the provider's root cause is proven.

Both original started calls retain unknown consumption and their USD 0.024576 reservations each.
The original session remains stopped for paid decisions under `MODEL_FAILURE`; its existing public
supervision continues. No original calls or financial results were replaced.

## Explicitly authorized two-call replay

The user separately authorized repeating only those two calls. An independent diagnostic record,
`timeout-replay-20261002-context`, references the persisted round, reserves both calls transactionally
under the original tenant/network/database campaign lock, and retains the USD 5 campaign ceiling.
It uses a separate renewable lease and fenced writes. No Jev request, fresh market investigation,
new account, position, execution or study restart is performed.

| Call     | HTTP | Duration | Input tokens | Output tokens | Estimated USD | Result                       |
| -------- | ---- | -------- | ------------ | ------------- | ------------- | ---------------------------- |
| Direct   | 200  | 3,760 ms | 5,573        | 116           | 0.0018111     | Valid BTC/ETH hold proposals |
| Fallback | 200  | 3,702 ms | 5,484        | 116           | 0.0017844     | Valid BTC/ETH hold proposals |

Total new reported usage cost is USD **0.0035955**. Combined historical costs and reservations are
USD **0.176470254** at diagnostic completion. The two historical unknown calls remain reserved.
Diagnostic PostgreSQL readback confirmed completion and released ownership. The diagnostic answers
are retrospective model outputs, not new executable recommendations or a financial comparison.

The stored normalized evidence, account state, prompt, model and limits were reused. JSONB does
not preserve original JSON object ordering. Reconstructed requests have the same byte counts
(15,188 and 14,884) but different hashes; byte-identical replay is not established. Both original
and reconstructed hashes, HTTP status, phase, duration and consumption are recorded. No original
request body was available. Do not treat this replay as proof that every input byte was identical.

Before provider submission, setup checks rejected a schema mismatch and a byte-hash mismatch.
Those preparations made zero provider calls and retained their diagnostic artifacts. Only the
subsequent context replay submitted requests: exactly two, with no retry. The separate earlier
`timeout-replay-20261002` diagnostic is completed/released with zero started calls and zero cost.

## Interpretation and validation

The repeats did not reproduce the failure. A transient delay or transport interruption remains
possible, but is unproven. The correction is established by controlled tests, not by these successful
repeats: header/body deadlines, parent deadlines, cancellation, lease loss, transport errors,
sanitization, single-attempt behavior and persistence of `MODEL_TIMEOUT` all passed.

Checks passed: 24 focused tests; full PostgreSQL suite with 1,877 passed, zero failed and three gated
skips; lint, types, formatting, shared builds and Node/Worker consumer builds. No merge or deployment.
The correction was compiled in `codex/perpl-model-timeout-diagnostic` for the repeats, separately
from the still-running comparison's frozen checkout. The paid session was not switched to new code.

Private output directory:
`apps/agent-service/.data/perps-studies/perps-20261001-rest-paced/timeout-replay-20261002-context/`
contains JSON, CSV and HTML. These artifacts and operator scripts remain ignored, with no secrets
in reports. Read [the prospective study guide](PERPS-STUDY.md) before planning another comparison.
A new paid comparison needs explicit authorization and reconciliation of historical unknown usage;
this two-call diagnostic grants no continuation or further retries.
