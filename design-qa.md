# Public token market mockup — design QA

final result: passed

## Findings

No actionable P0, P1 or P2 findings remain in the local UI scope. This is a visual prototype with explicitly simulated data, not financial or remote transaction acceptance.

## Visual truth and evidence

- Source: `/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-1953694f-624b-45b8-94ae-9179928b1ad9.png`.
- Implementation: `http://localhost:3005/agents/halftime?stage=token-launched&market=preview`.
- Full page context: `/private/tmp/pickler-token-market-desktop-final-top.jpg`.
- Desktop comparison: `/private/tmp/pickler-token-market-desktop-final.jpg`.
- Complete market section: `/private/tmp/pickler-token-market-complete.jpg`.
- Mobile chart and ticket: `/private/tmp/pickler-token-market-mobile-320-final.jpg`.
- Mobile ticket, curve and distribution: `/private/tmp/pickler-token-market-mobile-lower.jpg`.

Source and desktop comparison are both 1487 × 1058 pixels. The browser viewport was 1487 × 1058 CSS pixels with native 1:1 screenshot output; no density resampling was needed. The complete market capture uses 1487 × 1280 CSS pixels and matching output pixels. Mobile captures use 320 × 890 CSS pixels and matching output pixels. Tablet layout was also inspected at 779 × 890.

State: light surface, anonymous local fixture, launched token, 24H chart, Buy, amount 100, slippage 0.5%, curve explanation collapsed for the final desktop capture. The lower mobile evidence intentionally includes the expanded explanation.

The source and rendered desktop screenshot were opened together in the same comparison input. Full-view comparison covered hierarchy, chart/trade proportions and curve/distribution placement. The second desktop capture brings the market to the top of the content region for a readable focused inspection of metrics, controls, chart, progress and table. Mobile captures separately cover the upper and lower regions at native scale.

## Intentional differences

- Retain the responsive agent header already approved by the user. Its height and layout differ from the older header in the source image.
- Use the existing Halftime fixture, frozen avatar and HALF ticker instead of copying the production agent's identity. Its address is explicitly simulated and has no explorer link.
- Normalize ticker prefixes and show token identity and network once within the market section. Remove the repeated ticker from the trade title and the duplicated total supply from the FDV caption.
- Use the repository's typography, radii, colors and controls rather than approximating raster-generated styles with new tokens.
- Keep a coherent static price history for the displayed period change. The source's apparent 24-hour rise does not match its displayed 12.4% change.
- The CTA is Preview buy/sell. It reviews the UI example without connecting a wallet or sending transactions. Arbitrary inputs show Not quoted rather than an invented financial estimate.
- Group recent token trades with the token section, above agent activity tabs, to avoid confusing those separate activities.

## Comparison history

1. Initial desktop comparison found P2 gradient drift: the area fill looked gray instead of fading from green into the white chart surface. Evidence: `/private/tmp/pickler-token-market-desktop-first.jpg`. Fixed the AreaSeries bottom color to the surface background token. The revised desktop capture and final comparison show the intended green fade.
2. Initial comparison found P2 density drift in the trade ticket: excessive spacing, a repeated demo notice and a gray input weakened the compact two-column composition. Reduced the ticket gap, used a 240px chart, removed the redundant notice and set the input to the white surface token. Evidence: `/private/tmp/pickler-token-market-desktop-revised.jpg` and final desktop comparison.
3. Mobile inspection found P2 range drift: shrinking the chart exposed only the final hours of the selected 24H period. Enabled `lockVisibleTimeRangeOnResize` in the shared area chart. Evidence before: `/private/tmp/pickler-token-market-mobile-320.jpg`; after: `/private/tmp/pickler-token-market-mobile-320-final.jpg`. The full selected period is now retained.
4. Post-fix desktop comparison found no remaining actionable P0/P1/P2 differences. The complete market capture confirms curve figures, distribution, recent trades and spaced agent tabs.

## Required fidelity surfaces

- **Typography:** existing Archivo/Instrument Sans families and product optical weights are retained. Numeric metrics use tabular figures. Desktop hierarchy is distinct; mobile labels, ticker, price and units wrap without clipping.
- **Spacing and layout:** aligned 2:1 chart/trade grid, three metric columns, consistent section gaps and existing radii. Below 900px the trade ticket stacks. Below 540px the price spans the first metric row and distribution stacks. At 320px there is no document overflow; only the intentionally bounded trades table scrolls horizontally.
- **Colors and tokens:** white chart and input, light panel frame, lime selected controls/progress, green gains and amber preview badge use the existing surface tokens. Static and rendered Design checks passed, including contrast.
- **Assets:** existing product logo, icons and frozen token avatar are reused. No source asset was substituted with a new handcrafted drawing. The chart is the existing charting library's data visualization, not an image approximation.
- **Copy:** AUSD units are explicit; FDV has an explanation. Static examples are marked PREVIEW · DEMO DATA, Illustrative quote and Illustrative activity. Fixed supply, 80/20 distribution, no creator allocation and gas in MON are present without duplicate summaries.

## Interactions and verification

Verified 1H/24H/7D selection, period change and chart updates; Buy/Sell; independent input values; slippage selection; empty input disabling the preview action; arbitrary input showing Not quoted; inline demo review feedback; and curve explanation expansion/collapse. The table is keyboard-focusable for horizontal scrolling. Console error check returned an empty list.

Affected UI/web types, lint, formatting, architecture, production web build and static/rendered Design checks passed. The existing controlled public trading suite also passed after isolating the mockup behind `market=preview`. Existing token previews and real public trading remain unchanged. Production rejects the fixture route and the mockup component independently returns null in production.

## Open questions and follow-up polish

None block this local UI handoff. Live market history, volume, curve state and trade estimates remain a subsequent integration task; these static examples must not be exposed as live values. Chart tick placement is library-controlled and differs slightly from the raster source.

## Implementation checklist

- [x] Implement the token market mockup and preserve the approved agent header.
- [x] Remove unnecessary repeated identity, supply and network labels.
- [x] Verify mobile, tablet and desktop layout and controls.
- [x] Compare revised visual evidence against the approved source.
- [x] Preserve the existing controlled and real trade flows.
- [x] Keep the preview local and perform no deployment during UI validation.

## Follow-up: trade badges and transaction references

The user requested read-only Buy/Sell badges and a clickable transaction hash in Recent trades.
Rows now reuse `Tag` with win/loss state tints and `ChainReference` for the hash link and icon-only
copy feedback. The new Transaction column is explicitly labelled as a sample in this local
mockup. Its hashes come from the real recorded Monad testnet V4 acceptance; the displayed times
and quantities remain illustrative and do not describe Halftime's history.

Desktop evidence: `/private/tmp/pickler-token-recent-trade-badges.jpg` (1487 × 890 pixels, native
1:1). The full table shows contrasting green/pink pills, aligned numeric columns, hash links and
copy icons. A separate fresh 320 × 890 viewport measured document width 320, bounded table viewport
242 and table content width 660; the extra column does not widen the document. The mobile
viewport capture is `/private/tmp/pickler-token-recent-trade-badges-mobile.jpg` and shows the
unchanged responsive upper market region rather than the table.

Clicking the first hash opened the exact MonadScan testnet transaction in a new tab with Success
and block 69860919. The copy control changed to its Copied label/check icon. No signature or
transaction was requested. A fresh preview tab reported no console errors; the previous tab had
only the earlier development CSS hot-reload messages while edits were being applied.

Affected web types, lint, formatting and static/rendered Design checks passed. The existing
approved mockup layout remains intact. This follow-up has no actionable P0/P1/P2 findings.

## Agent directory implementation — October 11, 2026

**Final result: passed.** The user selected the compact comparison list, then explicitly rejected
the token-ticker revision. No token fields were added to `/agents`.

### Target and normalized evidence

Source: `/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-bfb64730-1470-484c-8a9e-82de7df6bb13.png`
(1173 × 1341 pixels). The source was normalized to 857 × 979 for comparison with a screenshot
captured at the same CSS viewport at density 1. The source and implementation were opened together
in `/private/tmp/pickler-agents-comparison-final.jpg`; the focused comparison is
`/private/tmp/pickler-agents-comparison-focus.jpg`. Both explicitly compare the first two Crypto
agents. The actual route defaults to all nine fixture agents, with availability filtering off,
preserving the existing product behavior. Crypto and Taking questions were selected for comparison.

Additional evidence: `/private/tmp/pickler-agents-mobile-320.jpg`,
`/private/tmp/pickler-agents-tablet-632.jpg` and
`/private/tmp/pickler-agents-desktop-1280.jpg`. The latter two captures include a scrolled list;
the final 857px comparison starts at the top of the page. Read-only browser measurements confirmed
document width equalled viewport width at 320, 632 and 1280 pixels.

### Iterations

1. Initial comparison found P2 avatar/typography drift: 40px avatars and small Ask labels weakened
   the identity and action hierarchy. Reused the existing 62px avatar variant, increased the title
   and metric scale, set an explicit 44px Ask target and kept response time directly beneath it.
   Also increased heading/filter spacing to recover the reference's rhythm. Initial evidence:
   `/private/tmp/pickler-agents-comparison-first.jpg`.
2. Revised inspection found P2 numeric wrapping at 857px: `+$1,580` split across two lines after
   increasing metric size. Expanded the shared P&L track in both the header and each record. Added
   spacing between the search icon and text. The final full and focused comparisons show intact
   numbers, aligned columns and compact one-line descriptions.
3. Post-fix mobile inspection confirmed labels remain visible and Ask/reply time stack together.
   There are no remaining actionable P0/P1/P2 findings.

### Required fidelity surfaces

- **Typography:** use existing Archivo and Instrument Sans tokens, tabular financial figures,
  bold names and scores, and a quieter category/description. Full API descriptions are retained
  and clipped visually to one line; they are not replaced by invented summaries.
- **Layout:** one compact toolbar and comparison header replace the old large filter card and
  individual cards. Rows share grid tracks and dividers. Below 760px metrics move below identity;
  below 480px Ask follows metrics. No duplicate Profile button or response-time column.
- **Colors:** use existing white/panel surfaces, good/caution/loss score washes, legible blue
  hit rates, green/red P&L and violet Ask. The reference's generated gradients and brighter shades
  are intentionally replaced by the existing product tokens. Design token/contrast checks passed.
- **Assets:** existing Pickler brand and curated icons are reused. Text initials are the existing
  agent avatar, matching the reference. No new raster artwork or handcrafted icon was required.
- **Copy:** exact page subtitle is retained. The result count is derived from filtered data rather
  than labelling production data Demo. Closed services show Not taking questions without an Ask
  action or promised reply time. Names and destinations remain sourced from directory DTOs.

### Interaction and regression evidence

Verified topic selection, keyboard opening of the Select, Space activation of the Switch, open-only
filtering, closed-agent state, filter-only empty state, search-empty recovery through Browse all,
and `?q=` synchronization. The profile link opened `/agents/unlockwatch`. No auth, wallet signatures,
provider calls or transactions were performed. The shared Select keeps Radix keyboard/focus
behavior; its new pill variant is opt-in and existing form triggers remain boxed.

UI/web type checks, affected ESLint, Prettier, architecture, production web build and strict Design
source passed. Rendered Design passed for `agents`, `agent-profile` and
`public-agent-token-market-preview`: surfaces, tokens, contrast and type. The full global rendered
run was stopped and narrowed to those affected routes; no claim is made that every route was tested.

### Accepted differences and remaining work

The existing navbar/footer were preserved; their dimensions differ slightly from the generated
source. Existing product icons use an external-link glyph instead of the raster arrow. These are
P3 differences, consistent with the shared design system. No functional or visual blocker remains.
QA was performed locally before PR submission. No deployment was performed; live token-market data remains outside this UI delivery.

- [x] Implement the selected design without token data.
- [x] Preserve actual records, search behavior and destinations.
- [x] Verify desktop, tablet, mobile and keyboard interactions.
- [x] Compare source and final rendered evidence together, including a focused comparison.
- [x] Keep the previous token-market preview and unrelated local work intact.

Fresh-load console verification returned no errors. Earlier errors in the long-lived tab were
Turbopack CSS hot-reload messages recorded during editing, not errors from a clean load. The final
normal-width default-state screenshot is `/private/tmp/pickler-agents-preview.jpg` (1280px).

## Compact token markets and chart interactions — October 12, 2026

final result: passed

No actionable P0, P1 or P2 findings remain in this local UI scope. Public rollout is not claimed.
The existing trade, signing and receipt flow is preserved.

### Visual target and evidence

The selected direction is mockup 2:
`/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-c06eaa87-e11f-4b6d-9310-041074471d4f.png`.
The requested refinement reference is
`/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-b20c9136-6837-4fbd-8b4d-428e8f747dd1.png`
(1058 × 1487 pixels).

Interactive outputs:

- `http://localhost:3005/?tokens=preview#tokens`
- `http://localhost:3005/agents/halftime?stage=token-launched`

Source and rendered output were inspected together in
`/private/tmp/pickler-market-design-comparison.jpg`. The comparison normalizes the reference and
implementation into side-by-side component regions. It includes the table, chart, hover tooltip,
trade ticket, curve and supply summary. Browser chrome, surrounding landing content and different
fixture counts are excluded from the component-level density comparison.

Native desktop evidence is `/private/tmp/pickler-market-chart-final.png` (1440 × 1000).
The table focus is `/private/tmp/pickler-market-board-desktop-region.png` (1400 × 1150, cropped from
an unmodified full-page screenshot). Full-page desktop and 390px mobile captures are in
`/private/tmp/pickler-market-final-shots/` and `/private/tmp/pickler-market-final-detail-shots/`.
Those screenshots use density 1. Interactive browser inspection covered 1440 × 1000 and
390 × 844; the controlled production-component suite additionally checked 320, 380, 632, 779 and
1280px widths. No document overflow was found. Recent trades intentionally retain an accessible
horizontal table scroller on narrow screens.

Compared state: light surface, anonymous, launched fixture, 24H selected, Buy, amount 1,
0.5% slippage and collapsed curve explanation. The hovered observation displays its actual UTC
time and value. The preview uses one core-generated Halftime market with four observations,
instead of three fabricated listings or the production agent identity. Different prices, quantities,
row count and the sell-driven final decrease are intentional data differences. Normal public reads
use the existing canonical API, never preview values. The older illustrative `market=preview`
route also uses the refined shared chart, remains labelled and is refused in production.

### Fidelity review and corrections

- Typography: repository Archivo display and shared UI fonts retain the target hierarchy. Prices
  and valuations use tabular figures. Compact headers and captions stay readable; long identities
  wrap without displacing the trade action.
- Spacing: the table aligns comparison columns; the detail keeps the chart/trade 2:1 layout and
  stacks on mobile. Plot framing was corrected after an initial sparse-data capture showed large
  lateral margins. The anchor now reserves space for sticky navigation on fresh navigation.
- Colors: all surfaces, grid, tooltip, semantic colors and fills come from the surrounding `--pk-*`
  tokens. Static and rendered token/contrast checks passed. The faint area fill preserves readable
  axes and leaves the trade action as the main lime emphasis.
- Assets: existing Pickler logo, frozen AgentAvatar and shared icon components are preserved.
  There are no new raster illustrations or approximations of a reference asset. The chart is a
  data visualization drawn by the existing Lightweight Charts dependency.
- Copy: financial values remain prepared API/core values. Curved rendering is visual interpolation,
  while tooltip inspection reports only supplied observations. No fake activity, return promise,
  dollar conversion or additional price samples were introduced. Missing metrics are distinct from
  zero and retain navigation/retry.

The tooltip was checked for pointer and keyboard use, containment, UTC time and Escape dismissal.
A development hot-reload mismatch while changing the chart model was resolved by a fresh load;
subsequent cold-load interaction checks recorded no page errors. Keyboard crosshair updates now
explicitly update the tooltip because the chart library does not emit a hover event for that call.

### Interaction and motion acceptance

The persistent chart instance survives unchanged parent renders. Curved lines fill the usable plot;
range/data changes reveal smoothly; hover uses a bounded tooltip and observation marker. The
latest-price pulse is triggered by data updates only. Market panels, rows, trade arrows and curve
fills use short transitions. Reduced motion disables reveal, panel entrances and continuous chart
pulse. Generic AreaChart preserves its earlier straight-line and pan/scale behavior.

The controlled browser suite passed pointer hover, keyboard inspection, range changes, actual
transaction references, 320–1280px layout, loading, pending, malformed data, failure/retry, form
preservation and reduced motion. It rejected external providers and sent no transactions.

Validation passed: production Web build, Web/UI types, affected lint, formatting, static Design,
rendered surfaces/tokens/contrast/type, affected existing tests (24) and the controlled public market
suite. Screenshot assertions cover both illustrative and core-backed local previews.

### Remaining scope and checklist

- [x] Compact public market board and real-value sparklines.
- [x] Curved, full-width chart with bounded pointer/keyboard inspection.
- [x] Responsive layout, contrast and reduced-motion handling.
- [x] Preserve the existing trade button and approval/trade receipts.
- [x] Compile and validate locally without provider transactions.
- [ ] User review of the interactive preview, then PR delivery when requested.

P3, accepted: the reference contains three sample markets; the deterministic preview intentionally
shows the single existing core-backed market. More confirmed listings populate the same table.
No push, merge or deployment was performed for this refinement.

## October 12, 2026 — Compact token list on the landing

final result: passed

The user clarified that the selected mockup's token list belongs on the landing. The previous
narrow-screen card transformation is removed: the existing public board now preserves compact
comparison rows across breakpoints. The network/quote badge sits beside the heading once; each
row aligns the token, observed-price sparkline, FDV, 24-hour curve volume, supply progress and
profile action. Public reads and the labelled local preview share this implementation.

Reference and rendered output were inspected together in
`/private/tmp/pickler-landing-compact-comparison.jpg`. The reference is the upper token-list region
of `exec-b20c9136-6837-4fbd-8b4d-428e8f747dd1.png`; the implementation region is an actual 1400px
browser capture. The three illustrative reference rows and one core-backed preview row remain an
intentional data difference. Existing logo, token avatars, UI icons, fonts and color tokens are
preserved. The chart still interpolates only supplied observations, with no fabricated activity.

Interactive inspection covered 320, 390, 692 and 1400px widths. Rows measured 84.5px at the compact
breakpoint and 96px on desktop. Below the table's 640px minimum width, only the labelled region
scrolls horizontally; the token column remains fixed. Native keyboard scrolling reached the final
curve/action columns, while the identity stayed at x=19px. Settled document widths matched each
viewport. Pointer hover highlights the row and its arrow, and reduced-motion overrides remain.

P2 issues found during this pass were fixed before handoff:

- Outer table sizing leaked into the chart library's internal table, hiding its canvas. Selectors
  now target the board table and direct row cells only.
- The hidden action-column label escaped its clipping container on small screens. The board now
  establishes the positioning context; mobile document overflow is gone.
- Chart canvas layers overlapped the sticky token identity during horizontal scrolling. The
  sparkline now establishes its own stacking context below the fixed column.

Evidence: `/private/tmp/pickler-landing-token-list-compact.png` is the settled 692px landing view;
`/private/tmp/pickler-landing-token-list-desktop-hover.png` shows the desktop hover state.
Automated desktop/phone screenshots are in `/private/tmp/pickler-landing-compact-verified-shots/`.
Static Design, rendered tokens/contrast/type, Web types and scoped landing lint passed. This
correction does not alter launch confirmation, quotes, approvals, transaction submission or
receipt handling. No push, merge or deployment was performed.

### Follow-up — Remove column dividers

final result: passed

The user requested removal of the landing board's vertical separators. The header/cell
border-left rule is removed; column widths, spacing, row separation and interactions remain.
Native inspection at 802px confirms all twelve outer table cells have a zero left-border width
and the document stays within the viewport. Screenshot:
`/private/tmp/pickler-landing-token-list-without-dividers.png`.
Formatting, static Design and whitespace checks passed. This explicit user refinement supersedes
those separators in the original image reference; no data or transaction behavior changed.

### Follow-up — Observed price movement indicators

final result: passed

The landing comparison rows now show an arrow and percentage badge for the last observed price
move. Gains use the existing green state pair; losses use the existing red state pair. The
sparkline follows the same prepared direction. The selected compact list, row alignment, sticky
identity and absence of vertical dividers remain intact. The tooltip and accessible label identify
the actual compared observations; this is not presented as a 24-hour return.

Core computes the signed basis-point change using integer arithmetic. Infrastructure prepares it
from the existing canonical snapshot and excludes orphaned evidence. The optional DTO field keeps
older responses compatible. Insufficient observations show no badge; tiny moves retain their
true direction with a less-than-0.01% label. No fabricated listings, trades or percentages are added.
The deterministic Halftime snapshot ends with a sell and displays a red downward -5.51% badge.

The browser preview was inspected at 320, 390 and its normal 1280px width. Settled document widths
match their viewports, and the price badge remains legible within the horizontal table region.
The loss foreground/background are the surface's existing design tokens. Chart recoloring updates
the persistent series without remounting or resetting inspection. Existing animation and reduced
motion behavior remain unchanged.

Evidence: `/private/tmp/pickler-price-movement-landing.png`; automated desktop/phone captures are in
`/private/tmp/pickler-market-movement-shots/`. Validation passed: ten arithmetic/canonical isolated
PostgreSQL tests, shared builds, Web/UI types, affected lint, production Web build, generated
OpenAPI (210 operations), static Design, rendered tokens/contrast/type, deterministic fixture
parity and the controlled public market/receipt browser suite. The controlled suite exercised
pending/error/retry, keyboard, 320-1280px layout and trade-form preservation without providers or
transactions. No push, merge or deployment was performed for this refinement.

### Follow-up — Compact, fully visible responsive token rows

final result: passed

Source visual truth remains the selected upper landing list in
`/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-b20c9136-6837-4fbd-8b4d-428e8f747dd1.png`
(1058 x 1487 raster). The user's new instruction explicitly calls for less height and complete
small-screen visibility, superseding the earlier horizontally scrolling table. Source and current
renders were opened together; the original three illustrative listings versus the single
core-backed preview listing remains an intentional content difference.

Implementation evidence: `/private/tmp/pickler-token-compact-final.png` shows the normal 582px
browser viewport; `/private/tmp/pickler-token-responsive-390.png` is a 390 x 890, 1x phone capture.
Full desktop/phone captures are under `/private/tmp/pickler-compact-responsive-shots/`. The desktop
full-page render is 1400 x 6399 at 1x, with its token board inspected as the focused region. The
native 1400px capture is clipped by the host to 1024px and is not used as full-width visual proof.
State: settled local preview, last move down, no wallet or transaction. Source and implementation
were compared by their token-list regions and table-width proportions, not by whole-page height.

Findings fixed in this iteration:

- P2: stacked price, movement and chart inflated rows to 108.5px at 582px. Chart and numbers now
  sit beside each other. Desktop rows measure 60.5px; mobile two-line rows measure 95px.
- P2: the fixed-width table hid metrics and the profile action on phones. At 720px and below the
  same semantic row becomes a compact grid with every metric and action visible, without a scroll
  gesture. Accessible table headers remain available and visible mobile labels identify metrics.
- P2: inherited heading margins expanded the header and misaligned the network badge. The section
  heading resets its margin and uses a compact layout with the quote/network badge once.
- P2: tablet action-column sizing could clip the navigation target. A reserved 56px column fits
  its 44px hit target. Native inspection at the 721px boundary confirms the complete target fits.

Fidelity surfaces: existing Archivo/Instrument Sans families, weights and tokens are preserved;
figures retain tabular alignment and names truncate within their identity column. Lower padding,
compact headers and an adjacent chart provide the requested density. Green/red movement tokens,
row hover, curve progress, borders and rounded outer frame remain consistent; vertical column
dividers stay removed. Existing avatars and UI icons remain sharp at their intended sizes. All
copy is English; units remain in the section badge instead of repeated column sublabels. Mobile
labels add context without duplicating figures. No price, volume or trading behavior changed.

Verified at 320, 390, 582, 720, 721, 768, 1024 and 1400 CSS pixels: document width equals viewport
width, every cell is inside the viewport and the profile action remains visible. The profile
navigation was exercised and returned successfully to the landing. Browser error logs were empty.
Web types, scoped lint, formatting, whitespace and static/rendered Design tokens/contrast/type
passed. Reduced-motion overrides are retained. No provider requests or financial transactions
were made during this visual refinement; no push, merge or deployment was performed.

Implementation checklist: compact desktop rows, fully visible mobile grid, preserved movement and
sparklines, aligned header and visible profile action, responsive geometry and local preview
verification are complete. No actionable P0/P1/P2 findings remain.

### Follow-up — Readable mobile layout and price → chart → movement order

final result: passed

This iteration supersedes the previous 95px mobile layout, which the user rejected as cramped.
The explicit requirement is now price number, sparkline, then direction arrow/percentage on one
line. The selected list reference remains the upper token board in the generated image recorded
above. Its compact comparison structure, shared identity, metrics and single profile action are
preserved; the user's ordering and mobile readability instructions supersede its original chart
placement. The reference and settled implementation screenshots were opened for visual review.

Fixed findings:

- P2: the movement badge appeared before the chart and could wrap beneath the number. The DOM
  now orders price, sparkline and movement directly, with aligned centers at every checked width.
- P2: 12px figures and a 30px avatar made phone rows difficult to read. Phone price figures use
  16px, secondary figures use 14px, and the identity retains a 36px avatar and readable name.
- P2: packing all primary content into one narrow row left little room for the chart. At 540px
  and below, identity/action, the full-width price group and the three secondary metrics use
  three compact rows. At 541–900px the board uses two rows; wider screens retain the 60.5px
  desktop comparison row. These are one shared board, not separate tall cards.
- P2: the small-screen curve meter competed with its percentage for horizontal space. Its value
  now aligns with the secondary figures and the thin meter sits immediately below it.

Measured at 320, 390, 540, 541, 582, 720, 900, 901, 1024 and 1400 CSS pixels: no document or price
cell overflow, no truncated preview figures, price/chart/badge in the requested order with equal
vertical centers, and a complete 44px profile action. Phone rows measure 149.7px; tablet rows
measure 108.7px. The settled 390px, 1024px and normal 589px renders were visually inspected.
Colors and existing hover/entry/progress animations use the existing tokens; reduced motion
remains respected. Units and network still appear once in the heading badge, with no vertical
column dividers. Only presentation layout changed; canonical metrics and trading behavior remain.

Evidence:

- Normal small browser section: `/private/tmp/pickler-token-price-chart-movement.png`.
- Phone viewport: `/private/tmp/pickler-token-mobile-price-order.png`.
- Desktop viewport: `/private/tmp/pickler-token-desktop-price-order.png`.
- Full automated captures: `/private/tmp/pickler-readable-mobile-shots/`.

Validation passed: Web types, scoped lint, formatting, static Design, rendered tokens, contrast
and typography. Browser error logs were empty. The preview remains open at its normal viewport.
No provider or financial transactions, push, merge or deployment occurred for this refinement.
No actionable P0/P1/P2 findings remain.

---

# Perpl portfolio ticker — design QA

- Source: `/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-f9e36b1e-3705-48f0-9db1-a2b7d9216455.png`
- Implementation: `/tmp/perpl-portfolio-desktop-v2.jpg`
- Viewport: 1440 × 1024 CSS pixels, density 1.
- Source: 1487 × 1058 pixels, normalized proportionally to the implementation's 1440 × 1024 frame.
- State: local labelled example portfolio; ticker paused, disclosures collapsed.
- Full comparison: `/tmp/perpl-ticker-qa/comparison-v2.png` (source left, implementation right).
- Focused comparison: `/tmp/perpl-ticker-qa/ticker-comparison.png` (source above, implementation below).

## Findings

- [P2, resolved] Display and data typography was smaller than the selected visual target. The final title is 76px at desktop; the primary balance is 68px, secondary figures 40px, currency labels 14–20px, table values 16px and table headers 14px. The second normalized comparison verifies the stronger hierarchy.
- [P2, resolved] Side header did not align with its data. Both are now left-aligned.
- [P2, resolved] The pinned market caption consumed too much space at small widths. Hide that redundant visual caption below 480px; keep the region's accessible name.

## Product constraints

The example uses the existing controlled, normalized fixture rather than inventing a second set of financial numbers. Positive P&L and the displayed buffer therefore differ from the illustrative mock. The shared navbar retains its actual connection state; the example does not fabricate a connected wallet. Protocol details and collateral/account metadata remain available in disclosures rather than being discarded for visual fidelity.

## Verification so far

Desktop and 380/320px layouts have no page overflow. Pause/resume and keyboard access were checked in the in-app browser. The visual duplicate is inert and hidden from assistive technology. Position, estimate and catalogue disclosures work. Loaded logos are the existing reviewed Perpl market assets. Browser error/warning logs are empty. Title uses Archivo with width axis 112; body uses Instrument Sans. Sampled primary labels and monetary text exceed 5.84:1 contrast, with muted table labels at 6.28:1.

## Comparison history

1. Initial screenshot `/tmp/perpl-portfolio-desktop-v1.jpg`: side alignment and mobile-caption findings.
2. `/tmp/perpl-portfolio-desktop-final.jpg`: initial fixes verified; normalized comparison identified the typography finding above.

## Required fidelity surfaces

Typography: display/data scale corrected and visually verified in the second full comparison and `/tmp/perpl-ticker-qa/balance-comparison-v2.png`. Spacing: primary groups match, with the shared navbar intentionally retained. Colors: existing surface tokens and sampled contrast verified. Assets: actual local market/brand marks, loaded and sharp. Copy: financial estimates and example state remain explicit.

3. `/tmp/perpl-portfolio-desktop-v2.jpg`: display/data scale corrected. Comparison `/tmp/perpl-ticker-qa/comparison-v2.png` and focused balance comparison `/tmp/perpl-ticker-qa/balance-comparison-v2.png` confirm no remaining actionable P0/P1/P2 visual findings. Rechecked 768px and 320px after the change: no overflow; two intact position rows. Mobile viewport evidence: `/tmp/perpl-portfolio-mobile-v2.jpg`.

## Final validation and boundaries

Next production build and TypeScript passed. Scoped ESLint, formatting, design source and diff checks passed. Existing Perpl client tests passed (2); direct formatting checks passed for unknown values, negative amounts, zero, sub-basis-point moves and encoded market links. The public observed-wallet prop introduced on main is preserved, and explicitly observed addresses remain visible in the heading.

Motion measurements show the ticker moving, explicit pause stopping it and keyboard focus switching to the original scrollable list. The last focused market was completely inside its viewport. Duplicate content has no focusable links, is inert and aria-hidden. The strip avoids looping when its content fits without overflow. Reduced-motion CSS and flash guards were source-checked; this browser API did not expose media emulation or a real touch device. Price-update flashes were not tested against a new live observation. No provider, wallet signature, private credential or production deployment was used for this redesign acceptance.

## Follow-up polish

- [P3] The shared navigation intentionally retains existing app controls and its real connection state instead of copying the mock's fictional connected wallet.
- [P3] Example figures and semantic buffer colors differ from the conceptual mock because the controlled fixture is authoritative. Do not replace them with made-up financial observations.

final result: passed

## Market strip density refinement — 2026-10-14

The requested strip is now 56px high on desktop and 52px at mobile widths, retaining 44px
interactive targets. The loop duration is 65 seconds rather than 90 seconds, approximately
38% faster for the same content distance. Pause, keyboard and reduced-motion behavior is
unchanged.

Browser measurements verified the 56/52px heights, 65-second duration, working pause/resume
and no page overflow at 1440px and 380px. Evidence: `/tmp/perpl-ticker-thin-desktop.jpg` and
`/tmp/perpl-ticker-thin-mobile.jpg`. Scoped formatting, strict design source and diff checks
passed. Open-position alternatives are conceptual mockups pending selection; this refinement
does not implement a new position layout.

---

# Perpl position spotlight — selected design QA, 2026-10-14

## Evidence and normalization

- Source visual truth: `/Users/gilbertsahumada/.codex/generated_images/01a0b4a8-16eb-7520-b9a7-27ab962def15/exec-ad3db911-4542-4722-a648-10b4eb993f1a.png` (third displayed result in the latest ideation set).
- Implementation: `/tmp/perpl-positions-spotlight-desktop-clean.jpg`.
- Browser viewport: 1440 × 1024 CSS pixels at density 1. Source pixels: 1681 × 936; implementation pixels: 1440 × 1024.
- Comparison state: controlled example wallet, BTC selected, details collapsed, light public surface. The unchanged navbar, ticker, heading and portfolio summary are outside the position comparison crop.
- Full section comparison: `/tmp/perpl-spotlight-qa/positions-comparison.png`. The source position region is cropped at y=260–850 and resized proportionally to 1440px width. The implementation is cropped at y=345–870. No screenshot typography is stretched.
- Focused comparisons: `/tmp/perpl-spotlight-qa/selected-position-comparison.png` and `/tmp/perpl-spotlight-qa/prices-comparison.png`.
- User-facing evidence: `/tmp/perpl-open-positions-preview.jpg`. Mobile evidence: `/tmp/perpl-positions-spotlight-mobile.jpg` and `/tmp/perpl-positions-spotlight-320-v1.jpg`.

## Findings and comparison history

1. Initial capture `/tmp/perpl-positions-spotlight-v1.jpg` identified three P2 findings: dark secondary text inside the active violet selector, its trailing chevron not reaching the right edge, and excessive detail-panel height.
2. The selected P&L subtree now uses the appropriate surface ink for its labels and currency. The selector has an explicit full-width grid track. Smaller internal gaps and padding reduce the detail panel from 532px to 492px. `/tmp/perpl-positions-spotlight-v2.jpg` verifies those corrections.
3. Final capture `/tmp/perpl-positions-spotlight-desktop-clean.jpg` and the normalized full/focused comparisons verify the final layout, including larger 16px desktop currency labels. No actionable P0/P1/P2 findings remain.

## Required fidelity surfaces

Typography: Archivo headings with the required width axis, Instrument Sans body, tabular monetary figures. Identity/P&L and entry/mark hierarchy match the reference; 14–16px labels remain readable. Spacing: the desktop list/detail proportions match, with aligned price and collateral groups. The mobile selectors scroll within their own list above one full-width detail pane. Colors: selected violet, independent Long/Short status colors and signed P&L colors use existing surface tokens. Browser sampling confirms white selected labels and lime gain figures on the violet background. Assets: actual reviewed BTC/ETH SVGs remain sharp and use the shared MarketAsset. Copy: the source's entry, mark, size, collateral and P&L figures are reproduced from the existing controlled fixture; unavailable values retain existing formatting.

## Product constraints and interactions

The established buffer meter keeps its explicit 0–20% scale. Both example buffers therefore fill the bar, instead of reproducing the mock's misleading partial fills. Exhaustion details remain available in a labelled disclosure and are not presented as liquidation prices. The source's gradients and subtle extra separators are replaced by existing flat surface tokens. No leverage, return percentage, new calculation, history chart or trading action was introduced.

BTC/ETH selection was exercised with clicks, Enter and Space; the pane changes identity, direction, entry/mark, quantity, collateral and buffer together. Native pressed state and a stable selection live region identify the selection. The per-position exhaustion disclosure and portfolio-estimates disclosure work. Desktop 1440px, tablet 768px and mobile 380/320px measurements show no page overflow. Prices remain intact at 320px. Browser error/warning logs are empty. Reduced-motion rules were source-checked; browser media emulation and real-touch acceptance were not available.

Selection is keyed by account/position identity, initialized from the first position and reset by wallet identity. Refresh/removal fallback and empty/unknown behavior were inspected in the component; this static preview does not exercise live polling or real account changes. The existing HTTP controller and public observed-wallet flow remain unchanged. No wallet signature, provider call, financial transaction, deployment or merge was used for this UI validation.

## Validation and follow-up

Production Next build and TypeScript passed. Scoped ESLint, Prettier, strict design-source and diff checks passed. Native definition lists retain price/size labels; the list buttons remain separate from the detail pane. The unchanged surrounding dashboard intentionally retains the previously approved design rather than reworking the mock's contextual summary band. A larger live account and a real touch device remain useful follow-up acceptance cases.

final result: passed
