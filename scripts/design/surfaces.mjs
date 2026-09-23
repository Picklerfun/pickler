// Both surfaces, and the inversion. The ground each route paints is the easy half; the half that
// matters is nesting, because that is the mechanism the whole system rests on. The landing's dark
// panels and the account's white wallet card are not rules of their own — they are a subtree taking
// the opposite data-surface. If nesting does not invert, the system is two themes wearing one name.
import { surfaces } from "./lib/probe.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { GROUND, ROUTES } from "./routes.mjs";

/* The blocks that must invert, named one by one. A selector rather than a boolean, and rather than
 * "does anything on this page invert": on every light route the first inverting pair in document
 * order is the shell's inverted "Create agent" action, so a boolean is satisfied by the nav no
 * matter what the screen's own block does. The portfolio's dark total panel was rebuilt as a
 * literal with no data-surface at all and this check stayed green, reporting that the portfolio
 * inverts when what inverted was the nav.
 *
 * Where the block carries an authored hook the selector names it and the check asserts the
 * data-surface separately, which tells "the block is gone" apart from "the block lost its surface".
 * The portfolio's total panel has neither id nor aria-label, so its selector has to lean on
 * [data-surface] to find it at all and the two failures collapse into one message. An id there
 * would separate them. */
const MUST_NEST = {
  landing: "#how",
  "portfolio-connected": 'main section[data-surface="dark"]',
  account: 'section[aria-label="Wallet"] [data-surface="light"]',
};

const { results, blocked } = await eachRoute(ROUTES, (page, route) =>
  page.evaluate(surfaces, MUST_NEST[route.name] ?? null),
);

const problems = [];
const notes = [];
for (const { route, value } of results) {
  const want = GROUND[route.surface];
  if (value.ground !== want) {
    problems.push({
      route,
      text: `${route.name} paints ${value.ground} at ${value.where} but is a ${route.surface} surface, which is ${want}`,
    });
  }
  if (value.root !== want) {
    problems.push({
      route,
      text: `${route.name}: --pk-bg resolves to ${value.root} at ${value.where}, but a ${route.surface} surface holds ${want}. The element is carrying the wrong data-surface, or something overrode the token.`,
    });
  }

  /* Every nested pair on the page, so a screen proves all its inversions or names which one
   * failed. A pair declaring the opposite surface to its parent must invert; a pair declaring the
   * same surface is redundant rather than wrong, and says so. */
  for (const pair of value.nests) {
    if (!pair.outer) {
      continue;
    }
    const where = `${pair.inner.selector} [${pair.inner.surface}] inside ${pair.outer.selector} [${pair.outer.surface}]`;
    if (pair.inner.surface === pair.outer.surface) {
      notes.push(`${route.name}: ${where} — same surface nested in itself, which changes nothing`);
      continue;
    }
    if (pair.inner.bg === pair.outer.bg) {
      problems.push({
        route,
        text: `${route.name}: ${where} computes the same --pk-bg (${pair.inner.bg}) as its parent, so declaring the opposite surface inverted nothing.`,
      });
      continue;
    }
    notes.push(
      `${route.name}: ${where} inverts — bg ${pair.inner.bg} on ${pair.outer.bg}, ink ${pair.inner.ink} on ${pair.outer.ink}, painting ${pair.inner.paints}${pair.inner.shell ? " (shared shell)" : ""}`,
    );
  }

  const wanted = MUST_NEST[route.name];
  if (!wanted) {
    notes.push(`${route.name}: no block on this screen is required to invert`);
    continue;
  }
  const nest = value.nest;
  if (!nest.found) {
    problems.push({
      route,
      text: `${route.name}: nothing matches ${wanted}. That block is either gone or no longer carries data-surface, and either way the one mechanism everything else rests on is unexercised on this screen. It must not be rebuilt as a literal ground and a literal ink: that paints the same pixels and inverts nothing.`,
    });
    continue;
  }
  if (!nest.surfaced) {
    problems.push({
      route,
      text: `${route.name}: ${nest.selector} matches ${wanted} but carries no data-surface, so whatever makes it look inverted is a literal rather than the system.`,
    });
    continue;
  }
  if (nest.inShell) {
    problems.push({
      route,
      text: `${route.name}: ${wanted} matched ${nest.selector}, which sits inside the shared nav, header or footer rather than in this screen's own content. The shell's inverted action satisfies a loose selector on every light route, so this assertion is being answered by something that is not the screen's block.`,
    });
    continue;
  }
  if (!nest.outer) {
    problems.push({
      route,
      text: `${route.name}: ${nest.inner.selector} takes data-surface="${nest.inner.surface}" but sits inside no other data-surface, so nothing is being inverted against.`,
    });
    continue;
  }
  if (nest.inner.bg === nest.outer.bg) {
    problems.push({
      route,
      text: `${route.name}: ${nest.inner.selector} [data-surface="${nest.inner.surface}"] inside ${nest.outer.selector} [data-surface="${nest.outer.surface}"] computes the same --pk-bg (${nest.inner.bg}) as its parent. Nesting the opposite value did not invert anything.`,
    });
    continue;
  }
  notes.push(
    `${route.name}: ${nest.inner.selector} (${nest.inner.surface}, ${nest.inner.bg}) inverts inside ${nest.outer.selector} (${nest.outer.surface}, ${nest.outer.bg})`,
  );
}

for (const note of notes) {
  process.stdout.write(`ok       ${note}\n`);
}
finish("surfaces", {
  routes: ROUTES,
  blocked,
  results,
  summary: (value) => `ground ${value.ground}`,
  problems,
});
