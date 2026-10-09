// Both surfaces, and the inversion. The ground each route paints is the easy half; the half that
// matters is nesting, because that is the mechanism the whole system rests on. The landing's dark
// panels and the account's white wallet card are not rules of their own — they are a subtree taking
// the opposite data-surface. If nesting does not invert, the system is two themes wearing one name.
import { surfaces } from "./lib/probe.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { GROUND, ROUTES } from "./routes.mjs";

/* Every block that must invert, per route, named one by one.
 *
 * An array rather than one selector, for the same reason it stopped being a boolean. The boolean
 * proved whichever pair came first in document order; one selector proves one block on a page that
 * has four. The landing has the hero phone, the three ways (`#how-hire` speaks for the first), the
 * steps' phone and the closing block — one id says nothing about the other three, and the ink defect
 * that produced 1.00:1 was a defect in exactly this class.
 *
 * Selectors must be scoped to the route's own content: the shared nav's inverted action satisfies a
 * loose selector on every light route, and a match inside nav, header or footer is refused below
 * rather than counted. Each selector asserts every element it matches, so a selector that is too
 * loose reports loudly instead of quietly standing for whichever element came first.
 *
 * Every selector here is an id, and that is deliberate rather than stylistic. These began as class
 * matches — `[class$="tape"]` and the like — which hold only while a block keeps exactly one class,
 * and whose looser cousin `[class*="tape"]` matches sixty elements on this page. An id is unique by
 * definition, which is the property the assertion needs.
 *
 * None of them may find the block by `[data-surface]`. A selector that does can never reach the
 * "matches but carries no data-surface" branch below: remove the attribute and the element stops
 * matching, so the block reports as missing and the sharper failure is dead code. Name the element,
 * then ask what surface it carries. */
const MUST_NEST = {
  landing: ["#hero-phone", "#how-hire", "#steps-phone", "#download"],
  create: ["#apply-hero", "#arena", "#apply-piece"],
  "portfolio-connected": ["#portfolio-balance"],
  account: ["#account-wallet-card"],
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
  for (const target of value.targets) {
    if (!target.matches.length) {
      problems.push({
        route,
        text: `${route.name}: nothing matches ${target.selector}. That block is either gone or no longer carries data-surface, and either way the one mechanism everything else rests on is unexercised for it. It must not be rebuilt as a literal ground and a literal ink: that paints the same pixels and inverts nothing.`,
      });
      continue;
    }
    const many = target.matches.length > 1 ? ` (${target.matches.length} matches)` : "";
    for (const match of target.matches) {
      if (!match.surfaced) {
        problems.push({
          route,
          text: `${route.name}: ${match.selector} matches ${target.selector}${many} but carries no data-surface, so whatever makes it look inverted is a literal rather than the system.`,
        });
        continue;
      }
      if (match.inShell) {
        problems.push({
          route,
          text: `${route.name}: ${target.selector} matched ${match.selector}, which sits inside the shared nav, header or footer rather than this screen's own content. The shell's inverted action satisfies a loose selector on every light route, so this assertion is being answered by something that is not the screen's block.`,
        });
        continue;
      }
      if (!match.outer) {
        problems.push({
          route,
          text: `${route.name}: ${match.inner.selector} takes data-surface="${match.inner.surface}" but sits inside no other data-surface, so nothing is being inverted against.`,
        });
        continue;
      }
      if (match.inner.bg === match.outer.bg) {
        problems.push({
          route,
          text: `${route.name}: ${match.inner.selector} [data-surface="${match.inner.surface}"] inside ${match.outer.selector} [data-surface="${match.outer.surface}"] computes the same --pk-bg (${match.inner.bg}) as its parent. Nesting the opposite value did not invert anything.`,
        });
        continue;
      }
      notes.push(
        `${route.name}: ${target.selector}${many} → ${match.inner.selector} (${match.inner.surface}, --pk-bg ${match.inner.bg}, painting ${match.inner.paints}) inverts inside ${match.outer.selector} (${match.outer.surface}, ${match.outer.bg})`,
      );
    }
  }
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
