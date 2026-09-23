// Contrast, read off the rendered page. This is the check that catches a component reading the
// wrong token: §4's table can be perfectly right while a heading reads --pk-ink-faint where it
// meant --pk-ink-muted, and only the rendering shows it.
//
// How much of the DOM: every element carrying its own text, with no cap. The walk is one evaluate
// call and costs milliseconds, so the thing worth rationing is the report, not the work. Findings
// are therefore grouped by the four things that decide a ratio — ink, ground, size, weight — so one
// mis-read token reports once with a count and a line to look at, instead of four hundred times.
import { composite, effectiveOpacity, hex, parse, ratio } from "./lib/colour.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { ROUTES } from "./routes.mjs";

// WCAG 1.4.3: large text is 24px at any weight, or 18.66px at 700 or more.
const LARGE = 24;
const LARGE_BOLD = 18.66;

const collect = () =>
  [...document.querySelectorAll("body *")]
    .filter((el) => {
      const carriesText = [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
      );
      // opacityProperty is deliberately off: an element dimmed to nothing is handled below and
      // reported, rather than disappearing from the walk as if it were not text at all.
      return (
        carriesText && el.checkVisibility({ opacityProperty: false, visibilityProperty: true })
      );
    })
    .map((el) => {
      const style = getComputedStyle(el);
      /* The chain from this element up to <html>: each ground it could be painted on, and the
       * element opacity at every level. Opacity is not part of a colour and compounds down the
       * tree — 0.55 inside 0.8 is 0.44 — so white ink on the dark panel at opacity 0.55 measures
       * 21:1 while the eye sees about four, and nothing in the source looks wrong. Suffix products
       * and compositing are done in Node against the tested arithmetic, so nothing here can quietly
       * disagree with lib/colour.mjs. */
      const chain = [];
      let painted = false;
      for (let node = el; node; node = node.parentElement) {
        const at = getComputedStyle(node);
        if (at.backgroundImage !== "none") {
          painted = true;
        }
        chain.push({
          opacity: Number(at.opacity),
          ground: at.backgroundColor.endsWith(", 0)") ? null : at.backgroundColor,
        });
      }
      const name = (node) =>
        node.tagName.toLowerCase() +
        (node.id ? `#${node.id}` : "") +
        (node.classList.length ? `.${node.classList[0]}` : "");
      return {
        selector: (el.parentElement ? `${name(el.parentElement)} > ` : "") + name(el),
        ink: style.color,
        chain,
        overImage: painted,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        text: el.textContent.trim().slice(0, 40).replace(/\s+/g, " "),
      };
    });

const { results, blocked } = await eachRoute(ROUTES, (page) => page.evaluate(collect));

const problems = [];
const invisible = [];
let overImage = 0;
for (const { route, value } of results) {
  const seen = new Map();
  for (const item of value) {
    const ink = parse(item.ink);
    if (!ink || ink[3] === 0) {
      continue;
    }
    if (item.overImage) {
      // An opaque gradient or starfield sits between the ink and any colour we can read, so any
      // number computed here would be fiction. Counted and named, never quietly passed.
      overImage += 1;
      continue;
    }
    /* Effective opacity at each level: the product of every opacity from that element up to the
     * root, because an ancestor's opacity dims its whole subtree against whatever is behind it. The
     * chain runs element-first, so these are suffix products. */
    const effective = effectiveOpacity(item.chain.map((level) => level.opacity));
    if (effective[0] === 0) {
      // Dimmed to nothing. A ratio for it would be arithmetic about something nobody can see, and
      // scoring it 1:1 would bury every real finding — but skipping it in silence would hide a
      // control someone switched off by accident, so it is named below instead of judged here.
      invisible.push(`${route.name} ${item.selector} — "${item.text}"`);
      continue;
    }
    // Composite the stack from the far end back: the page's own ground first, then anything
    // translucent painted over it, then the ink. White is what a browser paints under all of it.
    // Each layer carries its own alpha times the opacity in force where it is painted.
    let ground = [255, 255, 255, 1];
    for (let i = item.chain.length - 1; i >= 0; i -= 1) {
      const layer = item.chain[i].ground;
      if (!layer) {
        continue;
      }
      const colour = parse(layer);
      ground = composite([colour[0], colour[1], colour[2], colour[3] * effective[i]], ground);
    }
    const seenInk = composite([ink[0], ink[1], ink[2], ink[3] * effective[0]], ground);
    const large = item.size >= LARGE || (item.size >= LARGE_BOLD && item.weight >= 700);
    const need = large ? 3 : 4.5;
    const measured = ratio(seenInk, ground);
    if (measured >= need) {
      continue;
    }
    // One wrong token paints many elements. Group by what actually decides the ratio.
    const key = `${hex(seenInk)}|${hex(ground)}|${item.size}|${item.weight}`;
    const already = seen.get(key);
    if (already) {
      already.count += 1;
      continue;
    }
    seen.set(key, { count: 1 });
    problems.push({
      key,
      route,
      line: () =>
        `${route.name} ${item.selector}: ${measured.toFixed(2)} needs ${need} — ` +
        `${hex(seenInk)} on ${hex(ground)} at ${item.size}px/${item.weight}` +
        (effective[0] < 1 ? ` (opacity ${effective[0].toFixed(2)})` : "") +
        ` ×${seen.get(key).count} — "${item.text}"`,
    });
  }
}

if (invisible.length) {
  process.stdout.write(
    `note: ${invisible.length} text element(s) compute to opacity 0 — decorative, screen-reader\n` +
      `      only, or switched off by accident. Not scored, because a ratio for something nobody\n` +
      `      can see is arithmetic rather than a finding: ${invisible.slice(0, 3).join("; ")}` +
      `${invisible.length > 3 ? ", …" : ""}\n`,
  );
}

if (overImage) {
  process.stdout.write(
    `note: ${overImage} element(s) sit over a background image; their ground cannot be read, so ` +
      `they are not measured here and want eyes on the screenshots.\n`,
  );
}

finish("contrast", {
  routes: ROUTES,
  blocked,
  results,
  summary: (value) => `${value.length} text element(s)`,
  problems: problems.map((p) => ({ route: p.route, text: p.line() })),
});
