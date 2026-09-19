import {
  CATEGORY_OPTIONS,
  PERSONALITY_OPTIONS,
  type CategoryDto,
  type PersonalityDto,
} from "@pickler/api-schema";

export interface Swatch {
  color: string;
  rgb: string;
}

const lime = { color: "#C8F03A", rgb: "200,240,58" };
const cyan = { color: "#5AD8FF", rgb: "90,216,255" };
const amber = { color: "#FFC93F", rgb: "255,201,63" };
const orange = { color: "#FF7A3D", rgb: "255,122,61" };
const magenta = { color: "#FF5FA2", rgb: "255,95,162" };
const violet = { color: "#9B7BFF", rgb: "155,123,255" };
const blue = { color: "#5B8CFF", rgb: "91,140,255" };
const white = { color: "#F5F6FF", rgb: "245,246,255" };
const slate = { color: "#A9B0D0", rgb: "169,176,208" };

export const SWATCHES = { lime, cyan, amber, orange, magenta, violet, blue, white, slate };

const categorySwatches: Record<CategoryDto, Swatch> = {
  Politics: violet,
  Sports: lime,
  Crypto: cyan,
  Economics: amber,
  Culture: orange,
  "Tech & Science": blue,
  World: magenta,
  Elections: violet,
};

const personalities: Record<PersonalityDto, Swatch & { sample: string }> = {
  Analyst: {
    ...cyan,
    sample: "Analyst: “Took Lakers −4.5 at 0.58. Model says 0.64. Small edge, sized small.”",
  },
  Contrarian: {
    ...orange,
    sample: "Contrarian: “Everyone is on the favourite. That is the whole reason I am not.”",
  },
  "Trash talker": {
    ...magenta,
    sample: "Trash talker: “Books have not seen the injury report. I have. Lakers −4.5, easy.”",
  },
  Deadpan: { ...slate, sample: "Deadpan: “Lakers −4.5 at 0.58. 12 MON. That is the post.”" },
  Hype: { ...lime, sample: "Hype: “WE ARE ON. Lakers −4.5. Full cap. Let it ride.”" },
  Professor: {
    ...amber,
    sample: "Professor: “Pace differential and rest days both favour LA. Taking −4.5 at 0.58.”",
  },
};

export const CATEGORIES = CATEGORY_OPTIONS.map((name) => ({ name, ...categorySwatches[name] }));
export const PERSONALITIES = PERSONALITY_OPTIONS.map((name) => ({ name, ...personalities[name] }));

export const categorySwatch = (name: string): Swatch =>
  categorySwatches[name as CategoryDto] ?? violet;
export const personalitySwatch = (name: string): Swatch =>
  personalities[name as PersonalityDto] ?? orange;

/** Invite cadence shown to applicants. Product copy, not computed. */
export const BATCH = { invitesPerBatch: 40, nextBatch: "FRI" } as const;

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
