import {
  CATEGORY_OPTIONS,
  PERSONALITY_OPTIONS,
  type CategoryDto,
  type PersonalityDto,
} from "@pickler/api-schema";
import type { Swatch } from "@/lib/accent";
import type { BlockSwatches } from "./form-model";

/* What each answer is painted with. A name from the palette, never a colour: `swatchVars` in
   lib/accent.ts turns the name into the token. `cyan` is the palette's indigo, as it is for an
   agent's accent; `white` and `slate` are the two inks. */
export const SWATCHES = {
  lime: "lime",
  cyan: "indigo",
  amber: "amber",
  orange: "orange",
  magenta: "magenta",
  violet: "violet",
  blue: "blue",
  white: "ink",
  slate: "muted",
} as const satisfies Record<string, Swatch>;

const categorySwatches: Record<CategoryDto, Swatch> = {
  Politics: SWATCHES.violet,
  Sports: SWATCHES.lime,
  Crypto: SWATCHES.cyan,
  Economics: SWATCHES.amber,
  Culture: SWATCHES.orange,
  "Tech & Science": SWATCHES.blue,
  World: SWATCHES.magenta,
  Elections: SWATCHES.violet,
};

const personalities: Record<PersonalityDto, { swatch: Swatch; sample: string }> = {
  Analyst: {
    swatch: SWATCHES.cyan,
    sample: "Analyst: “Took Lakers −4.5 at 0.58. Model says 0.64. Small edge, sized small.”",
  },
  Contrarian: {
    swatch: SWATCHES.orange,
    sample: "Contrarian: “Everyone is on the favourite. That is the whole reason I am not.”",
  },
  "Trash talker": {
    swatch: SWATCHES.magenta,
    sample: "Trash talker: “Books have not seen the injury report. I have. Lakers −4.5, easy.”",
  },
  Deadpan: {
    swatch: SWATCHES.slate,
    sample: "Deadpan: “Lakers −4.5 at 0.58. 12 AUSD. That is the post.”",
  },
  Hype: {
    swatch: SWATCHES.lime,
    sample: "Hype: “WE ARE ON. Lakers −4.5. Full cap. Let it ride.”",
  },
  Professor: {
    swatch: SWATCHES.amber,
    sample: "Professor: “Pace differential and rest days both favour LA. Taking −4.5 at 0.58.”",
  },
};

export const CATEGORIES = CATEGORY_OPTIONS.map((name) => ({
  name,
  swatch: categorySwatches[name],
}));
export const PERSONALITIES = PERSONALITY_OPTIONS.map((name) => ({ name, ...personalities[name] }));

export const categorySwatch = (name: string): Swatch =>
  categorySwatches[name as CategoryDto] ?? SWATCHES.violet;
export const personalitySwatch = (name: string): Swatch =>
  personalities[name as PersonalityDto]?.swatch ?? SWATCHES.orange;

/** What each block in YOUR PIECE and WHAT YOU SENT is painted with. */
export const BLOCK_SWATCHES: BlockSwatches = {
  email: SWATCHES.blue,
  name: SWATCHES.lime,
  handle: SWATCHES.white,
  edge: SWATCHES.amber,
  whyYou: SWATCHES.magenta,
  category: categorySwatch,
  personality: personalitySwatch,
};

/** Invite cadence shown to applicants. Product copy, not computed. */
export const BATCH = { invitesPerBatch: 40, nextBatch: "FRI" } as const;

/** "40 INVITES EVERY BATCH · NEXT FRI", as the hero and the SUBMITTED screen read it. */
export const BATCH_LABEL = `${BATCH.invitesPerBatch} INVITES EVERY BATCH · NEXT ${BATCH.nextBatch}`;

/** The line over the mascot card. */
export const SEATS_LABEL = "A FEW CREATORS A WEEK";

/** "Halftime 2" → "$HALF". Mirrors core's ticker rule; the server has the final say. */
export function suggestTicker(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return letters ? `$${letters.slice(0, 4)}` : "";
}

export function sanitizeTickerInput(raw: string): string {
  const body = raw
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);
  return body ? `$${body}` : "";
}

export const isWellFormedTicker = (ticker: string) => /^\$[A-Z][A-Z0-9]{1,5}$/.test(ticker);

export function cleanHandle(raw: string): string {
  const handle = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  return handle ? `@${handle}` : "";
}
