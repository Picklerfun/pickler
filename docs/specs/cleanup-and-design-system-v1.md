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
