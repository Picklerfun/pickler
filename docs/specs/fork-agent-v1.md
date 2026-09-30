# Fork an agent v1: start a brief from a ranked agent

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`. Builds
on `studio-brief-v1.md` (the brief, the preview run, the private draft) and `go-public-v1.md`
(publication and the Public profile section). Every decision is reversible unless the table says
otherwise.

## 1. Problem and users

**User:** a studio account writing a brief on the empty home (or on "+ New agent" once the brief
path serves later agents), who would rather start from an agent that already works than from a
blank page.

**Problem.** The empty home's START FROM row offers "Blank", selected, and "A ranked agent" with a
"Soon" tag that links to the marketplace directory
(`apps/web/src/features/studio/home/empty.tsx:365-373`; `studio-brief-v1.md:148-149`, `:233`). The
side panel says "Read a ranked agent first to see how a working one reads" and links to its
receipts. Nothing can be copied.

The canvas "Pickler Studio Empty v4" draws the real thing (its logic lines 353-379, 403-409,
467-480, 542-567):

- START FROM lists ranked agents as chips (`@wire 84`, `@drift 71`, `@counter 66`) plus Blank.
- Picking one loads its **thesis, reads, enters, exits and never** into the five fields. The
  **name stays empty**, the **handle is derived from the new name**, and the **caps reset to the
  starter caps** (5 / 20 / 2×), with the risk tag reading "STARTER CAPS · @WIRE RUNS 25 / 100 / 3×".
- Each section's tag reads "FROM @WIRE" until edited, then "EDITED". The name line says
  "FORKED FROM @WIRE · SCORE 84".
- The side card becomes **FORKED FROM** with the agent's initials, name, line, three stats (SCORE,
  HIT · 30D, AUSD · 30D) and "SEE ITS RECEIPTS →".
- The paper run and create rules are the same as for a blank brief.

Two things the canvas does not settle: which agents may be forked (a brief is the agent's edge,
and its rules are exactly what paid reads protect), and what the source gets in return.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                         | Reason                                                                                                                                                       | Reversible?                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| F1  | **Forkable = public + not killed + opted in by its owner.** The opt-in is "Let others start from its brief" in the Public profile section (`go-public-v1.md` §3.4), **off by default**, stored as `agent_profiles.forkable`.                                                                                                                     | Opting in publishes the brief's rules to every studio account. Only the owner may decide that; the default protects the edge that reads sell.                | yes                                     |
| F2  | **Only agents with a brief can be forked.** An agent from `/studio/new` has no brief (`studio-brief-v1.md:28-29`) and cannot opt in until one is written in its Brief section.                                                                                                                                                                   | There is nothing in the canvas's shape to copy.                                                                                                              | yes                                     |
| F3  | **"Ranked" means: sorted by the leaderboard score.** The picker lists forkable agents ordered by score (desc), then resolved decisions, then publication date. Agents with no score yet are listed after those with one and show "NEW" instead of a number. At most 12 chips on the home; "More" opens a searchable sheet.                       | Settlement does not exist yet (`reads.ts:97-98`, score null), so a strict "ranked only" rule would make the feature empty. Honest labels, no invented score. | yes (a minimum-score gate can be added) |
| F4  | **What is copied: the five brief sections only** (thesis, reads, entersWhen, exitsWhen, never), from the source's **active config version** at the moment of loading.                                                                                                                                                                            | The canvas's `load()` copies exactly these.                                                                                                                  | yes                                     |
| F5  | **Not copied:** name, handle, caps (reset to `STARTER` 5 / 20 / 2×), max leverage, voice, X, avatar, accent, links, skills and plugin settings, schedule, wallet, read service, token. The source's caps are shown for reference only.                                                                                                           | The canvas resets caps and leaves the name blank; identity and money are never inherited.                                                                    | yes                                     |
| F6  | **No live link:** the fork is a copy at a version. Later edits to the source never reach the fork, and the fork's edits never reach the source.                                                                                                                                                                                                  | A brief is what an agent runs on; it must change only when its owner changes it.                                                                             | yes                                     |
| F7  | **Loading a brief is logged, not charged.** Each load is recorded (who, which source, which version) so the owner sees how often their brief is read, and so abuse can be rate-limited.                                                                                                                                                          | Opted-in briefs are public inside the studio; the owner deserves the count.                                                                                  | yes                                     |
| F8  | **Attribution is permanent and public.** A draft created from a fork records `forked_from` (agent id, config version). The fork's public profile shows "Started from @source's brief" with a link; the source's profile shows "Forks · N" (public forks only). The studio shows the FORKED FROM card on the draft home and in the Brief section. | Credit is the return v1 can give without moving money. Lineage is data the royalty question will need.                                                       | yes                                     |
| F9  | **No royalty in v1.** Lineage is stored so that a share (for example of the fork's read fees) can be computed later.                                                                                                                                                                                                                             | Any split touches payouts and taxes (`paid-reads-v1.md` §12). §12 Q1.                                                                                        | yes                                     |
| F10 | **Turning the opt-in off** hides the brief from new loads immediately. Existing forks keep their copy and their attribution line.                                                                                                                                                                                                                | A copy already made cannot be taken back; the line keeps the credit honest.                                                                                  | yes                                     |
| F11 | **An owner cannot fork their own agent through this path** (they already have the brief). A killed source disappears from the picker; its forks keep the line, linking to the killed agent's page, which still serves (`agent-directory.ts:205-208`).                                                                                            | Keeps the list meaningful; links never break.                                                                                                                | yes                                     |
| F12 | **Attribution needs no edit threshold.** Even a fork that rewrites every line keeps "Started from"; the studio shows how many lines are still the source's.                                                                                                                                                                                      | A similarity threshold is easy to game and hard to explain.                                                                                                  | yes                                     |

## 3. User flows

### 3.1 Start from a ranked agent (empty home)

1. START FROM shows up to 12 chips from `GET /v1/studio/forkable-agents` (colour dot, `@handle`,
   score or NEW) and "Blank". "More" opens a sheet with search by handle or beat.
2. Picking a chip calls `GET /v1/studio/forkable-agents/:handle/brief`. If any field is dirty, a
   confirm first: "Replace your brief with @wire's?". Then the five fields fill, the caps reset to
   starter, the tags read "FROM @WIRE", the name line "FORKED FROM @WIRE · SCORE 84", and the side
   card becomes FORKED FROM with stats and "SEE ITS RECEIPTS →" (to the marketplace profile).
3. Any run in progress is cancelled on the screen and the run panel resets (as the canvas's
   `load()` does); a finished run becomes stale by fingerprint.
4. The person edits, runs it on paper (`POST /v1/studio/preview-runs` with `forkedFrom`), names it
   and creates it (`POST /v1/studio/drafts` with `forkedFrom`). The server re-checks that the source
   is still forkable; if not, the draft is created **without** attribution only if no field still
   matches the source, otherwise 409 `SOURCE_NOT_FORKABLE` ("@wire stopped sharing its brief").
5. Picking "Blank" clears the fields and the attribution.

### 3.2 Opting in (source owner)

Public profile section → "Let others start from its brief" → confirm sheet: "Every studio account
will be able to read and copy its thesis, sources and rules. Name, caps, voice and wallet are never
shared." → `PUT /v1/studio/agents/:id/profile { forkable: true }`. Below the switch: "Loaded N times
· M public forks".

### 3.3 After create and publish

- Draft home: the FORKED FROM card (initials, name, score, "3 of 14 lines still @wire's").
- Brief section: the same card, collapsed.
- Public profile after Go Public: "Started from @wire's brief".
- Source's public profile: "Forks · N".

## 4. API

Studio routes need a studio account; the envelope and errors follow conventions.

| Method | Path                                             | Request                                                | Response `data`                                                                                                                                                                      | Errors                                                                                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/studio/forkable-agents`                     | `?q=&cursor=&limit=` (limit ≤ 50)                      | `[{ handle, name, accent, avatarUrl, line, beat, score: number \| null, hitRate30d: number \| null, net30dMicroAusd: number \| null, resolved }]`, `meta.nextCursor`                 | —                                                                                                            |
| GET    | `/v1/studio/forkable-agents/:handle/brief`       | —                                                      | `{ source: { agentId, handle, name, score, configVersion }, brief: { thesis, reads[], entersWhen[], exitsWhen[], never[] }, sourceCaps: { perTradeAusd, perDayAusd, maxLeverage } }` | 404 `NOT_FORKABLE` (private, killed, opted out, no brief, or own agent); 429 (60 loads per hour per account) |
| POST   | `/v1/studio/preview-runs` (exists)               | adds optional `forkedFrom: { agentId, configVersion }` | as today                                                                                                                                                                             | 409 `SOURCE_NOT_FORKABLE`                                                                                    |
| POST   | `/v1/studio/drafts` (exists, `studio.ts:481`)    | adds optional `forkedFrom: { agentId, configVersion }` | as today, plus `forkedFrom: { handle, name } \| null`                                                                                                                                | 409 `SOURCE_NOT_FORKABLE`                                                                                    |
| PUT    | `/v1/studio/agents/:id/profile` (`go-public-v1`) | `{ forkable }`                                         | the profile, plus `forkStats: { loads, forks, publicForks }`                                                                                                                         | 409 `FORK_NEEDS_PUBLIC`, `FORK_NEEDS_BRIEF`                                                                  |
| GET    | `/v1/studio/agents/:id/lineage`                  | —                                                      | `{ forkedFrom: { handle, name, configVersion, killed } \| null, linesFromSource, linesTotal }`                                                                                       | —                                                                                                            |

**Marketplace DTO changes** (`packages/api-schema/src/agents.ts`): the persona gains
`forkedFrom: { handle, name } | null` and `forkCount: number` (public forks only).

The preview-run fingerprint (studio-brief-v1 §5) does **not** include `forkedFrom`: attribution does
not change what runs.

## 5. Data model and migrations

Migration **`00NN_agent_forks`** (next free number is 0023; assigned at build time). It depends on
`00NN_go_public` for `visibility`.

```sql
ALTER TABLE agents.agent_profiles
  ADD COLUMN forkable boolean NOT NULL DEFAULT false;

CREATE TABLE agents.agent_forks (
  agent_id uuid PRIMARY KEY REFERENCES agents.agents(id) ON DELETE CASCADE,  -- the fork
  source_agent_id uuid NOT NULL REFERENCES agents.agents(id),
  source_config_version integer NOT NULL,
  source_brief jsonb NOT NULL,           -- the five sections as loaded, for "lines still the source's"
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (agent_id <> source_agent_id)
);
CREATE INDEX agent_forks_source_idx ON agents.agent_forks (source_agent_id);

CREATE TABLE agents.brief_loads (
  id bigserial PRIMARY KEY,
  source_agent_id uuid NOT NULL REFERENCES agents.agents(id) ON DELETE CASCADE,
  source_config_version integer NOT NULL,
  loaded_by uuid NOT NULL,               -- auth user id
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brief_loads_source_idx ON agents.brief_loads (source_agent_id, created_at DESC);
CREATE INDEX brief_loads_user_idx ON agents.brief_loads (loaded_by, created_at DESC);
```

- The draft transaction (`studio-brief-v1.md` §6 step 4) inserts `agent_forks` when `forkedFrom` is
  present and still valid; a replayed create returns the same attribution.
- `linesFromSource` is computed by comparing the fork's current brief lines with `source_brief`
  (trimmed, case-sensitive).
- The forkable list is a read over `agents.agents` (public, not killed) ⨝ `agent_profiles`
  (`forkable`) ⨝ the active config with a non-null brief, ordered per F3 with the settlement read
  model's score when it exists.

## 6. Integrations

None external. Internal: the settlement/record read model for score, 30-day hit rate and net
(conventions decision 2); until it exists these are `null` and drawn as NEW / "—". The marketplace
profile pages for "SEE ITS RECEIPTS →", through `hrefFor`/`marketplaceUrl`
(`apps/web/src/server/hosts.ts:106-137`).

## 7. Design work

| Surface | Screen / state                                                                                                                      | Canvas                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Studio  | START FROM with real chips, a selected fork, tags FROM/EDITED, risk tag with the source's caps, FORKED FROM side card               | **exists**: "Pickler Studio Empty v4", create phase                |
| Studio  | "More" sheet with search; a chip for an agent with no score ("NEW"); "Replace your brief?" confirm; `SOURCE_NOT_FORKABLE` at create | **must be drawn** in Claude Design                                 |
| Studio  | FORKED FROM card on the draft home and in the Brief section, with "N of M lines still @x's"                                         | **must be drawn** (Empty v4's draft phase and Studio v5 have none) |
| Studio  | Public profile: the fork opt-in switch, its confirm sheet, load and fork counts                                                     | **must be drawn** (with the section in `go-public-v1.md` §7)       |
| Web     | Profile lines "Started from @x's brief" and "Forks · N"                                                                             | "Agent Profile Light" exists; the lines **must be added**          |
| Mobile  | The same two lines on "Agent Profile Mobile Light"                                                                                  | exists; additions **must be drawn**                                |

## 8. Security and abuse

- **Leaking a brief the owner did not share:** the brief endpoint checks public, not killed,
  `forkable`, and a non-null brief in one query at request time; drafts and private agents are
  never listed.
- **Scraping:** 60 loads per account per hour and 300 per day; loads are logged per user.
- **Attribution spoofing:** `forkedFrom` is accepted only if the caller loaded that source and
  version in the last 24 h (checked against `brief_loads`), so nobody can attach a famous agent's
  name to an unrelated brief.
- **Attribution stripping:** there is no endpoint that removes `agent_forks`; the line stays on
  the public profile.
- **Name confusion:** the fork's name and handle are always the person's own; the handle rules
  and availability check apply as for any draft.

## 9. Acceptance criteria and tests

1. Only public, non-killed, opted-in agents with a brief appear in the list or answer the brief
   endpoint; everything else is 404 `NOT_FORKABLE`.
2. Loading copies exactly the five sections of the active config version; caps come back as the
   starter caps; name and handle are untouched on the screen.
3. A draft created with a valid `forkedFrom` writes one `agent_forks` row; a replay does not write a
   second; a source opted out between load and create yields 409 when lines still match.
4. `forkedFrom` without a matching recent load is refused.
5. The public profile shows "Started from" and the source shows the public fork count; a private
   fork is not counted.
6. Web unit tests: tags FROM/EDITED/YOURS/EMPTY, the risk tag, the source note, the replace
   confirm, and that the fingerprint ignores `forkedFrom`.
7. Design harness: 0 FAIL on `/studio?stage=empty-forked`, `...-forked-edited`, and the draft home
   with a FORKED FROM card.

## 10. Rollout and dependencies

Needs first: `studio-brief-v1.md` (built), `go-public-v1.md` (visibility and the Public profile
section, where the opt-in lives). Useful but not blocking: the settlement read model for scores
(without it, every chip says NEW). Order: migration → opt-in switch → list and brief endpoints →
the home's START FROM → attribution on profiles.

## 11. Out of scope

Royalties or any payment to the source; forking skills, sources configuration or caps; merging a
source's later changes; forking from the marketplace (a "Fork" button on a public profile, which
would need a studio account anyway); forking a private agent within one's own workspace
("duplicate" is a separate, simpler feature).

## 12. Open questions for the owner

1. **Royalty:** should a fork's owner share part of the fork's read revenue (for example 10 % of the
   owner's share for 90 days) with the source's owner? If yes, it lands in the paid-reads payout job.
2. **Default of the opt-in:** keep it off by default (F1), or on for agents that have been public
   for some time, as the canvas implies ranked agents are simply there to fork?
3. **Minimum record to be listed:** should forking require a score (a strict "ranked" list), even
   though that leaves the feature empty until settlement ships?
