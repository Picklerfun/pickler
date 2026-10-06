# UI package instructions

Read [the root instructions](../../AGENTS.md) first. Read the web app's local instructions when changing consumption there. Update this file when components, styling exports, or client boundaries change.

`@pickler/ui` contains product-independent React components and the control system both surfaces share. Current files are `src/brand.tsx`, `src/button.tsx`, `src/chart.tsx`, `src/chip.tsx`, `src/field.tsx`, `src/icon.tsx`, `src/meter.tsx`, `src/segmented.tsx`, `src/skeleton.tsx`, `src/tokens.ts`, `src/index.ts`, and `src/styles.css`. The package exports `BrandMark`, `Button`, `ButtonLink`, `CandleChart`, `BarChart`, `Chip`, `ChipLink`, `ChipText`, `Tag`, `Field`, `Input`, `Textarea`, `Icon`, `Meter`, `Segmented`, `Skeleton`, `TOKEN_MIRROR` (also as `@pickler/ui/tokens`) and the stylesheet `@pickler/ui/styles.css`. The web root layout imports `@pickler/ui/shadcn.css`, which includes that stylesheet. Other consumers may import the original stylesheet directly.

## The control system

One set of shapes, two surfaces. The public site and the creator studio share radii, control sizes and button variants; what changes is tone.

- **Shapes:** one scale, `mark` (4) · `sm` (12) · `md` (14) · `lg` (16) · `xl` (20) · `2xl` (24) · `3xl` (28) · `pill`. A step is a role, not a number: marks and dots take `mark`, chips and tiles `sm`, rail and menu rows `md`, stat tiles `lg`, cards `xl`, panels `2xl`, full-width sections `3xl`. Every action, chip and status is a pill. Nothing square. Feature stylesheets use these tokens rather than literal values.
- **Surfaces:** put `data-surface="light"` or `data-surface="dark"` on a wrapper. Light is white with near-black ink and is the default; dark is night blue (`#0B0D1A`) with navy panels and white ink. There is one dark and one light in the product, so a surface is not a page theme — nest the opposite value on any subtree and everything inside it inverts. That is how a light page carries a dark panel and a dark page a white card.
- **Type:** two faces. Archivo for titles and the lead figure of a view (a token price, a wallet balance), and it is only itself with its width axis set — anything in the display face carries `font-variation-settings: var(--pk-display-wdth)`, which `.pk-display`, `h1` and `h2` already do. Instrument Sans for everything else, including every control label; where a monospace used to carry a chip, a ticker or a small label, that is this face at 10–12px tracked 0.04em to 0.14em, and where it carried figures it is this face with `font-variant-numeric: tabular-nums`.
- **Buttons:** one `primary` per view, and never two filled buttons side by side — pair `primary` with `secondary`. `tile` is the rectangular action used in studio grids. Sizes are `sm`, `md` and `lg`; `mono` switches the label to uppercase mono for navigation and utility actions.
- **Icons:** `Icon` wraps a curated set from `lucide-react`, which matches what the canvases drew by hand: a 24×24 grid, round joins and one stroke weight (1.9 here). Colour comes from `currentColor`, and `label` is required whenever the icon is the only content of a control. Add a name to `src/icon.tsx` rather than importing from `lucide-react` inside a feature — that is how two screens end up with two different arrows.
- **Colour:** every colour, the ink ramp, the hairlines and the three faces are declared once in `src/styles.css`, per surface, and it is the only file that may hold a colour literal or define a `--pk-*` property. Its own rules read tokens too: a literal is allowed inside a token's definition and nowhere else. Feature stylesheets read the tokens by name (`var(--pk-ink)`); they define no alias of one and hold no literal. `src/tokens.ts` holds the five values code must hold as values (Next's `themeColor`, the chart's fallbacks), keyed by token name and pinned to `styles.css` by `scripts/design/mirror.test.mjs`. `src/brand.tsx` holds a third party's logo colours, which are not tokens and carry `data-third-party-mark` so the runtime token check skips them; the static check refuses that attribute in any file not listed in `MARKS` (`scripts/design/source.mjs`), because everything under it goes unmeasured. Seven tokens carried forward from before v2 stay part of the system under their own names, defined once per surface in the light block (`[data-surface="light"], :root`) and the `[data-surface="dark"]` block of `src/styles.css`: `--pk-ink-dim` (`--pk-ink-muted` on light, `--pk-ink-soft` on dark), `--pk-border-strong` (a control's edge), and `--pk-lime-edge`, `--pk-magenta-edge`, `--pk-amber-edge`, `--pk-cyan-edge`, `--pk-violet-edge` (the edge of a tinted object, one per state). `npm run design:source` enforces all of it.
- **Panel:** the surface content sits on — one border, one radius, one translucent ground — lives as `.pk-panel` in the stylesheet. A feature sheet takes it with `composes: pk-panel from global` and keeps only its own difference (a blur, a lit top edge, its padding), rather than declaring the border and the radius again.
- **Fields:** `Field` is the frame — a mono micro label, the control, and one line under it that carries a hint or an error through `tone`. `Input` and `Textarea` are the controls; `prefix` puts a fixed mark inside the frame, like the @ before a handle, so the two read as one. A field lights on focus in `--pk-focus`, which is violet on the light surface and lime on the dark one. `shape="pill"` is for a search box sitting in a row of filters.
- **Chips:** one object, three renderings. `Chip` presses (a filter, a copy action), `ChipLink` navigates (a contract, an X handle, an agent's page), `ChipText` only reads (a market cap, a venue). `Tag` is the louder cousin for a status the eye should catch first.
- **Segmented:** `disabled` shuts every option while what the choice belongs to is busy. Each option carries `data-value`, so a feature can tint one of them differently — Ask violet and Trade lime inside one track — without counting children in CSS. `Segmented` is the exclusive choice always on screen — buy or sell, grid or table. `tone="lime"` is for taking a side, `ink` for a view of the same data. A filter that can be off is a `Chip`; an action that does something is a `Button`.
- **Meter:** `Meter` is the filled track — graduation progress, a reputation score, a trait. Tone says what the figure beside it already says: `lime` for landed or graduated, `amber` for on its way, `magenta` for against, `cyan` for neutral. It is announced only with a `label`; without one it is decoration repeating a number that is already written.
- **Charts:** `CandleChart` and `BarChart` wrap [lightweight-charts](https://github.com/tradingview/lightweight-charts). Features pass data — candles or bars, each bucket timestamped in milliseconds — and the look is decided in `src/chart.tsx`, which reads `--pk-ink-faint`, `--pk-rule-strong`, `--pk-win`, `--pk-loss` and `--pk-font` from the surrounding surface, so a chart follows `data-surface` like everything else. Do not call `createChart` in a feature; add an option or a series type here instead. The library's in-panel logo is turned off (`layout.attributionLogo: false`), which its Apache-2.0 notice allows as long as the credit and a link to <https://www.tradingview.com/> live on the page — `PublicShell` carries them in its footer on the routes that pass `charts`, which is the two that mount one — so a page that adds a chart adds that prop, and a page that does not must not claim a credit it never earned.
- **Deltas:** a feature that needs a control to differ passes `className` and keeps only the difference — padding, a glow, a colour the canvas asks for. A variant rule here is `.pk-button[data-variant=…]`, which outweighs a single class, so a delta that must win is scoped (`.page .walletButton`). A feature never re-declares shape, type or state.
- New controls use these components, and the app is expected to have no hand-rolled button, chip, track or bar left. What is deliberately not here: the carousel dots, which are a position indicator rather than a control; the nav scrim, which is an invisible click-away; and the underlined tabs, which have one consumer today — the agent profile. Tabs move here when a second surface needs them, and not before. Feature stylesheets may keep their own layout, but not their own shapes.

- Keep components independent of Next.js, core, infrastructure, authentication, wallets, and provider services.
- Preserve native HTML semantics and prop types. `Button` defaults to `type="button"` and accepts native button props; form submission must use an explicit submit type.
- Preserve keyboard behavior, focus visibility, disabled semantics, and accessible names.
- Keep components server-compatible when possible. Add `"use client"` only to modules requiring client hooks or interactivity; do not mark the entire library client-only.
- Keep shared component styling here with scoped class names such as `pk-button`. Product layouts and feature-specific styles stay in the app.
- Pass behavior through props rather than embedding network calls. Keep product-specific forms and wallet flows in the consuming app.
- Expose public components deliberately; do not require consumers to import internal source paths.

From the root: `npm run typecheck --workspace=@pickler/ui` and `npm run lint`. Run `npm run build` for export or rendering-boundary changes; check the consuming page visually and with keyboard interaction for UI behavior changes. No standalone UI test suite or component explorer exists yet.

## Loading placeholders

`Skeleton` is a server-compatible decorative span with line, title, avatar, button and panel
shapes. It uses the surface rule token and carries no visible loading copy or animation. Consumers
provide a labelled `role="status"` region and `aria-busy`, and own geometry matching their content.
Never replace errors, unknown balances or passkey authorization prompts with indefinite skeletons.

`Icon` includes `sidebar` (PanelLeft) for a labelled sidebar disclosure. Keep the control visible
in both expanded and collapsed states; its accessible name and expanded state belong to its host.

`Icon` includes `chevronsUpDown` for a workspace selector, showing both directions together.

## shadcn Sidebar and menus

`src/components/` contains official shadcn new-york/Radix source installed with the registry CLI.
`components.json` is the reproducible registry configuration. Public subpaths `@pickler/ui/sidebar`
and `@pickler/ui/dropdown-menu` export the composable components; `./components/*` and `./hooks/*`
resolve their internal dependencies for CLI additions. Existing product Button/Input/Skeleton
exports are unchanged. The registry's supporting controls remain inside its component area.

The initial Sidebar/DropdownMenu installation used shadcn CLI 4.21.3:
`npx shadcn@4.21.3 add @shadcn/sidebar @shadcn/dropdown-menu --yes --cwd packages/ui`.
The installed dependency versions are frozen by the root lockfile.

Add components with `npx shadcn@latest add @shadcn/<name> --cwd packages/ui`; inspect `--dry-run`
and `--diff` before updating an installed component. Never blindly overwrite the local changes.
Record integration changes here. Read the official Sidebar and DropdownMenu docs before extending
composition. Prefer shared components over local event listeners or duplicate navigation code.

The generated Sidebar owns state, gap/container transitions, mobile Sheet, shortcut and tooltips.
Local adaptations: package-relative internal imports; keyboard guard for editable targets/repeat;
external-store mobile breakpoint (768px) to avoid a hydration setState effect; deterministic
skeleton width; mobile props forwarded to SheetContent; host surface and explicit modal semantics forwarded to the portal;
mobile close restores focus to its associated `[data-sidebar-toggle]` (SidebarProvider uses a
custom global-header trigger). Sidebar tooltips mount only for collapsed desktop navigation,
so hidden mobile/expanded tooltips cannot consume Escape before the Sheet. Dropdown checkbox props omit unknown `checked` for exact optional
types. An exiting dropdown does not restore focus over another newly opened dropdown. These adaptations do not add a second sidebar state machine.

Tailwind utilities use `tw:` and omit preflight. `src/shadcn.css` imports the utility/theme and
animation packages plus the existing stylesheet. Only `styles.css` defines semantic color, radius
and shadow mappings to the existing `--pk-*` roles. Portal callers explicitly pass their surface;
TooltipContent accepts `surface`, Sidebar passes it to the mobile Sheet, and DropdownMenuContent
accepts `data-surface`. Do not inject raw palette values or allow portals to inherit the body's
wrong surface. Component palette classes (including scrim, focus and destructive roles) use
those semantic mappings; disabled menu copy retains full opacity for contrast. Reduced-motion rules cover all installed navigation/overlay slots.

Controlled browser coverage in `scripts/design/account-menu.mjs` verifies desktop collapse,
preference persistence, mobile dialog focus/dismissal, agent switching, paired chevrons, account
menus and safe profile return. Run web/UI types, lint, format, design source/rendered checks and a
web build after changing these components or their CSS toolchain.
