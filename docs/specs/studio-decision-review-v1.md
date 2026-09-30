# Studio decision review v1: the owner's view of every decision

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(decisions 2 and 8) and reads what `docs/specs/decision-resolution-v1.md` writes. Every decision
below is reversible unless the table says otherwise.

## 1. Problem and users

The studio shows one decision at a time. The Picks section draws the latest run's forecast, report
and sources (`apps/web/src/features/studio/sections/picks.tsx`), the Activity section every trace
event (`sections/activity.tsx`), and `decision.ts` reconciles the four stored decision shapes into
one view (`apps/web/src/features/studio/decision.ts:1-60`). The studio home shows the latest call
(`apps/web/src/features/studio/home/picks.tsx`). What the owner cannot do
(`docs/product-map/research/04-runtime.md` §3, "Reviewing decisions"):

- see a list of the agent's decisions, filter it, and find the ones a given rule stopped;
- see whether a decision was right, because nothing resolves it (fixed by `decision-resolution-v1`);
- see aggregate performance: hit rate, calibration, what the rules saved or cost;
- say "this one was wrong, and here is why", and have that kept.

The run list endpoint exists (`workers/api/src/routes/studio.ts:616-628`) and the trace is fetched
whole per run (`:655-661`), so a list today means N+1 fetches of full traces.

Separately, "reviewing decisions" exists only as local laboratories: Jev and DeepSeek classifier
evaluations, the quantitative veto reviewer, the BTC benchmarks
(`packages/agent-runtime/AGENTS.md:105-125`; `apps/agent-service/BTC-DECISION-BENCHMARK-VALIDATION.md:11-14,158-163`).
Conventions decision 8 keeps them experiments. This spec says so explicitly and defines the seam a
future reviewer model would use.

Users: the **agent owner** (and members of the owner's workspace with write access), in the studio
at `studio.pickler.fun`, with the Turnkey passkey session. Secondarily **Pickler's evaluation
work**, which needs human labels on real decisions (`apps/agent-service/AGENTS.md:70`,
`prepare:decision-evidence` prepares unreviewed datasets).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                | Reason                                                                                                                                                                                                                          | Reversible? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| R1  | **The Picks section becomes Decisions**: a paginated, filterable list of every enrolled decision with its resolution, and a detail view per decision. The single-decision view stays as the detail.                                                                                                                                                     | The owner's question is "how is it doing", which a list with outcomes answers and one card does not.                                                                                                                            | yes         |
| R2  | **The list reads `pickler.decisions` + current resolution + review**, one query, never the trace. The detail reads the trace once, server-side, and returns a shaped review (§5.2), so the browser no longer walks raw events for sources and market names.                                                                                             | Removes the N+1 and moves the "which market, which sources" parsing (`picks.tsx:15-70`) to one tested place on the server.                                                                                                      | yes         |
| R3  | **The owner sees everything, including the brief's rule text**: which entry rules fired or held, which `never` line was broken, the rule that stopped the trade, the policy reason codes, the prompt hashes, model usage and cost.                                                                                                                      | It is the owner's own configuration. The public redaction (`public-record-v1` P3) does not apply in the studio.                                                                                                                 | yes         |
| R4  | **A "Record" section** in the RUN group shows owner-scope aggregates from `pickler.agent_records` plus per-rule and per-reason breakdowns computed on read (§5.3).                                                                                                                                                                                      | The public record hides pre-public decisions and rule-level detail; the owner needs both to tune the brief.                                                                                                                     | yes         |
| R5  | **The owner can review any decision**: a verdict (`wrong`, `right`, `unsure`), zero or more reason tags from a fixed list, and a note of up to 1 000 characters. One current review per decision per reviewer; every change is also written to `audit.events`. Allowed before and after resolution; the review records which state the decision was in. | The ask is "mark a decision as wrong with a reason". Recording the resolution state at review time separates hindsight labels ("it lost") from judgement labels ("the sources were stale"), which matters for any later tuning. | yes         |
| R6  | **Reviews never change a decision, a resolution or the public record.** A decision marked wrong that won is still a win.                                                                                                                                                                                                                                | The record must be the market's verdict, not the owner's. Otherwise an owner could annotate away losses.                                                                                                                        | no          |
| R7  | **Reviews are private to the workspace** and are used, in v1, only to show the owner their own patterns. Exporting them for Pickler's evaluation datasets is an internal operator route that ships disabled.                                                                                                                                            | Using customer labels to tune platform models is a data-use decision for the owner (§12).                                                                                                                                       | yes         |
| R8  | **Jev and the benchmarks stay experiments.** No reviewer model runs in the hosted path, none is called from the studio, and nothing in this spec imports `composition/quant-review`, `compact-quant-review` or the Jev client.                                                                                                                          | Conventions decision 8. Jev's reliability as a reviewer is unproven: 0/6 material errors caught by the current reviewer, strict-invariant failures stopped both v4 runs (`BTC-DECISION-BENCHMARK-VALIDATION.md:45-56,136-151`). | yes         |
| R9  | **A future reviewer plugs in behind a `DecisionReviewer` port** (§6.2), writes to its own table, is labelled "assistant review" and never "human", and may only annotate. Its acceptance gate is measured against the human labels this spec collects.                                                                                                  | Defining the seam now costs one interface and keeps a reviewer from being bolted onto the runtime or the policy later.                                                                                                          | yes         |

## 3. User flows

### 3.1 Browse decisions

1. Studio → an agent → **Decisions** (rail key `picks`, relabelled; `apps/web/src/features/studio/sections/rail.ts:32`).
2. The list shows, per row: decided time, market question, the call (`TRADE` outcome at ask /
   `PASS` / `HELD` when a rule stopped a trade), stated band, market price, resolution chip
   (`AWAITING`, `DISPUTED`, `WON`, `LOST`, `VOID`, `UNRESOLVABLE`), a `TESTNET` tag on testnet
   decisions (`decision-resolution-v1` D18), virtual P&L (and held P&L for
   held trades), an audience mark (`PUBLIC`, `OWNER ONLY`, `PAID READ`; `decision-resolution-v1`
   D16), and a review mark.
3. Filters: action (`trade`, `pass`, `held`), audience (`public`, `owner`, `buyer`), resolution state, policy reason code, the rule that
   stopped it (by rule text from the current or any past brief version), reviewed / not reviewed /
   verdict, and a date range. The URL carries the filters so a view can be shared within the
   workspace.

### 3.2 Open one decision

The detail (`GET /v1/studio/decisions/:runId`) shows, top to bottom:

1. **The call**: market and outcome, final action, model action if different, stated band against
   market price and ask, limit, expiry.
2. **Rules**: each `entersWhen` line with fired/held and the model's `why`; each `never` line with
   respected/broken; the armed exit line; the rule that stopped it, highlighted
   (`packages/core/src/features/research/decision-policy.ts:14-56`). The brief version shown is the
   one the run used (`runs.config`), with a "changed since" mark when the current brief differs.
3. **Policy**: every reason code in words, with the numbers it compared (width vs
   `maxProbabilityRangeWidth`, margin vs `minProbabilityMargin`, ask vs limit), as `decision.ts`
   already computes (`width`, `margin`, `marginOk`).
4. **Sources read**: each source with title, link, provider, retrieved time, whether the decision
   cited it (`sourceIds`), and the search queries with their intent (supporting / contradicting,
   `run-research.ts:260`).
5. **Reasoning summary**: thesis, counter-evidence, uncertainty, missing information, and for v3/v4
   decisions the report sections with their status (`decision.ts:23-29`) and the forecast.
6. **Resolution**, when it arrives: outcome, payout, block and link, Brier, hit, virtual / held /
   paper P&L, the paper fill and any exit check that closed it (`decision-resolution-v1` §3.4).
7. **Receipt**: decision hash, public commitment, receipt hash; "Public at …" with a link to the
   public receipt, or "Owner only (made before the agent was public)", or "Paid read · never
   public" with a link to the read in the studio (conventions decision 10: a paid read's reasoning
   and sources are never public; only its outcome card may be).
8. **Your review** panel (§3.3).
9. **Run**: usage, model steps, cost, duration, and a link to the full trace (the existing Activity
   view filtered to this run).

### 3.3 Mark a decision wrong (or right)

1. In the review panel the owner picks a verdict, ticks reasons, writes an optional note, and saves:
   `PUT /v1/studio/decisions/:runId/review` with the version they loaded.
2. The panel shows "Reviewed before resolution" or "Reviewed after it WON / LOST" (R5).
3. Changing the review later bumps its version; "Clear" deletes it. Both write `audit.events`.
4. Reason tags (fixed list, `packages/core/src/features/review/domain.ts`):
   `bad_sources`, `missed_evidence`, `stale_price`, `misread_rules`, `rule_too_strict`,
   `rule_too_loose`, `overconfident`, `underconfident`, `wrong_market`, `timing`, `other`
   (`other` requires a note).

### 3.4 See how the agent is doing

**Record** section (`GET /v1/studio/agents/:id/performance?window=30d|90d|all`):

- Headline: decisions, calls, passes, held; resolved calls, hit rate; Brier, market Brier, Brier
  skill; calibration gap with the calibration chart; virtual net; paper net; current and best
  streak; open calls.
- **Rules**: per `entersWhen` / `never` line (matched by exact text across brief versions): times it
  held a trade, and the held P&L of those trades — "this rule saved 3.2 AUSD over 14 held trades"
  or "cost 1.1".
- **Policy reasons**: the same, per reason code.
- **By uncertainty level** (`LOW`/`MEDIUM`/`HIGH`): count, Brier, hit rate.
- **Reviews**: counts by verdict and tag, and the share of "wrong" verdicts that actually lost.
- A banner when the owner scope and the public scope differ ("12 decisions before going public are
  not in your public record").

### 3.5 Home

The studio v5 home's Picks card (`home/picks.tsx`, harness id `home-picks`) gains the resolution
chip on the latest call and a one-line record ("7 of 11 · Brier 0.19 · +2.4 virtual"), linking to
Record. `pickCard` in `home/status.ts` gains the resolution input; it stays pure and pinned in
`studio-status.test.ts`.

## 4. API

Mounted under `/v1/studio` (also served at the `/v1/console` alias, `workers/api/src/app.ts:52-53`).
Auth: the studio session (Supabase JWT); scope via the existing `access.authorize` and
`directory.agentScope`, so another workspace's decision is a 404, never a 403. New routes use the
envelope; the existing studio routes keep their bodies. DTOs in
`packages/api-schema/src/decision-review.ts` (new).

| Method | Path                                 | Request                                                                                                                                              | Response `data`                                     | Errors                                                                                                                               |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/agents/:id/decisions`              | `?action=trade,pass,held&audience=public,owner,buyer&state=&reason=&rule=&reviewed=yes\|no\|wrong\|right\|unsure&from=&to=&cursor=&limit=` (max 100) | `DecisionRowDto[]`, `meta.nextCursor`, `meta.total` | 404 `AGENT_NOT_FOUND`, 400 `INVALID_FILTER`                                                                                          |
| GET    | `/decisions/:runId`                  | —                                                                                                                                                    | `DecisionReviewDto` (§5.2)                          | 404 `DECISION_NOT_FOUND` (not enrolled yet: the web falls back to the run view)                                                      |
| GET    | `/agents/:id/performance`            | `?window=30d\|90d\|all`                                                                                                                              | `AgentPerformanceDto` (§5.3)                        | 404 `AGENT_NOT_FOUND`                                                                                                                |
| PUT    | `/decisions/:runId/review`           | `{ verdict, reasons: ReasonTag[], note: string ≤ 1000, expectedVersion: number \| null }`                                                            | `ReviewDto` (with `version`)                        | 400 `INVALID_REVIEW` (`other` without note, unknown tag), 403 `READ_ONLY` (member without write), 404, 409 `REVIEW_VERSION_CONFLICT` |
| DELETE | `/decisions/:runId/review`           | `?expectedVersion=`                                                                                                                                  | `{ cleared: true }`                                 | 404, 409                                                                                                                             |
| POST   | `/decisions/:runId/check-resolution` | `Idempotency-Key`                                                                                                                                    | `ResolutionStateDto`                                | 404, 429 `CHECK_RATE_LIMITED` (1 per decision per 5 min, `error.detail.retryAt`)                                                     |

`check-resolution` runs `decision-resolution-v1`'s use case for one decision, the same code as the
Cron, under the same rate limit; `POST /runs/:id/paper-order/settle` (`studio.ts:663`) becomes an
alias of it, as `decision-resolution-v1` §4 states (cross-review C20).

**The settle alias's body.** Request: no body (any body is ignored); `Idempotency-Key` optional, as
today. Response: unchanged from today, the bare `PaperOrder` body `GET /runs/:id/paper-order`
returns (`studio.ts:702`), with `settlement` filled when the check resolved it, so existing callers
keep working. Errors: those of `check-resolution` plus today's `PAPER_NOT_FILLED` (409) for a run
without a filled paper order. The web moves to `check-resolution`; the alias stays for old clients.

Internal (disabled until R7 is answered):

| Method | Path                                   | Auth                                                                                                                                               | Response                                                                                                                                                                                                                   |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/internal/decision-reviews/export` | service binding + operator claim, reached only through the operator CLI of `operations-v1.md` §4.3 (cross-review E2); `REVIEW_EXPORT_ENABLED=true` | JSONL stream: `{ runId, agentId, verdict, reasons, note, resolutionStateAtReview, decision, resolution }` in the `{run, events}` shape `prepare:decision-evidence` reads (`apps/agent-service/DECISION-EVALUATION.md:110`) |

## 5. Data model and migrations

One migration, **`decision_reviews`** (number assigned at build time), after
`decision_resolutions`.

### 5.1 `pickler.decision_reviews`

| Column                     | Type        | Notes                                                         |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| `run_id`                   | text        | → `pickler.decisions.run_id`                                  |
| `reviewer_user_id`         | uuid        | the studio user                                               |
| `tenant_id`, `agent_id`    | text        | denormalised for scope checks and filters                     |
| `verdict`                  | text        | `wrong` \| `right` \| `unsure`                                |
| `reasons`                  | text[]      | checked against the tag list                                  |
| `note`                     | text        | ≤ 1 000 chars, default `''`                                   |
| `state_at_review`          | text        | the decision's `state` when saved (`awaiting`, `resolved`, …) |
| `outcome_at_review`        | text null   | `won` \| `lost` \| `void` when resolved                       |
| `version`                  | integer     | starts at 1                                                   |
| `created_at`, `updated_at` | timestamptz |                                                               |

PK `(run_id, reviewer_user_id)`; index `(agent_id, verdict)`. RLS enabled, private schema. Each
write also inserts `audit.events` (`event_type = 'decision_review.saved' | 'decision_review.cleared'`,
payload = before and after).

### 5.2 `DecisionReviewDto`

Built server-side by a new `DecisionReviewQuery` in `packages/core/src/features/review/`, from
`pickler.decisions`, the current resolution, the run (config, decision), its events and the review:

```ts
interface DecisionReviewDto {
  runId: string;
  decidedAt: string;
  market: { id: string; question: string; outcome: string | null; expectedEndAt: string | null };
  call: {
    finalAction: "TRADE" | "ABSTAIN";
    modelAction: "TRADE" | "ABSTAIN";
    held: boolean;
    stated: { lower: number; estimate: number; upper: number } | null;
    marketPrice: number | null;
    ask: number | null;
    limit: number | null;
  };
  rules: {
    briefVersion: number;
    changedSince: boolean;
    entries: { rule: string; fired: boolean; why: string }[];
    never: { rule: string; respected: boolean }[];
    exitArmed: string | null;
    stoppedBy: { kind: "entry" | "never"; rule: string } | null;
  } | null;
  policy: {
    version: string;
    reasons: { code: string; words: string; compared: string | null }[];
  } | null;
  sources: {
    id: string;
    title: string;
    url: string | null;
    provider: string;
    retrievedAt: string;
    cited: boolean;
  }[];
  searches: { query: string; intent: "supporting" | "contradicting" | string }[];
  reasoning: {
    thesis: string;
    counterEvidence: string;
    uncertainty: string;
    missing: string[];
    report: ReportSectionDto[] | null;
  };
  resolution: ResolutionDto | null; // decision-resolution-v1 §4
  paper: { order: PaperOrderDto | null; exitChecks: ExitCheckDto[] };
  receipt: {
    decisionHash: string;
    publicCommitment: string | null; // null unless audience = "public" (decision-resolution-v1 §5.1)
    receiptHash: string | null;
    publicId: string | null;
    audience: "public" | "owner" | "buyer";
  };
  run: { usage: unknown; durationMs: number | null; promptHashes: Record<string, string> };
  review: ReviewDto | null;
  assistantReviews: []; // always empty in v1 (R8, §6.2)
}
```

### 5.2.1 Row, review and resolution-state DTOs

```ts
type ResolutionChip = "AWAITING" | "DISPUTED" | "WON" | "LOST" | "VOID" | "UNRESOLVABLE";

interface DecisionRowDto {
  runId: string;
  decidedAt: string;
  audience: "public" | "owner" | "buyer";
  network: "mainnet" | "testnet";
  market: { id: string; question: string; outcome: string | null };
  call: "TRADE" | "PASS" | "HELD";
  stated: { lower: number; estimate: number; upper: number } | null;
  marketPrice: number | null;
  ask: number | null;
  chip: ResolutionChip;
  virtualPnlMicro: number | null; // calls only
  heldPnlMicro: number | null; // held trades only
  stoppedBy: { kind: "entry" | "never"; rule: string } | null;
  reasons: string[]; // policy reason codes
  review: { verdict: "wrong" | "right" | "unsure"; tags: ReasonTag[] } | null;
}

interface ReviewDto {
  runId: string;
  reviewer: { userId: string; handle: string | null };
  verdict: "wrong" | "right" | "unsure";
  reasons: ReasonTag[];
  note: string;
  stateAtReview:
    "awaiting" | "disputed" | "resolved" | "void" | "identity_missing" | "unresolvable";
  outcomeAtReview: "won" | "lost" | "void" | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ResolutionStateDto {
  runId: string;
  state: ReviewDto["stateAtReview"];
  chip: ResolutionChip;
  checkedAt: string; // when this check ran
  nextCheckAt: string | null; // null once resolved, void or unresolvable
  resolution: ResolutionDto | null; // decision-resolution-v1 §4, current revision
  paperOrder: PaperOrderDto | null; // with its settlement when this check settled it
}
```

`chip` maps `state` (`identity_missing` shows as `AWAITING`) and, when resolved, the outcome.
Micro amounts are JSON numbers here because they are bounded by the 1 AUSD stake (conventions,
money rule: integers in micro-units).

### 5.3 `AgentPerformanceDto`

`AgentRecordDto` (scope `owner`, `decision-resolution-v1` §5.5) for `window=all`; for 30d / 90d the
same `computeRecord` function over the window's decisions, computed on read (bounded by the
agent's decision count). Plus `rules[]` (`{ kind, rule, held, heldPnlMicro }`), `reasons[]`
(`{ code, held, heldPnlMicro }`), `byUncertainty[]`, `reviews` (`{ wrong, right, unsure,
tags: Record<ReasonTag, number>, wrongThatLost }`) and `publicGap` (owner minus public decision
counts).

## 6. Integrations

### 6.1 None new for v1

Everything is read from Postgres. No model, no provider, no chain call except the one-decision
resolution check, which goes through `decision-resolution-v1`.

### 6.2 How a future reviewer model plugs in (designed, not built)

- **Port** in `packages/core/src/features/review/ports.ts`:

  ```ts
  interface DecisionReviewer {
    readonly id: string; // "jev-quant-review", "compact-quant-review", …
    readonly version: string;
    review(input: DecisionReviewInput, signal: AbortSignal): Promise<AssistantReview>;
  }
  interface DecisionReviewInput {
    decision: DecisionReviewDto; // the same shaped view the owner sees, without the human review
    sources: { id: string; content: string }[]; // retrieved contents, never refetched
  }
  interface AssistantReview {
    verdict: "concern" | "no_concern" | "invalid";
    findings: { tag: ReasonTag; sourceIds: string[]; explanation: string }[];
    usage: unknown;
  }
  ```

- **Storage**: its own table `pickler.decision_assistant_reviews (run_id, reviewer_id,
reviewer_version, verdict, findings, usage, created_at)`, never `decision_reviews`. Created by the
  reviewer's own spec, not by this one.
- **Where it runs**: after a decision is enrolled, dispatched by a `workers/jobs` cron that calls an
  internal API route, with the API doing the work (conventions decisions 15 and 18), never
  inside the research run and never before the policy verdict. Moving a reviewer into the runtime
  as a veto (`packages/agent-runtime/AGENTS.md:105-125`) is a separate spec with its own failure
  policy (the open `invalidAnswerPolicy: "block-case"` question,
  `BTC-DECISION-BENCHMARK-VALIDATION.md:158-163`).
- **What it may do**: annotate only. It cannot change a decision, a resolution, a human review or
  the public record, and the studio labels its output "Assistant review" with the reviewer id.
- **Gate before enabling**: at least 200 human-reviewed real decisions from this spec, across at
  least 10 agents; the reviewer's `concern` agrees with human `wrong` verdicts (reviewed before
  resolution) at a precision and recall the enabling spec states; zero `invalid` answers on a held-out
  set; cost per review charged through the research budget (`docs/specs/research-runtime-v2.md`). Until then `assistantReviews` is
  always `[]`.

## 7. Design work

Existing canvases: **Pickler Studio v5** (the home, `/studio` with an agent) and **Pickler Studio
v4** (the shell and sections); the studio is the dark surface (`docs/specs/design-system-v2.md` §5).

| Screen                           | Change                                                                                                                                                                                             | Canvas                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Studio home, Picks card          | Resolution chip on the latest call; one-line record linking to Record                                                                                                                              | extend **Pickler Studio v5**                |
| Decisions list (section `picks`) | New: filter bar, rows with call / band / market / chip / P&L / review mark; empty ("No decisions yet: the first run makes one"), filtered-empty, loading, error                                    | **new canvas: Pickler Studio Decisions**    |
| Decision detail                  | Reorganised from today's Picks view into the nine blocks of §3.2, with the Rules block and resolution block new                                                                                    | **Pickler Studio Decisions** (detail frame) |
| Review panel / sheet             | Verdict segmented control, tag chips, note, "Reviewed before resolution" line, saved / conflict / read-only states                                                                                 | **Pickler Studio Decisions** (review frame) |
| Record section                   | New: headline figures, calibration chart, rules and reasons tables with held P&L, by-uncertainty table, reviews summary, owner-vs-public banner, "not enough data" state under 10 scored decisions | **new canvas: Pickler Studio Record**       |
| Rail                             | `Picks` → `Decisions`; new `Record` item in RUN (`sections/rail.ts:28-35`, `sections/keys.ts`)                                                                                                     | **Pickler Studio v4** rail, copy only       |
| Paper order card                 | "Settle" → "Check now" with the resolution state                                                                                                                                                   | **Pickler Studio Decisions**                |

Every state gets a harness id and a staged route (the `?stage=` pattern, `apps/web/AGENTS.md`
"Studio home"), so the design checks can measure populated screens without real data. Charts follow
the `--pk-*` tokens (`packages/ui/src/styles.css`).

## 8. Security and abuse

- **Scope.** Every route resolves the decision through the caller's workspace and tenant
  (`directory.agentScope`); another workspace's run id answers 404. Tested.
- **Write access.** Review writes need a workspace member with write access (`access.authorize(…,
true)`, as `studio.ts:630`); a read-only member gets 403 `READ_ONLY`.
- **Staged studio.** A staged or preview studio refuses the review write, like every other studio
  write (`apps/web/AGENTS.md`, "Studio home").
- **Record integrity.** Reviews are annotations (R6); a test proves saving a `wrong` review on a
  won decision leaves `agent_records` byte-identical.
- **Note content.** Plain text, rendered as text, never HTML; 1 000 characters.
- **Export.** Off by default; operator-only; never reachable from the web proxy.

## 9. Acceptance criteria and tests

Core (`packages/core/src/features/review/`):

1. `DecisionReviewQuery` builds the DTO from each of the four decision shapes (legacy, v2, v3, v4)
   using the same fixtures as `decision.ts`'s tests, with nothing invented for missing fields.
2. Rule matching across brief versions: a rule edited by one character is a different rule.
3. Held P&L per rule sums to the agent's `held_net_micro` for decisions stopped by exactly one rule.
4. Review validation: `other` needs a note; unknown tags fail; note length.

Infrastructure (real Postgres):

5. The list returns one page with one query (asserted with a query counter) and filters combine.
6. `PUT` with a stale `expectedVersion` → 409; with the right one → version + 1 and one
   `audit.events` row; `DELETE` likewise.
7. Another workspace's decision → 404 on every route.
8. A review never changes `agent_records`.

Web:

9. Decisions list, detail, review panel and Record render populated, empty, loading and error states
   with harness ids; the review panel's conflict state reloads the latest review.
10. Home's Picks card shows the chip for each resolution state (`studio-status.test.ts`).

## 10. Rollout and dependencies

Needs first: `decision-resolution-v1` steps 1–3 (enrolled and resolved decisions). The list can ship
with `AWAITING` chips before resolution is enabled, because enrollment alone fills it.

1. Migration `decision_reviews`; core query and rules; routes.
2. Web: Decisions list and detail (replacing the Picks view), review panel.
3. Record section and home card, after resolutions have been flowing on staging for a week.
4. Export route stays disabled until the owner answers §12 question 1.

## 11. Out of scope

- Any reviewer model in the product (R8); its own spec when the gate in §6.2 is met.
- Reviews by buyers or the public, and public display of owner reviews.
- Automatic brief tuning from reviews ("suggest a rule change").
- Reviewing preview runs (they are not decisions, `decision-resolution-v1` D1).
- Multi-reviewer workflows, assignment, or review queues.

## 12. Open questions for the owner

1. **Using owners' reviews for Pickler's evaluation datasets.** May Pickler export owners' reviews
   (with decisions and sources) to tune or evaluate models across agents, and does that need an
   explicit opt-in in the studio or a clause in the terms? Until answered, the export stays off
   (R7).
2. **Jev laboratory track.** The benchmark stopped on invalid answers and the prepared
   `invalidAnswerPolicy: "block-case"` needs approval and budget. Pause the track until 200 human
   labels exist (§6.2), or keep it running in parallel?
