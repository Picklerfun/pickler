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
| `--pk-ink-faint`      | `#6B7186`                                                          | `#5A5F78`                    |
| `--pk-panel`          | `#F5F6FA`                                                          | `#15182A`                    |
| `--pk-panel-2`        | `#F1F2F7`                                                          | `#1C2036`                    |
| `--pk-panel-3`        | `#E2E5EE`                                                          | `#25293D`                    |
| `--pk-rule`           | `rgba(11,13,26,.08)`                                               | `rgba(255,255,255,.08)`      |
| `--pk-rule-strong`    | `rgba(11,13,26,.12)`                                               | `rgba(255,255,255,.12)`      |
| `--pk-nav-bg`         | `rgba(255,255,255,.88)`                                            | `#0B0D1A` (opaque)           |
| `--pk-popover`        | `#FFFFFF`                                                          | `#15182A`                    |
| `--pk-popover-shadow` | `0 1px 0 rgba(11,13,26,.08), 0 24px 60px -20px rgba(11,13,26,.35)` | `0 30px 80px rgba(0,0,0,.5)` |

`--pk-ink-muted` and `--pk-ink-faint` swap roles between surfaces rather than inverting: `#5A5F78`
is the muted tone on light and the faint tone on dark. That is what the canvases do, and it works
because that grey sits near the middle of both ranges.

**Light has three ink levels; dark has four.** No light canvas uses a softened ink — body copy
inside a white card is full-strength `#0B0D1A`, and the next step down is already the muted grey.
Dark needs the extra level because pure white body copy on navy is harsh, which is what `#C7CAD8`
is for. So `--pk-ink-soft` resolves to `--pk-ink` on light: the slot exists for components that use
it, and on light it simply does nothing.

**The dark nav bar is opaque.** The landing's nav is translucent over a scrolling white page; the
studio's top bar sits on a fixed layout and is solid `#0B0D1A`. Giving dark a translucent nav would
be inventing a blur the canvases do not have.

### Accents

The same hue on both surfaces; only the ink changes.

| Token             | Value                            | Dark ink  |
| ----------------- | -------------------------------- | --------- |
| `--pk-lime`       | `#C8F03A`                        | —         |
| `--pk-lime-hover` | `#D6F95C`                        | —         |
| `--pk-violet`     | `#5B3CE0` light / `#9B7BFF` dark | `#B9A6FF` |
| `--pk-amber`      | `#FFC93F`                        | —         |
| `--pk-magenta`    | `#FF5FA2`                        | `#FF9EC6` |
| `--pk-blue`       | `#5B8CFF`                        | —         |
| `--pk-orange`     | `#FF7A3D`                        | —         |

The seven-colour agent palette — lime, violet `#5B3CE0`, amber, orange, magenta, blue `#5B8CFF`,
violet `#9B7BFF` — is unchanged in spirit and appears as the footer swatch row and the avatar grids.

### State pairs

Every state is a tinted ground with an ink chosen to be legible on it. A tinted object reads as a
state, never as a control, so it never borrows a button's fill.

| State   | Light tint / ink      | Dark tint / ink       |
| ------- | --------------------- | --------------------- |
| good    | `#EDF7CE` / `#3F6B00` | `#2A3A0F` / `#C8F03A` |
| win     | `#E4F3E5` / `#2E7D32` | `#2A3A0F` / `#C8F03A` |
| caution | `#FBF0D4` / `#8A6200` | `#3A2E0B` / `#FFC93F` |
| loss    | `#FBE4EC` / `#C62C62` | `#3A1626` / `#FF9EC6` |
| info    | `#F1EEFF` / `#5B3CE0` | `#231B3E` / `#B9A6FF` |
| cool    | `#EAF0FF` / `#2F55C8` | `#141C33` / `#5B8CFF` |

The dark tints for `info` and `cool` are the only values in this document not read directly from a
canvas: the canvases show those two pairs on light only. They are derived by the same method the
observed dark pairs use — the accent at roughly 18% over the ground — and must be checked against a
canvas that uses them before being relied on.

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

Studio Empty is the same chrome as Studio v4 with no agents, so they share every component and
differ only in what the main column renders.

## 6. What the other pages get

Fourteen CSS modules consume these tokens; five screens have new canvases. The rest —
tokens, agents, markets, leaderboard, reads, apply, activity, wallet — keep their current
composition and inherit the new surface. They will look coherent in colour and type without being
redesigned, which is the point of tokens carrying meaning rather than values.

Any page that reads a token this document removes must be migrated in the same change. That is the
monospace family and any `--pk-*` name that does not survive into the new set.

## 7. Verification

A token system is easy to get subtly wrong and hard to see. Three checks, in order of value:

**Contrast.** Every ink-on-ground and ink-on-tint pair in §4 must be measured, not eyeballed. The
light state inks were chosen by the designer to be legible on their tints; that should be
confirmed rather than assumed, and the two derived dark pairs especially.

**No literals.** After migration, no `#rrggbb` may remain in any CSS module or component outside
the token file. A grep is the test.

**Both surfaces, every component.** Each component in `packages/ui` renders on both surfaces. A
component that only works on one is a component that reads a token it should not.

## 8. Out of scope

The remaining canvases in the design project — the mobile flows, the market and agent detail
screens, the landing variants — are not in this change. Neither is the agent-token curve UI.

Specification two of the custody work (agent sub-wallets and their policies) is unaffected: it adds
no screens in this set.
