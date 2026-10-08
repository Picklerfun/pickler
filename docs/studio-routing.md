# Studio route migration

Studio sidebar sections use real Next App Router pages. Publication, market selection, wallet
operations, strategies and HTTP contracts are unchanged. No migration or provider activation is
required for this web change.

## URLs and ownership

| Destination            | URL                                                                     |
| ---------------------- | ----------------------------------------------------------------------- |
| Studio entry           | `/` on the dedicated Studio host; `/studio` on shared development hosts |
| Create agent           | `/studio/new`                                                           |
| Selected agent section | `/studio/agents/<product-id>/<section>`                                 |
| Account                | `/account` with a sanitized local `returnTo`                            |
| Public agent           | Existing marketplace `/agents/<handle>`                                 |

Every draft, published and historical sidebar key has an explicit page file. The closed registry
in `features/studio/routing/routes.ts` is checked against the existing rail registries. Unknown
sections and invalid IDs are rejected. An agent requested by URL must exist in the authenticated
workspace list; missing or foreign IDs never fall back to another agent. Screen cookie guards
are not data authorization: the API still verifies the Supabase JWT and workspace ownership.

Old entry queries (`agent` and `resume`, plus existing development `section`) replace the browser
URL only after the authorized list is loaded. With no agents, entry opens creation. `stage`
fixtures remain development-only, including canonical route examples. OAuth returns keep the
existing root popup flow; Supabase sign-in/onboarding preserves sanitized local deep links.

## Layout and lifetime

The `(workspace)` layout retains the memory provider across Account/Studio navigation. Studio's
layout keeps the existing controller, shell, sidebar preference, dialogs and reads mounted across
section changes. Server pages choose the client outlet; interactive forms remain client components.
The active section is derived from the URL, so browser history, reload and deep links agree.
Next Link handles sidebar navigation and private prefetch is disabled. The existing top loader
indicates route loading; pending data uses Skeletons and explicit errors retain retry actions.

Form drafts are temporary, scoped by agent and section, and never stored in localStorage. Returning
from Account restores edits. Reload/tab close warns about dirty forms or pending writes. The agent
selector asks before discarding edits and rejects switching during a write. Direct browser history
between different agents keeps drafts separately scoped; it cannot apply one agent's form to another.
Signing out or changing users clears drafts and write outcomes and invalidates late completions.

Clean drafts follow refreshed configuration. Dirty drafts keep their original version. A change
on another screen/device does not overwrite them; a stale save offers **Discard edits and reload**.
Successful writes use the existing versioned API and duplicate save admission stays locked across
unmounts. No route change admits research, signs a wallet transaction or loads X posts. The single
paid X preview attempt also survives section and profile navigation; content is not retained here.

## Reproduction and evidence

Use Node 22.22+ and the committed npm lockfile, from the repository root:

```sh
npm ci
npm run build:shared
node --import tsx --test apps/web/test/*.test.ts scripts/design/*.test.mjs
npm run typecheck --workspace=@pickler/web
npm exec eslint -- apps/web/src scripts/design/studio-routing.mjs scripts/design/account-menu.mjs
npm run format:check
npm run check:architecture
npm run design:check
node scripts/design/studio-routing.mjs
node scripts/design/account-menu.mjs
node scripts/design/sidebar-motion.mjs
node scripts/design/studio-loading.mjs
npm run build:worker --workspace=@pickler/web
```

Browser scripts start dedicated local fixture servers when no `DESIGN_BASE_URL` is supplied. They
refuse remote targets. Run them sequentially so their ports and Next development build do not
conflict. These browser fixtures verify presentation/transport; they do not prove backend access.
Run the separate [compiled Studio acceptance](studio-acceptance.md) against its marker-verified
disposable Supabase stack for real Web → API → Queue → PostgreSQL coverage. The route assertions
in that suite use actual product IDs and no stage previews. No real providers or transfers run.

| Scenario                                                                  | Evidence                              | Status                                  |
| ------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| Every draft/live section, stable navbar/sidebar                           | Controlled routing browser regression | Validated locally                       |
| Reload, history and profile return with dirty Brief                       | Controlled routing browser regression | Validated locally                       |
| Explicit page registry, host/auth return, rejected destinations           | Web unit tests                        | Validated locally                       |
| Dirty-version conflicts, separate forms and logout clearing               | Memory-store regression tests         | Validated locally                       |
| Actual 409 recovery, foreign/missing IDs and anonymous deep-link return   | Compiled local route acceptance       | Validated locally                       |
| Actual creation, OAuth, publication and paper execution on canonical URLs | Compiled local product acceptance     | Validated locally; all four strategies  |
| Hosted auth, callback and browser route behavior                          | Deployed environment                  | Pending; no deployment in this delivery |

The additional `scripts/studio/routing.mjs` regression reuses a synthetic actor from a completed
full acceptance run. It verifies the database marker before using that actor, then drives the
compiled Web/API with real authentication and setup writes. It checks dirty form retention,
a genuine concurrent `409`, explicit discard, missing/foreign agents, unknown sections and the
anonymous deep-link guard. It performs no execution, X timeline request or transfer:

```sh
node scripts/studio/routing.mjs "$STUDIO_STACK" "$STUDIO_ACCEPTANCE_RUN"
```

`STUDIO_ACCEPTANCE_RUN` is the private run directory printed by the full acceptance command. Both
arguments must refer to the same dedicated disposable stack. The regression advances one synthetic
agent's setup version; it must never use a regular account or database.

Local acceptance on 2026-10-08 used main base `a677fc3fb1d3ba63384ca438897755cafe61d94d`,
controlled stack port 55532 and synthetic providers on 8798. The four-strategy run passed with
`rules`, `deepseek`, `jev` and `combined` at version 2.1.0. The final compiled route regression
passed against a real version conflict and a different creator's agent. Web/harness tests passed
986 cases; Design passed 124 routes, including all original 114 and ten canonical examples.
The private run evidence records timestamps, controlled configuration, financial oracle results
and requests. A private delivery manifest records the final Git commit and local check results.

The controlled test database and all generated credentials, browser captures and provider logs
stay outside Git. The original private fixture routes remain measured by Design; representative
canonical routes are measured in addition. A successful local run does not confirm deployment.

## Design measurement regressions

The profile-return regression waits for both the target URL and Brief form before opening the
account menu. Next navigation is asynchronous; checking the old menu during a pending transition
is not evidence of a wrong return destination.

Radix Select renders a native form shim before hydration. It is absolutely positioned with a
zero-area `clip` rectangle, but Chromium's `checkVisibility()` still returns true. The color probe
now excludes only positioned rectangles with no painted area. Partial clips and ignored clips on
static elements still reject non-token colors. The regression reproduces the false positive and
checks both rejection cases; it does not exempt Select, hidden accessibility nodes or any route
from color validation.
