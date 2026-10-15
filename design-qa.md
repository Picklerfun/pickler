# Perpl trading workspace — design QA

**Final result: visual follow-up passed; variable leverage remains pending**

## Findings

No actionable P0/P1/P2 visual findings remain in the reviewed local states after the browser
comments below. The requested leverage range is still a product decision: the current backend
accepts only 1×, so the new slider is explicitly disabled at that limit. This is a visual and
controlled interaction check, not financial execution acceptance.

## Target and evidence

- Selected direction: the first trading workspace design, refined with token-purchase button
  effects and curated icons as requested.
- Source visual truth: `/Users/gilbertsahumada/.codex/generated_images/01a0b4c5-d1ce-7c11-8bce-c5d1fac0a886/exec-0a8fcef2-4b69-49a8-9c80-1578c8f15706.png`.
- Local implementation: `http://localhost:3012/studio?stage=perpl-trading-ready`.
- Implementation capture: `/private/tmp/perpl-ui-qa-20261015/desktop-final.jpg`.
- Combined full-view and focused ticket comparison, opened and inspected together:
  `/private/tmp/perpl-ui-qa-20261015/comparison-final.jpg`.
- Additional browser captures are in `/private/tmp/perpl-ui-qa-20261015/`:
  `button-working.jpg`, `mobile-controls.jpg`, `mobile-positions.jpg`, `mobile-active.jpg`,
  `mobile-record.jpg`, `mobile-setup.jpg` and `tablet-controls.jpg`.
- These paths identify local review artifacts; the images are not shipped product assets.

## Normalization and state

The source is 1490 × 1056 pixels. The implementation desktop viewport and screenshot are
1488 × 1056 CSS/image pixels. Browser screenshots are compared at their actual image dimensions,
not multiplied by the reported devicePixelRatio. The combined comparison renders both at equal
column widths and includes unscaled focused ticket regions; no browser chrome or device frame
is included. The two-pixel source-width difference does not affect the ticket comparison.

The main comparison uses the connected, observed, ready state, dark surface, expanded sidebar,
NEAR, margin 0.06 AUSD, target hold 30 seconds and fixed 1×. The implementation uses explicitly
labelled fixture data and the fixture's agent/account/date. The source's illustrative identity and
hashes are not treated as actual observations. Mobile checks use a 390 × 844 CSS viewport and
full-page screenshots; tablet Controls uses 834 × 1112, reports density 1 and scrollWidth 834.
The desktop capture is image-width 1488; mobile captures are image-width 390. No raster resize or
image editing is used. `tablet-record.jpg` is a 1280px supplementary record capture, not tablet
breakpoint evidence.

## Comparison history

1. First implementation review: blocked. Compared the source with
   `desktop-iteration-1.jpg`. P2 findings: the market control did not fill its field; preview
   disabled styling obscured the primary action; the extra activity strip competed with the
   ticket; repeated receipt disclosures made the recent cycle taller than the selected design;
   and the status chip was too small relative to the agent heading.
2. Corrections: made the selector fill the grid track, enabled explicitly inert button feedback
   only in labelled development fixtures, removed duplicate chrome from trading sections,
   consolidated execution details into one disclosure per cycle and increased the trading
   status chip. Existing paper-only fixtures keep their warnings and runtime presentation.
3. Final comparison: passed. `desktop-final.jpg` and `comparison-final.jpg` show the revised
   ticket, session column, compact paired receipts and status hierarchy. Reviewed the full view
   and the enlarged ticket side by side with the source. No remaining P0/P1/P2 differences.

## Required fidelity surfaces

- **Fonts and typography:** existing Archivo display face and Instrument Sans body/control face
  preserve the selected wide-heading treatment. The focused comparison shows distinct title,
  label and action weights with readable line heights. Native font rendering differs slightly
  from the generated mock; no fallback, broken wrapping or clipped labels was observed.
- **Spacing and layout rhythm:** account strip precedes a wider ticket and narrower session
  column. Recent receipts and the closed Advanced settings disclosure follow. Panel radius,
  borders and spacing reuse product tokens. The ticket becomes two field columns and stacks
  above the summary at narrower widths; mobile receipts become single-column rows. Desktop,
  tablet and mobile checks found no horizontal overflow or overlapping controls.
- **Colors and tokens:** navy surfaces, lime primary/confirmed states and muted metadata follow
  existing `--pk-*` tokens. Focus remains visible. Button working, waiting and success phases
  reuse token purchase effects; status text supplements color. Static token checks pass.
- **Image quality and asset fidelity:** existing Pickler avatar/brand assets, reviewed market
  assets and curated Lucide icons are retained. No generated screenshot is embedded as UI, and
  no product image or logo is replaced by CSS art or a handcrafted SVG approximation. Icons
  remain sharp and consistently aligned with labels. The reviewed NEAR asset intentionally uses
  its existing official color instead of the mock's monochrome presentation.
- **Copy and content:** one Start trading action, accurate target-hold wording, separate session
  and pre-existing wallet positions, explicit unknown values and unrecorded hashes. Submission
  is never labelled a confirmed fill. The local fixture adds visible preview-only copy; hosted
  flows retain their real execution state. Full navigation is preserved rather than copying the
  mock's abbreviated sidebar.

## Interactions and accessibility

- Keyboard opened the market Select, changed NEAR to an occupied BTC market and restored NEAR.
  Occupied-market messaging disabled Start trading. Radix retains focus and selection semantics.
- Local Start trading exercised ring/sweep, waiting and confirmed feedback without submitting
  orders or changing account data. This is a button preview, not execution evidence.
- View positions navigated correctly. Six pre-existing wallet positions remained read only; the
  active fixture showed Close position only for the session-managed position.
- Opening and closing receipts expose separate fill status and UTC timestamps. Enter expanded
  the consolidated execution details and exposed both request/order IDs and observed fill data.
- Setup displays connection required and unknown balances/counts, not a ready or flat account.
- Native disclosures, labelled fields, existing hash copy/explorer controls, aria-busy and
  stable status/alert regions are retained. Corrected an invalid cancellation alert role during
  final code review. Reduced-motion CSS disables sweep, spin, wallet pulse and check drawing.
- The app console error query returned no errors. Browser-tool telemetry failures are external
  to the application and were not counted as app failures.

## Intentional differences and remaining coverage

The mock's illustrative hashes are not fabricated in product history; missing receipts say
Tx hash not recorded. The shared 48px action, native fonts, complete navigation, permission
metadata and existing content width follow the repository's design system. Closed position
snapshots stay separate from cycle receipts so P&L is not attributed to an unrelated cycle.

A real provider submission, clipboard/explorer acceptance with a new real hash, OS reduced-motion
toggling, browser text zoom and a screen-reader session were not performed in this visual change.
The full automated rendered-design suite is left to CI; local evidence is the CUA browser review
and static source check. No database migration, deployment or real trade was performed.

## Implementation checklist

- [x] Implement the selected composition with existing product tokens and assets.
- [x] Reuse token action effects without importing wallet or trading policy into shared UI.
- [x] Add labelled icons and preserve keyboard, busy, disabled and unknown states.
- [x] Compare source and implementation together at full-view and focused scales.
- [x] Fix P0/P1/P2 findings and re-capture the revised implementation.
- [x] Check desktop, tablet, mobile, setup, active and closed fixtures.

The original visual review above is historical. The following user comments supersede the
mock in the affected areas; remaining coverage is listed above.

## Browser-comment follow-up — October 15, 2026

The user identified the narrow account layout at 955 × 890, a configured-only market list,
the static leverage box, repeated network labels and neutral Long/Short text. Those comments
are the visual truth for this iteration, overriding the original mock's account strip and
fixed-value leverage box.

- The execution selector now reads the existing official network-scoped catalogue. All eight
  captured testnet markets appear in the labelled preview: BTC, ETH, SOL, MON, ZEC, LIT, PUMP,
  NEAR. Hosted use reads the API, with no captured-data fallback. Configured permissions still
  gate selection; unavailable or ambiguous identities remain disabled. Failed/stale reads block
  new starts and expose retry without changing the saved choice.
- Account and control layout now uses content-width container queries. At 955px with the sidebar
  expanded, the identity has its own aligned row and three facts share the next row. The ticket
  and session stack. At 390px, connection and balance share a row and the wallet occupies a
  full-width row with its copy action beside the address. The page has no horizontal overflow
  at either measured width (scrollWidth equals innerWidth).
- Monad Testnet was removed from the account strip and recent-cycle heading. Global network
  context remains visible. Long and Short use shared green/red Tag tokens, independent of
  profit/loss and execution status. Development position fixtures include both directions;
  they remain read only.
- The official shared Radix Slider replaces the static box. Its thumb has the accessible name
  Leverage, description Current limit · 1×, min/max/value 1 and disabled semantics. The backend's
  existing 1× limit remains unchanged. No larger executable range or drag acceptance is claimed.

Evidence under `/private/tmp/perpl-ui-qa-20261015/`: `review-955.png` (955px full page),
`review-markets.png` (open catalogue), `review-mobile.png` (390px full page),
`review-mobile-positions.png`, `review-directions.png` (both direction colors), and
`review-final.png` (1280px final full page after hydration). Captures use their actual pixel
widths without raster edits. `review-desktop.png` was an intermediate pre-hydration capture;
use `review-final.png` for the visible slider thumb. The final implementation and the selected
source were opened together; the intentional layout changes above follow the user's comments.

Keyboard opened the catalogue; selecting occupied BTC disabled Start trading and exposed its
warning, then selecting NEAR restored readiness. Manage markets navigated to Sources & rules
and its catalogue controls. A fresh final browser tab reported no application console errors.
An invalid icon name found during the first iteration was fixed before this final check.

Validation passed: 169 focused Studio/Perpl/token tests, UI and web types, root lint, architecture,
static design tokens (492 source files), scoped formatting and the production Cloudflare web
build. The full automated rendered-design suite has not run locally. GitHub Actions could not
start because GitHub reports an account billing lock; CI acceptance remains pending. No provider
orders, credentials, migrations or deployment were involved in this follow-up.

## Main reconciliation — October 15, 2026

Merged main at `3675e1f7` (PR #191). Its redundant network-label removal overlapped the redesigned
execution component and live Studio composition. Retained the observed-account status precedence,
new ticket/receipts/controls and official catalogue gate, while applying the network-neutral
activity strip and existing-key copy from main. The violet navigation Soon tags are preserved.

Validation passed after reconciliation: 177 focused Studio/Perpl/token/market-format tests,
root lint and formatting, architecture, design source (492 files), and the production Cloudflare
web build including type checking. The local ready fixture still renders the reviewed composition;
`/private/tmp/perpl-ui-qa-20261015/reconciled-main.png` records the 1280px full-page check. A fresh
browser tab reported no application console errors. This merge changes no trading permissions,
leverage policy, API, migration or provider execution behavior.

## Network copy follow-up — October 15, 2026

The user requested that Testnet appear only in the top network selector. Removed remaining
app-owned mentions from the Perpl connection/ticket, market catalogue badge, account and wallet
views, token preparation feedback and reviewed wallet errors. Wallet funding and transaction
review retain their actual chain IDs. Technical network metadata, RPC/explorer URLs, API values
and transaction guards are unchanged. Native wallet prompts retain canonical network metadata.

Browser verification covered ready Controls, connection setup, Sources & rules and the wallet
modal using labelled local fixtures. Controls and setup contain no Testnet text in main content;
the header selector and its accessible description retain the network context. Evidence:
`/private/tmp/perpl-ui-qa-20261015/network-copy-ready.png` and `network-copy-setup.png`.

Validation passed: 241 existing focused Studio/Perpl/token/wallet/status tests, web types, root
lint and static design checks over 492 files. Updated existing rendered harness selectors for
the new copy and retained the separate chain-10143/143 funding assertions. Those full rendered
harnesses were not rerun for this copy-only follow-up; the prior production build result above
predates this follow-up. React review found no new hooks, requests, effects or client boundaries.

Root formatting and architecture checks also passed for this follow-up.
