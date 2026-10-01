/* The token check's verdict, apart from the page it was read from: which painted colours no
 * --pk-* token of their own surface holds. `tokens` and `painted` are what `resolveTokens` and
 * `paintedColours` in ./probe.mjs return. */
import { parse } from "./colour.mjs";

/** One colour as a comparable key: rounded channels and a three-place alpha. */
export const key = (value) => {
  const colour = parse(value);
  return colour
    ? `${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])},${Number(colour[3].toFixed(3))}`
    : null;
};

/** Every stray, once per colour and role, with how many times the page painted it. */
export function strays(tokens, painted) {
  // One set per surface scope on the page: an element is judged against the tokens of the
  // surface it sits in, so a dark ink on a light page is a stray even though dark holds it.
  const held = tokens.values.map((scope) => new Set(scope.map(key)));
  const found = new Map();
  for (const paint of painted) {
    const colour = parse(paint.value);
    if (!colour || colour[3] === 0 || held[paint.scope]?.has(key(paint.value))) {
      continue;
    }
    const stray = `${key(paint.value)}|${paint.role}`;
    const seen = found.get(stray);
    if (seen) {
      seen.count += 1;
      continue;
    }
    found.set(stray, { count: 1, paint, colour });
  }
  return [...found.values()];
}
