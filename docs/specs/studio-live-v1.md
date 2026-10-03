# Studio: the live studio of a published Perpl agent (v1)

Status: decided autonomously on 2026-10-02 (the owner asked for no questions). Canvas: Claude
Design project `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, `Pickler Studio v5 Live.dc.html`. Builds on
`studio-draft-dashboard-v1.md` (the draft studio, Connect X, Go Public) and keeps its rule D19: no
copy promises what the Perpl runtime will do.

## 1. Problem and users

After Go Public a Perpl agent stops being a draft, and the studio drops it into the old home and
rail, which were built for Polymarket agents: their Brief edits `config.profile`, their Run now is
refused (`CATEGORIES_REQUIRED`), their schedule can never unlock (`isReadyToSchedule` needs a
market selection and a Polymarket connection check). Nothing there fits a Perpl agent.

The canvas draws the studio of a live agent: approvals, positions with charts, a decisions feed,
posts, five hard caps, how it enters (on its own or with approval), stops, and health. Most of that
is the Perpl runtime and live trading, which are not built (`perpl-agent-runtime-v1.md`,
`perpl-live-v1.md`). This spec builds the studio itself and everything that has real data today,
and draws the rest as empty states that say what is true. Later specs fill them (§11).

Users: a studio account that owns a published agent created by the simplified flow (`config.perpl`).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reason                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| L1  | **A published Perpl agent gets `features/studio/live/`.** The studio picks it when the agent is not a draft and its config has `perpl`. Agents without `config.perpl` (legacy Polymarket) keep today's home and rail. After Go Public the studio opens the live Overview.                                                                                                                                                                                                                                                                                                        | The canvas is a Perpl agent's studio; the legacy one cannot serve it.                      |
| L2  | **The shell is shared with the draft studio.** Top bar, rail, avatar, agent switcher, tiles, the Wallets and credits modals, Identity, Master wallet, Trade and the X card are one implementation with two configurations, moved to `features/studio/shell/` where both import them.                                                                                                                                                                                                                                                                                             | The two canvases draw the same chrome; a fork would drift.                                 |
| L3  | **Rail:** RUN = Overview, Positions, Decisions, Posts; BUILD = Brief, Sources & rules, Limits & controls, Identity & voice; YOU = Trade, Master wallet; then a "PUBLIC PAGE" link to the marketplace's `/agents/<handle>`. Positions and Decisions carry a count badge only when above zero. Nothing is locked.                                                                                                                                                                                                                                                                  | The canvas.                                                                                |
| L4  | **Two states, PUBLIC and PAUSED.** The chip reads "PUBLIC · RUNS SOON" (not the canvas's "LIVE · WATCHING") or "PAUSED · EXITS ONLY". "Pause entries" / "Resume" in the header call the existing `PUT /agents/:id/pause`. "Stop · close all" is drawn shut with "Soon": it closes positions, which needs live trading.                                                                                                                                                                                                                                                           | Pause is real and already refuses paper opens. Nothing watches yet (D19).                  |
| L5  | **Stats:** EQUITY is the agent wallet's AUSD ("EQUITY · AUSD IN ITS WALLET"). TODAY, OPEN and NEW MARGIN TODAY read "Soon".                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Only the balance exists.                                                                   |
| L6  | **Sections with no data yet show the canvas's frame and an honest empty state:** Overview's "Waiting on you" is hidden while there are no proposals; "Its positions": "Flat. It opens positions once the Perpl runtime runs."; Decisions: "No decisions yet. Once it runs, every check lands here with what it did and why. Nothing here is edited after the fact."; Positions' Record: "Its record starts with its first closed position."; Posts: "No posts yet. Entries and exits will post on Pickler{ and X} when it trades." "Talk to it" is Soon, as in the draft studio. | The Soon rule and D19.                                                                     |
| L7  | **"Its markets" is real market data** for the agent's `config.perpl.markets`, read from the existing `GET /v1/marketplace/markets` and `/markets/:symbol`: mark, 24 h change, funding (the DTO's hourly rate, labelled "FUNDING · 1H"), and a sparkline of `trail`. When the answer's `source.venue` is not `"perpl"` (today's sample board, until PR #73) the card is tagged "SAMPLE DATA". A failed read shows "Couldn't read Perpl." with Retry.                                                                                                                              | Real where it exists; never passing a sample off as the venue.                             |
| L8  | **The brief of a published agent is edited and applied as a new version.** "Apply as v{n+1}" calls `PUT /setup` with `brief`; "Discard" resets the form. The note bar reads "BRIEF V{n} · LIVE" or "EDITS NOT APPLIED · IT STILL RUNS ON V{n} · APPLYING TAKES EFFECT FROM THE NEXT DECISION".                                                                                                                                                                                                                                                                                   | The canvas.                                                                                |
| L9  | **Versions are recorded from now on.** A new table `agents.setup_versions` gets one row per saved setup: the config version, a one-line summary built by core from what changed ("Exit 2 changed", "Thesis changed · entry 3 added", "Caps 25 / 100 / 3×", "Sources changed", "Voice · Hype"), and when. `GET /agents/:id/versions` lists the newest 20. A version from before this table has no row and is not invented.                                                                                                                                                        | The canvas's VERSIONS list; history cannot be derived for versions that never ran.         |
| L10 | **`PUT /agents/:id/setup` serves every Perpl agent, draft or public.** The draft-only gate (`NOT_A_DRAFT`, `requireDraft`) becomes "the config has `perpl`" (409 `NOT_A_PERPL_AGENT`). Core's `reviseDraft` is renamed `reviseSetup`.                                                                                                                                                                                                                                                                                                                                            | L8, and the same editor serves both studios.                                               |
| L11 | **Five caps.** PER TRADE, PER DAY and MAX LEVERAGE as today, plus OPEN AT ONCE (1–6, default 1) and DAY-LOSS STOP (5–200 AUSD in steps of 5, default 10), stored as `config.risk = { maxOpenPositions, dayLossStopAusd }`. They are saved, not signed (draft spec D11): tag "SAVED · 25/100/3/3/20" or "UNSAVED CHANGES", buttons "Save caps" and "Discard", line "Pickler holds every trade to these. On-chain caps come with live trading."                                                                                                                                    | The canvas's five rows; honesty about enforcement. The runtime will read the two new ones. |
| L12 | **How it enters is a saved setting:** `config.entry = { mode: "approve" \| "auto", meanwhile: "wait" \| "small", smallAusd }`, default approve / wait. The canvas's control and its three mode notes are drawn; the status note says "It is public on Pickler. It starts watching Perpl and its sources when the Perpl runtime opens; then it {asks you before entering \| goes in at N AUSD and asks you to size up \| enters on its own inside the caps}."                                                                                                                     | The owner sets it once; the runtime reads it later.                                        |
| L13 | **Stops card:** "Pause entries" real (no passkey); "Stop · close all" Soon; "Auto-pause" tagged "WITH THE RUNTIME" with "It will pause itself when it hits the day-loss stop, runs out of gas or credits, or loses Perpl for more than 2 minutes."                                                                                                                                                                                                                                                                                                                               | L4, D19.                                                                                   |
| L14 | **Meters are real zeros:** NEW MARGIN TODAY `0 / {perDay} AUSD`, OPEN POSITIONS `0 / {max}`, DAY-LOSS STOP `0 / −{stop} AUSD`, LEVERAGE IN USE `0× / {max}× max`.                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing has traded; zero is the fact.                                                      |
| L15 | **Health and warnings are computed from real reads:** Perpl market data (CONNECTED, SAMPLE DATA or UNREACHABLE, from L7's read); Sources "{n} ON"; Gas · MON with LOW under 0.2; AI credits "Soon"; Brief "v{n} · APPLIED" or "· UNAPPLIED EDITS". The banner lists what needs fixing — "MON FOR GAS IS LOW · {x} LEFT", "FREE AUSD BELOW ONE TRADE · IT CAN EXIT BUT NOT ENTER" — with "Fix it" opening Limits & controls.                                                                                                                                                      | Real, useful before the runtime exists.                                                    |
| L16 | **Sources & rules:** Perpl fixed, Web a switch with the same site editing as the draft; "X feeds" and "Open interest" rows shut and tagged Soon. IT MAY is read-only: Open positions (follows Pause entries), Close positions (always), Post calls (Soon), Reply on X (Soon), Move funds out (never). Saving is "Apply as v{n+1}".                                                                                                                                                                                                                                               | Only Perpl and Exa are plugins today.                                                      |
| L17 | **Identity & voice** is the draft's with the canvas's differences: the avatar is not editable, the handle reads "HANDLE IS FIXED · PUBLIC", voice says "from the next post", and a connected X account shows no Disconnect ("A public agent keeps its X account."). Connecting X later works.                                                                                                                                                                                                                                                                                    | The server refuses a public agent's disconnect.                                            |
| L18 | **Limits' wallet card:** AUSD · FREE (the balance), AUSD · IN POSITIONS (0), MON · GAS, arrivals, "Fund from master" and "Pull free AUSD back" (the Wallets modal on this wallet), and "ONLY YOU MOVE FUNDS · PASSKEY · IT IS FLAT, EVERYTHING IS FREE".                                                                                                                                                                                                                                                                                                                         | Real transfers exist.                                                                      |
| L19 | **No schedule control.** The canvas says "There is no schedule to set": a live Perpl agent is event-driven. The interval a draft saved stays in the config, unused.                                                                                                                                                                                                                                                                                                                                                                                                              | The canvas.                                                                                |
| L20 | **Master wallet and Trade** are the draft studio's, with "Fund {name}" opening the Wallets modal on the agent and the allocation rows of this canvas.                                                                                                                                                                                                                                                                                                                                                                                                                            | L2.                                                                                        |

## 3. User flows

1. **Go Public** (draft studio) → the live Overview. Header: avatar, name,
   `@HANDLE · PERPL · MONAD · PUBLIC SINCE {MON D} · DAY {n} · {SECTION}`, "Pause entries", and
   "Stop · close all" shut. Four stat tiles. The banner when something needs fixing.
2. **Overview**, two columns: Its positions (empty state); then the status card (the status note
   and two chips, the mode and the health, both opening Limits & controls), ITS MARKETS (L7), and
   Decisions (empty state, "All decisions" → Decisions).
3. **Positions:** Open (empty state) and Record (empty state, the six performance tiles hidden).
4. **Decisions:** the six filters with their counts (all zero), the empty state, and Talk to it.
5. **Posts:** "Every call, in public", `PICKLER ONLY` or `PICKLER + X · @HANDLE`; without X, the
   banner "Posting on Pickler only. Connect an X account and every call mirrors there." with
   "Connect X" → Identity; the empty state.
6. **Brief:** L8, four textareas with their tags, and VERSIONS (L9).
7. **Sources & rules:** L16.
8. **Limits & controls:** L18, L11, L13, L12 with L14's meters, and HEALTH (L15).
9. **Identity & voice:** L17. **Trade:** Soon panel. **Master wallet:** L20.
10. **Pause entries** flips the chip to "PAUSED · EXITS ONLY" and the button to "Resume"; a failure
    shows inline and changes nothing.

Saving follows the draft studio: buttons shut unless dirty and valid, "Saving…", a stale version
(409 `CONFLICT`) reloads and says "It changed somewhere else. Reloaded.", previews send nothing.

## 4. API

| Method | Path                             | Change                                                                                                                                                                                                                                    |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | `/v1/studio/agents/:id/setup`    | Any agent whose config has `perpl` (409 `NOT_A_PERPL_AGENT` otherwise). Body gains `caps.maxOpenPositions?`, `caps.dayLossStopAusd?` and `entry?: { mode, meanwhile, smallAusd }`. Writes a `setup_versions` row in the same transaction. |
| GET    | `/v1/studio/agents/:id/versions` | New. `{ versions: [{ version, summary, at }] }`, newest first, at most 20. Owner only; another owner's agent is 404 `NOT_FOUND`.                                                                                                          |

Everything else is existing: `PUT /pause`, `PUT /identity`, the X routes, `/wallets`,
`/wallets/ledger`, the transfer routes, `GET /v1/marketplace/markets` and `/markets/:symbol`.

`agentConfigSchema` (strict) gains `risk` and `entry`; a mirror test parses what core writes.

## 5. Data model

Migration `0026_setup_versions`:

```sql
CREATE TABLE agents.setup_versions (
  agent_id uuid NOT NULL REFERENCES agents.agents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version)
);
```

Config (`AgentConfig`, core and api-schema): `risk?: { maxOpenPositions: 1..6, dayLossStopAusd:
5..200 }` and `entry?: { mode: "approve" | "auto", meanwhile: "wait" | "small", smallAusd: 1..
spend.perCallAusd }`. Absent means the defaults of L11 and L12.

## 6. Integrations

None new. Market data comes through the marketplace routes, which PR #73 turns from the sample
board into Perpl's.

## 7. Design work

All drawn in `Pickler Studio v5 Live.dc.html`. Staged states (`?stage=`, never in production):
`perpl-live` (Overview), `perpl-paused`, `perpl-warnings`, `perpl-positions`, `perpl-decisions`,
`perpl-posts`, `perpl-brief`, `perpl-brief-dirty`, `perpl-sources`, `perpl-limits`,
`perpl-identity`, `perpl-trade`, `perpl-master`. Each is a design-harness route proving
`#live-section-<key>` (or the banner, the paused chip, the dirty note). Charts beyond the sparkline
(position and equity charts) come with the data they draw.

## 8. Security and abuse

- `PUT /setup` stays owner-only, versioned, bounded by core (`reviseSetup`); `entry.smallAusd`
  never exceeds the per-trade cap; a public agent's handle and X account cannot be changed here.
- Versions are written by the server from the stored configs, never from client text.
- The live studio adds no signing path: transfers use the existing passkey ceremony.

## 9. Acceptance criteria and tests

1. A published agent with `config.perpl` opens the live studio; a draft opens the draft studio; an
   agent without `config.perpl` opens the legacy one (pure model test of the choice).
2. `reviseSetup` keeps every earlier rule, bounds `risk` and `entry`, and what it writes parses
   through `agentConfigSchema` (mirror test).
3. `PUT /setup` on a public Perpl agent bumps the version, persists caps, risk and entry, and
   writes one `setup_versions` row whose summary names the change; on a non-Perpl agent it is 409
   and writes nothing (route and Postgres tests).
4. `GET /versions` lists only the caller's agent's versions, newest first.
5. Web models (rail, status, tiles, warnings, health, meters, mode notes, caps, markets view,
   version rows) are unit-tested; every staged state passes the design harness with 0 FAIL.
6. The draft studio's tests and staged states still pass after the shell is shared.

## 10. Rollout

Migration 0026 is additive and goes before the API. Nothing else to configure.

## 11. Out of scope, and the specs that follow

1. **Perpl paper runtime for studio agents** (`perpl-agent-runtime-v1.md`): the decisions feed,
   paper positions with their exits and charts, the record, real stats and meters.
2. **Approval flow and enforcement:** "Waiting on you" proposals, `entry` and `risk` enforced,
   auto-pause, owner notices.
3. **Posts:** on Pickler, mirrored to X (`go-public-v1.md` D7–D8).
4. **Live trading** (`perpl-live-v1.md`): "Close now · passkey", "Stop · close all", signed caps.
5. "Talk to it", AI credits, personal trading, X feeds and open-interest plugins.
