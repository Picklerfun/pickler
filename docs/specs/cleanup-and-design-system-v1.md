# Cleanup and one design system v1

Status: decided autonomously on 2026-09-29, at the owner's request ("clean the version and the junk
routes, and have a design system with no overridden tokens … the routes with the space one make no
sense any more"). The owner was away; every decision below names its reason so it can be reversed.
Evidence: `docs/specs/cleanup-inventory-2026-09-29.md`. Visual authority:
`docs/specs/design-system-v2.md`.

## 1. Goal

One design system, read from one place, and nothing in `apps/web` that the product no longer uses.
After this work:

- every colour, font family, radius and shadow in `apps/web` comes from a `--pk-*` token defined in
  `packages/ui/src/styles.css`, and a check fails the build when one does not;
- no screen draws the pre-v2 night sky, starfield or neon floor;
- every route is on the surface `design-system-v2.md` assigns it;
- dead classes, dead exports and unused adapters are gone.

Nothing here changes what the product does. No route is removed that a person can reach today.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                | Reason                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | "The space one" is the pre-v2 backdrop: the `.space` sky, the `.stars` starfield, and the neon floor grid. All three go, everywhere, including the floor on `/signin`, `/signup` and `/passkey`.                                                                                                                                                        | The owner said it makes no sense any more. The floor is the same pre-v2 drawing as the sky; keeping one third of it would leave the old look in place.            |
| D2  | `/agents`, `/agents/[handle]` and `/agents/[handle]/ask` move to the light marketplace surface. `PublicShell` loses its `surface` prop.                                                                                                                                                                                                                 | `design-system-v2.md` assigns the marketplace the light surface. These three are the only marketplace routes on dark, and only because of the backdrop.           |
| D3  | `/apply` becomes a plain studio-dark page: the dark ground, no backdrop.                                                                                                                                                                                                                                                                                | It is a studio route (`STUDIO_SEGMENTS`), and the studio is dark. No canvas draws a different `/apply`.                                                           |
| D4  | The alias layer goes. Un-prefixed variables (`--ink`, `--label`, `--body`, `--faint`, …) defined in feature CSS are replaced by the `--pk-*` token each one maps to.                                                                                                                                                                                    | A second naming set on top of the tokens is what "overridden tokens" looks like in practice: a module can redefine `--label` and nothing notices.                 |
| D5  | Legacy "carried forward" tokens in `styles.css` are replaced by their v2 token where one exists. A legacy token with no v2 equivalent stays, renamed only if its name is misleading, and is listed in the spec's appendix as part of the system.                                                                                                        | Deleting a token with no equivalent would change how screens look. This work does not redesign.                                                                   |
| D6  | Colour literals become tokens. Where a literal is an alpha of a token colour, it becomes a token defined once in `styles.css` (for example an edge or a veil), not `rgba()` in a module. JS palettes (`apply/lib/options.ts`, `lib/accent.ts`, chart fallbacks) read one shared module that mirrors the tokens and is pinned to `styles.css` by a test. | One place to change a colour. JS cannot read CSS variables at build time, so a pinned mirror is the honest form.                                                  |
| D7  | Spacing and font sizes stay as they are.                                                                                                                                                                                                                                                                                                                | There is no scale in the token file or the spec. Inventing one is a redesign, and "no overridden tokens" is about the tokens that exist. Recorded as a follow-up. |
| D8  | The studio keeps every rail section the Studio v5 and Studio Empty v4 canvases list. A section with no real content renders one shared "Soon" panel; the six separate stubs become that one component. `sections/brief.tsx` goes if `brief/` supersedes it.                                                                                             | The owner's earlier rule: what the product does not support yet is shown as "Soon", never faked and never hidden.                                                 |
| D9  | Preview fixtures and the `?stage=` / `?step=` / `?section=` doors stay.                                                                                                                                                                                                                                                                                 | They are off in production, and the design harness measures about thirty routes through them.                                                                     |
| D10 | The design harness gains a static source check and wider runtime checks, runs against its fixture API so no route is blocked, and becomes a `package.json` script and a CI job.                                                                                                                                                                         | Today gradients and shadows pass unmeasured, 13 routes are never visited, and nothing runs the checks automatically — which is how the backdrop survived.         |
| D11 | Unused `createSupabase*` data adapters and their tests go. The Mera/PRF signer adapter goes if only tests use it.                                                                                                                                                                                                                                       | The API moved its product data to Postgres; these have no caller.                                                                                                 |
| D12 | API routes with no web caller stay, listed in the inventory with their likely consumer.                                                                                                                                                                                                                                                                 | The agent HMAC API and the phone app are callers this repository cannot see. Removing a route is not reversible for them.                                         |
| D13 | Sample landing and market data stay.                                                                                                                                                                                                                                                                                                                    | The code marks them "Stays sample" on purpose; replacing them is product work.                                                                                    |

## 3. What changes

### 3.1 The backdrop (D1–D3)

- Remove `.space`, `.stars`, the floor grids, their keyframes, and the markup that draws them, from
  `PublicShell`, `ApplyShell` and the auth layout.
- Remove the tokens only they read (`--pk-space-*`, `--pk-space-veil*`, `--pk-glow-rim`). Any other
  reader moves to a v2 token first.
- Redraw the three `/agents` routes on the light surface with the components the other marketplace
  routes already use. Contrast is checked by the harness on every text element.
- Each affected route keeps its content, its links and its data.

### 3.2 Tokens (D4–D6)

- `packages/ui/src/styles.css` is the only file that may define a custom property whose name starts
  with `--pk-`, and the only file that may contain a colour literal.
- No CSS module defines a custom property that aliases a token (`--x: var(--pk-…)`). A module may
  define a custom property for a computed, local value that is not a colour (a width, a delay).
- A token that is read must be defined. `--pk-font-mono` is either defined or its reader moves to
  the token the spec names.
- The mapping from each alias, each legacy token and each literal to its token is a table in the
  inventory; the implementation follows it and the plan quotes it.

### 3.3 Dead code

- Unreferenced CSS classes and unused exports are removed, per the inventory. A class reached only
  by dynamic `styles[name]` access is kept and the inventory says why.
- An export used only by a test goes with its test, unless the test pins behaviour the product
  still has.

### 3.4 The harness (D10)

- **Static check** (`scripts/design/source.mjs`), over `apps/web/src` and `packages/ui/src`:
  - a colour literal (hex, `rgb`, `rgba`, `hsl`, `hsla`, named colours other than `transparent`,
    `currentColor`, `inherit`) outside `styles.css` fails;
  - a `--pk-*:` definition outside `styles.css` fails;
  - a custom property whose value is only `var(--pk-…)` fails;
  - a `var(--pk-…)` with no definition in `styles.css` fails;
  - hex strings in TS outside the one pinned mirror module fail.
- **Runtime checks** also read `background-image`, `box-shadow`, `filter: drop-shadow`, `outline`
  and SVG `fill`/`stroke`, and compare every colour they find with the token set of the element's
  surface.
- **Coverage:** the harness starts its fixture API and points the web at it, so the sample handles
  exist and the studio and account routes have a session. Zero blocked routes; `/passkey` is added.
- **Automation:** `npm run design:check` runs the static check and the runtime checks. CI runs the
  static check on every pull request. The runtime checks run in CI if a headless browser is
  available there without new paid services; otherwise they stay a local gate and the spec says so.
- **As built (2026-09-29):** `npm run design:source` and `npm run design:check` both pass
  `--strict`, so any static violation exits 1. The token check reads `background-image`,
  `box-shadow`, `text-shadow`, `filter`, a drawn `outline` and SVG `fill`/`stroke`, judged against
  the tokens of the nearest `[data-surface]`; it skips `[data-third-party-mark]`, `::before`,
  `::after` and canvas pixels. Every studio section has a route (60 in all). The `Design` workflow
  runs the static check and the harness unit tests on every pull request (job `source`), and
  `npm run design:check` with Playwright's Chromium installed on the GitHub runner (job
  `rendered`), which is free and needs no paid service. The `rendered` job had not yet run on
  GitHub when this was written. If it cannot render there for a reason in the runner rather than
  the tree, it becomes manual (`workflow_dispatch` only), `npm run design:check` becomes a local gate
  before each pull request, and this paragraph gives the reason.

### 3.5 Infrastructure (D11)

- Remove the unused adapters, their exports and their tests. `npm run build:workers` and the API
  tests prove nothing imported them.

## 4. Order of work

1. The static check, first, reporting every violation without failing. It is the measure of done.
2. The backdrop and the surfaces (3.1).
3. Aliases, then legacy tokens, then literals (3.2), module by module, largest first.
4. Dead classes and exports (3.3).
5. Studio stubs into one "Soon" panel (D8).
6. Harness coverage and runtime checks, then the static check set to fail, then CI (3.4).
7. Infrastructure leftovers (3.5).

Each step leaves every gate green and every measured route at 0 FAIL.

## 5. What done means

- `npm run design:check` exits 0 with zero blocked routes.
- The static check finds no violation.
- Screenshots of every route at 1400 px and 390 px, before and after, are compared. A route may
  differ only where this spec says it changes (3.1) or where a literal moved to its token's value.
- `build:shared`, `typecheck`, `lint`, `prettier --check .`, `npm test`, `build`, `check:staging`,
  `build:workers` and the contracts workflow all exit 0.

## 6. Not in this work

- A spacing or type scale (D7).
- Removing API routes (D12) or sample data (D13).
- The product hosts split (`product-hosts-v1.md`), including the studio host still defaulting to
  `app.pickler.fun` in `server/hosts.ts`.
- Go Public, forking a ranked agent, and the other follow-ups of `studio-brief-v1.md`.

## 7. Open to the owner

These were decided so the work could proceed. Say so and they change:

1. D1 removes the neon floor from the sign-in screens too.
2. D3 draws `/apply` on plain studio dark.
3. D7 leaves spacing and font sizes alone.

## 8. Amendments after the inventory

The inventory (`cleanup-inventory-2026-09-29.md`, commit 763ec44) contradicted parts of sections
2 and 3. Where they disagree, this section wins.

| #   | Finding                                                                                                                                                               | Decision                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `--pk-glow-rim` is read by the shared glow button, the auth primary button and the apply pixel, not only by the backdrop.                                             | It stays as a system token. Only `--pk-space-core`, `-mid` and `-edge` go with the backdrop markup.                                                                                                                           |
| A2  | `--pk-space-veil*` has live reads in `/apply`, and `--pk-space-edge-rgb` is read by `markets.module.css`.                                                             | Each reader moves to the v2 surface or edge token of its own surface; then the veil and edge tokens go. If a reader needs an alpha no v2 token has, one token is added to `styles.css` under a v2 name, never a `space` name. |
| A3  | 29 live literals are pre-v2 palette colours with no v2 base (`#F5F6FF`, `#5AD8FF`, `#F3F1EC`).                                                                        | Each becomes the v2 token that replaced that colour's role on its surface (ink, accent cyan, ink). This changes those pixels on purpose: the old palette is what is being removed. Section 5's comparison allows it.          |
| A4  | 7 carried-forward tokens have no single v2 equivalent (131 uses); `--pk-ink-dim` maps to a different token per surface.                                               | They stay, as D5 says, and are listed as part of the system. A token whose value depends on the surface is defined per surface in `styles.css` (`[data-surface]`), never in a module.                                         |
| A5  | `sections/brief.tsx` is live: it is the Brief row of an existing agent.                                                                                               | It stays. D8's "goes if superseded" does not apply. Unifying it with `brief/` is a follow-up.                                                                                                                                 |
| A6  | The empty studio's rail lists Console, Trades and Sources & rules, which have no section.                                                                             | One shared list of rail sections feeds both rails. A section with no screen is a "Soon" row in both, as the canvases draw them.                                                                                               |
| A7  | `/console` came in with main, nothing links to it, and both production hosts refuse it.                                                                               | The plan reads what it renders. If it duplicates the studio or is a leftover alias, it is removed with its files; if it holds work of main's that nothing else has, it stays and is listed for the owner.                     |
| A8  | `/tokens` now renders main's `LaunchBoard`; the harness proof is stale and the old token board's classes are orphaned.                                                | The harness proof is updated to the new screen; the orphaned classes go with the dead code.                                                                                                                                   |
| A9  | Three unused adapter files export schemas and a constant that live Postgres code imports.                                                                             | Those exports move to the module that uses them first; then the adapters go. `PasskeyUnusableError` goes with `fromViemAccount` if no production code imports it.                                                             |
| A10 | `?section=trading` is refused: trading renders inside `limits`.                                                                                                       | Unchanged here; listed as a follow-up.                                                                                                                                                                                        |
| A11 | `typecheck:design` is already wired through turbo and CI; the runtime checks and the harness unit tests are not. The fixture API is `scripts/design/fixture-api.mjs`. | Section 3.4 stands, with those paths.                                                                                                                                                                                         |

## Appendix: the tokens after this work

Decided in the implementation plan (`docs/superpowers/plans/2026-09-29-cleanup-design-system.md`),
where each call has its reason.

**Carried forward and kept (D5, A4).** They have no single v2 equivalent and are part of the
system under their own names: `--pk-ink-dim` (the muted ink on light, the soft ink on dark),
`--pk-border-strong`, `--pk-lime-edge`, `--pk-magenta-edge`, `--pk-amber-edge`, `--pk-cyan-edge`,
`--pk-violet-edge`. Each is defined twice in `packages/ui/src/styles.css`, once in the light block
(`[data-surface="light"], :root`) and once in `[data-surface="dark"]`, and nowhere else. A1 keeps
`--pk-glow-rim`, defined once on `:root`.

**Carried forward and removed (D5).** Each reader now reads the v2 token on the right.

| Removed                | Reads now               |
| ---------------------- | ----------------------- |
| `--pk-ink-placeholder` | `--pk-ink-faint`        |
| `--pk-surface`         | `--pk-panel`            |
| `--pk-surface-strong`  | `--pk-panel-2`          |
| `--pk-field`           | `--pk-panel`            |
| `--pk-field-autofill`  | `--pk-panel`            |
| `--pk-border`          | `--pk-rule-strong`      |
| `--pk-cyan`            | `--pk-blue`             |
| `--pk-cyan-ink`        | `--pk-state-cool-ink`   |
| `--pk-pink-ink`        | `--pk-magenta-ink`      |
| `--pk-lime-tint`       | `--pk-state-good-bg`    |
| `--pk-magenta-tint`    | `--pk-state-loss-bg`    |
| `--pk-amber-tint`      | `--pk-state-caution-bg` |
| `--pk-cyan-tint`       | `--pk-state-cool-bg`    |
| `--pk-violet-tint`     | `--pk-state-info-bg`    |

**Removed with the backdrop (D1, A2).** `--pk-space-core`, `--pk-space-mid`, `--pk-space-edge`,
`--pk-space-edge-rgb`, `--pk-space-veil`, `--pk-space-veil-strong`.

**Added (D6, A2).** Defined on `:root`, the same on both surfaces.

| Token                   | Value                       | For                                         |
| ----------------------- | --------------------------- | ------------------------------------------- |
| `--pk-lit-edge`         | `rgba(255, 255, 255, 0.22)` | the inset highlight along a raised top edge |
| `--pk-glow-lime`        | `rgba(200, 240, 58, 0.32)`  | a lime halo                                 |
| `--pk-glow-lime-strong` | `rgba(200, 240, 58, 0.5)`   | the same halo under the cursor              |
| `--pk-scrim`            | `rgba(11, 13, 26, 0.72)`    | what a dialog dims the page with            |

**Renamed.** `--tint-fg`, `--tint-bg` and `--tint-bd` are `--pk-tint-fg`, `--pk-tint-bg` and
`--pk-tint-bd`.

**Runtime checks in CI (3.4).** They run, in the `rendered` job of `.github/workflows/design.yml`,
with Playwright installed on the runner and not in `package.json`.
