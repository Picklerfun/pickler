// Both surfaces, and the inversion. The ground each route paints is the easy half; the half that
// matters is nesting, because that is the mechanism the whole system rests on. The landing's dark
// panels and the account's white wallet card are not rules of their own — they are a subtree taking
// the opposite data-surface. If nesting does not invert, the system is two themes wearing one name.
import { surfaces } from "./lib/probe.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { GROUND, ROUTES } from "./routes.mjs";

// The two canvases that contain an inverted block. Each must prove nesting works, and a null here
// means the block was built with a literal instead — which is the failure worth catching.
const MUST_NEST = new Set(["landing", "account"]);

const { results, blocked } = await eachRoute(ROUTES, (page) => page.evaluate(surfaces));

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

  if (!value.nested) {
    if (MUST_NEST.has(route.name)) {
      problems.push({
        route,
        text: `${route.name} has no data-surface inside another data-surface. Its inverted block was built with a literal rather than by nesting, so the system is not doing its work: the one mechanism everything else rests on is unexercised here.`,
      });
    } else {
      notes.push(`${route.name}: no nested surface (none is required on this screen)`);
    }
    continue;
  }
  const { inner, outer } = value.nested;
  if (inner.bg === outer.bg) {
    problems.push({
      route,
      text: `${route.name}: ${inner.selector} [data-surface="${inner.surface}"] inside ${outer.selector} [data-surface="${outer.surface}"] computes the same --pk-bg (${inner.bg}) as its parent. Nesting the opposite value did not invert anything, so the inverted blocks cannot be built this way.`,
    });
    continue;
  }
  notes.push(
    `${route.name}: ${inner.selector} (${inner.surface}, ${inner.bg}) inverts inside ${outer.selector} (${outer.surface}, ${outer.bg})`,
  );
}

for (const note of notes) {
  process.stdout.write(`ok       ${note}\n`);
}
finish("surfaces", { routes: ROUTES, blocked, problems });
