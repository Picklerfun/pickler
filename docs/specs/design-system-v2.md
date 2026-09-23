# Design system v2 — two surfaces, one product

Design source: the Claude Design project `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, read through
DesignSync. Five canvases are in scope: `Pickler Landing Waitlist`, `Portfolio Light`,
`Pickler Studio v4`, `Pickler Studio Empty` and `Pickler Account`.

Every value here was read out of those canvases, not carried over from the existing system. The two
exceptions are named where they appear, in the dark `info` and `cool` state tints, which no canvas
in this set shows and which are derived. Two other values were invented in an earlier draft — a
softened light ink and a translucent dark nav — and both are gone: the canvases have neither, and
§4 says so where the slot would have been.

## 1. What changed, and why it is not a retheme

The product has two halves, and they now look different on purpose:

- **The marketplace** — landing, tokens, agents, markets, portfolio, leaderboard, reads — is
  **light**: a white ground with near-black ink.
- **The studio** — the creator dashboard, account and the auth screens — is **night blue**:
  `#0B0D1A` with navy panels and white ink.

The current system cannot express this. It has two surfaces, `public` and `console`, and **both are
dark**: `#05061a` and `#08080a`. The second is a neutral near-black carrying warm bone ink
(`#f3f1ec`). The new studio is not that colour made bluer — `#0B0D1A` has a clear blue dominant at
roughly 232° — and its ink is pure white. They are different families, not adjacent shades.

Three other things change meaning rather than value:

**Win and loss.** Today they are lime and pink, which are legible on black and illegible on white.
The light surface needs its own pair: `#2E7D32` and `#C62C62`.

**Violet splits in two.** `#5B3CE0` on light, `#9B7BFF` on dark. The existing system already has
this idea — an accent and an accent _ink_ — so the pattern survives and only the values move.

**The typefaces.** Chakra Petch, Manrope and JetBrains Mono give way to **Archivo** for display and
**Instrument Sans** for everything else. Archivo is a variable font and the canvases use its width
axis at 108–112 throughout, so loading weight alone reproduces the wrong letterforms.

**The monospace is retired.** It appears in no new canvas. Where it carries chips, tickers and small
labels today, those become Instrument Sans at 10–12px with wide letter-spacing, which is what every
canvas does.

## 2. Inversion runs both ways

This is the observation the whole system rests on.

The light canvases contain dark blocks: the landing's ticker tape, its "FOUR MOVES" panel, its
mascot card, and Portfolio's total-value panel. The dark canvases contain light blocks: Account's
master-wallet card is white on a night-blue page.

And the dark used inside a light page is **exactly** the studio's own ground and panel —
`#0B0D1A` and `#15182A`. There is one dark in the product, not two, and an inverted block is the
other surface appearing inline.

So a surface is not a page-level theme. It is a property any subtree can take, and nesting the
opposite value inverts everything inside it. That single mechanism produces every inverted block in
all five canvases with no special-case CSS.

### An inverted block must re-declare its ink

This is the mechanism's one real trap, and it produced an invisible heading on the front page before
anything caught it: `FOUR MOVES.` rendered `#0B0D1A` on `#0B0D1A`, and the four card titles under it
at 1.10:1.

Setting `data-surface` on a subtree redefines every token inside it. It does **not** change `color`,
because `color` was already resolved further up the tree and inherits as a _computed value_ rather
than as a live reference to `--pk-ink`. So the block takes the dark ground and keeps the light ink,
and the two are the same colour.

Every inverted subtree therefore declares `color: var(--pk-ink)` — and `background: var(--pk-bg)` —
at its own root. The attribute changes what the tokens mean; the declaration is what re-reads them.

Nothing about this is visible in the source. The block looks correct, the attribute is present, the
tokens are right, and the text is not there. It was found by measuring the rendered page, which is
the argument for §7 in one sentence.

### An inverted block must be told what it inverts from

Nesting the opposite surface is how a dark panel sits in a light page. It is not, by itself, how a
single control inverts — and the difference cost an afternoon to find, in a browser rather than in
prose.

The marketplace's "Create agent" action is dark on a white bar. Built as `data-surface="dark"` it is
correct on the light routes and **disappears on the dark one**, painting `#0B0D1A` on a bar that is
already `#0B0D1A`. A dark action is not dark; it is dark _relative to_ a light bar. So the control
takes the bar's surface as an input and renders the opposite of whatever it is given.

The sharper form of the same point: for an object made of two tokens, swapping `--pk-ink` and
`--pk-bg` inverts by itself and needs no attribute at all. This control only needs a surface because
its hover reaches for a third value off the inverted ramp. If the design ever drops that hover step,
the attribute goes with it.

## 3. Approach

`packages/ui/src/styles.css` already switches on `data-surface`, redefining the same semantic token
names per surface. Seventeen files consume those names. The change is to **keep the names, change
the values, and rename the switch** from `public|console` to `light|dark`.

Two alternatives were rejected. Parallel token sets per surface (`--pk-light-bg`, `--pk-dark-bg`)
would force every consumer to know which surface it is on, which is the thing tokens exist to avoid,
and would make nested inversion impossible without duplicating every rule. CSS `color-scheme` with
`light-dark()` binds the surface to the reader's operating system preference, but here the surface
is decided by product area: the marketplace is light and the studio is dark regardless of what
anyone prefers.

## 4. The tokens

### Ground, ink and panels

| Token                 | Light                                                              | Dark                         |
| --------------------- | ------------------------------------------------------------------ | ---------------------------- |
| `--pk-bg`             | `#FFFFFF`                                                          | `#0B0D1A`                    |
| `--pk-ink`            | `#0B0D1A`                                                          | `#FFFFFF`                    |
| `--pk-ink-soft`       | _falls back to `--pk-ink`_                                         | `#C7CAD8`                    |
| `--pk-ink-muted`      | `#5A5F78`                                                          | `#9AA0B8`                    |
| `--pk-ink-faint`      | _falls back to `--pk-ink-muted`_                                   | `#8C91A9` (see Validation)   |
| `--pk-panel`          | `#F5F6FA`                                                          | `#15182A`                    |
| `--pk-panel-2`        | `#F1F2F7`                                                          | `#1C2036`                    |
| `--pk-panel-3`        | `#E2E5EE`                                                          | `#25293D`                    |
| `--pk-rule`           | `rgba(11,13,26,.08)`                                               | `rgba(255,255,255,.08)`      |
| `--pk-rule-strong`    | `rgba(11,13,26,.12)`                                               | `rgba(255,255,255,.12)`      |
| `--pk-nav-bg`         | `rgba(255,255,255,.88)`                                            | `#0B0D1A` (opaque)           |
| `--pk-popover`        | `#FFFFFF`                                                          | `#15182A`                    |
| `--pk-popover-shadow` | `0 1px 0 rgba(11,13,26,.08), 0 24px 60px -20px rgba(11,13,26,.35)` | `0 30px 80px rgba(0,0,0,.5)` |

`--pk-ink-muted` and `--pk-ink-faint` were drawn to swap roles between surfaces rather than
inverting: `#5A5F78` is the muted tone on light, and the canvases use that same grey as the faint
tone on dark. **Neither faint value survived measurement.** On dark that grey reads 3.08:1 on the
ground, and on light the faint grey reads 3.85:1 on `--pk-panel-3`. The dark level moved; the light
level turned out to have no room to move into and collapses onto muted. See **Validation**.

**Light has two ink levels; dark has four.** No light canvas uses a softened ink — body copy
inside a white card is full-strength `#0B0D1A`, and the next step down is already the muted grey.
Dark needs the extra level because pure white body copy on navy is harsh, which is what `#C7CAD8`
is for. So `--pk-ink-soft` resolves to `--pk-ink` on light: the slot exists for components that use
it, and on light it simply does nothing.

`--pk-ink-faint` does the same, and for a sharper reason: on light there is no room for a fourth
level below muted. A faint grey light enough to read as a step down cannot clear 4.5:1 on
`--pk-panel-3`, and one that can is five channel steps from muted — one level with a rounding error
rather than two. So light keeps two ink levels that both work on every ground, and the two unused
slots resolve upward. Dark has the room, and uses all four.

**The dark nav bar is opaque.** The landing's nav is translucent over a scrolling white page; the
studio's top bar sits on a fixed layout and is solid `#0B0D1A`. Giving dark a translucent nav would
be inventing a blur the canvases do not have.

### Accents

The same hue on both surfaces; only the ink changes.

| Token             | Value                            | Dark ink  |
| ----------------- | -------------------------------- | --------- |
| `--pk-lime`       | `#C8F03A`                        | —         |
| `--pk-lime-hover` | `#D6F95C`                        | —         |
| `--pk-lime-ink`   | `#3F6B00` light / `#C8F03A` dark | —         |
| `--pk-amber-ink`  | `#855E00` light / `#FFC93F` dark | —         |
| `--pk-violet`     | `#5B3CE0` light / `#9B7BFF` dark | `#B9A6FF` |
| `--pk-amber`      | `#FFC93F`                        | —         |
| `--pk-magenta`    | `#FF5FA2`                        | `#FF9EC6` |
| `--pk-blue`       | `#5B8CFF`                        | —         |
| `--pk-orange`     | `#FF7A3D`                        | —         |

Lime and amber need an ink of their own for the same reason violet and magenta do, and it is not a
preference: as text on white they measure 1.31:1 and 1.54:1, which is unreadable. Their light inks
are values the design already uses — they are the `good` and `caution` state inks below. `caution`'s
is darkened from the canvas; see **Validation**. As a fill
both stay exactly as they are; an accent bright enough to carry a fill is never dark enough to be
read on white.

The seven-colour agent palette — lime, violet `#5B3CE0`, amber, orange, magenta, blue `#5B8CFF`,
violet `#9B7BFF` — is unchanged in spirit and appears as the footer swatch row and the avatar grids.

### State pairs

Every state is a tinted ground with an ink chosen to be legible on it. A tinted object reads as a
state, never as a control, so it never borrows a button's fill.

| State   | Light tint / ink      | Dark tint / ink       |
| ------- | --------------------- | --------------------- |
| good    | `#EDF7CE` / `#3F6B00` | `#2A3A0F` / `#C8F03A` |
| win     | `#E4F3E5` / `#2B732E` | `#2A3A0F` / `#C8F03A` |
| caution | `#FBF0D4` / `#855E00` | `#3A2E0B` / `#FFC93F` |
| loss    | `#FBE4EC` / `#BB2A5D` | `#3A1626` / `#FF9EC6` |
| info    | `#F1EEFF` / `#5B3CE0` | `#231B3E` / `#B9A6FF` |
| cool    | `#EAF0FF` / `#2F55C8` | `#141C33` / `#5B8CFF` |

The light `win`, `loss` and `caution` inks are darkened from the canvas, for the reason in
**Validation**: an ink is only as legible as its worst ground, and for these three that ground is
`--pk-panel-3` rather than the state's own tint.

The dark tints for `info` and `cool` are not read from a canvas: the canvases show those two pairs
on light only. They are derived by the same method the observed dark pairs use — the accent at
roughly 18% over the ground — and must be checked against a canvas that uses them before being
relied on. They are not the only departures any more; **Validation** lists them all.

### Shape

Observed radii across the canvases are 2, 3, 4, 5, 9, 10, 12, 13, 14, 16, 18, 20, 24, 28 and pill.
Collapsed to eight steps, keeping every value that carries a distinct role:

`--pk-radius-mark: 4px` · `--pk-radius-sm: 12px` · `--pk-radius-md: 14px` ·
`--pk-radius-lg: 16px` · `--pk-radius-xl: 20px` · `--pk-radius-2xl: 24px` ·
`--pk-radius-3xl: 28px` · `--pk-radius-pill: 999px`

Marks, dots and the small coloured squares take `mark`. Chips and tiles take `sm`. Rail items and
menu rows take `md`. Stat tiles take `lg`. Cards take `xl`. Panels take `2xl`. Full-width sections
take `3xl`. Every action, chip and status pill is a pill.

### Type

`--pk-font-display: Archivo` with `font-variation-settings: 'wdth' 112` — the display face is only
correct with the width axis set; weight alone produces different letterforms.
`--pk-font: "Instrument Sans"`. `--pk-font-mono` is removed.

Display sizes are fluid in every canvas (`clamp(40px, 6vw, 76px)` and similar) with tight tracking
from `-0.02em` to `-0.05em`. Small labels run 10–12px at weight 600 with `letter-spacing` from
`0.04em` to `0.14em` — that pairing is what replaces the monospace.

## 5. The five screens

| Canvas                     | Route                   | Surface                              |
| -------------------------- | ----------------------- | ------------------------------------ |
| `Pickler Landing Waitlist` | `/`                     | light                                |
| `Portfolio Light`          | `/portfolio`            | light, with a dark total-value panel |
| `Pickler Studio v4`        | `/console`              | dark                                 |
| `Pickler Studio Empty`     | `/console`, empty state | dark                                 |
| `Pickler Account`          | `/account`              | dark, with a light wallet card       |

The landing is shorter than the one it replaces: a ticker tape, a nav, a one-word hero, a three-part
hero row, a "runs on" strip, four steps, the waitlist form and a footer. Sections present in the
current landing and absent from the canvas are removed rather than restyled.

Studio Empty is **not** Studio v4 with the agents removed. It shares the top bar, rail and main
frame, and then its main column is a different thing: a stepped flow that carries a `PIECE` section,
a `DRAFT OVERVIEW · GO PUBLIC` panel and a passkey sheet, under the screen labels
`Studio · Empty · <step>` and `Studio · Draft overview`. It is the journey from no agents to a first
one, not an empty state.

That passkey sheet reaches into custody: authorising an agent's sub-wallet is specification two of
the Turnkey work, which does not exist yet. This change builds the screen and its ceremony
presentation; the sheet's confirm action has nothing real to call until that specification lands, so
it must not pretend otherwise.

## 6. What the other pages get

Fourteen CSS modules consume these tokens; five screens have new canvases. Most of the rest keep
their composition and inherit the new surface, and look coherent in colour and type without being
redesigned — which is the point of tokens carrying meaning rather than values.

**Three do not, and an earlier draft of this section was wrong to say they would.** `apply`, `agents`
and `markets` each paint an opaque dark layer of their own — gradients and a starfield — over
whatever ground the surface provides. Near-black ink on that is not coherent, it is invisible. That
is composition, not colour, and no token can fix it.

So those three are pinned to `data-surface="dark"` until someone draws them light, each with a
comment saying why and that the attribute goes when a canvas exists. A page whose composition is
dark belongs on the dark surface. The same test applies to any module not listed here: painting its
own opaque ground earns the pin, merely reading tokens does not.

Any page that reads a token this document removes must be migrated in the same change. That is the
monospace family and any `--pk-*` name that does not survive into the new set.

## 7. Verification

A token system is easy to get subtly wrong and hard to see: it fails by looking almost right. Every
check below runs against the **rendered page**, not against this document, because the failure that
matters is a component reading the wrong token — and a table cannot see that.

Playwright 1.63 is available globally with Chromium cached, and is deliberately **not** added as a
repository dependency: these are verification scripts run against a dev server, not a test suite the
build depends on. They live in `scripts/design/`.

**Contrast, measured on the DOM.** Walk every text node in each route, read its computed colour and
its nearest painted background, and compute the WCAG ratio from those two values. Body text must
reach 4.5:1 and large text 3:1. This is stronger than checking §4's table in the way that matters:
the table can be right while a component reads `--pk-ink-faint` where it should read
`--pk-ink-muted`, and only the rendering shows it. Report every failure with its selector, the two
colours and the ratio.

**The tokens are actually the source.** Collect every distinct computed colour across all five
routes and assert each one resolves to a value in §4. A colour that appears on screen and is in no
token is a literal someone typed, wherever it lives.

**Both surfaces, and inversion.** Assert `/` and `/portfolio` paint a white ground and `/console`
and `/account` a night-blue one. Then assert the nested case, which is the mechanism the whole
system rests on: the landing's "FOUR MOVES" panel must compute to the dark ground while its parent
computes to white, and Account's wallet card the reverse. If nesting does not invert, the system is
two themes wearing one name.

**The display face carries its width axis.** Assert the computed `font-variation-settings` on
display headings includes `wdth`. Archivo at the right weight and the wrong width is a different
typeface, and it is invisible unless measured.

**Screenshots, for a person to judge.** Capture each route at desktop and phone widths into
`scripts/design/shots/`. The automated checks above catch what is measurable; spacing, rhythm and
whether it _reads_ like the canvas are not, and want eyes.

**No literals in source.** After migration, no `#rrggbb` outside the token file. A grep is the test,
and it is the weakest of these — it catches the careless case, while the DOM checks catch the
plausible one.

## 8. Out of scope

The remaining canvases in the design project — the mobile flows, the market and agent detail
screens, the landing variants — are not in this change. Neither is the agent-token curve UI.

Specification two of the custody work (agent sub-wallets and their policies) is unaffected: it adds
no screens in this set.

## Validation

Every other value in this document was read from a canvas. These were not, and each is recorded
here so that nobody restores one from the canvas in six months and undoes it silently.

**Read this before adding a token.** Both faint ink levels were transcribed from the canvas and
checked against the page ground, and both failed against the panels the text actually sits on. That
is one mistake made twice, not two coincidences. A ground is not a page: `--pk-panel-3` is a ground,
every tinted state is a ground, and an ink is only as legible as its worst one. Measure a new ink
against every ground it can land on, never against `--pk-bg` alone — `scripts/design/levels.test.mjs`
does exactly that and needs no browser to do it.

**`--pk-ink-faint` on dark, `#5A5F78` → `#8C91A9`.** The canvas value measures **3.08:1** on
`#0B0D1A` and fails AA for body text; it was already in use at 12px. It was first moved to `#757B97`,
which cleared 4.6:1 on the ground and still failed on every panel — 3.44:1 on `--pk-panel-3`, which
is where small labels actually sit. That is the mistake above, made while fixing the mistake above.
`#8C91A9` is the least lightening that reaches **4.6:1 on `--pk-panel-3`**, the worst ground it lands
on, with hue and saturation held: hue 229.4°, saturation 14.4%, lightness 52.6% → 60.6%. Dark keeps
four levels that step apart on every ground — 4.61, 5.53, 8.79, 14.35 at their worst.

**`--pk-ink-faint` on light, `#6B7186` → `--pk-ink-muted`.** The canvas value measures 4.85:1 on
white, which passes, and **3.85:1 on `--pk-panel-3`**, which does not. Unlike dark, there is nowhere
for it to go: the least darkening that clears 4.6:1 on `--pk-panel-3` is `#5F6578`, which is five
channel steps from `--pk-ink-muted` (`#5A5F78`) — one level with a rounding error rather than two.
So the level collapses onto muted, deliberately and in writing, rather than shipping two greys that
the spec calls different and the screen does not. Nothing is lost: the token is only ever used as
text colour, never as a border or a fill, so its lightness carried no other job.

**The light `win`, `loss` and `caution` inks, darkened twice.** Measured on their own tints the
canvas values were **4.46:1** (`win` `#2E7D32`) and **4.42:1** (`loss` `#C62C62`) — both a hair
under, and a state ink that cannot be read on the state's ground fails the one promise a
tint-and-ink pair makes. Darkening them to clear their tints then showed the real constraint: the
same inks are used as accents on the ink-ramp grounds, where `--pk-panel-3` is far harsher than any
tint. On that ground the canvas values read **4.07**, **4.23** and **4.36**. So each is moved by the
least that reaches 4.6:1 on `--pk-panel-3`, hue and saturation held — `#2E7D32` → `#2B732E`,
`#C62C62` → `#BB2A5D`, `#8A6200` → `#855E00` — which clears every lighter ground with it, tints
included (5.08, 4.83, 5.15). `loss` matters more than its name suggests: the agent avatars borrow
it, so it appears on every marketplace page rather than only where something went wrong.

Every token holding one of those colours moved together — `--pk-win`, `--pk-loss`,
`--pk-magenta-ink`, `--pk-amber-ink`, the three state inks and the two edge rgbas. A state ink a few
channel steps from the accent it names is one colour with a rounding error, not two, which is the
same trap that sank `#5F6578` above. `--pk-agent-*` is left alone: that palette is a separate set of
names with its own grounds.

The canvas is not wrong in either case and the transcriptions were not careless. The design was
drawn by eye, and eyes do not compute contrast ratios; this is the class of defect only a
measurement finds. `scripts/design/contrast.mjs` found both, on rendered pages.

**The dark `info` and `cool` state tints.** Derived rather than observed, for the reason given under
**State pairs**: no canvas in this set shows those two pairs on dark. They still want checking
against a canvas that uses them.

**One value passes by four hundredths.** On dark, `--pk-cyan-ink` `#5B8CFF` measures **4.54:1** on
`--pk-panel-3`. It clears AA and needs no change, but it is the narrowest margin in the palette and
it is recorded so that darkening that panel is a considered decision rather than an accident. Every
other ink on every other ground has room.

Everything in this section is measured by `scripts/design/`, which runs against the rendered page
rather than against this table — because the failure that matters is a component reading the wrong
token, and a table cannot see that.
