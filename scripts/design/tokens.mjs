// The tokens are the source, or they are decoration. This collects every colour each route actually
// paints — ink, ground, edges with a width to show, gradients, shadows, drop-shadows, outlines and
// SVG paint — and asserts each one is a value some --pk-* token holds on the surface the element
// sits in. A colour on screen that is in no token is a literal someone typed, wherever it lives: a
// module, an inline style, a component default.
//
// Both sides are read the same way, by painting them and reading the browser's own answer, so
// `#0b0d1a` in the token file and `rgb(11, 13, 26)` on screen are never called different colours.
import { hex } from "./lib/colour.mjs";
import { COLOUR, paintedColours, resolveTokens } from "./lib/probe.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { strays } from "./lib/strays.mjs";
import { ROUTES } from "./routes.mjs";

const { results, blocked } = await eachRoute(ROUTES, async (page) => ({
  tokens: await page.evaluate(resolveTokens),
  painted: await page.evaluate(paintedColours, COLOUR),
}));

const problems = [];
for (const { route, value } of results) {
  if (!value.tokens.names.length) {
    // The stylesheet was unreadable or the tokens are not on this page. Without this, every colour
    // would be a stray and the report would be noise rather than a finding.
    problems.push({
      route,
      text: `${route.name}: no --pk-* tokens found on the page at all — the token stylesheet did not load, so nothing here can be judged against it.`,
    });
    continue;
  }
  for (const { count, paint, colour } of strays(value.tokens, value.painted)) {
    const alpha = colour[3] === 1 ? "" : ` at ${colour[3]} alpha`;
    problems.push({
      route,
      text: `${route.name} ${paint.selector}: ${hex(colour)}${alpha} as ${paint.role} is in no --pk-* token of its surface ×${count}`,
    });
  }
}

finish("tokens", {
  routes: ROUTES,
  blocked,
  results,
  summary: (value) => `${value.tokens.names.length} token(s), ${value.painted.length} paint(s)`,
  problems,
});
